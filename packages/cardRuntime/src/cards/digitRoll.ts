// 数字滚动大字报（里程表式）。
//
// 移植自上游 video-shotcraft 的 demos/data/odometer-digit-roll/OdometerDigitRoll.tsx
// （规格见 gallery/source/odometer-digit-roll.md）。
//
// 形态：**全屏卡** —— 它替代这一段画面，不叠加在 AI 视频上。
//
// 与上游一致的四件事（都是它的规格里点名的命门）：
//   · 每位从 20+i×7f 开始 16f outCubic 减速到目标，**过冲半格**，再 6f 弹回整数锁定
//   · 滚动期每位叠 2 个错帧残影（±半行，opacity 0.25/0.12），**按速度门控**，停稳自动摘
//   · 全体锁定瞬间：整体加深脉冲 8f + 1.035 微缩放 + 标签条淡入
//   · 小数点与 % 等非数字位全程驻场不滚
//
// 与上游的两点差异：
//   · 上游在 React 组件里按帧取 useCurrentFrame()；这里是 render(frame, ...) 纯函数
//   · 上游字号写死 190px（配 1920×1080）；这里在**设计坐标**里作画（移植上游 DesignStage），
//     输出分辨率由 runtime 等比放大，所以换画幅不改参数

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";

const DIGITS = "0123456789";

/** 三次贝塞尔缓动。out 系用于减速，back 系用于过冲弹回。 */
function bezierEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(u) - t;
    if (Math.abs(error) < 1e-6) break;
    const slope = sampleDX(u);
    if (Math.abs(slope) < 1e-6) break;
    u -= error / slope;
  }
  return sampleY(Math.min(1, Math.max(0, u)));
}

/** 上游 Easing.out(Easing.cubic)。 */
function outCubic(t: number): number {
  return bezierEase(t, 0.215, 0.61, 0.355, 1);
}

/** 钳到 [0,1] 的归一化进度。 */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 某一位在某一帧的滚动位置（单位：位，0 = 显示 '0'）。
 *
 * 规格：位 i 于 20+i×7f 开始 16f 减速至目标 **+0.5 位**（过冲半格），
 * 再 6f 弹回整数锁定。返回浮点位置，调用方据此算 translateY。
 */
function positionAt(frame: number, index: number, target: number): number {
  const start = 20 + index * 7;
  const roll = 16;
  const settle = 6;
  // 从一整圈外滚进来：起点比目标小 10 位，保证一开始也在可见范围内滚动
  const from = target - 10;
  const overshoot = target + 0.5;
  if (frame <= start) return from;
  if (frame < start + roll) {
    const progress = outCubic((frame - start) / roll);
    return from + (overshoot - from) * progress;
  }
  if (frame < start + roll + settle) {
    const progress = outCubic((frame - start - roll) / settle);
    return overshoot + (target - overshoot) * progress;
  }
  return target;
}

/** 相邻帧的位置差（用于残影的速度门控）。 */
function velocityAt(frame: number, index: number, target: number): number {
  return Math.abs(positionAt(frame + 1, index, target) - positionAt(frame - 1, index, target)) / 2;
}

/** 卡渲染时要内联进页面的辅助函数。必须显式声明 —— 见 types.ts 的说明。 */
const helpers: CardHelpers = { bezierEase, outCubic, clamp01, positionAt, velocityAt };

export const digitRoll: CardDefinition = {
  meta: {
    slug: "digitRoll",
    title: "数字滚动大字报",
    category: "数据",
    shape: "fullscreen",
    oneliner: "王牌数字的全屏亮相：每位像老虎机滚轮独立减速、过冲半格后咔哒锁定，从左到右逐位落定，全体锁定时整体加深脉冲。",
    origin: "移植自上游 video-shotcraft（Apache-2.0）demos/data/odometer-digit-roll",
  },
  size: { width: 1920, height: 1080 },
  // 上游：滚动+逐位锁定 ~63f + 脉冲 8f + hold ≥45f
  frames: 116,
  params: {
    fontSize: { min: 0, max: 400, value: 0, description: "设计坐标下的字号；0 = 按设计画布与位数自动" },
    value: { min: 0, max: 999999999, value: 190000, description: "终值（≤6 位；大数请缩写，如 12.4M）" },
    caption: { min: 0, max: 1, value: 1, description: "标签条开关（1 显示 / 0 隐藏）" },
    stagger: { min: 0, max: 20, value: 7, description: "逐位错峰帧数（上游典型 7）" },
    overshoot: { min: 0, max: 1.5, value: 0.5, description: "过冲格数（上游典型 0.5；0 = 无过冲，机械感减半）" },
    echo: { min: 0, max: 1, value: 1, description: "残影开关（1 开 0 关；规格要求 2 副本、速度门控）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; display: flex; flex-direction: column;
             align-items: center; justify-content: center; }
    .row { display: flex; align-items: baseline; }
    /* 字号由内联 font-size 给（设计坐标），其余尺寸一律 em —— 放大只由外层负责 */
    .roll { display: flex; align-items: center; font-weight: 800;
            font-variant-numeric: tabular-nums; }
    /* 每列宽度写成 0.62em 并配 flex:none：否则 overflow:hidden 会按内容宽度撑开，
       竖条被裁成方块（踩过）。数字必须等宽，否则每滚一格整行抖动。 */
    .roll .col { display: block; overflow: hidden; flex: none; width: 0.62em; position: relative; }
    .roll .strip { display: block; }
    .roll .d { display: block; text-align: center; }
    /* 残影：同一 strip 的两个错帧副本，按速度门控显隐 */
    .roll .echo { position: absolute; left: 0; top: 0; right: 0; opacity: 0; pointer-events: none; }
    .roll .static { display: block; flex: none; }
    .value { color: #101010; }
    .label { color: #6b7280; font-weight: 500; letter-spacing: 0.16em; }
  `,
  helpers,
  /**
   * 在设计坐标里作画。
   *
   * 字号按设计画布与位数算：一行占设计宽的 84%（再留出标签与两侧留白），
   * 且不超过高度的 46%。换画幅不必重调参数。
   * 上游明确要求 **位数 ≤ 6** —— 每多一位多 7f 错峰，8 位滚完 >2.5s 观众等不起。
   */
  render(frame: number, _total: number, params: CardParams, design: CardDesign): string {
    const value = String(params.value);
    const digits = value.replace(/[^0-9]/g, "").length;
    // 一行数字的宽度 ≈ 数字位 × 0.62em + 非数字位 × 0.36em
    const units = value.length;
    const estimatedEm = digits * 0.62 + (units - digits) * 0.36;
    const fontSize = params.fontSize > 0
      ? params.fontSize
      : Math.max(8, Math.round(Math.min(design.h * 0.46, (design.w * 0.84) / estimatedEm)));
    const lineHeight = Math.round(fontSize * 1.15);
    const lineEm = lineHeight / fontSize;

    // 逐位：从 20+i×stagger 开始，16f 滚动 + 6f 稳定
    const stagger = params.stagger;
    const settleFrame = 20 + (digits - 1) * stagger + 16 + 6;
    const pulse = clamp01((frame - settleFrame) / 8);
    // 上游：整体 ink→#000→ink 加深脉冲 8f + 1.035 微缩放
    const pulseDepth = pulse <= 0 ? 0 : Math.sin(pulse * Math.PI);
    const pulseScale = 1 + 0.035 * pulseDepth;
    const ink = `rgb(${Math.round(16 - 16 * pulseDepth)}, ${Math.round(16 - 16 * pulseDepth)}, ${Math.round(16 - 16 * pulseDepth)})`;
    // 标签条：脉冲归零后淡入
    const labelOpacity = clamp01((frame - settleFrame - 8) / 10);

    let digitIndex = -1;
    const cells = value.split("").map((character: string) => {
      const target = DIGITS.indexOf(character);
      if (target < 0) {
        // 小数点、% 等非数字位：全程驻场不滚
        return `<span class="static" style="font-size:0.52em;line-height:${(lineEm / 0.52).toFixed(3)}em;height:${(lineEm / 0.52).toFixed(3)}em">${character}</span>`;
      }
      digitIndex += 1;
      const position = positionAt(frame, digitIndex, target);
      const offset = position * lineHeight;
      const strip = (DIGITS + DIGITS + DIGITS).split("").map((digit: string) =>
        `<span class="d" style="font-size:1em;line-height:${lineEm}em;height:${lineEm}em">${digit}</span>`).join("");
      // 残影：速度门控 —— 慢到一定程度自动摘掉（上游：停稳自动摘）
      let echoMarkup = "";
      if (params.echo > 0.5) {
        const velocity = velocityAt(frame, digitIndex, target);
        const gate = clamp01((velocity - 0.02) / 0.12);
        if (gate > 0.01) {
          echoMarkup = `<span class="echo" style="transform:translateY(${-offset - lineHeight * 0.5}px);opacity:${(0.25 * gate).toFixed(3)}">${strip}</span>`
            + `<span class="echo" style="transform:translateY(${-offset + lineHeight * 0.5}px);opacity:${(0.12 * gate).toFixed(3)}">${strip}</span>`;
        }
      }
      // data-check：给自检脚本标记「这个元素必须完整落在父容器内」。
      // 卡的画面靠肉眼看不出「差零点几像素被裁掉」（踩过：竖屏下恰好第 2 列消失）。
      return `<span class="col" data-check="数位盒" style="height:${lineEm}em">${echoMarkup}`
        + `<span class="strip" style="transform:translateY(${-offset}px)">${strip}</span>`
        + `</span>`;
    }).join("");

    return `<div class="stage">
      <div class="row" data-check="数字行" style="font-size:${fontSize}px;color:${ink};transform:scale(${pulseScale.toFixed(4)})">
        <span class="roll value">${cells}</span>
      </div>
      <div class="label" data-check="标签条" style="font-size:${Math.round(fontSize * 0.16)}px;margin-top:${Math.round(fontSize * 0.22)}px;opacity:${params.caption > 0.5 ? labelOpacity.toFixed(3) : 0}">累计服务用户</div>
    </div>`;
  },
};
