// 仪表自检指针。
//
// 按上游 video-shotcraft 的 gallery/source/gauge-readout-moves.md 规格实现 A 式
// needle-sweep-selftest（原实现在 demos/data/gauge-readout-moves/）。
//
// 形态：**全屏卡** —— 汽车点火自检的仪表盘：指针先「唰」地甩满全弧再回落定格真实值，
// 先亮量程再报数，落定同帧盘下数值弹出。开场宣誓感。
//
// 规格要点：去程 ~12f ease-out 甩满 270° 全弧；回程 ~20f 带过冲回摆落真值；
// 落定同帧数值弹出。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = {
  ...motionHelpers(),
  // ACT: render 用到的模块级函数**必须声明在 helpers 里**，否则不会跟着内联进页面，
  // 页面会报 `xxx is not defined`（踩过：polar 漏了、渲染直接失败）。
  polar: polar as unknown as (...args: never[]) => unknown,
};

/** 极坐标 → 直角（角度以正上方为 0、顺时针为正）。 */
function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

export const gaugeReadout: CardDefinition = {
  meta: {
    slug: "gaugeReadout",
    title: "仪表自检指针",
    category: "数据",
    shape: "fullscreen",
    oneliner: "点火自检式仪表：指针先甩满 270° 全弧再带过冲回摆落定真实值，刻度随指针点亮，落定同帧数值弹出。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/gauge-readout-moves.md A 式",
  },
  size: { width: 1920, height: 1080 },
  frames: 96,
  params: {
    sweepStart: { min: 0, max: 60, value: 10, description: "起扫帧" },
    sweepFrames: { min: 4, max: 40, value: 12, description: "去程用时（帧）；规格 ~12f" },
    returnFrames: { min: 4, max: 60, value: 20, description: "回程用时（帧）；规格 ~20f 带回摆过冲" },
    value: { min: 0, max: 100, value: 68, description: "定格真实值（百分比）" },
    ticks: { min: 5, max: 40, value: 21, description: "刻度条数" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #0d1117;
             display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .dial { position: relative; }
    .readout { position: absolute; left: 50%; transform: translateX(-50%); text-align: center; }
    .num { color: #eafff5; font-weight: 800; font-variant-numeric: tabular-nums; }
    .unit { color: #8b949e; font-weight: 500; letter-spacing: 0.12em; }
    .needle { position: absolute; left: 50%; top: 50%; transform-origin: 50% 100%; }
    .hub { position: absolute; left: 50%; top: 50%; border-radius: 50%; background: #7be0b0;
           box-shadow: 0 0 22px rgba(123,224,176,0.8); transform: translate(-50%,-50%); }
    .tick { position: absolute; left: 50%; top: 50%; background: #30363d; transform-origin: 50% 0%; }
    .tickOn { background: #7be0b0; box-shadow: 0 0 10px rgba(123,224,176,0.75); }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const size = Math.round(Math.min(design.w * 0.52, design.h * 0.78));
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.42;
    // 270° 全弧：从 -135° 到 +135°
    const startAngle = -135;
    const endAngle = 135;
    const angleAt = (ratio: number) => startAngle + (endAngle - startAngle) * ratio;

    const targetRatio = params.value / 100;
    // 去程：甩满全弧（ease-out）
    const out = seg(frame, params.sweepStart, params.sweepStart + params.sweepFrames, outCubic);
    // 回程：从 1 带过冲回摆到真值（outBack 到 1 之后自然回落）
    const back = seg(frame, params.sweepStart + params.sweepFrames,
      params.sweepStart + params.sweepFrames + params.returnFrames, outBack);
    // 组合：去程到 1，回程从 1 到 target（outBack 提供过冲，会短暂低于 target 再回来）
    const ratio = out < 1 ? out : lerp(back, 1, targetRatio);

    const angle = angleAt(Math.min(1, Math.max(0, ratio)));
    // 指针长度与宽度
    const needleLength = radius * 1.02;
    const needleWidth = Math.round(size * 0.012);

    // 刻度：随指针点亮（扫过的刻度变强调色）
    const ticks = Array.from({ length: params.ticks }, (_, i) => {
      const tickRatio = i / (params.ticks - 1);
      const tickAngle = angleAt(tickRatio);
      const lit = ratio >= tickRatio - 0.001;
      const tickLength = i % 5 === 0 ? size * 0.055 : size * 0.03;
      return `<span class="tick ${lit ? "tickOn" : ""}" style="width:${Math.max(2, Math.round(size * 0.005))}px;height:${tickLength.toFixed(1)}px;transform:translate(-50%,0) rotate(${tickAngle.toFixed(2)}deg) translateY(${(-radius).toFixed(1)}px)"></span>`;
    }).join("");

    // 弧线（量程）
    const arcFrom = polar(cx, cy, radius * 1.12, startAngle);
    const arcTo = polar(cx, cy, radius * 1.12, endAngle);
    const arcPath = `M ${arcFrom[0].toFixed(1)} ${arcFrom[1].toFixed(1)} A ${(radius * 1.12).toFixed(1)} ${(radius * 1.12).toFixed(1)} 0 1 1 ${arcTo[0].toFixed(1)} ${arcTo[1].toFixed(1)}`;

    // 数值：落定同帧弹出（去程+回程结束的那一帧）
    const settleFrame = params.sweepStart + params.sweepFrames + params.returnFrames;
    const popIn = seg(frame, settleFrame, settleFrame + 5, outBack);
    const numScale = lerp(popIn, 0.8, 1);

    const numSize = Math.round(size * 0.17);
    const unitSize = Math.round(size * 0.045);

    return `<div class="stage" data-check="舞台">
      <div class="dial" data-check="表盘" style="width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" style="position:absolute;left:0;top:0">
          <path d="${arcPath}" fill="none" stroke="#1f2630" stroke-width="${Math.round(size * 0.014)}" stroke-linecap="round" />
        </svg>
        ${ticks}
        <span class="needle" data-check="指针" style="width:${needleWidth}px;height:${needleLength.toFixed(1)}px;margin-left:${(-needleWidth / 2).toFixed(1)}px;margin-top:${(-needleLength).toFixed(1)}px;transform:rotate(${angle.toFixed(2)}deg);background:linear-gradient(180deg,#eafff5,#7be0b0);border-radius:${needleWidth}px"></span>
        <span class="hub" style="width:${Math.round(size * 0.055)}px;height:${Math.round(size * 0.055)}px"></span>
        <div class="readout" data-check="读数" style="top:${(cy + radius * 0.34).toFixed(1)}px;transform:translateX(-50%) scale(${numScale.toFixed(4)})">
          <span class="num" style="font-size:${numSize}px">${params.value}</span>
          <span class="unit" style="font-size:${unitSize}px;margin-left:0.4em">%</span>
        </div>
      </div>
    </div>`;
  },
};
