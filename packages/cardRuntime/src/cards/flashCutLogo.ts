// 白闪 + 标志简化定格。
//
// 按上游 video-shotcraft 的 gallery/source/white-flash-logo-simplify-cut.md 规格实现
// （原实现在 demos/transitions/white-flash-logo-simplify-cut/）。
//
// 形态：**全屏卡** —— 白闪过曝抹掉接缝，过曝峰值那一帧标志只剩剪影，
// 曝光回来后细节逐层长回来。用于段落收束到品牌落版。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outQuart, inOutQuad } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const flashCutLogo: CardDefinition = {
  meta: {
    slug: "flashCutLogo",
    title: "白闪标志定格",
    category: "转场",
    shape: "transition",
    semantics: ["转折", "标题"],
    inputs: ["场"],
    oneliner: "白闪过曝抹掉接缝——峰值那一帧标志只剩纯白剪影，曝光回来后细节逐层长回，最后落成品牌落版。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/white-flash-logo-simplify-cut.md",
  },
  size: { width: 1920, height: 1080 },
  // 起手 8f + 过曝冲上 6f + 峰值保持 3f + 曝光回落 24f + 定格
  frames: 66,
  params: {
    flashStart: { min: 0, max: 30, value: 8, description: "白闪起始帧" },
    flashFrames: { min: 1, max: 20, value: 6, description: "冲上过曝峰值用时（帧）" },
    peakHold: { min: 0, max: 20, value: 3, description: "峰值保持帧数" },
    recoverFrames: { min: 4, max: 60, value: 24, description: "曝光回落用时（帧）" },
    peak: { min: 0.8, max: 1, value: 1, description: "过曝峰值亮度（1 = 全白）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #0d1117;
             display: flex; align-items: center; justify-content: center; }
    .mark { display: flex; flex-direction: column; align-items: center; }
    .glyph { display: flex; align-items: center; gap: 0.18em; }
    .bar { border-radius: 6px; background: #7be0b0; }
    .word { color: #eafff5; font-weight: 800; letter-spacing: 0.06em; }
    .sub { color: #8b949e; font-weight: 500; letter-spacing: 0.18em; }
    /* 过曝层：纯白全屏，压在标志之上把一切抹平 */
    .flash { position: absolute; inset: 0; background: #ffffff; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const peakFrame = params.flashStart + params.flashFrames;
    const peakEnd = peakFrame + params.peakHold;
    const recoverEnd = peakEnd + params.recoverFrames;

    // 过曝曲线：冲上去（inOut）→ 峰值保持 → 回落（outQuart）
    let exposure: number;
    if (frame < params.flashStart) {
      exposure = 0;
    } else if (frame < peakFrame) {
      exposure = inOutQuad((frame - params.flashStart) / params.flashFrames);
    } else if (frame < peakEnd) {
      exposure = 1;
    } else if (frame < recoverEnd) {
      exposure = 1 - outQuart((frame - peakEnd) / params.recoverFrames);
    } else {
      exposure = 0;
    }
    const whiteOpacity = exposure * params.peak;

    // 标志本体：入场先用 outCubic 撑起
    const intro = seg(frame, 0, params.flashStart + 2, outCubic);
    const markScale = lerp(intro, 0.92, 1);
    // ACT: 过曝峰值那一帧标志只剩剪影 —— 用亮度和对比度把细节压掉，
    // 而不是换一个「剪影版」元素：同一元素的连续变化才读作「曝光变化」。
    const brightness = 1 + exposure * 3.4;
    const contrast = 1 - exposure * 0.85;
    const markOpacity = Math.max(0, 1 - exposure * 0.96);

    const barCount = 3;
    const barWidth = Math.round(design.w * 0.016);
    const barHeight = Math.round(design.h * 0.1);
    const bars = Array.from({ length: barCount }, (_, i) =>
      `<span class="bar" style="width:${barWidth}px;height:${barHeight * (0.55 + i * 0.225)}px;opacity:${(0.5 + i * 0.25).toFixed(2)}"></span>`).join("");

    const wordSize = Math.round(design.h * 0.11);
    const subSize = Math.round(design.h * 0.03);
    // 副行的细节最后长回来（曝光回落的后半段）
    const subIn = seg(frame, peakEnd + params.recoverFrames * 0.4, recoverEnd, outCubic);

    return `<div class="stage" data-check="舞台">
      <div class="mark" data-check="标志" style="transform:scale(${markScale.toFixed(4)});filter:brightness(${brightness.toFixed(2)}) contrast(${contrast.toFixed(2)});opacity:${markOpacity.toFixed(3)}">
        <div class="glyph">
          ${bars}
          <span class="word" style="font-size:${wordSize}px;margin-left:0.24em">住凯</span>
        </div>
        <span class="sub" style="font-size:${subSize}px;margin-top:${Math.round(design.h * 0.04)}px;opacity:${subIn.toFixed(3)}">把交付做成确定的事</span>
      </div>
      <span class="flash" style="opacity:${whiteOpacity.toFixed(3)}"></span>
    </div>`;
  },
};
