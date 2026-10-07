// 指标 + 迷你趋势线。
//
// 按上游 video-talkcraft 的 references/cards/metric-with-sparkline.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**全屏卡** —— 把「多少」和「往哪走」压成**一个动效**：
// 数字和曲线**同一刻起跑**，观众的眼睛在两者之间来回一次，就同时拿到两件事。
//
// 两条命门（规格原文）：
//   ① **滚动结束前不许出现单位和箭头** —— 数字还在跳时屏上就写着「%↑」，
//      等于结论比计算先到。单位与箭头是**结论签名**，必须押在数字定住那一帧
//   ② **折线与计数同刻起跑，不是先后** —— 错开哪怕 0.2s，读作「先讲数字，再补个图」

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack, rand } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const metricWithSparkline: CardDefinition = {
  meta: {
    slug: "metricWithSparkline",
    title: "指标迷你趋势线",
    category: "数据",
    shape: "fullscreen",
    oneliner: "小标签先淡入，大数字从 0 滚到终值，下方小折线在同一刻起跑画完；数字定住那一帧单位与箭头才出现。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/metric-with-sparkline.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 84,
  params: {
    value: { min: 0, max: 1000, value: 67, description: "终值" },
    countFrames: { min: 6, max: 60, value: 27, description: "计数用时（帧）；规格 0.9s = 27 帧" },
    lineFrames: { min: 6, max: 60, value: 18, description: "折线画完用时（帧）；规格 0.6s = 18 帧，**与计数同刻起跑**" },
    trendUp: { min: 0, max: 1, value: 1, description: "趋势向上（1 上 / 0 下）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #ffffff; padding: 0 8%;
             display: flex; flex-direction: column; justify-content: center; }
    .label { color: #8a8a8a; font-weight: 500; letter-spacing: 0.08em; }
    .numRow { display: flex; align-items: baseline; }
    .num { color: #1a1a1a; font-weight: 800; font-variant-numeric: tabular-nums; }
    .sign { color: #0066cc; font-weight: 700; }
    .spark { position: relative; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const label = "周活跃留存";
    const labelSize = Math.round(design.h * 0.036);
    const numSize = Math.round(design.h * 0.17);
    const signSize = Math.round(numSize * 0.42);

    const start = 8;
    // 标签先淡入
    const labelIn = seg(frame, 0, start, outCubic);
    // 计数：ease-out 滚到终值（与折线**同刻起跑**）
    const count = seg(frame, start, start + params.countFrames, outCubic);
    const shown = Math.round(count * params.value);
    // 折线：同一刻起跑
    const lineProgress = seg(frame, start, start + params.lineFrames, outCubic);

    // 数字定住那一帧：单位与箭头才出现（规格命门①）
    const settled = frame >= start + params.countFrames;
    const signIn = seg(frame, start + params.countFrames, start + params.countFrames + 6, outBack);
    const signScale = lerp(signIn, 0.7, 1);

    // 迷你折线：12 个采样点，整体随 trendUp 上行 + 确定性起伏
    const sparkWidth = Math.round(design.w * 0.34);
    const sparkHeight = Math.round(design.h * 0.075);
    const samples = 13;
    const points: [number, number][] = [];
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      const base = params.trendUp > 0.5 ? 0.18 + t * 0.72 : 0.82 - t * 0.72;
      const wobble = (rand(i * 5.1) - 0.5) * 0.16;
      const value = Math.min(0.98, Math.max(0.02, base + wobble));
      points.push([t * sparkWidth, sparkHeight - value * sparkHeight]);
    }
    // 只画到 lineProgress 处（画出来 = 描画进度）
    const visibleCount = Math.max(2, Math.ceil(lineProgress * samples));
    const drawn = points.slice(0, visibleCount);
    const sparkPath = drawn.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

    return `<div class="stage" data-check="舞台">
      <div class="label" data-check="标签" style="font-size:${labelSize}px;opacity:${labelIn.toFixed(3)}">${label}</div>
      <div class="numRow" data-check="数字行" style="margin-top:${Math.round(design.h * 0.02)}px">
        <span class="num" style="font-size:${numSize}px">${shown}</span>
        <span class="sign" style="font-size:${signSize}px;margin-left:0.12em;opacity:${signIn.toFixed(3)};transform:scale(${signScale.toFixed(3)});display:inline-block;transform-origin:left bottom">%</span>
        <span class="sign" data-check="箭头" style="font-size:${signSize}px;margin-left:0.1em;opacity:${signIn.toFixed(3)}">${params.trendUp > 0.5 ? "↑" : "↓"}</span>
      </div>
      <div class="spark" data-check="趋势线" style="margin-top:${Math.round(design.h * 0.03)}px">
        <svg width="${sparkWidth}" height="${sparkHeight}" viewBox="0 0 ${sparkWidth} ${sparkHeight}">
          <path d="${sparkPath}" fill="none" stroke="#0066cc" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>`;
  },
};
