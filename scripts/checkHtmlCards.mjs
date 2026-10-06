// HTML 卡的通用自检：渲染确定性 + 每位元素落位 + 多画幅几何。
//
// 为什么要这套：卡的画面靠肉眼看不出「差零点几像素被裁掉」这类问题
// （踩过：竖屏下恰好第 2 列消失）。这里用浏览器量几何，不靠看图。
//
// 用法：bun scripts/checkHtmlCards.mjs [--slug digitRoll] [--quick]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCardPage } from "@toonflow/card-runtime";
import { htmlCards, findHtmlCard } from "@toonflow/card-runtime/cards";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const only = argv.includes("--slug") ? argv[argv.indexOf("--slug") + 1] : undefined;
const port = Number(process.env.ZK_CDP_PORT ?? 9411);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const cards = only ? [findHtmlCard(only)] : htmlCards;
// 覆盖横竖方宽四种画幅：设计坐标机制的核心承诺就是「换画幅不改参数」
const aspects = [[1920, 1080], [1080, 1920], [1080, 1080], [2560, 1080]];

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

const paint = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { void document.body.offsetHeight; r(true); })))`;
const stage = join(root, ".tmp-build", "htmlCardCheck");

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
} catch {
  console.error(`连不上 127.0.0.1:${port} 的 Chrome。先跑：\n  bun scripts/renderCard.mjs --print-chrome`);
  process.exit(1);
}
const cdp = await Cdp.connect(targets.find(target => target.type === "page").webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const failures = [];
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const card of cards) {
  const total = card.frames ?? 1;
  // 抽 4 帧：起始、中段、落定、末帧 —— 既查同帧确定，也查帧间确实在动
  const sampleFrames = [0, Math.round(total * 0.35), total - 1, total - 1];
  for (const [width, height] of aspects) {
    const name = `${card.meta.slug}-${width}x${height}`;
    writeFileSync(join(stage, `${name}.html`), buildCardPage(card, {}, { width, height }));
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: pathToFileURL(join(stage, `${name}.html`)).href });
    await sleep(1200);
    if (await cdp.evaluate("typeof window.renderAt !== 'function'")) {
      failures.push(`${name}：页面没加载成功（window.renderAt 不存在）`);
      continue;
    }
    // 预热（挡掉页面刚加载时的光栅化过渡态）
    for (const frame of [0, Math.round(total / 2), 0]) {
      await cdp.evaluate(`window.renderAt(${frame})`);
      await cdp.evaluate(paint);
    }
    const sizes = new Set();
    let sameFrame = true;
    for (const frame of sampleFrames) {
      await cdp.evaluate(`window.renderAt(${frame})`);
      await cdp.evaluate(paint);
      const a = (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 })).data;
      await cdp.evaluate(`window.renderAt(${frame})`);
      await cdp.evaluate(paint);
      const b = (await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 })).data;
      if (a !== b) sameFrame = false;
      sizes.add(a.length);
    }
    // 落位自检：带 data-check 的元素必须完整落在**它声明的边界**内。
    // 默认边界是最靠近的 [data-check="舞台"]（没有就用视口）。
    // ACT: 只标注「不该溢出」的元素 —— 中心辉光、冲击环这类**故意溢出**的
    // 装饰层不要标（踩过：把它们标上后自检误报 12 项）。
    // 也不要用 offsetParent 当边界：卡里常用零尺寸的定位锚点包一层，
    // 那会让边界退化成一条线（踩过：数字层被判越界，实际是锚点没有尺寸）。
    const placement = await cdp.evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-check]')];
      const stage = document.querySelector('[data-check="舞台"]');
      const bounds = stage ? stage.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
      const bad = [];
      let checked = 0;
      for (const el of items) {
        if (el === stage) continue;
        checked += 1;
        const box = el.getBoundingClientRect();
        if (box.top < bounds.top - 0.5 || box.bottom > bounds.bottom + 0.5
          || box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) {
          bad.push({ check: el.dataset.check, box: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)], bounds: [Math.round(bounds.left), Math.round(bounds.top), Math.round(bounds.right), Math.round(bounds.bottom)] });
        }
      }
      return { checked, bad };
    })()`);
    const framesDiffer = sizes.size > 1;
    const ok = sameFrame && framesDiffer && placement.bad.length === 0;
    console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(28)} 同帧一致=${sameFrame ? "✓" : "✗"} 帧间有变化=${framesDiffer ? "✓" : "✗"} 落位检查=${placement.checked}项${placement.bad.length ? " ✗" : ""}`);
    if (!sameFrame) failures.push(`${name}：同一帧两次截图不一致（逐帧渲染会闪）`);
    if (!framesDiffer) failures.push(`${name}：各帧画面完全相同（动画没生效）`);
    for (const item of placement.bad) {
      failures.push(`${name}：${item.check} 越出边界 box=${item.box} bounds=${item.bounds}`);
    }
  }
}

if (failures.length) {
  console.log("");
  console.log(`HTML 卡自检失败 ${failures.length} 项：`);
  for (const failure of failures) console.log("  ✗ " + failure);
  process.exit(1);
}
console.log("");
console.log(`HTML 卡自检通过（${cards.length} 张 × ${aspects.length} 种画幅）`);
process.exit(0);
