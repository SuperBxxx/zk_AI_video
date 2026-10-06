// HTML 卡的运行时：给卡一个「按帧渲染」的入口。
//
// 为什么是这个形态：上游的卡是 Remotion/React 组件，逐帧执行 JavaScript，
// FFmpeg 表达不了；但**无头 Chromium 能**（实测 SVG/CSS 渐变/滤镜/3D 变换/clipPath
// 全部支持，且逐帧截图字节级确定）。所以把卡做成自足的 HTML：一张卡 = 一个 HTML 文件，
// 既能被渲染器逐帧抓帧合成视频，也能直接用浏览器打开看。
//
// 卡片契约见 types.ts。

import type { CardDefinition, CardParams, CardRenderOptions } from "./types";

/** 缓动：三次贝塞尔，与上游 Easing.bezier 同参（0.25, 0.8, 0.25, 1）。 */
function bezier(t: number): number {
  // ACT: 用牛顿迭代解 x(t)=progress 的一元三次，而非引入缓动库。
  // 上限：迭代 8 次，极端参数下误差 <1e-6，对逐帧动画完全够用。
  const x1 = 0.25, y1 = 0.8, x2 = 0.25, y2 = 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(u) - t;
    if (Math.abs(error) < 1e-6) break;
    const slope = sampleDX(u);
    if (Math.abs(slope) < 1e-6) break;
    u -= error / slope;
  }
  return sampleY(Math.min(1, Math.max(0, u)));
}

/** 与上游 interpolate(frame, [a,b], [from,to], {clamp}) 等价（线性）。 */
function interpolate(frame: number, input: [number, number], output: [number, number]): number {
  const [a, b] = input;
  const [from, to] = output;
  if (b === a) return frame >= b ? to : from;
  const progress = Math.min(1, Math.max(0, (frame - a) / (b - a)));
  return from + (to - from) * progress;
}
void interpolate;

/** 把参数取成最终值（缺省用卡声明的默认值），并校验区间。 */
function resolveParams(card: CardDefinition, overrides: Record<string, number> = {}): CardParams {
  const resolved: CardParams = {};
  for (const [name, spec] of Object.entries(card.params ?? {})) {
    const raw = overrides[name] ?? spec.value;
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`参数 ${name} 必须是数字`);
    if (raw < spec.min || raw > spec.max) throw new Error(`参数 ${name}=${raw} 超出 [${spec.min}, ${spec.max}]`);
    resolved[name] = raw;
  }
  const unknown = Object.keys(overrides).filter(name => !(name in (card.params ?? {})));
  if (unknown.length) throw new Error(`卡 ${card.meta.slug} 没有这些参数：${unknown.join("、")}`);
  return resolved;
}

/**
 * 设计坐标系。移植自上游 demos/_fixtures/Motion.tsx 的 `DesignStage`。
 *
 * 上游机制（29 行）：内容按 w×h 的设计坐标作画，`scale = 输出宽 / w` 等比放大铺满。
 * **卡片参数在设计坐标系里标定，改输出分辨率不需要动参数。**
 *
 * 与上游的差异：上游设计画布写死 480×270（16:9，只按宽算缩放），
 * 换画幅会变形。成片画幅不一定是 16:9，所以这里**把设计画布做成与输出同比例、
 * 短边固定**：输出 1080×1920 → 设计画布 270×480（scale 4）；
 * 输出 1920×1080 → 480×270（scale 4）。两种画幅下 scale 都是 4，参数完全通用。
 */
export const designShortSide = 270;
export function designCanvasFor(width: number, height: number) {
  const landscape = width >= height;
  return {
    w: landscape ? Math.round(designShortSide * (width / height)) : designShortSide,
    h: landscape ? designShortSide : Math.round(designShortSide * (height / width)),
    scale: landscape ? width / (designShortSide * (width / height)) : width / designShortSide,
  };
}

/**
 * 组装一个自足的 HTML 页面：把卡与运行时内联进去，不依赖任何外部文件。
 *
 * 之所以内联：卡要在 file:// 下被 Chrome 打开，ES module 的 import 会被 CORS 拦；
 * 而且「一张卡 = 一个 HTML 文件」这个形态本身就要求它能独立打开。
 */
export function buildCardPage(
  card: CardDefinition,
  overrides: Record<string, number> = {},
  sizeOverride: Partial<CardRenderOptions> = {},
): string {
  const params = resolveParams(card, overrides);
  // 输出画幅：调用方按**成片画幅**覆盖卡声明的默认值
  const width = sizeOverride.width ?? card.size.width;
  const height = sizeOverride.height ?? card.size.height;
  const design = designCanvasFor(width, height);
  // 放大方式（照抄上游 DesignStage 的两个选项）：
  //   scale（默认）= transform: scale，合成期放大。快，但字形靠亚像素抗锯齿，
  //                 同一帧两次截图可能不一致（实测竖屏会闪）。
  //   zoom        = CSS zoom，布局期放大，字形按目标尺寸重新光栅化 → 逐帧确定。
  // 文字密集或要求严格确定时用 zoom。
  const raster = sizeOverride.raster ?? "scale";
  // 卡按设计坐标作画；放大由外层完成
  const firstFrame = card.render(0, card.frames ?? 1, params, design);
  // ACT: 卡上的 render 是**对象方法简写**（`render(frame, total, params) {…}`），
  // 它去掉 function 关键字后**不是合法表达式** —— 直接 toString() 赋给 const 会
  // 语法错误，套 `new Function("return (…)"）` 也一样（两种都踩过）。
  // 所以把关键字补回去，得到的才是可用的函数源码。
  const renderBody = card.render.toString().trim();
  const renderSource = renderBody.startsWith("function")
    ? renderBody
    : `function ${renderBody}`;

  // ACT: render 里引用的**辅助函数**必须显式声明在卡的 helpers 上。
  // 早先是「从 render 源码里扫出被调用的名字，再在卡对象上找同名方法」——
  // 那是隐式契约：类型检查看不到那些名字（TS2304），而运行时却依赖文本扫描。
  // 现在改成显式读取 helpers；同时保留一个兜底：render 里调用、helpers 未声明、
  // 但卡对象上恰好有同名函数的名字，也一并内联（向后兼容自定义写法）。
  const declaredHelpers = (card.helpers ?? {}) as Record<string, (...args: never[]) => unknown>;
  const helperNames = new Set(Object.keys(declaredHelpers));
  const isNative = (fn: (...args: never[]) => unknown) => /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
  const builtins = new Set(["Math", "Number", "String", "JSON", "Object", "Array", "Boolean", "Set", "Map", "parseInt", "parseFloat", "isNaN", "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "render"]);
  for (const match of renderSource.match(/\b([A-Za-z_$][\w$]*)\s*\(/g) ?? []) {
    const name = match.replace(/\s*\($/, "");
    if (builtins.has(name) || helperNames.has(name)) continue;
    const candidate = (card as unknown as Record<string, unknown>)[name];
    if (typeof candidate !== "function") continue;
    // ACT: **不要内联原型上的原生方法**。踩过：卡里写了 `value.toLocaleString("en-US")`，
    // 抽取器把 `toLocaleString` 当成卡的辅助函数，而它的 toString() 是
    // `function toLocaleString() { [native code] }` —— 塞进页面就是语法错误，
    // 表现为页面静默加载失败。判据用 `[native code]`，比枚举名单可靠：
    // 名单会一直漏（toLocaleString / toFixed / toString …），而原生标记不会。
    if (isNative(candidate as (...args: never[]) => unknown)) continue;
    helperNames.add(name);
  }
  const helperSource = [...helperNames].map(name => {
    const fn = declaredHelpers[name] ?? ((card as unknown as Record<string, unknown>)[name] as (...args: never[]) => unknown);
    if (isNative(fn)) {
      throw new Error(`卡 ${card.meta.slug} 的 helpers 里含有原生函数 ${name}，无法内联；请把它从 helpers 里去掉（原生方法在页面里本来就有）`);
    }
    const source = fn.toString().trim();
    // 处理「对象方法简写」：补回 function 关键字
    return source.startsWith("function") ? source : `function ${name}${source.replace(/^[^(]*/, "")}`;
  }).join("\n");

  const script = [
    bezier.toString(),
    interpolate.toString(),
    helperSource,
    `const CARD_PARAMS = ${JSON.stringify(params)};`,
    `const CARD_DESIGN = ${JSON.stringify(design)};`,
    `const CARD_RENDER = ${renderSource};`,
    // ACT: 渲染入口按帧幂等 —— 每次都整段重写 innerHTML。
    // 这牺牲了一点性能（每帧重建 DOM），换来的是**确定性**：
    // 同一帧渲染两次结果逐字节一致（已实测），逐帧抓帧才不会闪。
    `window.renderAt = function (frame, total) {
  document.getElementById('stage').innerHTML = CARD_RENDER(frame, total || ${card.frames ?? 1}, CARD_PARAMS, CARD_DESIGN);
  return true;
};`,
  ].filter(Boolean).join("\n");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent;
               font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
  /* 输出画布：截图尺寸必须与之相等 */
  #output { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  /* 设计画布：卡只在这里作画，尺寸是设计坐标；等比放大铺满输出（上游 DesignStage 的做法）。
     写死设计尺寸 + 放大，卡就不必知道输出分辨率，参数也就能跨画幅通用。 */
  #stage { position: absolute; left: 0; top: 0; width: ${design.w}px; height: ${design.h}px;
           overflow: hidden; ${raster === "zoom"
             ? `zoom: ${design.scale};`
             : `transform: scale(${design.scale}); transform-origin: top left;`} }
  ${card.styles ?? ""}
</style></head>
<body><div id="output"><div id="stage">${firstFrame}</div></div>
<script>
${script}
</script></body></html>`;
}
