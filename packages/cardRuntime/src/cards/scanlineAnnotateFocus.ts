// 扫描线标注聚焦。
//
// 按上游 video-shotcraft 的 gallery/source/scanline-annotate-focus.md 规格实现
// （原实现在 demos/effects/scanline-annotate-focus/）。
//
// 形态：**叠加卡** —— 一条亮扫描线自上而下掠过，扫过之处依次弹出取景框并命名。
// 把「分析」这件抽象事做成可见的因果链：观众读的是「机器的视线」。
//
// 命门（规格原文）：扫描线必须**匀速**、标注必须**严格滞后于扫描线过境** ——
// 先扫到再弹框。顺序一旦错乱就变成了预先编排的动画。
//
// 触发时刻由目标 bbox 反算：`ft = 起点 + ((y+h+扫描起点偏移)/扫描行程) × 扫描时长`，
// 即扫描线越过 bbox **下缘**的那一刻；再按 y 排序钳制最小间隔，避免两框同时弹。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = {
  ...motionHelpers(),
  // ACT: render 引用的模块级函数**必须声明在 helpers 里**，否则不会跟着内联进页面，
  // 页面会报 `xxx is not defined`（踩过：scanTargets 漏了，渲染直接失败）。
  scanTargets: scanTargets as unknown as (...args: never[]) => unknown,
};

/** 演示用的标注目标（设计坐标下的 bbox 与名称）。 */
function scanTargets() {
  return [
    { label: "HEADLINE", x: 0.06, y: 0.14, w: 0.52, h: 0.13 },
    { label: "CHART · Q3", x: 0.06, y: 0.36, w: 0.38, h: 0.2 },
    { label: "FOOTNOTE", x: 0.52, y: 0.62, w: 0.4, h: 0.11 },
    { label: "SOURCE", x: 0.06, y: 0.78, w: 0.3, h: 0.08 },
  ];
}

export const scanlineAnnotateFocus: CardDefinition = {
  meta: {
    slug: "scanlineAnnotateFocus",
    title: "扫描线标注聚焦",
    category: "强调",
    shape: "overlay",
    semantics: ["强调", "机制"],
    inputs: ["V"],
    // ACT: 占位区（视频生成时要让开的地方）—— 扫描线自上而下掠过整屏，取景框散布画面各处；底片整幅都参与
    occlusion: "full",
    oneliner: "亮扫描线匀速自上而下掠过，扫过之处依次弹出取景框并命名，状态行实时数已触发的框——像机器的视线在分析画面。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/scanline-annotate-focus.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：扫描 0.06→0.66 + 状态行 0.74→0.80 转完成态，全程约 4.6s（138f）
  frames: 138,
  params: {
    scanFrames: { min: 20, max: 140, value: 83, description: "扫描行程用时（帧）；规格 0.60 归一化 ≈ 83 帧，**必须匀速**" },
    scanStart: { min: 0, max: 40, value: 8, description: "扫描起始帧（规格 0.06 ≈ 8 帧）" },
    fadeIn: { min: 1, max: 30, value: 4, description: "扫描线淡入帧数" },
    fadeOut: { min: 1, max: 30, value: 7, description: "扫描线淡出帧数" },
    minGap: { min: 0, max: 30, value: 7, description: "相邻框弹出的最小间隔（帧）；规格 0.05 ≈ 7 帧" },
    statusAt: { min: 0, max: 200, value: 110, description: "状态行切完成态的帧（规格 0.74 ≈ 102 帧）" },
  },
  styles: `
    /* 叠加卡：透明底，扫描线与框都是浅色，能在任意画面上读出来 */
    .stage { position: absolute; inset: 0; overflow: hidden; }
    .scan { position: absolute; left: 0; right: 0; height: 2px;
            background: linear-gradient(90deg, transparent, #7be0b0 12%, #eafff5 50%, #7be0b0 88%, transparent);
            box-shadow: 0 0 18px rgba(123,224,176,0.85), 0 0 46px rgba(123,224,176,0.4); }
    /* 取景框 = 四个 L 角 */
    .frame { position: absolute; }
    .corner { position: absolute; width: 9px; height: 9px; border: 2px solid #eafff5;
              box-shadow: 0 0 10px rgba(234,255,245,0.7); }
    .flash { position: absolute; inset: 0; background: #ffffff; }
    .label { position: absolute; white-space: nowrap; color: #b8bdc7;
             font-family: ui-monospace, Consolas, monospace; letter-spacing: 1.5px; }
    .status { position: absolute; left: 4%; top: 4%; color: #b8bdc7;
              font-family: ui-monospace, Consolas, monospace; letter-spacing: 1.5px; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const targets = scanTargets();
    const topY = -design.h * 0.11;      // 扫描起点在画面上方（规格 y = −30 / 540）
    const travel = design.h * 1.22;     // 扫描行程（规格 330 / 540）
    const monoSize = Math.round(design.h * 0.024);   // 规格 6.5px @540 高
    const cornerSize = Math.round(design.h * 0.033); // 规格 9px @540 高

    // 扫描线位置：**匀速**（无缓动）—— 规格点名
    const rawProgress = (frame - params.scanStart) / params.scanFrames;
    const progress = Math.min(1, Math.max(0, rawProgress));
    const scanY = topY + travel * progress;
    // 淡入 0.04→0.09、淡出 0.66→0.71（换算成帧）
    const scanOpacity = Math.min(
      seg(frame, params.scanStart - 2, params.scanStart + params.fadeIn, outCubic),
      1 - seg(frame, params.scanStart + params.scanFrames, params.scanStart + params.scanFrames + params.fadeOut, outCubic),
    );

    // 目标触发时刻：扫描线越过 bbox **下缘**那一刻；再按 y 排序钳制最小间隔
    const sorted = [...targets].sort((a, b) => a.y - b.y);
    let previousFire = -Infinity;
    const fired = sorted.map(target => {
      const bottom = (target.y + target.h) * design.h;
      const rawFrame = params.scanStart + ((bottom - topY) / travel) * params.scanFrames;
      const fire = Math.max(rawFrame, previousFire + params.minGap);
      previousFire = fire;
      return { target, fire };
    });

    let frameMarkup = "";
    let firedCount = 0;
    for (const { target, fire } of fired) {
      if (frame < fire) continue;
      firedCount += 1;
      // 取景框：4 个 9px L 角，outBack 驱动 scale 1.75→1（0.13 内走完，过冲后回稳）
      const pop = seg(frame, fire, fire + 4, outBack);
      const frameScale = lerp(pop, 1.75, 1);
      // 框内白色 fill 闪一下：像相机对焦成功的确认闪
      const flash = Math.min(
        seg(frame, fire + 1, fire + 3, outCubic),
        1 - seg(frame, fire + 3, fire + 7, outCubic),
      ) * 0.07;
      // 标注：淡入 + translateY 4→0
      const labelIn = seg(frame, fire + 2, fire + 5, outCubic);
      const labelY = lerp(labelIn, 4, 0);

      const left = target.x * design.w;
      const top = target.y * design.h;
      const width = target.w * design.w;
      const height = target.h * design.h;
      frameMarkup += `<span class="frame" style="left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;transform:scale(${frameScale.toFixed(4)});opacity:${pop.toFixed(3)}">
        <span class="flash" style="opacity:${flash.toFixed(3)}"></span>
        <span class="corner" style="left:-1px;top:-1px;border-right:none;border-bottom:none"></span>
        <span class="corner" style="right:-1px;top:-1px;border-left:none;border-bottom:none"></span>
        <span class="corner" style="left:-1px;bottom:-1px;border-right:none;border-top:none"></span>
        <span class="corner" style="right:-1px;bottom:-1px;border-left:none;border-top:none"></span>
        <span class="label" data-check="标注" style="left:0;top:${(-monoSize * 1.9).toFixed(1)}px;font-size:${monoSize}px;opacity:${labelIn.toFixed(3)};transform:translateY(${labelY.toFixed(1)}px)">${target.label}</span>
      </span>`;
    }

    const complete = frame >= params.statusAt;
    const totalTargets = String(targets.length).padStart(2, "0");
    const statusText = complete
      ? "ANALYSIS · COMPLETE"
      : `SCAN · ${String(firedCount).padStart(2, "0")}/${totalTargets}`;

    return `<div class="stage">
      <div class="scan" style="top:${scanY.toFixed(1)}px;opacity:${scanOpacity.toFixed(3)}"></div>
      ${frameMarkup}
      <div class="status" data-check="状态行" style="font-size:${monoSize}px;color:${complete ? "#7be0b0" : "#b8bdc7"}">${statusText}</div>
    </div>`;
  },
};
