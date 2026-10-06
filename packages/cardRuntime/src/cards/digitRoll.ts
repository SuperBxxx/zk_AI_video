// 数字翻牌：里程表式的数字竖条滚动。
//
// 移植自上游 video-shotcraft 的 assets/lib/DigitRoll.tsx（Remotion/React 组件）。
// 算法照抄它的意图：每位数字是一条「0-9 再重复一遍」的竖条，
// 从一整圈（10 位）之外滚到目标位，每位错开若干帧，用同一条贝塞尔缓动。
//
// 形态：**全屏卡** —— 它替代这一段画面，不叠加在 AI 视频上。
//
// 与上游的两点差异：
//   · 上游在 React 组件里用 useCurrentFrame() 取帧；这里改成 render(frame, ...) 纯函数。
//   · 上游字号写死 30px；这里在**设计坐标**里作画（移植上游 DesignStage 的机制），
//     输出分辨率由 runtime 的等比放大负责，所以换画幅不必改任何参数。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";

const DIGITS = "0123456789";

/**
 * 三次贝塞尔缓动，与上游 `Easing.bezier(0.25, 0.8, 0.25, 1)` 同参。
 *
 * ACT: 用牛顿迭代解 x(u)=t 的一元三次，不引入缓动库。
 * 上限：迭代 8 次；极端参数下误差 <1e-6，对逐帧动画完全够用。
 */
function bezierEase(t: number): number {
  const x1 = 0.25, y1 = 0.8, x2 = 0.25, y2 = 1;
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

/**
 * 卡渲染时需要的辅助函数。
 *
 * ACT: 必须**显式声明**（而不是让 runtime 去猜卡对象上有哪些同名方法）——
 * `render` 里是把它当裸函数名调用的：只挂在对象上时类型检查看不见这个名字（TS2304），
 * 而运行时却靠 runtime 的文本扫描把它注入，那是隐式契约，改动一次就静默失效。
 */
const helpers: CardHelpers = { bezierEase };

export const digitRoll: CardDefinition = {
  meta: {
    slug: "digitRoll",
    title: "数字翻牌",
    category: "数据",
    shape: "fullscreen",
    oneliner: "里程表式的数字竖条滚动：每位从整圈外滚到目标位，错开落定。用于数据镜头的关键数字。",
    origin: "移植自上游 assets/lib/DigitRoll.tsx",
  },
  // 默认画幅。实际用哪个由渲染器按成片画幅覆盖 —— 卡只按设计坐标作画。
  size: { width: 1920, height: 1080 },
  frames: 90,
  params: {
    fontSize: { min: 0, max: 400, value: 0, description: "设计坐标下的字号；0 = 按设计画布宽与位数自动" },
    value: { min: 0, max: 999999999, value: 190000, description: "要滚到的数值" },
    stagger: { min: 0, max: 20, value: 4, description: "每位落定的错开帧数" },
    rollFrames: { min: 4, max: 90, value: 22, description: "单位滚动用时（帧）" },
    delay: { min: 0, max: 60, value: 6, description: "整组起滚的延迟（帧）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; display: flex; flex-direction: column;
             align-items: center; justify-content: center; }
    .row { display: flex; align-items: baseline; }
    /* 字号由内联的 font-size 给（设计坐标下按位数算），其余尺寸一律用 em ——
       放大倍数只由外层负责，卡自己不必知道输出分辨率。 */
    .roll { display: flex; align-items: center; font-weight: 800; }
    /* 每列宽度写成 0.62em 并配 flex:none：否则 overflow:hidden 会按内容宽度撑开，
       竖条被裁成方块、数字看起来像拼贴的（踩过）。 */
    .roll .col { display: block; overflow: hidden; flex: none; width: 0.62em; }
    .roll .strip { display: block; }
    .roll .d { display: block; text-align: center; font-variant-numeric: tabular-nums; }
    .roll .static { display: block; flex: none; }
    .value { color: #2E9E6B; text-shadow: 0 0 0.3em rgba(46,158,107,0.35); }
    .unit { color: #cfe8dc; font-weight: 600; margin-left: 0.25em; font-size: 0.42em; }
    .caption { color: #8fb8a6; font-weight: 500; letter-spacing: 0.12em; font-size: 0.15em; margin-top: 0.35em; }
  `,
  helpers,
  /**
   * 在**设计坐标**里作画，尺寸单位一律 em（相对字号）。
   *
   * 字号按设计画布宽与位数算：一行数字占设计宽的 88%，同时不超过高度的 42%。
   * 这样横屏/竖屏/方屏都不必重调参数 —— 放大倍数由 runtime 负责。
   * （踩过：早先按「输出短边」直接算像素字号，竖屏里 6 位数横向超出画布被裁掉。）
   */
  render(frame: number, _total: number, params: CardParams, design: CardDesign): string {
    const value = String(params.value);
    const unit = "人";
    const caption = "累计服务用户";
    const cells = value.length;
    const fontSize = params.fontSize > 0
      ? params.fontSize
      : Math.round(Math.max(6, Math.min(design.h * 0.42, (design.w * 0.88) / (cells * 0.62 + 1.4))));
    // 行高取整：小数会让「列裁剪窗」与「数字盒」的边界各取整到不同像素，
    // 必然有一列错开零点几像素被裁掉（踩过：竖屏下恰好第 2 列消失）。
    const lineHeight = Math.round(fontSize * 1.15);
    const lineEm = lineHeight / fontSize;

    const columns = value.split("").map((character: string, index: number) => {
      const target = DIGITS.indexOf(character);
      // 非数字（小数点、逗号等）原样显示，不参与滚动
      if (target < 0) {
        return `<span class="static" style="font-size:1em;line-height:${lineEm}em;height:${lineEm}em;color:#cfe8dc">${character}</span>`;
      }
      const start = params.delay + index * params.stagger;
      const raw = (frame - start) / params.rollFrames;
      const progress = raw <= 0 ? 0 : raw >= 1 ? 1 : bezierEase(raw);
      // 从一整圈（10 个数字）之外滚到目标位
      const offset = (10 + target) * progress * lineHeight;
      const strip = (DIGITS + DIGITS).split("").map((digit: string) =>
        `<span class="d" style="font-size:1em;line-height:${lineEm}em;height:${lineEm}em">${digit}</span>`).join("");
      return `<span class="col" style="height:${lineEm}em">`
        + `<span class="strip" style="transform:translateY(${-offset}px)">${strip}</span>`
        + `</span>`;
    }).join("");

    return `<div class="stage">
      <div class="row" style="font-size:${fontSize}px">
        <span class="roll value">${columns}</span>
        <span class="unit">${unit}</span>
      </div>
      <div class="caption">${caption}</div>
    </div>`;
  },
};
