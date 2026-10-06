// 把一张 HTML 卡渲染成视频：无头 Chrome 逐帧抓帧 → ffmpeg 合成。
//
// 为什么走这条路（而不是 FFmpeg 滤镜链）：少数效果的表达力超出滤镜链 ——
// SVG 路径动画、渐变遮罩、CSS 滤镜、3D 变换、clipPath。上游那 229 个效果组件
// 几乎不用 WebGL/Canvas（0/3 个），全靠这些浏览器能力，所以**无头 Chromium 能渲染**。
//
// 实测数据（1920×1080，24 帧）：
//   · 同一帧截两次字节级一致 → 逐帧抓帧不会闪（确定性是这条路的前提）
//   · png 3.6 帧/秒（747 KB/帧）；jpeg q90 12.4 帧/秒（71 KB/帧）
//   瓶颈是图像编码，不是求值（只求值 4000 帧/秒），所以默认用 jpeg。
//
// 关于启动 Chrome：本机沙箱不允许脚本 spawn Chrome（crashpad 写配置被拒）。
// 所以本脚本**不自起浏览器** —— 先跑 `--print-chrome` 拿到命令、起好，再渲染。
//
// 用法：
//   bun scripts/renderCard.mjs --list
//   bun scripts/renderCard.mjs --card digitRoll --out out/digitRoll.mp4
//   bun scripts/renderCard.mjs --print-chrome
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCardPage } from "@toonflow/card-runtime";
import { findHtmlCard, htmlCardSummaries } from "@toonflow/card-runtime/cards";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const value = name => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const chromePath = process.env.ZK_CHROME
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const cdpPort = Number(value("port") ?? 9411);
const fps = Number(value("fps") ?? 30);
const quality = Number(value("quality") ?? 90);
const profileDirectory = join(root, ".tmp-build", "renderCardProfile");

if (flag("list")) {
  console.log("可用的 HTML 卡：");
  for (const card of htmlCardSummaries()) {
    console.log(`  ${card.slug.padEnd(14)} ${card.title}  [${card.category}]  ${card.size.width}×${card.size.height}  ${card.frames} 帧`);
    console.log(`      ${card.oneliner}`);
    if (card.origin) console.log(`      来源：${card.origin}`);
    console.log(`      参数：${card.params.join("、")}`);
  }
  process.exit(0);
}

if (flag("print-chrome")) {
  console.log("先在一个终端里启动它（本机沙箱不让脚本自起浏览器）：");
  console.log("");
  console.log(`  "${chromePath}" --remote-debugging-port=${cdpPort} --user-data-dir="${profileDirectory}" \\`);
  console.log(`    --headless=new --disable-gpu --no-first-run --hide-scrollbars --window-size=1920,1080 about:blank`);
  console.log("");
  console.log("然后另开一个终端跑渲染（本脚本会自动连上它）。");
  process.exit(0);
}

const slug = value("card");
if (!slug) {
  console.error("缺少 --card <slug>；用 --list 看有哪些卡。");
  process.exit(2);
}
const card = findHtmlCard(slug);
const total = Number(value("frames") ?? card.frames ?? 1);
const output = value("out") ?? join(root, "out", `${slug}.mp4`);
const overrides = {};
for (const name of Object.keys(card.params ?? {})) {
  const raw = value(name);
  if (raw !== undefined) overrides[name] = Number(raw);
}
// 画幅由**独立的命令行参数**决定，不是卡参数 ——
// 卡只按设计坐标作画（移植上游 DesignStage 的机制），输出分辨率完全由调用方定：
// 成片可能是 9:16 / 1:1 / 21:9，卡不该把画布写进自己的参数表。
// 踩过：早先这里写的是 `overrides.width ?? card.size.width`，而 width/height 早已
// 从卡参数里移除，于是 --width/--height 被**静默忽略**，输出永远是 1920×1080。
const width = Number(value("width") ?? card.size.width);
const height = Number(value("height") ?? card.size.height);

const ffmpeg = process.env.ZK_FFMPEG
  ?? "E:\\ffmpeg-2025-07-01-git-11d1b71c31-full_build\\bin\\ffmpeg.exe";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const cdp = new Cdp(ws);
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && cdp.pending.has(message.id)) {
        const { resolve, reject } = cdp.pending.get(message.id);
        cdp.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "求值失败");
    return result.result.value;
  }
}

// 连上已运行的 Chrome；没有就按 --print-chrome 的提示让用户先起
let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
} catch {
  console.error(`连不上 127.0.0.1:${cdpPort} 上的 Chrome。先跑：\n  bun scripts/renderCard.mjs --print-chrome`);
  process.exit(1);
}

// 卡页面写到工作目录外的临时目录：file:// 下加载更稳妥，也不污染工作区
const stageDirectory = join(root, ".tmp-build", "cardStage", slug);
rmSync(stageDirectory, { recursive: true, force: true });
mkdirSync(stageDirectory, { recursive: true });
const pagePath = join(stageDirectory, "card.html");
writeFileSync(pagePath, buildCardPage(card, overrides, { width, height }));

const page = targets.find(target => target.type === "page");
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
console.log(`卡 ${slug}：${width}×${height}，${total} 帧 @ ${fps}fps = ${(total / fps).toFixed(2)}s`);

// 视口与画布一致，否则截图尺寸不对
await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await cdp.send("Page.navigate", { url: pathToFileURL(pagePath).href });
await sleep(2200);
if (await cdp.evaluate("typeof window.renderAt !== 'function'")) {
  console.error("卡页面没加载成功（window.renderAt 不存在）。");
  process.exit(1);
}

// 确定性自检：同一帧渲染两次必须字节级一致，否则逐帧抓帧会闪。
//
// ACT: 设完帧必须**等一次真实绘制**再截图 —— 只改 innerHTML 就立刻截，
// 抓到的是上一帧还没提交的画面（踩过：同一帧两次截图不一致）。
// 用「双 rAF + 强制 reflow」代替 sleep：sleep 是赌，等绘制是确定。
const awaitPaint = `new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // 读一次布局属性，强制把改动提交到绘制
    void document.body.offsetHeight;
    resolve(true);
  }));
})`;

// ACT: 页面导航后先**预热**：渲染几帧并等稳定，再开始正式抓帧。
// 踩过：预热前偶发「同一帧两次截图不一致」—— 页面刚加载时合成器/字体光栅化
// 还没进入稳态，第一次截图抓到的是过渡态。预热把这段不确定性挡在正式抓帧之外。
for (const frame of [0, 20, 40, 20, 0]) {
  await cdp.evaluate(`window.renderAt(${frame})`);
  await cdp.evaluate(awaitPaint);
}

// 确定性自检：同一帧渲染两次必须字节级一致，否则逐帧抓帧会闪
await cdp.evaluate(`window.renderAt(7)`);
await cdp.evaluate(awaitPaint);
const first = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality });
await cdp.evaluate(`window.renderAt(7)`);
await cdp.evaluate(awaitPaint);
const second = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality });
const deterministic = first.data === second.data;
console.log(`确定性自检：同一帧两次截图 ${deterministic ? "一致 ✓" : "不一致 ✗（逐帧渲染会闪，先修卡）"}`);

const frameDirectory = join(stageDirectory, "frames");
mkdirSync(frameDirectory, { recursive: true });
const started = Date.now();
for (let frame = 0; frame < total; frame++) {
  await cdp.evaluate(`window.renderAt(${frame})`);
  await cdp.evaluate(awaitPaint);
  const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality, captureBeyondViewport: false });
  writeFileSync(join(frameDirectory, `f${String(frame).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
  if ((frame + 1) % 30 === 0 || frame === total - 1) {
    const elapsed = (Date.now() - started) / 1000;
    process.stdout.write(`\r  抓帧 ${frame + 1}/${total}  ${(elapsed / (frame + 1)).toFixed(2)}s/帧  预计剩 ${((total - frame - 1) * elapsed / (frame + 1)).toFixed(0)}s   `);
  }
}
console.log("");
const renderSeconds = (Date.now() - started) / 1000;

mkdirSync(dirname(output), { recursive: true });
// ACT: 中间帧用 jpeg（比 png 快 3.4 倍），再编成 H.264。
// 代价是多一次有损压缩；q90 的损失远低于 H.264 自身的量化，成片看不出差别。
const composed = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(fps), "-i", join(frameDirectory, "f%05d.jpg"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", output], { encoding: "utf8" });
if (composed.status !== 0) {
  console.error("ffmpeg 合成失败：" + (composed.stderr ?? "").slice(-400));
  process.exit(1);
}
const frames = readdirSync(frameDirectory).length;
console.log(`已完成：${output}`);
console.log(`  抓帧 ${renderSeconds.toFixed(1)}s（${(total / renderSeconds).toFixed(1)} 帧/秒）· 合成 ${frames} 帧 · ${(total / fps).toFixed(2)}s @ ${fps}fps`);

// ACT: 显式退出。本机的 Bun 在跑完这类脚本后**偶发不退出**（stdio 句柄没收干净），
// 会让外层 for 循环里的下一个渲染永远等下去。所有写入都是同步的，直接退出是安全的。
process.exit(0);
