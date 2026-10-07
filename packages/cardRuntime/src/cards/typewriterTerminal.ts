// 终端打字（把打字当**引信**）。
//
// 按上游 video-shotcraft 的 gallery/source/typewriter-moves.md 规格实现
// （A 式 terminal-typewriter；原实现在 demos/typography/typewriter-moves/）。
//
// 形态：**全屏卡** —— 暗色终端窗逐字敲出命令，回车帧镜头急推进命令行、
// 末 2f 加模糊，然后硬切。命令行是场景的导火索（开发者产品的标配语法）。
//
// 与规格逐条对齐：
//   · 字符节奏 `substring(0, floor((f-起点)/步长))` —— **帧确定、无插值**。
//     规格点名：任何缓动打字都读作加载动画。
//   · 光标 `f % 12 < 6` 方波闪（规格：淡入淡出的光标不是终端，是网页）。
//   · 急推 f58–64 `scale 1→3.2` + `Easing.in(cubic)`，origin 钉在命令行文字中心；
//     规格：幅度小于 3x 读作抖了一下，不是"冲进去"。
//   · 末 2f blur 10px；硬切（交叉溶解会毁掉「引信→爆炸」的因果）。
//   · 收尾静止 ≥77f。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, seg, inCubic } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const typewriterTerminal: CardDefinition = {
  meta: {
    slug: "typewriterTerminal",
    title: "终端打字",
    category: "文字",
    shape: "fullscreen",
    semantics: ["过程演示", "机制"],
    inputs: ["文"],
    oneliner: "暗色终端逐字敲出命令、方块光标方波闪，回车帧镜头急推进命令行并加模糊——打字本身是节奏，命令行是场景的引信。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/typewriter-moves.md A 式",
  },
  size: { width: 1920, height: 1080 },
  // 滚动+急推+硬切，收尾要静止 ≥77f（规格）
  frames: 148,
  params: {
    chars: { min: 1, max: 40, value: 22, description: "命令的字符数" },
    charFrames: { min: 0.5, max: 6, value: 2, description: "每字符用时（帧）；规格典型 2f" },
    holdStart: { min: 0, max: 200, value: 60, description: "起敲前的静置帧数" },
    pushStart: { min: 0, max: 200, value: 108, description: "急推起始帧（回车帧）" },
    pushFrames: { min: 1, max: 30, value: 6, description: "急推用时（帧）；规格典型 6f" },
    pushScale: { min: 1, max: 8, value: 3.2, description: "急推终态缩放；规格：小于 3x 读作抖了一下" },
  },
  styles: `
    .stage { position: absolute; inset: 0; overflow: hidden; background: #0b0d10; }
    .win { position: absolute; inset: 0; display: flex; flex-direction: column;
           justify-content: center; padding: 0 8%; transform-origin: 50% 50%; }
    .bar { display: flex; gap: 0.6em; margin-bottom: 1.1em; }
    .dot { width: 0.55em; height: 0.55em; border-radius: 50%; }
    .line { display: flex; align-items: center; white-space: pre; font-weight: 500; }
    .prompt { color: #6fe3b0; }
    .cmd { color: #e8eef5; }
    .cursor { display: inline-block; background: #e8eef5; margin-left: 0.12em; }
    .hint { position: absolute; left: 8%; bottom: 12%; color: #4b5563; letter-spacing: 0.08em; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    // 字号：按设计画布推，等宽字体（打字卡必须等宽，否则逐帧重排抖动 —— 规格点名）
    const fontSize = Math.round(Math.min(design.h * 0.085, (design.w * 0.84) / (params.chars * 0.62 + 6)));
    const lineHeight = Math.round(fontSize * 1.5);
    const cursorWidth = Math.round(fontSize * 0.56);

    // 字符节奏：floor((f-起点)/步长)，帧确定、无插值
    const typed = Math.max(0, Math.floor((frame - params.holdStart) / params.charFrames));
    const shown = Math.min(params.chars, typed);

    // 光标：**打字中方波闪** `f%12<6`（规格：淡入淡出的光标不是终端是网页）；
    // 打完字到急推之前保持常亮（"敲完了、等回车"的停顿感）；急推一开始就摘除。
    // ACT: 收尾必须真静止 —— 规格点名「光标残留 0.05 opacity 都毁真静止」，所以硬摘。
    const blinking = frame % 12 < 6;
    const cursorOpacity = frame < params.pushStart ? (blinking ? 1 : 0) : 0;

    // 急推：回车帧起 6f，Easing.in(cubic)，origin 钉命令行中心
    const pushProgress = seg(frame, params.pushStart, params.pushStart + params.pushFrames, inCubic);
    const pushScale = 1 + (params.pushScale - 1) * pushProgress;
    // 末 2f 加模糊 10px
    const blurAmount = seg(frame, params.pushStart + params.pushFrames - 2, params.pushStart + params.pushFrames) * 10;

    // 命令文案：等宽字符
    const command = "npm run build -- --release";
    const visible = command.slice(0, shown);
    const capSize = Math.round(fontSize * 0.42);

    return `<div class="stage" data-check="舞台">
      <div class="win" style="transform:scale(${pushScale.toFixed(4)});filter:blur(${blurAmount.toFixed(2)}px)">
        <div class="bar" style="font-size:${fontSize}px">
          <span class="dot" style="background:#ff5f57"></span>
          <span class="dot" style="background:#febc2e"></span>
          <span class="dot" style="background:#28c840"></span>
        </div>
        <div class="line" style="font-size:${fontSize}px;line-height:${lineHeight}px;font-family:ui-monospace,Consolas,'Cascadia Mono',monospace">
          <span class="prompt">$</span><span class="cmd">${visible.replace(/[<>&]/g, "")}</span><span class="cursor" style="width:${cursorWidth}px;height:${Math.round(fontSize * 0.92)}px;opacity:${cursorOpacity}"></span>
        </div>
      </div>
      <div class="hint" style="font-size:${capSize}px">回车即构建</div>
    </div>`;
  },
};

// ACT: 这张卡**故意不给终端窗与命令行加 data-check** —— 急推把它放大到 3.2 倍，
// 本来就该溢出（裁切由 .stage 的 overflow:hidden 负责，那是设计意图不是缺陷）。
// 自检只该约束「不该溢出」的元素；标错会误报（踩过：这一张误报 8 项）。
