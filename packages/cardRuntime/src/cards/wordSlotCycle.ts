// 词槽轮换。
//
// 按上游 video-talkcraft 的 references/cards/word-slot-cycle.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 句干左端锚死不动，句尾一个胶囊每 0.7s 向上翻一格换一个短语。
// 典型用法：「它能帮你 写代码 / 改简历 / 做 PPT / 查资料 → 搞定所有事」，
// 末词是结论。用在标题/要点层，**不作用于底部跟读字幕**（素排铁律）。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const wordSlotCycle: CardDefinition = {
  meta: {
    slug: "wordSlotCycle",
    title: "词槽轮换",
    category: "文字",
    shape: "overlay",
    oneliner: "句干锚死不动，句尾胶囊每 0.7s 向上翻一格换一个短语，末词换成结论并转强调色。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/word-slot-cycle.md",
  },
  size: { width: 1920, height: 1080 },
  // 4 个词 × 21 帧 + 末词定格
  frames: 132,
  params: {
    perWordFrames: { min: 6, max: 60, value: 21, description: "每个词的停留帧数；规格 0.7s = 21 帧" },
    flipFrames: { min: 2, max: 20, value: 8, description: "向上翻一格用时（帧）" },
    startFrame: { min: 0, max: 40, value: 10, description: "起手帧" },
    accentLast: { min: 0, max: 1, value: 1, description: "末词转强调色（1 开 / 0 全同色）" },
  },
  styles: `
    /* 叠加卡：透明底，白字带投影 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .row { display: flex; align-items: center; white-space: nowrap;
           font-weight: 700; color: #ffffff;
           text-shadow: 0 3px 22px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.65); }
    /* 句干：锚死不动（规格命门：左端锚死） */
    .stem { display: block; }
    /* 胶囊槽：只露出当前一格，翻上来的一格从下方进入 */
    .slot { display: block; overflow: hidden; position: relative; }
    .track { display: block; }
    .cell { display: block; text-align: center; border-radius: 999px;
            background: #1c2430; color: #eafff5; }
    .cellLast { background: #0066cc; color: #ffffff; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const stem = "它能帮你";
    const words = ["写代码", "改简历", "做 PPT", "搞定所有事"];
    const lastIndex = words.length - 1;

    const fontSize = Math.round(Math.min(design.h * 0.1, (design.w * 0.82) / (stem.length + 6) / 1.02));
    const cellHeight = Math.round(fontSize * 1.7);
    const stemWidth = Math.round(stem.length * fontSize * 1.02);
    const slotWidth = Math.round(Math.max(...words.map(w => w.length)) * fontSize * 1.02 + fontSize * 1.1);

    // 当前词与翻转进度：每个词停留 perWordFrames，翻格用 flipFrames
    const elapsed = Math.max(0, frame - params.startFrame);
    const slot = Math.floor(elapsed / params.perWordFrames);
    const withinSlot = elapsed - slot * params.perWordFrames;
    const currentIndex = Math.min(lastIndex, slot);
    // 翻转：在每格末尾的 flipFrames 内从当前词滑到下一个词（向上翻 = 轨迹上移）
    const flip = Math.min(1, Math.max(0, (withinSlot - (params.perWordFrames - params.flipFrames)) / params.flipFrames));
    const hasNext = currentIndex < lastIndex;
    const eased = hasNext ? seg(frame, params.startFrame + (currentIndex + 1) * params.perWordFrames - params.flipFrames,
      params.startFrame + (currentIndex + 1) * params.perWordFrames, outCubic) : 0;
    const trackOffset = (currentIndex + eased) * cellHeight;

    // 末词：胶囊转强调色（规格：末拍结论换强调色）
    const isLast = currentIndex === lastIndex;
    const accent = params.accentLast > 0.5 && isLast;

    // 整块入场：轻微上移淡入
    const intro = seg(frame, params.startFrame - 8, params.startFrame, outBack);

    const cells = words.map((word, index) => {
      const isFinal = index === lastIndex;
      const cls = params.accentLast > 0.5 && isFinal ? "cell cellLast" : "cell";
      return `<span class="${cls}" style="height:${cellHeight}px;line-height:${cellHeight}px;font-size:${fontSize}px;padding:0 ${Math.round(fontSize * 0.55)}px;white-space:nowrap">${word}</span>`;
    }).join("");

    return `<div class="stage">
      <div class="row" data-check="整句" style="font-size:${fontSize}px;opacity:${intro.toFixed(3)};transform:translateY(${lerp(intro, Math.round(fontSize * 0.2), 0).toFixed(2)}px)">
        <span class="stem" data-check="句干" style="width:${stemWidth}px">${stem}</span>
        <span class="slot" data-check="词槽" style="width:${slotWidth}px;height:${cellHeight}px;margin-left:${Math.round(fontSize * 0.24)}px">
          <span class="track" style="transform:translateY(${(-trackOffset).toFixed(2)}px)">${cells}</span>
        </span>
      </div>
    </div>`;
  },
};
