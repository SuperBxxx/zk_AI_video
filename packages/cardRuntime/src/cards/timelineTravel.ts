// 时间轴旅行。
//
// 按上游 video-shotcraft 的 gallery/source/timeline-travel.md 规格实现
// （原实现在 demos/data/timeline-travel/）。
//
// 形态：**全屏卡** —— 把产品的版本史拍成一次沿时间轴的旅行：
// 镜头缓起 → 冲刺 → 急刹三段变速横移，刻度依次掠过，每过一格卡片从刻度线上弹立。
// 速度本身讲「发展快」，急停讲「现在最重要」。
//
// ACT: 里程碑卡**故意不加 data-check** —— 它们分布在整条轴上，随世界层横移扫进画面，
// 起手时本来就在画外（那是这张卡的全部动作）。自检只该约束「不该溢出」的元素。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack, inOutQuad } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const timelineTravel: CardDefinition = {
  meta: {
    slug: "timelineTravel",
    title: "时间轴旅行",
    category: "数据",
    shape: "fullscreen",
    semantics: ["过程演示", "时间地点"],
    inputs: ["文"],
    oneliner: "镜头沿水平刻度轴缓起→冲刺→急刹横移，版本刻度依次掠过、卡片从刻度线上弹立，急停在「今天」并推近。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/timeline-travel.md",
  },
  size: { width: 1920, height: 1080 },
  // 静置 12f + 加速掠过 ~88f + 急停推近 + 收尾
  frames: 150,
  params: {
    milestones: { min: 3, max: 8, value: 4, description: "里程碑个数（刻度点）" },
    holdFrames: { min: 0, max: 40, value: 12, description: "起手静置帧数（规格 f0–12）" },
    travelFrames: { min: 30, max: 200, value: 88, description: "横移用时（帧）；规格 ~f12–100" },
    spacing: { min: 0.3, max: 1.5, value: 0.72, description: "刻度间距（按画幅宽的比例）" },
    pushScale: { min: 1, max: 2, value: 1.18, description: "急停后推近的终态缩放" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #0d1117; overflow: hidden; }
    .world { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
    .axis { position: absolute; left: 0; right: 0; top: 58%; height: 2px; background: #30363d; }
    .milestone { position: absolute; top: 58%; }
    .tickMark { position: absolute; left: 50%; width: 2px; height: 22px; margin-left: -1px;
                background: #7be0b0; box-shadow: 0 0 12px rgba(123,224,176,0.8); }
    .card { position: absolute; left: 50%; bottom: 14px; transform-origin: 50% 100%;
            background: #161e2a; border: 1px solid #263041; border-radius: 10px;
            padding: 18px 22px; white-space: nowrap; }
    .ver { color: #eafff5; font-weight: 700; font-variant-numeric: tabular-nums; }
    .note { color: #8b949e; font-weight: 500; }
    .today { position: absolute; left: 50%; top: 46%; transform: translateX(-50%);
             color: #7be0b0; font-weight: 800; letter-spacing: 0.16em; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const spacing = design.w * params.spacing;
    const hold = params.holdFrames;
    const travelEnd = hold + params.travelFrames;
    const pushEnd = travelEnd + 18;

    // 三段变速横移：缓起（inOutQuad）→ 冲刺（线性）→ 末 12% 急刹（outCubic）
    // ACT: 用一个分段函数表达「缓起→冲刺→急刹」，比三条 tween 拼接更不容易错位。
    let progress: number;
    if (frame <= hold) {
      progress = 0;
    } else if (frame <= travelEnd) {
      const raw = (frame - hold) / params.travelFrames;
      const brakeStart = 0.88;
      if (raw < 0.16) {
        // 缓起：占总行程的 16%，但只走 6% 的距离
        progress = inOutQuad(raw / 0.16) * 0.06;
      } else if (raw < brakeStart) {
        // 冲刺：匀速走掉大部分距离
        progress = 0.06 + ((raw - 0.16) / (brakeStart - 0.16)) * 0.8;
      } else {
        // 急刹：末 12% 时间走完剩余距离
        progress = 0.86 + outCubic((raw - brakeStart) / (1 - brakeStart)) * 0.14;
      }
    } else {
      progress = 1;
    }

    // 世界层平移：最后一个里程碑落到画面中偏左（给「今天」留位置）
    const worldShift = -progress * (params.milestones - 1) * spacing;
    const pushScale = 1 + (params.pushScale - 1) * seg(frame, travelEnd, pushEnd, outCubic);

    const milestoneSize = Math.round(design.h * 0.04);
    const milestones = Array.from({ length: params.milestones }, (_, i) => {
      const left = design.w * 0.3 + i * spacing;
      const isLast = i === params.milestones - 1;
      // 弹卡：相机扫过刻度前 6f 起弹（底边为轴 scaleY 立起，spring 过冲）
      const appearFrame = hold + (i / Math.max(1, params.milestones - 1)) * params.travelFrames - 6;
      const pop = seg(frame, appearFrame, appearFrame + 11, outBack);
      const scaleY = Math.max(0.001, pop);
      const label = isLast ? "今天" : `v${i + 1}.0`;
      const note = isLast ? "正式版" : `${i + 1} 个版本前`;
      return `<span class="milestone" style="left:${left.toFixed(1)}px">
        <span class="tickMark"></span>
        <span class="card" style="transform:scaleY(${scaleY.toFixed(4)})">
          <span class="ver" style="font-size:${milestoneSize}px">${label}</span>
          <span class="note" style="font-size:${Math.round(milestoneSize * 0.62)}px;margin-left:0.7em">${note}</span>
        </span>
      </span>`;
    }).join("");

    // 「今天」在急停后推近时淡入
    const todayIn = seg(frame, travelEnd + 4, pushEnd, outCubic);

    return `<div class="stage" data-check="舞台">
      <div class="world" style="transform:translateX(${worldShift.toFixed(1)}px) scale(${pushScale.toFixed(4)});transform-origin:${(design.w * 0.5).toFixed(0)}px 55%">
        <span class="axis"></span>
        ${milestones}
      </div>
      <div class="today" data-check="今天" style="font-size:${Math.round(design.h * 0.05)}px;opacity:${todayIn.toFixed(3)}">今天</div>
    </div>`;
  },
};
