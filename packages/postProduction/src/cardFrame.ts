// 卡的画幅契约：设计坐标的算法 + 渲染到目标画幅时的规则与校验。
//
// 这是这套卡最容易误用的一点，值得单独成文件，也值得放在 postProduction ——
// 它是**两个卡库共用的布局规则**，而 cardRuntime 只负责按规则作画。
// （cardRuntime 反过来 re-export 这里的 designCanvasFor，保证算法只有一份。）
//
// 约束：本包不得依赖任何 node 内置模块。此文件是纯数学 + 字符串，符合约束。
//
// ## 事实：卡是分辨率无关的
//
// 卡在**设计坐标**里作画（移植上游 Remotion 的 DesignStage 思路），调用方给目标画幅，
// 卡等比放大。规则是「**短边恒为 270，长边按画幅比伸缩**」：
//
//     1920×1080 → 设计 480×270  scale 4
//     1080×1920 → 设计 270×480  scale 4
//     1080×1080 → 设计 270×270  scale 4
//     2560×1080 → 设计 640×270  scale 4
//     3840×2160 → 设计 480×270  scale 8
//
// 所以**卡不会与 AI 视频画幅冲突** —— 竖屏视频就渲竖屏卡，不会出现「横屏卡拼竖屏视频」。
//
// ## 代价：竖屏下长句卡会缩字
//
// 竖屏的可用宽度只有 270（横屏是 480），长句为了不横向溢出，字号被宽度钳住。
// 实测 `digitRoll` / `typewriterTerminal` / `perCharacterRise` 在竖屏下字号缩小
// 约 1.7 倍。**不溢出是保住了，但竖屏可读性没有专门优化。**
//
// ## 规则
//
//   · `fullscreen`（替代这一段画面）—— 按**目标画幅**渲染，不能用自己的默认画幅
//   · `transition`（作用于前后两镜）—— 同上
//   · `overlay`（叠在 AI 视频上）—— 画幅**必须与目标视频一致**，否则缩放会造成
//     字幕与描边的非整数像素抖动，留白位置也会错
//
// 判断放这里统一做，渲染入口与工具共用同一份，避免两处规则漂移。

/** 设计画布的短边长度。所有卡都按这个短边标定参数。 */
export const designShortSide = 270;

/** 目标画幅 → 设计画布与放大倍数。 */
export function designCanvasFor(width: number, height: number): { w: number; h: number; scale: number } {
  const landscape = width >= height;
  return {
    w: landscape ? Math.round(designShortSide * (width / height)) : designShortSide,
    h: landscape ? designShortSide : Math.round(designShortSide * (height / width)),
    scale: landscape ? width / (designShortSide * (width / height)) : width / designShortSide,
  };
}

/** HTML 卡的输出形态。全屏卡替代这一段画面；叠加卡叠在 AI 视频上。 */
export type CardShape = "fullscreen" | "overlay" | "transition";

/**
 * 叠加卡在画面上**占用**的区域（归一化 0~1，相对画幅）；`"full"` 表示整屏参与。
 *
 * 为什么放在这里（而不是 cardRuntime）：这是**画幅契约**的一部分，与 CardShape 同类，
 * 渲染入口、工具与卡目录共用同一份定义；cardRuntime 反过来从这里引用，避免两处定义漂移。
 *
 * 它回答的是「生成视频之前要知道什么」：12 张叠加卡里 8 张把文字画在中间、1 张贴底，
 * `focusDimSpotlight` 与 `numberSlabPop` 更是整屏参与。不知道这件事就生成视频，
 * 主体很容易正好落在文字底下 —— 那时视频已经产出，只能重做。
 */
export type CardOcclusion = { x: number; y: number; w: number; h: number } | "full";

/** 目标画幅。 */
export interface FrameSize {
  width: number;
  height: number;
}

/** 一次画幅适配的结论。 */
export interface FrameFit {
  /** 卡按目标画幅渲染后，浏览器里的设计画布尺寸。 */
  design: { w: number; h: number; scale: number };
  /** 目标画幅是横 / 竖 / 方。 */
  orientation: "landscape" | "portrait" | "square";
  /** 必须提醒 Agent 的事实（不阻塞渲染）。 */
  warnings: string[];
}

/** 宽高比是否一致（容 0.5% 误差，挡掉 1920×1080 与 1918×1080 这种舍入差）。 */
export function sameAspect(a: FrameSize, b: FrameSize): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) < 0.005;
}

/**
 * 判断一张 HTML 卡渲染到目标画幅时的结论与提醒。
 *
 * **契约（这是唯一的硬规则）**：
 *   · `fullscreen` / `transition` —— 按**目标画幅**渲染。卡声明的 `baseSize` 只是默认值，
 *     与目标不同是预期的（12 张全屏卡的默认都是 1920×1080）。
 *   · `overlay` —— 作为透明层叠在视频上，**调用方必须按目标视频画幅渲染**。
 *
 * ACT: overlay 的 baseSize 同样是默认值（也是 1920×1080），调用方不会用错；
 * 所以不能拿「baseSize ≠ target」当告警依据 —— 那会对**每一次竖屏叠卡**都报警，
 * 是纯噪音。这里改为：只在**竖屏 + 叠加卡**时提醒一句「该卡是横屏构图调的」，
 * 让它是有信息量的提醒而不是复读契约。
 */
export function fitCardToFrame(
  card: { slug: string; shape: CardShape; baseSize: FrameSize },
  target: FrameSize,
): FrameFit {
  const design = designCanvasFor(target.width, target.height);
  const orientation = target.width > target.height ? "landscape"
    : target.width < target.height ? "portrait" : "square";
  const warnings: string[] = [];

  const baseOrientation = card.baseSize.width > card.baseSize.height ? "landscape"
    : card.baseSize.width < card.baseSize.height ? "portrait" : "square";

  if (orientation === "portrait" && card.shape === "overlay") {
    warnings.push(
      `这张叠加卡是**横屏构图**调的（默认 ${card.baseSize.width}×${card.baseSize.height}）。`
      + `按竖屏渲染不会变形（设计画布自动变 ${design.w}×${design.h}），但卡内的落位、字号比例`
      + `是按横屏调的，竖屏下文字会缩、留白位置未必合适 —— 用了要回看画面。`,
    );
  }

  if (card.shape === "fullscreen" && orientation !== baseOrientation) {
    warnings.push(
      `${orientation === "portrait" ? "竖屏" : "方画幅"}：卡会按 ${design.w}×${design.h} 的`
      + `设计画布渲染，与它默认的 ${card.baseSize.width}×${card.baseSize.height}（${baseOrientation === "landscape" ? "横屏" : "竖屏"}）`
      + `构图不同。**长句文字会自动缩字**（可用宽度从 480 量级降到 ${design.w}），`
      + `全屏文字卡在竖屏下建议改用短文案，或改用叠加卡。`,
    );
  }

  return { design, orientation, warnings };
}
