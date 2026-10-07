// 活体折线图（示波流线）。
//
// 按上游 video-shotcraft 的 gallery/source/chart-live-moves.md 规格实现 A 式
// oscilloscope-stream（原实现在 demos/data/chart-live-moves/）。
//
// 形态：**全屏卡** —— 曲线写入点钉在右端上下起伏、旧数据左流出画，
// 中途一次突发尖峰。「实时」不用说出口，而且有事件。
//
// 规格要点：采样窗平移约 8px/f；尖峰振幅约 2.2×、读数跳大变强调色；
// 刹停后要**真静止**（曲线不再动）。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, rand } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const chartLiveOscilloscope: CardDefinition = {
  meta: {
    slug: "chartLiveOscilloscope",
    title: "活体折线图",
    category: "数据",
    shape: "fullscreen",
    semantics: ["数据", "过程演示"],
    inputs: ["文"],
    oneliner: "示波流线：曲线写入点钉在右端起伏、旧数据左流出画，中途一次突发尖峰让读数跳变——把「系统活着」演出来。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/chart-live-moves.md A 式",
  },
  size: { width: 1920, height: 1080 },
  frames: 150,
  params: {
    points: { min: 20, max: 120, value: 64, description: "采样点个数（决定曲线长度）" },
    scrollPxPerFrame: { min: 0, max: 30, value: 8, description: "采样窗平移速度（规格约 8px/帧）" },
    spikeAt: { min: 0, max: 200, value: 78, description: "突发尖峰的起始帧" },
    spikeAmp: { min: 1, max: 4, value: 2.2, description: "尖峰振幅倍数（规格 2.2×）" },
    readout: { min: 0, max: 100, value: 62, description: "演示读数（%）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #0d1117; padding: 6% 7%; }
    .head { display: flex; align-items: baseline; gap: 0.6em; }
    .label { color: #8b949e; font-weight: 500; letter-spacing: 0.08em; }
    .value { color: #7be0b0; font-weight: 700; font-variant-numeric: tabular-nums; }
    .unit { color: #8b949e; font-weight: 500; }
    .plot { position: absolute; left: 7%; right: 7%; top: 26%; bottom: 14%; }
    .grid { position: absolute; inset: 0; }
    .hline { position: absolute; left: 0; right: 0; height: 1px; background: #1f2630; }
    .axis { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: #30363d; }
    .line { position: absolute; inset: 0; }
    .tip { position: absolute; width: 10px; height: 10px; border-radius: 50%;
           background: #7be0b0; box-shadow: 0 0 14px rgba(123,224,176,0.9); }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const label = "实时吞吐";
    const spikeStart = params.spikeAt;
    const spikeEnd = params.spikeAt + 16;
    // 刹停：尖峰过后曲线逐渐不动（真静止）
    const settleFrame = spikeEnd + 26;

    // 采样窗平移：到刹停帧为止按 scrollPxPerFrame 推进，之后冻结
    const scrollFrames = Math.max(0, Math.min(frame, settleFrame));
    const scroll = scrollFrames * params.scrollPxPerFrame;

    const plotWidth = design.w * 0.86;
    const plotHeight = design.h * 0.6;
    const step = plotWidth / (params.points - 1);

    // 读数：尖峰期跳大（规格：读数跳大变强调色）
    const inSpike = frame >= spikeStart && frame < spikeEnd;
    const spikeRise = seg(frame, spikeStart, spikeStart + 6, outCubic);
    const spikeFall = seg(frame, spikeStart + 6, spikeEnd, outCubic);
    const spikeShape = spikeRise < 1 ? spikeRise : 1 - spikeFall;
    const readoutValue = params.readout * (1 + (params.spikeAmp - 1) * spikeShape * 0.34);
    const emphasis = inSpike;

    // 曲线：以「滚动窗口」生成采样点。越靠右越新。
    const points: [number, number][] = [];
    for (let i = 0; i < params.points; i += 1) {
      // 该点的世界坐标（越大越新）
      const worldX = scroll + (params.points - 1 - i) * step * 0.14;
      // 基线：缓慢余弦起伏 + 确定性噪声
      let value = 0.5 + 0.08 * Math.cos(worldX * 0.06) + 0.05 * (rand(i * 3.7) - 0.5) * 2;
      // 尖峰：在世界坐标进入窗口的窄带内抬升
      const spikeCenter = spikeStart * params.scrollPxPerFrame;
      const distance = Math.abs(worldX - spikeCenter);
      const spikeWidth = step * 2.2;
      if (spikeRise > 0 && distance < spikeWidth) {
        const bell = 1 - distance / spikeWidth;
        value += (params.spikeAmp - 1) * 0.28 * bell * bell * (frame >= spikeStart ? 1 : 0);
      }
      // 最右端（最新）轻微上下起伏 —— 写入点
      if (i === params.points - 1) value += 0.012 * Math.sin(frame * 0.4);
      const clamped = Math.min(0.98, Math.max(0.02, value));
      points.push([i * step, plotHeight - clamped * plotHeight]);
    }
    const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const areaPath = `${path} L ${plotWidth.toFixed(1)} ${plotHeight.toFixed(1)} L 0 ${plotHeight.toFixed(1)} Z`;
    const tipPoint = points[points.length - 1];

    const labelSize = Math.round(design.h * 0.032);
    const valueSize = Math.round(design.h * 0.072);
    const hlines = [0.25, 0.5, 0.75].map(ratio =>
      `<span class="hline" style="top:${(plotHeight * ratio).toFixed(1)}px"></span>`).join("");

    return `<div class="stage" data-check="舞台">
      <div class="head" data-check="读数行">
        <span class="label" style="font-size:${labelSize}px">${label}</span>
        <span class="value" style="font-size:${valueSize}px;color:${emphasis ? "#ffb454" : "#7be0b0"}">${readoutValue.toFixed(1)}</span>
        <span class="unit" style="font-size:${labelSize}px">req/s</span>
      </div>
      <div class="plot" data-check="图表区">
        <div class="grid">${hlines}</div>
        <div class="axis"></div>
        <svg class="line" data-check="曲线" viewBox="0 0 ${plotWidth.toFixed(1)} ${plotHeight.toFixed(1)}" preserveAspectRatio="none" width="100%" height="100%">
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${emphasis ? "#ffb454" : "#7be0b0"}" stop-opacity="0.34" />
              <stop offset="100%" stop-color="${emphasis ? "#ffb454" : "#7be0b0"}" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#fill)" />
          <path d="${path}" fill="none" stroke="${emphasis ? "#ffb454" : "#7be0b0"}" stroke-width="3"
                stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
        <span class="tip" style="left:${tipPoint[0].toFixed(1)}px;top:${tipPoint[1].toFixed(1)}px;margin:-5px 0 0 -5px;background:${emphasis ? "#ffb454" : "#7be0b0"}"></span>
      </div>
    </div>`;
  },
};
