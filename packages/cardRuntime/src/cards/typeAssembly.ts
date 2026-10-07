// 文字集结（琴键式裂升）。
//
// 按上游 video-shotcraft 的 gallery/source/type-assembly-moves.md 规格实现 A 式
// split-text-stagger（原实现在 demos/typography/type-assembly-moves/）。
//
// 形态：**全屏卡** —— 字符从看不见的裁切线下滑升入位，理性利落，通用度最高的一式。
//
// 规格要点：每字在 overflow 盒内 `translateY(115% → 0)` 并带 10% 过冲；
// 逐字 delay i×2f；基线同步生长。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const typeAssembly: CardDefinition = {
  meta: {
    slug: "typeAssembly",
    title: "文字集结",
    category: "文字",
    shape: "fullscreen",
    oneliner: "琴键式裂升：每字在裁切盒内从下方 115% 升起带 10% 过冲，逐字错峰 2 帧，基线同步生长。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/type-assembly-moves.md A 式",
  },
  size: { width: 1920, height: 1080 },
  frames: 72,
  params: {
    stagger: { min: 0, max: 10, value: 2, description: "逐字错峰帧数；规格 i×2f" },
    riseFrames: { min: 4, max: 30, value: 11, description: "单字升起用时（帧）；规格含 10% 过冲" },
    overshoot: { min: 0, max: 0.3, value: 0.1, description: "过冲比例；规格 10%" },
    startFrame: { min: 0, max: 30, value: 5, description: "起手帧" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #0d1117;
             display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .row { display: flex; align-items: flex-end; white-space: nowrap;
           font-weight: 800; color: #eafff5; }
    /* 每字一个裁切盒：升起的字在盒内被裁，才有「从线下滑上来」的语义 */
    .box { display: block; overflow: hidden; }
    .ch { display: block; }
    .sub { color: #7be0b0; font-weight: 600; letter-spacing: 0.14em; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const text = "把复杂的事讲简单";
    const chars = text.split("");
    const fontSize = Math.round(Math.min(design.h * 0.15, (design.w * 0.8) / (chars.length * 1.06)));
    const boxHeight = Math.round(fontSize * 1.3);
    const dropDistance = Math.round(fontSize * 1.15);   // 规格：translateY(115% → 0)

    const cells = chars.map((character, index) => {
      const start = params.startFrame + index * params.stagger;
      // 裂升：先冲过 0（过冲 10%），再落回 0
      const rise = seg(frame, start, start + params.riseFrames, outCubic);
      const settle = seg(frame, start + params.riseFrames * 0.6, start + params.riseFrames, outBack);
      const offset = rise < 1
        ? lerp(rise, dropDistance, 0)
        : lerp(settle, -dropDistance * params.overshoot, 0);
      return `<span class="box" data-check="字盒" style="width:${(fontSize * 1.06).toFixed(1)}px;height:${boxHeight}px">`
        + `<span class="ch" style="font-size:${fontSize}px;line-height:${boxHeight}px;text-align:center;`
        + `transform:translateY(${offset.toFixed(2)}px)">${character}</span>`
        + `</span>`;
    }).join("");

    // 基线同步生长
    const lastStart = params.startFrame + (chars.length - 1) * params.stagger;
    const baseline = seg(frame, params.startFrame + 4, lastStart + params.riseFrames, outCubic);
    const lineWidth = fontSize * chars.length * 1.06;

    // 副行：整句落定后跟进
    const subIn = seg(frame, lastStart + params.riseFrames + 4, lastStart + params.riseFrames + 16, outCubic);

    return `<div class="stage" data-check="舞台">
      <div class="row" data-check="整句" style="font-size:${fontSize}px">${cells}</div>
      <span data-check="基线" style="display:block;height:3px;background:#7be0b0;border-radius:2px;margin-top:${Math.round(fontSize * 0.16)}px;width:${(lineWidth * baseline).toFixed(1)}px;opacity:${baseline.toFixed(3)}"></span>
      <div class="sub" data-check="副行" style="font-size:${Math.round(fontSize * 0.2)}px;margin-top:${Math.round(fontSize * 0.34)}px;opacity:${subIn.toFixed(3)}">再快的工具也替代不了判断</div>
    </div>`;
  },
};
