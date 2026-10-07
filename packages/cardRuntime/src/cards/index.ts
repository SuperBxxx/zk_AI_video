// HTML 卡的索引。每张卡是一个可在浏览器独立打开的文件生成器。
//
// 与 FFmpeg 卡库（packages/postProduction 的 cardLibrary）的分工：
//   · FFmpeg 卡：能用滤镜链等价表达的简单效果，极快、零依赖
//   · HTML 卡（这里）：需要 SVG 路径动画 / 渐变遮罩 / CSS 滤镜 / clipPath 等
//     浏览器能力的复杂效果，由无头 Chromium 逐帧渲染后交给 ffmpeg 合成
import { digitRoll } from "./digitRoll";
import { counterConfetti } from "./counterConfetti";
import { numberSlabPop } from "./numberSlabPop";
import { typewriterTerminal } from "./typewriterTerminal";
import { typewriterReveal } from "./typewriterReveal";
import { perCharacterRise } from "./perCharacterRise";
import { keywordPopHighlight } from "./keywordPopHighlight";
import { highlighterSweep } from "./highlighterSweep";
import { focusDimSpotlight } from "./focusDimSpotlight";
import { markerUnderlineTitle } from "./markerUnderlineTitle";
import { scanlineAnnotateFocus } from "./scanlineAnnotateFocus";
import { handDrawnEllipse } from "./handDrawnEllipse";

export const htmlCards = [
  digitRoll,
  counterConfetti,
  numberSlabPop,
  typewriterTerminal,
  typewriterReveal,
  perCharacterRise,
  keywordPopHighlight,
  highlighterSweep,
  focusDimSpotlight,
  markerUnderlineTitle,
  scanlineAnnotateFocus,
  handDrawnEllipse,
];

export function findHtmlCard(slug: string) {
  const card = htmlCards.find(item => item.meta.slug === slug);
  if (!card) throw new Error(`没有这张 HTML 卡：${slug}（现有：${htmlCards.map(item => item.meta.slug).join("、")}）`);
  return card;
}

export function htmlCardSummaries() {
  return htmlCards.map(card => ({
    slug: card.meta.slug,
    title: card.meta.title,
    category: card.meta.category,
    oneliner: card.meta.oneliner,
    origin: card.meta.origin,
    size: card.size,
    frames: card.frames,
    params: Object.entries(card.params ?? {}).map(([name, spec]) => `${name}(${spec.min}~${spec.max}，默认 ${spec.value})`),
  }));
}
