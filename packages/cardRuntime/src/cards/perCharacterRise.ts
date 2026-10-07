// 逐字升起。
//
// 按上游 video-talkcraft 的 references/cards/per-character-rise.md 规格独立实现。
//
// ⚠️ video-talkcraft 是 PolyForm Noncommercial（商用需授权）。本卡只照规格重写，
// 未复制其实现文件。
//
// 形态：**叠加卡** —— 透明背景，一句话的判断/主张/口号立在画面上。
//
// 与规格逐条对齐（它的命门全在"两条不同缓动 + 极小的逐字错峰"上）：
//   · 每字从**自己位置下方**（字号 44%）升到位
//   · **位移 0.33s、淡入 0.70s 走两条不同缓动** —— 位移先停、淡入后停
//   · **逐字错峰仅 1 帧（0.033s）** —— 规格点名：错峰大了就读作「一个个蹦」，
//     只有 1 帧才能读作「一股气顶上来」
//   · 全程**零模糊零缩放**
//   · 收尾定格 1.2s

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outQuint } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const perCharacterRise: CardDefinition = {
  meta: {
    slug: "perCharacterRise",
    title: "逐字升起",
    category: "文字",
    shape: "overlay",
    semantics: ["论点", "金句"],
    inputs: ["V"],
    // ACT: 占位区（视频生成时要让开的地方）—— 居中一行逐字上浮（boxHeight ≈ 字号 × 1.25）；透明底
    occlusion: { x: 0.07, y: 0.34, w: 0.86, h: 0.32 },
    oneliner: "每字从自己位置下方升到位，位移与淡入走两条不同缓动、逐字只错峰一帧——整句读作「一股气顶上来」，不是一个个蹦。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/per-character-rise.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：静置 0.3s → 位移 0.33s → 淡入 0.70s → 收尾定格 1.2s，共约 2.43s
  frames: 73,
  params: {
    chars: { min: 1, max: 24, value: 9, description: "字数（规格：适合 6~10 字）" },
    startFrame: { min: 0, max: 40, value: 9, description: "起手静置帧数（规格约 0.3s = 9 帧）" },
    riseFrames: { min: 2, max: 30, value: 10, description: "位移用时（帧）；规格 0.33s ≈ 10 帧" },
    fadeFrames: { min: 5, max: 60, value: 21, description: "淡入用时（帧）；规格 0.70s ≈ 21 帧" },
    stagger: { min: 0, max: 6, value: 1, description: "逐字错峰帧数；规格**必须仅 1 帧**，大了读作一个个蹦" },
    distance: { min: 0, max: 1, value: 0.44, description: "起始下落距离（按字号的比例）；规格 44%" },
  },
  styles: `
    /* 叠加卡：透明背景，白字带投影保证在任意画面上可读 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .row { display: flex; align-items: flex-end; white-space: nowrap;
           font-weight: 700; color: #ffffff;
           text-shadow: 0 3px 22px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.65); }
    /* 每字一个裁切盒：升起的字不能被邻字看见（规格：零模糊零缩放，靠裁切不靠遮罩） */
    .box { display: block; overflow: hidden; }
    .ch { display: block; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    // 字号：同时受宽与高约束（窄画幅的瓶颈是宽度）
    const fontSize = Math.round(Math.min(
      design.h * 0.16,
      (design.w * 0.86) / (params.chars * 1.02),
    ));
    const boxHeight = Math.round(fontSize * 1.25);
    const dropDistance = Math.round(fontSize * params.distance);

    const text = "这不是增长，是换挡";
    const chars = text.split("").slice(0, params.chars);

    const cells = chars.map((character, index) => {
      // 每字自己的起点：起手静置 + 逐字错峰
      const start = params.startFrame + index * params.stagger;
      // 位移走 outQuint（先停），淡入走 outCubic（后停）—— 两条不同缓动是规格的命门
      const rise = seg(frame, start, start + params.riseFrames, outQuint);
      const fade = seg(frame, start, start + params.fadeFrames, outCubic);
      const offset = lerp(rise, dropDistance, 0);
      return `<span class="box" data-check="字盒" style="width:${(fontSize * 1.02).toFixed(1)}px;height:${boxHeight}px;align-items:flex-end">`
        + `<span class="ch" style="font-size:${fontSize}px;line-height:${boxHeight}px;text-align:center;`
        + `transform:translateY(${offset.toFixed(2)}px);opacity:${fade.toFixed(3)}">${character}</span>`
        + `</span>`;
    }).join("");

    return `<div class="stage">
      <div class="row" data-check="整句">${cells}</div>
    </div>`;
  },
};
