// 扫描取景框。
//
// 按上游 video-shotcraft 的 gallery/source/scan-bracket-sweep.md 规格实现
// （原实现在 demos/effects/scan-bracket-sweep/）。
//
// 形态：**叠加卡** —— 四个直角框从画外滑入、收拢到目标上停住，锁定瞬间轻微一顿，
// 附一行状态标注。用于「把注意力交给画面里某个区域」，不遮内容。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const scanBracketSweep: CardDefinition = {
  meta: {
    slug: "scanBracketSweep",
    title: "扫描取景框",
    category: "强调",
    shape: "overlay",
    semantics: ["强调", "机制"],
    inputs: ["V"],
    // ACT: 占位区（视频生成时要让开的地方）—— 本卡参数本身就是归一化目标框（targetX/Y/W/H 默认值），直接对齐
    occlusion: { x: 0.42, y: 0.32, w: 0.24, h: 0.30 },
    oneliner: "四个直角框从画外滑入、收拢到目标上停住，锁定瞬间轻微一顿，附一行等宽状态标注。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/scan-bracket-sweep.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 78,
  params: {
    startFrame: { min: 0, max: 40, value: 8, description: "起手帧" },
    closeFrames: { min: 4, max: 40, value: 14, description: "收拢用时（帧）" },
    holdFrames: { min: 0, max: 30, value: 8, description: "锁定后的停顿保持（规格：锁定瞬间轻微一顿）" },
    // 目标在画面上的相对位置（0~1）
    targetX: { min: 0, max: 0.8, value: 0.42, description: "目标左边距（占画幅宽）" },
    targetY: { min: 0, max: 0.8, value: 0.32, description: "目标上边距（占画幅高）" },
    targetW: { min: 0.1, max: 0.8, value: 0.24, description: "目标宽（占画幅宽）" },
    targetH: { min: 0.1, max: 0.8, value: 0.3, description: "目标高（占画幅高）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; overflow: hidden; }
    .bracket { position: absolute; }
    /* 直角框：每条边是一个带边框的角，靠绝对定位拼成四个 L */
    .corner { position: absolute; width: 32px; height: 32px; border: 3px solid #eafff5;
              box-shadow: 0 0 14px rgba(234,255,245,0.75); }
    .label { position: absolute; white-space: nowrap; color: #b8bdc7;
             font-family: ui-monospace, Consolas, monospace; letter-spacing: 1.5px; }
    .tick { position: absolute; background: #7be0b0; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    // 目标框（最终位置）
    const finalLeft = params.targetX * design.w;
    const finalTop = params.targetY * design.h;
    const finalWidth = params.targetW * design.w;
    const finalHeight = params.targetH * design.h;

    // 收拢：从画外（四边各向外扩 18%）滑入到位，outCubic
    const close = seg(frame, params.startFrame, params.startFrame + params.closeFrames, outCubic);
    const spread = 0.18;
    const left = lerp(close, finalLeft - design.w * spread, finalLeft);
    const top = lerp(close, finalTop - design.h * spread, finalTop);
    const width = lerp(close, finalWidth + design.w * spread * 2, finalWidth);
    const height = lerp(close, finalHeight + design.h * spread * 2, finalHeight);

    // 锁定瞬间轻微一顿：位置稳住后 3f 内做一次极小的回弹
    const lockFrame = params.startFrame + params.closeFrames;
    const bump = seg(frame, lockFrame, lockFrame + 3, outBack);
    const bumpScale = 1 + (1 - bump) * 0.012;
    const locked = frame >= lockFrame;

    // 标注：锁定后淡入
    const labelIn = seg(frame, lockFrame + 2, lockFrame + 10, outCubic);
    const monoSize = Math.round(design.h * 0.026);
    const cornerSize = Math.round(Math.min(width, height) * 0.22);

    // 四角的 L 形（共用同一个 .corner 样式，靠 border 去掉一边）
    const corners = [
      { name: "tl", style: "left:-3px;top:-3px;border-right:none;border-bottom:none" },
      { name: "tr", style: "right:-3px;top:-3px;border-left:none;border-bottom:none" },
      { name: "bl", style: "left:-3px;bottom:-3px;border-right:none;border-top:none" },
      { name: "br", style: "right:-3px;bottom:-3px;border-left:none;border-top:none" },
    ].map(corner =>
      `<span class="corner" style="${corner.style};width:${cornerSize}px;height:${cornerSize}px"></span>`).join("");

    // 边缘刻度：取景框式的短刻度（左右各三条）
    const ticks = [0.25, 0.5, 0.75].map(ratio =>
      `<span class="tick" style="left:-3px;top:${(height * ratio).toFixed(1)}px;width:${Math.round(cornerSize * 0.34)}px;height:2px"></span>`
      + `<span class="tick" style="right:-3px;top:${(height * ratio).toFixed(1)}px;width:${Math.round(cornerSize * 0.34)}px;height:2px"></span>`).join("");

    return `<div class="stage">
      <span class="bracket" data-check="取景框" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;transform:scale(${bumpScale.toFixed(4)});opacity:${close.toFixed(3)}">
        ${corners}${ticks}
      </span>
      <span class="label" data-check="标注" style="left:${left.toFixed(1)}px;top:${(top - monoSize * 2).toFixed(1)}px;font-size:${monoSize}px;opacity:${labelIn.toFixed(3)}">${locked ? "TARGET LOCKED" : "SCANNING"}</span>
    </div>`;
  },
};
