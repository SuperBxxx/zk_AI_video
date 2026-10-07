// 关键词弹出强调。
//
// 按上游 video-talkcraft 的 references/cards/keyword-pop-highlight.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 字幕念到关键词的瞬间，该词带色块底弹出来。
// 这是口播强调的第一默认动作：**观众静音刷视频时也能抓到重点**。
//
// 三条命门（规格原文）：
//   · **快** —— 弹出 ≤0.2s，慢了像 PPT 入场
//   · **晚半拍** —— 等语音念到该词才弹；与整句字幕同时出现就没有「砸出来」的劲
//   · **有反冲** —— 过冲到 1.65 再回落；线性放大读作缩放素材，不是强调

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outQuart, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const keywordPopHighlight: CardDefinition = {
  meta: {
    slug: "keywordPopHighlight",
    title: "关键词弹出强调",
    category: "文字",
    shape: "overlay",
    oneliner: "字幕念到关键词的瞬间，该词带色块底从 0 弹到 1.65 倍再回落定格 1.15 倍，画面跟着微震一下。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/keyword-pop-highlight.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：总 0.46s + 关键词晚出现 0.55s + 收尾定格
  frames: 75,
  params: {
    popFrame: { min: 0, max: 40, value: 17, description: "关键词开始弹出的帧（规格：比整句晚 0.4~0.6s）" },
    popFrames: { min: 2, max: 12, value: 5, description: "弹出用时（帧）；规格 0.18s ≈ 5.4 帧，**必须快**" },
    peak: { min: 1, max: 2.5, value: 1.65, description: "过冲峰值；规格 1.65" },
    settle: { min: 0.8, max: 1.6, value: 1.15, description: "定格倍数；规格 1.15（比正文略大）" },
    settleFrames: { min: 2, max: 20, value: 7, description: "回落用时（帧）；规格 0.22s ≈ 6.6 帧" },
    shake: { min: 0, max: 1, value: 1, description: "冲击帧微震开关（规格：弹出瞬间画面 x 方向抖 3 个来回）" },
  },
  styles: `
    /* 叠加卡：透明背景，白字带投影 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .row { display: flex; align-items: baseline; white-space: nowrap;
           font-weight: 700; color: #ffffff;
           text-shadow: 0 3px 22px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.65); }
    .plain { display: block; }
    /* 关键词：色块底 + 高饱和黄字。左右留 ≥0.3em 外边距 —— 1.15 倍定格 + skew
       会横向溢出，边距不够色块会压到相邻字（规格点名的坑）。 */
    .kwWrap { display: block; position: relative; margin: 0 0.34em; }
    .slab { position: absolute; inset: -0.08em -0.12em -0.1em -0.12em;
            background: #c81e3c; transform: skewX(-6deg); border-radius: 0.06em; }
    .kw { display: block; position: relative; color: #ffe949;
          text-shadow: 0 2px 14px rgba(0,0,0,0.65); }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const lead = "今年真正变化的是";
    const keyword = "换挡";
    const tail = "本身";
    // 字号：同时受宽与高约束
    const units = (lead + keyword + tail).length + 2;
    const fontSize = Math.round(Math.min(design.h * 0.115, (design.w * 0.86) / (units * 0.98)));

    // 入场：0 → peak，规格用 power4.out（比 outQuart 更陡）
    const popIn = seg(frame, params.popFrame, params.popFrame + params.popFrames, outQuart);
    // 回落：peak → settle，规格用 back.out(2.5)
    const settleIn = seg(frame, params.popFrame + params.popFrames, params.popFrame + params.popFrames + params.settleFrames, outBack);
    // 组合：先升到峰值，再从峰值回落到定格值
    const scale = popIn < 1
      ? lerp(popIn, 0, params.peak)
      : lerp(settleIn, params.peak, params.settle);
    const opacity = popIn;

    // 冲击帧微震：弹出瞬间 x 方向 ±7px 抖 3 个来回（0.04s/次 ≈ 1.2 帧/次）
    let shakeX = 0;
    if (params.shake > 0.5) {
      const since = frame - params.popFrame;
      if (since >= 0 && since < 7.2) {
        const phase = since / 1.2;
        // 每半个周期换向，幅度线性衰减
        shakeX = Math.sin(phase * Math.PI) * 7 * (1 - since / 7.2);
      }
    }

    return `<div class="stage">
      <div style="transform:translateX(${shakeX.toFixed(2)}px)">
        <div class="row" data-check="整句" style="font-size:${fontSize}px">
          <span class="plain">${lead}</span>
          <span class="kwWrap" data-check="关键词" style="transform-origin:50% 80%;transform:scale(${scale.toFixed(4)});opacity:${opacity.toFixed(3)}">
            <span class="slab"></span>
            <span class="kw">${keyword}</span>
          </span>
          <span class="plain">${tail}</span>
        </div>
      </div>
    </div>`;
  },
};
