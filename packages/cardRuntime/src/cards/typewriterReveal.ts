// 打字机档案戳。
//
// 按上游 video-talkcraft 的 references/cards/typewriter-reveal.md 规格独立实现。
//
// ⚠️ video-talkcraft 是 PolyForm Noncommercial（商用需授权）。本卡只照规格重写，
// 未复制其实现文件。
//
// 形态：**叠加卡** —— 透明背景，文字叠在 AI 视频上（纪录片式口播交代时间/地点）。
//
// 与规格逐条对齐：
//   · 等宽字体逐字符敲出，**速度带随机抖动**（不是匀速 —— 匀速读作加载动画）
//   · 末尾方块光标以 500ms 周期闪烁；句尾闪 3 次后摘除
//   · 句尾闪完后，副信息行再延迟 0.4s 跟进
//   · 能量低：全套约 4s

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, rand, seg, outCubic } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const typewriterReveal: CardDefinition = {
  meta: {
    slug: "typewriterReveal",
    title: "打字机档案戳",
    category: "文字",
    shape: "overlay",
    semantics: ["时间地点", "引用"],
    inputs: ["V"],
    oneliner: "等宽字体逐字符敲出时间地点戳、速度带随机抖动，方块光标 500ms 周期闪，句尾闪 3 次后副信息行再跟进——纪录片式档案感。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/typewriter-reveal.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 120,
  params: {
    // ACT: 不设 `chars` 参数 —— 它是「文案长度」的镜像，手填必然与文案漂移。
    // 踩过：文案 19 字而 chars 默认 14，打字到 `第 ` 就停住，看着像动画坏了。
    // 字符数一律由 text 本身决定。
    startFrame: { min: 0, max: 60, value: 6, description: "起敲帧（规格：起手静置约 0.3s）" },
    baseStep: { min: 0.5, max: 6, value: 2, description: "每字符基准帧数（实际会加非负抖动）" },
    jitter: { min: 0, max: 2, value: 0.7, description: "敲字速度的随机抖动幅度（只加不减；0 = 匀速，规格说匀速读作加载动画）" },
    blinkAfter: { min: 0, max: 60, value: 12, description: "敲完后光标继续闪的帧数（规格：句尾闪 3 次 ≈ 1.5s）" },
    subDelay: { min: 0, max: 60, value: 12, description: "副行相对光标摘除的延迟帧数（规格：再延迟 0.4s）" },
  },
  styles: `
    /* 叠加卡：背景透明，文字自带投影保证在任意画面上可读 */
    .stage { position: absolute; inset: 0; display: flex; flex-direction: column;
             justify-content: flex-end; padding: 0 8% 14%; }
    .line { display: flex; align-items: center; white-space: pre;
            font-family: ui-monospace, Consolas, 'Cascadia Mono', monospace;
            font-weight: 600; color: #ffffff;
            text-shadow: 0 2px 18px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.6); }
    .cursor { display: inline-block; background: #ffffff; margin-left: 0.14em;
              box-shadow: 0 2px 18px rgba(0,0,0,0.6); }
    .sub { color: #e6e9ee; font-weight: 500; letter-spacing: 0.06em;
           text-shadow: 0 2px 18px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.6); }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    // 文案是这张卡的唯一内容入口（读上游规格：换内容改这三行）
    const text = "2026 · 深圳 · 第 4 次迭代";
    const subText = "投资方尽调材料 · 内部留档";
    const chars = text.length;
    // 字号：同时受宽与高约束（窄画幅的瓶颈是宽度）
    const fontSize = Math.round(Math.min(
      design.h * 0.062,
      (design.w * 0.84) / (chars * 0.6 + 2),
    ));
    const subSize = Math.round(fontSize * 0.72);

    // 逐字符的完成时刻：基准步长 + **非负**随机抖动（同种子可复现）。
    // 规格：速度带随机抖动 —— 匀速敲字读作加载动画，不是打字。
    //
    // ACT: 抖动必须**只加不减**。踩过：写成 `baseStep + (rand - 0.5) * 2 * jitter` 时，
    // 只要 `rand < 0.5 - baseStep / (2 * jitter)`（本例 rand < 0.286）步长就变成负数，
    // `accumulated` 不再增长 → 打字**永久停在中途**，而且不报错。
    let accumulated = params.startFrame;
    let shown = 0;
    for (let i = 0; i < chars; i += 1) {
      if (frame < accumulated) break;
      shown = i + 1;
      // 用下标做种子，保证同一位每帧取值一致（可复现）
      accumulated += params.baseStep + rand(i * 13.7) * params.jitter;
    }
    const typingDone = shown >= chars;
    const doneFrame = accumulated;

    // 光标：打字中方波闪（500ms 周期 @30fps = 15 帧）；敲完后继续闪 blinkAfter 帧再摘
    const blink = frame % 15 < 8;
    const withinBlink = frame < doneFrame + params.blinkAfter;
    const cursorOpacity = (typingDone ? withinBlink : true) && blink ? 1 : 0;

    // 副行：光标摘除后再延迟 subDelay 帧跟进
    const subStart = doneFrame + params.blinkAfter + params.subDelay;
    const subIn = seg(frame, subStart, subStart + 18, outCubic);

    const visible = text.slice(0, shown);
    const cursorWidth = Math.round(fontSize * 0.58);
    const cursorHeight = Math.round(fontSize * 0.94);

    return `<div class="stage">
      <div class="line" data-check="主行" style="font-size:${fontSize}px;line-height:1.5">
        <span>${visible.replace(/[<>&]/g, "")}</span><span class="cursor" style="width:${cursorWidth}px;height:${cursorHeight}px;opacity:${cursorOpacity}"></span>
      </div>
      <div class="sub" data-check="副行" style="font-size:${subSize}px;margin-top:${Math.round(fontSize * 0.6)}px;opacity:${subIn.toFixed(3)}">${subText}</div>
    </div>`;
  },
};
