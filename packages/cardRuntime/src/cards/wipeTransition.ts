// 擦除转场。
//
// 按上游 video-shotcraft 的 gallery/source/wipe-transitions.md 规格实现
// （原实现在 demos/transitions/wipe-transitions/）。
//
// 形态：**全屏卡** —— 两个画面之间的硬性交接。转场卡的作用是**遮住接缝**，
// 所以它必须在中途完全遮住画面（否则观众看到两个画面各露一半）。
//
// 规格要点：用几何擦除（斜切 / 圆扩 / 条带）而非交叉溶解 ——
// 交叉溶解让两个画面同时可见，读作「糊在一起」；几何擦除是**一个有方向的切断**。
// 擦除过程要快（0.3~0.4s），中间必须有一帧全遮盖。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, inOutQuad } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const wipeTransition: CardDefinition = {
  meta: {
    slug: "wipeTransition",
    title: "擦除转场",
    category: "转场",
    shape: "transition",
    semantics: ["转折"],
    inputs: ["场"],
    oneliner: "一个有方向的几何擦除：斜切/圆扩/条带把上一画面推出、下一画面推入，中途必有一帧全遮盖。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/wipe-transitions.md",
  },
  size: { width: 1920, height: 1080 },
  // 进 12f + 全遮盖保持 6f + 出 12f
  frames: 42,
  params: {
    enterFrames: { min: 3, max: 40, value: 12, description: "擦入用时（帧）；规格 0.3~0.4s" },
    holdFrames: { min: 0, max: 40, value: 6, description: "全遮盖保持帧数（规格：中途必须全遮住）" },
    exitFrames: { min: 3, max: 40, value: 12, description: "擦出用时（帧）" },
    // 0 = 斜切 / 1 = 圆扩 / 2 = 条带
    style: { min: 0, max: 2, value: 0, description: "样式：0 斜切 / 1 圆扩 / 2 条带" },
    // ACT: 默认必须是一个**看得见的实色**。踩过：默认给深色 #0d1117 与舞台底色相同，
    // 两种极端状态下整张卡都是纯深色 → 自检报「帧间无变化」，而且真接进流水线也等于没转场。
    // 转场卡的作用是遮住接缝，所以它的块必须是实心可见的。
    color: { min: 0, max: 1, value: 0, description: "块颜色（0 强调蓝 / 1 深色）；必须是实心可见的色" },
  },
  styles: `
    /* ACT: 舞台底色用中性灰而不是深色 —— 块色若与底色相同，整张卡在极端状态下没有画面。 */
    .stage { position: absolute; inset: 0; overflow: hidden; background: #20242b; }
    .wipe { position: absolute; inset: -10%; }
    .band { position: absolute; top: -10%; bottom: -10%; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const enterEnd = params.enterFrames;
    const holdEnd = enterEnd + params.holdFrames;
    const exitEnd = holdEnd + params.exitFrames;
    const color = params.color > 0.5 ? "#0d1117" : "#0066cc";

    // 进场：块从 0 涨到完全遮住；出场：继续涨到完全离开（同方向贯穿）
    // ACT: 用「同一块往前推到底」而不是「进来再出去」—— 后者会在中途露馅，
    // 而且方向感会断掉。这里的做法是块从左边缘进、到右边缘出，恒定方向。
    const enter = seg(frame, 0, enterEnd, inOutQuad);
    const exit = seg(frame, holdEnd, exitEnd, outCubic);
    // 总推进量：0 → 1（进场遮住）→ 2（出场完全离开）
    const total_ = enter + exit;

    if (params.style > 1.5) {
      // 条带：三条竖带依次扫过，错峰
      // ACT: 每条带用**同一段 0→1 的行程**（−40% → 140%），只把起始时间往后挪 offset。
      // 这样 t=0 时三条都在画外左侧，最后一条扫完才算转场结束。
      const bandCount = 3;
      const span = 1 + (bandCount - 1) * 0.14;
      const bands = Array.from({ length: bandCount }, (_, i) => {
        const offset = i * 0.14;
        const local = Math.min(1, Math.max(0, (total_ - offset) / span));
        const left = lerp(local, -40, 140);
        return `<span class="band" style="left:${left.toFixed(2)}%;width:${(100 / bandCount + 6).toFixed(1)}%;background:${color}"></span>`;
      }).join("");
      return `<div class="stage" data-check="舞台"><div class="wipe">${bands}</div></div>`;
    }

    if (params.style > 0.5) {
      // 圆扩：圆形从中心扩到盖住对角线，再继续扩出（圆心不动）
      const maxRadius = Math.sqrt(design.w * design.w + design.h * design.h) / 2;
      const radius = lerp(Math.min(1, total_ / 2) * 2, 0, maxRadius);
      const size = radius * 2;
      return `<div class="stage" data-check="舞台">
        <span style="position:absolute;left:50%;top:50%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;margin:${(-size / 2).toFixed(1)}px 0 0 ${(-size / 2).toFixed(1)}px;border-radius:50%;background:${color}"></span>
      </div>`;
    }

    // 斜切：一个倾斜 12° 的宽块从左推到右
    const skewWidth = design.w * 1.4;
    const left = lerp(total_, -skewWidth * 1.05, design.w * 1.05);
    return `<div class="stage" data-check="舞台">
      <span style="position:absolute;top:${(-design.h * 0.1).toFixed(1)}px;bottom:${(-design.h * 0.1).toFixed(1)}px;left:${left.toFixed(1)}px;width:${skewWidth.toFixed(1)}px;background:${color};transform:skewX(-12deg)"></span>
    </div>`;
  },
};
