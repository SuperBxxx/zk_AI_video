// 荧光笔高亮扫过。
//
// 按上游 video-talkcraft 的 references/cards/highlighter-sweep.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 引用文字卡 + 荧光笔从左扫过关键句，其余压暗。
// 等于替观众划重点，把「听到的那句」与「看到的那句」锁在一起。
//
// 三条命门（规格原文）：
//   · **色块不许盖字** —— 用 multiply 或半透明；盖住字等于涂掉证据
//   · **扫速对齐朗读** —— 0.4~0.8s，跟着语音走才像「现场划」而不是特效
//   · **必须压暗其余文字** —— 只加高亮不减环境，强调失效一半

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, inOutQuad } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const highlighterSweep: CardDefinition = {
  meta: {
    slug: "highlighterSweep",
    title: "荧光笔高亮扫过",
    category: "强调",
    shape: "overlay",
    semantics: ["引用", "强调"],
    inputs: ["V"],
    // ACT: 占位区（视频生成时要让开的地方）—— 居中实心白卡（cardWidth = 设计宽 × 0.72）盖住底片
    occlusion: { x: 0.14, y: 0.35, w: 0.72, h: 0.30 },
    oneliner: "半透明黄色荧光笔从左到右扫过引用文段的关键句，同帧其余文字压暗，扫完整句轻微浮起——替观众划重点。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/highlighter-sweep.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：静置 0.7s → 扫 0.6s → 浮起 0.3s
  frames: 78,
  params: {
    startFrame: { min: 0, max: 60, value: 21, description: "起扫帧（规格：起手静置约 0.7s 等语音到位）" },
    sweepFrames: { min: 6, max: 60, value: 18, description: "扫过用时（帧）；规格 0.6s ≈ 18 帧，随语速 0.4~0.8s" },
    dim: { min: 0, max: 0.9, value: 0.45, description: "其余文字压暗程度（0 = 不压暗，规格说强调会失效一半）" },
    lift: { min: 0, max: 1, value: 1, description: "扫完整句轻微浮起开关" },
  },
  styles: `
    /* 叠加卡：引用卡是白底发丝线，浮在画面上 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .card { background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.35); }
    .body { color: #1a1a1a; font-weight: 500; line-height: 1.6; }
    .dim { transition: none; }
    /* 关键句：内部绝对定位的荧光色块。四角用不规则圆角模拟笔触，左右各溢出一点。
       mix-blend-mode: multiply 保证**色块不盖字**（规格命门）。 */
    .hl { position: relative; display: inline; }
    .ink { position: absolute; left: -0.1em; right: -0.1em; top: 0.1em; bottom: -0.02em;
           background: #ffe949; opacity: 0.6; mix-blend-mode: multiply;
           border-radius: 12px 5px 10px 4px / 7px 12px 5px 10px; }
    .txt { position: relative; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const quote = "把复杂的事讲简单，是这一代工具真正的分水岭。";
    const highlight = "真正的分水岭";
    const before = quote.slice(0, quote.indexOf(highlight));
    const after = quote.slice(quote.indexOf(highlight) + highlight.length);

    const cardWidth = Math.round(design.w * 0.72);
    const fontSize = Math.round(Math.min(design.h * 0.062, (cardWidth * 0.86) / (quote.length * 0.98)));

    // 扫过：scaleX 0→1，origin left center，规格用 power2.inOut（起收笔略缓，匀速像 loading）
    const sweep = seg(frame, params.startFrame, params.startFrame + params.sweepFrames, inOutQuad);
    // 压暗与扫过**同帧**开始（规格：同帧其余文字压暗）
    const dimProgress = seg(frame, params.startFrame, params.startFrame + 14, outCubic);
    const dimAmount = params.dim * dimProgress;

    // 扫完整句轻微浮起
    const liftProgress = params.lift > 0.5
      ? seg(frame, params.startFrame + params.sweepFrames, params.startFrame + params.sweepFrames + 9, outCubic)
      : 0;
    const liftY = lerp(liftProgress, 0, -Math.round(fontSize * 0.06));

    return `<div class="stage">
      <div class="card" data-check="引用卡" style="width:${cardWidth}px;padding:${Math.round(fontSize * 0.9)}px ${Math.round(fontSize * 1.1)}px;transform:translateY(${liftY.toFixed(2)}px)">
        <div class="body" data-check="引文" style="font-size:${fontSize}px">
          <span class="dim" style="opacity:${(1 - dimAmount).toFixed(3)}">${before}</span><span class="hl"><span class="ink" data-check="荧光块" style="transform:scaleX(${sweep.toFixed(4)});transform-origin:left center"></span><span class="txt" style="color:#0f0f0f;font-weight:700">${highlight}</span></span><span class="dim" style="opacity:${(1 - dimAmount).toFixed(3)}">${after}</span>
        </div>
      </div>
    </div>`;
  },
};
