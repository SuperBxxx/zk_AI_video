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
import { spawn, spawnSync } from "node:child_process";
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
// 叠加卡必须输出**带透明通道**的视频才能叠在 AI 视频上（jpeg 没有 alpha，
// 用它渲叠加卡会得到白底，叠上去就是白框）。全屏卡走 jpeg 路径更快。
const wantAlpha = card.meta.shape === "overlay" || argv.includes("--alpha");

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

// 连上浏览器。**默认自己起一个**，也支持连已经在跑的（外层先起好、端口一致时直接用）。
//
// 这里有两个此前判错、后来实测纠正的点：
//
//  1. **「沙箱不允许起浏览器」是错的。** 早先一次没加 --no-sandbox 的失败尝试没有任何
//     报错线索，就被我归结成「环境不允许」，之后一直当成事实沿用。实测下来是能起的。
//  2. **但不能默认关沙箱。** 实测（见 scripts 的历史验证）：
//        Chrome 默认沙箱      → 起不来（本任务沙箱环境限制了它的沙箱初始化）
//        Chrome + --no-sandbox → 起得来
//        Edge   默认沙箱      → 起得来
//     也就是说「起不来」是**本任务环境**的限制，不是用户环境的。用户机器上不该关沙箱。
//
// 所以策略是**先试安全方式，失败才降级**：默认带沙箱启动，起不来再退到 --no-sandbox。
// 这样交付到用户机器上走的是安全路径，而受限环境里仍然能跑。
const chromeStartupTimeoutMs = 12000;

let ownedChrome = null;
let targets;
async function fetchTargets() {
  return await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
}

/**
 * 找本机的浏览器可执行文件。
 *
 * ACT: 必须用绝对路径 —— Windows 上 Chrome 默认不写进 PATH，`spawn("chrome")` 找不到
 * （踩过：报「起不了 Chrome」，实际是命令名解析失败，不是浏览器起不来）。
 *
 * 顺序：环境变量 → Chrome → **Edge**。
 * Edge 排在 Chrome 之后但必须在内：Windows 11 必装 WebView2 运行时（内核就是 Edge），
 * 而 Electrobun 桌面版本来就依赖它渲染界面 —— 所以**装了本应用的机器一定有 Edge**，
 * 但不一定有 Chrome。这就是「交付后浏览器会不会有问题」的答案：兜底是稳的。
 */
function resolveBrowser() {
  return [
    process.env.ZK_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean).find(candidate => existsSync(candidate));
}

/** 起一个浏览器实例并等 CDP 就绪；成功返回进程句柄，失败返回 null。 */
async function launchBrowser(executable, profile, port, extraArgs) {
  const child = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    ...extraArgs,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  const deadline = Date.now() + chromeStartupTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return child;
    } catch { /* 还没起来 */ }
  }
  if (!child.killed) child.kill();
  return null;
}

try {
  targets = await fetchTargets();
} catch {
  const browserPath = resolveBrowser();
  if (!browserPath) {
    console.error("找不到 Chrome/Edge。设 ZK_CHROME_PATH 指向可执行文件，或先手工起一个：\n  bun scripts/renderCard.mjs --print-chrome");
    process.exit(1);
  }
  const profile = join(root, ".tmp-build", "chromeProfile");
  mkdirSync(profile, { recursive: true });
  // 先试安全方式（带沙箱）。用户机器上就应该走这条。
  ownedChrome = await launchBrowser(browserPath, profile, cdpPort, []);
  if (!ownedChrome) {
    // 降级：某些受限环境（包括本任务的沙箱）会拦住 Chrome 的沙箱初始化，只能关掉它。
    // 这只在默认方式确实起不来时才发生，且会打印出来 —— 不要让它悄悄关掉沙箱。
    console.error("带沙箱起不来，降级为 --no-sandbox 重试（受限环境才会走到这里）");
    ownedChrome = await launchBrowser(browserPath, profile, cdpPort, ["--no-sandbox"]);
  }
  if (ownedChrome) {
    try { targets = await fetchTargets(); } catch { targets = undefined; }
  }
  if (!targets) {
    console.error(`起不了浏览器（${browserPath}，端口 ${cdpPort}）。可先手工起一个：\n  bun scripts/renderCard.mjs --print-chrome`);
    process.exit(1);
  }
}
/**
 * script 结束时收掉自己起的浏览器。
 *
 * ACT: 这里有两个坑，都实际踩过：
 *
 *  1. **必须杀整棵进程树**，`child.kill()` 不够。Chromium 是多进程架构，只杀父进程
 *     会留下 8~10 个孤儿子进程，它们还占着 profile 目录，下次启动可能直接失败。
 *     Windows 上用 `taskkill /T /F` 递归结束。
 *  2. **不能因为「启动器已退出」就跳过清理**。`chrome.exe` / `msedge.exe` 在 Windows 上
 *     是个启动器：它把真正的浏览器进程起起来后就自己退出了。所以 `child.exitCode !== null`
 *     恰恰是**最需要清理**的时刻 —— 早先在这里加了「已退出就 return」的判断，
 *     结果一次都没清掉。不能加那个判断。
 */
function shutdown() {
  if (!ownedChrome) return;
  const pid = ownedChrome.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    // 递归结束启动器及其全部子进程（启动器本身可能已退出，不影响 /T 按 pid 找树）
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try { ownedChrome.kill("SIGKILL"); } catch { /* 已经退了 */ }
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

// ── 透明底：叠加卡的 alpha 全靠这一步 ────────────────────────────────
//
// 踩过的坑（这一条花了很久才定位）：Chrome 截图**默认把画面合成到不透明白底上**，
// 即使页面自己写了 `html, body { background: transparent }`。结果是叠加卡渲出来
// 一层不透明白，叠到 AI 视频上等于把视频整块盖掉 —— 而 ffprobe 却报告
// `yuva444p12le`（ProRes 侧确实有 alpha 通道，只是通道里全是 255），
// 所以「像素格式带 a」**不等于**「真的有透明区域」，必须量像素才能发现。
//
// Chrome 154 已不认启动参数 `--default-background-color`（传了会直接起不来），
// 唯一有效的是 CDP 的 Emulation.setDefaultBackgroundColorOverride + 截图时
// background: "transparent" —— 两者缺一，输出都退回 rgb24。
//
// 对全屏卡也设，无害：全屏卡自己会画满背景。
const transparentOverride = await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
  color: { r: 0, g: 0, b: 0, a: 0 },
});
if (transparentOverride.error && wantAlpha) {
  console.error(`设置透明底失败，叠加卡的 alpha 会丢失：${JSON.stringify(transparentOverride.error)}`);
  process.exit(1);
}

// ACT: 页面导航后先**预热**：渲染几帧并等稳定，再开始正式抓帧。
// 踩过：预热前偶发「同一帧两次截图不一致」—— 页面刚加载时合成器/字体光栅化
// 还没进入稳态，第一次截图抓到的是过渡态。预热把这段不确定性挡在正式抓帧之外。
for (const frame of [0, 20, 40, 20, 0]) {
  await cdp.evaluate(`window.renderAt(${frame})`);
  await cdp.evaluate(awaitPaint);
}

// 确定性自检：同一帧渲染两次必须字节级一致，否则逐帧抓帧会闪
// ACT: 探针帧不能硬编码 —— 早先写死 renderAt(7)，短卡（--frames 2）会被夹到末帧，
// 两次截图必然相同，自检就变成了永远通过。取 min(7, total-2) 保证探针落在动画中段。
const probeFrame = Math.min(7, Math.max(0, total - 2));
await cdp.evaluate(`window.renderAt(${probeFrame})`);
await cdp.evaluate(awaitPaint);
const shotFormat = wantAlpha ? { format: "png", background: "transparent" } : { format: "jpeg", quality };
const first = await cdp.send("Page.captureScreenshot", shotFormat);
await cdp.evaluate(`window.renderAt(${probeFrame})`);
await cdp.evaluate(awaitPaint);
const second = await cdp.send("Page.captureScreenshot", shotFormat);
const deterministic = first.data === second.data;
console.log(`确定性自检：同一帧两次截图 ${deterministic ? "一致 ✓" : "不一致 ✗（逐帧渲染会闪，先修卡）"}`);

const frameDirectory = join(stageDirectory, "frames");
mkdirSync(frameDirectory, { recursive: true });
const started = Date.now();
for (let frame = 0; frame < total; frame++) {
  await cdp.evaluate(`window.renderAt(${frame})`);
  await cdp.evaluate(awaitPaint);
  const shot = await cdp.send("Page.captureScreenshot", {
    ...(wantAlpha ? { format: "png", background: "transparent" } : { format: "jpeg", quality }),
    captureBeyondViewport: false,
  });
  const extension = wantAlpha ? "png" : "jpg";
  writeFileSync(join(frameDirectory, `f${String(frame).padStart(5, "0")}.${extension}`), Buffer.from(shot.data, "base64"));
  if ((frame + 1) % 30 === 0 || frame === total - 1) {
    const elapsed = (Date.now() - started) / 1000;
    process.stdout.write(`\r  抓帧 ${frame + 1}/${total}  ${(elapsed / (frame + 1)).toFixed(2)}s/帧  预计剩 ${((total - frame - 1) * elapsed / (frame + 1)).toFixed(0)}s   `);
  }
}
console.log("");
const renderSeconds = (Date.now() - started) / 1000;

mkdirSync(dirname(output), { recursive: true });

// 叠加卡必须输出**带透明通道**的视频，否则没法叠在 AI 视频上。
// ACT: 两条渲染路径 —— 全屏卡走 jpeg 中间帧 + H.264（快）；叠加卡走 png 中间帧 +
// **ProRes 4444**（保 alpha）。jpeg 没有 alpha，用它渲叠加卡会得到白底，叠上去就是白框。
//
// 为什么不用 libvpx-vp9（体积更小）：实测本机的 libvpx-vp9 **不支持 alpha** ——
// 喂 png 进去也输出 yuv420p，alpha 被悄悄丢掉。保得住 alpha 的是 prores_ks / qtrle / png。
// 选 ProRes 4444：剪辑软件与 Final Cut 的标准带透明交付格式，体积也可控。
const composed = wantAlpha
  ? spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(fps), "-i", join(frameDirectory, "f%05d.png"),
    "-c:v", "prores_ks", "-pix_fmt", "yuva444p10le", "-profile:v", "4444",
    output], { encoding: "utf8" })
  : spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(fps), "-i", join(frameDirectory, "f%05d.jpg"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", output], { encoding: "utf8" });
if (composed.status !== 0) {
  console.error("ffmpeg 合成失败：" + (composed.stderr ?? "").slice(-400));
  process.exit(1);
}
const frames = readdirSync(frameDirectory).length;
console.log(`已完成：${output}`);
console.log(`  抓帧 ${renderSeconds.toFixed(1)}s（${(total / renderSeconds).toFixed(1)} 帧/秒）· 合成 ${frames} 帧 · ${(total / fps).toFixed(2)}s @ ${fps}fps${wantAlpha ? " · **带透明通道**（ProRes 4444）" : ""}`);

// ACT: 显式退出。本机的 Bun 在跑完这类脚本后**偶发不退出**（stdio 句柄没收干净），
// 会让外层 for 循环里的下一个渲染永远等下去。所有写入都是同步的，直接退出是安全的。
shutdown();
process.exit(0);
