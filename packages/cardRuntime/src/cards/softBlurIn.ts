// 对焦淡入。
//
// 按上游 video-talkcraft 的 references/cards/soft-blur-in.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 最低能量档的字幕入场：字不是「出现」的，是**被对焦出来**的。
// 观众感知到的是「画面本来就有这句话，只是刚刚看清」。
//
// 因为不争注意力，它能用在字多、字频繁的地方（旁白句、结论句、切素材后的第一句），
// 连着上五句也不会让人觉得画面在闹。
//
// 两条命门（规格原文）：
//   ① **解糊与淡入走满 0.9s，位移只占前 33%（0.3s）** —— 位移与解糊同停会读作
//      「整块被推上来」（一个有方向的入场）；位移先停之后那 0.6s 只在解糊，才是「对焦」
//   ② **逐字错峰只有 1 帧（0.033s）** —— 小到几乎不是「逐字」

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const softBlurIn: CardDefinition = {
  meta: {
    slug: "softBlurIn",
    title: "对焦淡入",
    category: "文字",
    shape: "overlay",
    semantics: ["金句", "论点"],
    inputs: ["V"],
    oneliner: "一句话像被镜头对焦出来——整块从模糊起、边解糊边淡入，位移只占前 1/3 时长，逐字只错峰一帧。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/soft-blur-in.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 60,
  params: {
    chars: { min: 2, max: 24, value: 11, description: "字数（规格适合 9 字左右的整句）" },
    startFrame: { min: 0, max: 30, value: 6, description: "起手帧" },
    totalFrames: { min: 12, max: 60, value: 27, description: "解糊与淡入总时长（帧）；规格 0.9s = 27 帧" },
    moveRatio: { min: 0.1, max: 1, value: 0.33, description: "位移占比；规格 **0.33**，位移与解糊同停就读作「整块被推上来」" },
    stagger: { min: 0, max: 4, value: 1, description: "逐字错峰帧数；规格**必须仅 1 帧**" },
  },
  styles: `
    /* 叠加卡：透明底，白字带投影 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .row { display: flex; align-items: baseline; white-space: nowrap;
           font-weight: 700; color: #ffffff;
           text-shadow: 0 3px 22px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.65); }
    .ch { display: block; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const text = "这不是增长，是换挡";
    const chars = text.split("").slice(0, params.chars);
    const fontSize = Math.round(Math.min(design.h * 0.115, (design.w * 0.84) / (chars.length * 1.02)));
    // 解糊起点：规格说从「字号 1/6」的模糊起
    const blurPeak = fontSize / 6;
    const moveFrames = params.totalFrames * params.moveRatio;
    // 位移距离：短距上移（它不是「入场」，所以位移要小）
    const lift = Math.round(fontSize * 0.14);

    const cells = chars.map((character, index) => {
      const start = params.startFrame + index * params.stagger;
      // 解糊/淡入：走满总时长
      const focus = seg(frame, start, start + params.totalFrames, outCubic);
      // 位移：只占前 33%，走完后就不再动（这是「对焦」与「推上来」的区别）
      const move = seg(frame, start, start + moveFrames, outCubic);
      const blur = blurPeak * (1 - focus);
      const offset = lerp(move, lift, 0);
      return `<span class="ch" data-check="字" style="font-size:${fontSize}px;width:${(fontSize * 1.02).toFixed(1)}px;text-align:center;`
        + `opacity:${focus.toFixed(3)};filter:blur(${blur.toFixed(2)}px);`
        + `transform:translateY(${offset.toFixed(2)}px)">${character}</span>`;
    }).join("");

    return `<div class="stage">
      <div class="row" data-check="整句">${cells}</div>
    </div>`;
  },
};
