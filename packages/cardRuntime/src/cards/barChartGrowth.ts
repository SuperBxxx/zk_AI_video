// 柱状图增长（整体形状语义）。
//
// 按上游 video-talkcraft 的 references/cards/bar-chart-growth.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**全屏卡** —— 一排柱一次连续抬升，读的是**斜率**不是逐项数值。
//
// 与「逐项对比」（chart-grow 那类）的区别在三处，缺一处就变回逐项读（规格原文）：
//   · **柱多（7 根）、错峰密（0.06s）** —— 整组在 0.64s 内长完，
//     肉眼读作**一次连续的抬升**（像一道波扫过去），不是七个先后事件
//   · **柱顶不带数值** —— 单根柱的值不重要，重要的是这一排的斜率；
//     挂七个数字就把观众拉回「逐项读」，形状语义直接消失
//   · **结论收在一个 chip 上** ——「增长 42%」这句才是要被复述的东西
//
// 命门：柱子只用 `scaleY`（改 height 每帧触发重排），且 `transform-origin: 50% 100%`
// 才有「从地里长出来」的语义。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack, rand } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const barChartGrowth: CardDefinition = {
  meta: {
    slug: "barChartGrowth",
    title: "柱状图增长",
    category: "数据",
    shape: "fullscreen",
    oneliner: "七根柱以 0.06s 密错峰一次连续抬升、柱顶不带数值，结论收在一个 chip 上——读的是整体斜率。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/bar-chart-growth.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 96,
  params: {
    bars: { min: 3, max: 14, value: 7, description: "柱数；规格 7 根（密错峰才读作波形）" },
    stagger: { min: 1, max: 20, value: 2, description: "逐柱错峰帧数；规格 0.06s ≈ 2 帧，**必须密**" },
    growFrames: { min: 4, max: 40, value: 14, description: "单柱生长用时（帧）" },
    baselineFrame: { min: 0, max: 40, value: 7, description: "基线画出的时刻（规格 0.24s ≈ 7 帧）" },
    chipAt: { min: 0, max: 120, value: 46, description: "chip 出现帧" },
    accent: { min: 0, max: 1, value: 1, description: "chip 用强调色（1 开 / 0 中性）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #ffffff;
             display: flex; flex-direction: column; justify-content: center; padding: 0 8%; }
    .title { color: #1a1a1a; font-weight: 700; }
    .plot { position: relative; display: flex; align-items: flex-end; }
    /* 柱只用 scaleY：改 height 每帧触发重排；scaleY + origin bottom 才读作「从地里长出来」 */
    .bar { flex: 1; transform-origin: 50% 100%; border-radius: 4px 4px 0 0; }
    .axis { height: 2px; background: #1a1a1a; transform-origin: left center; }
    .chip { display: inline-block; color: #ffffff; font-weight: 700; border-radius: 999px; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const title = "近七年交付量";
    const chipText = "整体增长 42%";
    const titleSize = Math.round(design.h * 0.056);
    const chipSize = Math.round(design.h * 0.042);

    const plotHeight = Math.round(design.h * 0.46);
    const barGap = Math.round(design.w * 0.012);

    // 基线：从左画出
    const axisProgress = seg(frame, 0, params.baselineFrame, outCubic);

    // 柱高：整体上行 + 轻微起伏（读斜率，不是逐项）
    const heights = Array.from({ length: params.bars }, (_, i) => {
      const trend = 0.42 + (i / (params.bars - 1)) * 0.5;
      const wobble = (rand(i * 7.3) - 0.5) * 0.14;
      return Math.min(1, Math.max(0.18, trend + wobble));
    });

    const bars = heights.map((height, i) => {
      const start = params.baselineFrame + i * params.stagger;
      const grow = seg(frame, start, start + params.growFrames, outCubic);
      const scaleY = Math.max(0.001, grow);
      // 颜色：整体由浅到深（形状语义），不逐柱换色
      const depth = 0.42 + 0.5 * (i / (params.bars - 1));
      const color = `hsl(168, 62%, ${Math.round((1 - depth) * 46 + 22)}%)`;
      return `<span class="bar" data-check="柱" style="height:${(height * plotHeight).toFixed(1)}px;margin-right:${barGap}px;background:${color};transform:scaleY(${scaleY.toFixed(4)})"></span>`;
    }).join("");

    // chip：结论收在一处（规格：它替代了七个数值）
    const chipIn = seg(frame, params.chipAt, params.chipAt + 8, outBack);
    const chipScale = lerp(chipIn, 0.86, 1);
    const chipColor = params.accent > 0.5 ? "#0066cc" : "#2a2a2c";

    return `<div class="stage" data-check="舞台">
      <div class="title" data-check="标题" style="font-size:${titleSize}px;margin-bottom:${Math.round(design.h * 0.06)}px">${title}</div>
      <div class="plot" data-check="图表区" style="height:${plotHeight}px">
        ${bars}
      </div>
      <div class="axis" data-check="基线" style="transform:scaleX(${axisProgress.toFixed(4)})"></div>
      <div data-check="chip" style="margin-top:${Math.round(design.h * 0.07)}px;transform:scale(${chipScale.toFixed(4)});transform-origin:left center;opacity:${chipIn.toFixed(3)}">
        <span class="chip" style="background:${chipColor};font-size:${chipSize}px;padding:${Math.round(chipSize * 0.42)}px ${Math.round(chipSize * 0.9)}px">${chipText}</span>
      </div>
    </div>`;
  },
};
