// 马克笔下划线。
//
// 按上游 video-shotcraft 的 gallery/source/marker-underline-title.md 规格实现
// （原实现在 demos/typography/marker-underline-title/）。
//
// 形态：**叠加卡** —— 打印体标题里出现一笔手绘马克笔，把一个词从排版里拎出来。
//
// 三条命门（规格原文）：
//   · **快** —— 8–12f 一笔呵成；慢了读作加载条
//   · **近** —— 贴着字底（bottom 偏移 ≈ −0.1em）；离远了读作分隔线不是强调
//   · **跟字势** —— 斜体词的划线必须左低右高微上斜；斜向画反是最容易犯且一眼假的错
//
// 时机：标题完全落定后 +4~8f 起笔 —— 划线是「看完标题后的强调」，与标题同动就抢戏。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const markerUnderlineTitle: CardDefinition = {
  meta: {
    slug: "markerUnderlineTitle",
    title: "马克笔下划线",
    category: "文字",
    shape: "overlay",
    semantics: ["标题", "强调"],
    inputs: ["V"],
    // ACT: 占位区（视频生成时要让开的地方）—— 居中大标题 + 贴着字底的马克笔；透明底，只占这一条带
    occlusion: { x: 0.05, y: 0.36, w: 0.9, h: 0.28 },
    oneliner: "大标题落定后，关键词下方马克笔从左到右一笔描画——变宽笔形、跟斜体字势微上斜、贴着字底。",
    origin: "按上游 video-shotcraft（Apache-2.0）规格实现：gallery/source/marker-underline-title.md",
  },
  size: { width: 1920, height: 1080 },
  // 标题落定 + 起笔 + 一笔 + 收尾定格
  frames: 54,
  params: {
    titleSize: { min: 0, max: 300, value: 0, description: "标题字号（设计坐标）；0 = 自动" },
    drawFrames: { min: 3, max: 40, value: 10, description: "一笔用时（帧）；规格 8–12f，**慢了读作加载条**" },
    startFrame: { min: 0, max: 40, value: 4, description: "起笔帧（标题落定后；规格 +4~8f）" },
    tilt: { min: -0.12, max: 0.12, value: 0.045, description: "上斜斜率（跟斜体字势；正 = 左低右高）" },
    thickness: { min: 0.02, max: 0.3, value: 0.11, description: "笔宽（按字号比例）" },
  },
  styles: `
    /* 叠加卡：透明背景，标题白字带投影 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .title { position: relative; display: inline-block; white-space: nowrap;
             font-weight: 800; color: #ffffff; font-style: italic;
             text-shadow: 0 3px 24px rgba(0,0,0,0.82), 0 1px 4px rgba(0,0,0,0.65); }
    /* 下划线用绝对定位的 SVG：贴字底、可微上斜、路径变宽靠 SVG 自身描边实现 */
    .mark { position: absolute; left: -2%; width: 104%; pointer-events: none; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const lead = "真正的分水岭是";
    const keyword = "交付速度";
    const text = lead + keyword;
    const fontSize = params.titleSize > 0
      ? params.titleSize
      : Math.round(Math.min(design.h * 0.14, (design.w * 0.82) / (text.length * 0.98)));

    // 一笔描画：8–12f，ease-out 微收尾（起笔快收笔略缓＝手劲）
    const draw = seg(frame, params.startFrame, params.startFrame + params.drawFrames, outCubic);

    // 笔形：一条左右略细、中段最宽的路径。
    // ACT: 用 SVG 描边 + strokeDasharray 模拟「变宽笔形」是做不到的（描边宽度恒定），
    // 所以这里用**填充路径**：把笔形画成一个上缘略拱、两端收尖的闭合路径，
    // 再用 clipPath 从左侧按进度揭开 —— 等价于「一笔从左到右描画」且能表达笔宽变化。
    const markWidth = 1000;   // 路径局部坐标宽
    const markHeight = 120;   // 路径局部坐标高
    const thickness = params.thickness * markHeight;
    const top = (markHeight - thickness) / 2;
    // 上缘微拱、两端收尖的笔形
    const brush = `M 0 ${top + thickness * 0.52}`
      + ` C ${markWidth * 0.14} ${top - thickness * 0.12}, ${markWidth * 0.32} ${top}, ${markWidth * 0.5} ${top + thickness * 0.06}`
      + ` C ${markWidth * 0.7} ${top + thickness * 0.12}, ${markWidth * 0.86} ${top + thickness * 0.02}, ${markWidth} ${top + thickness * 0.42}`
      + ` L ${markWidth} ${top + thickness * 0.78}`
      + ` C ${markWidth * 0.86} ${top + thickness * 0.96}, ${markWidth * 0.7} ${top + thickness * 0.9}, ${markWidth * 0.5} ${top + thickness * 0.94}`
      + ` C ${markWidth * 0.32} ${top + thickness * 0.98}, ${markWidth * 0.14} ${top + thickness * 1.12}, 0 ${top + thickness * 0.66} Z`;

    // 上斜：整条笔形绕左端微转（跟斜体字势）
    const tiltDeg = params.tilt * 100;

    // 只在关键词下方，所以横向只占关键词那一带的宽度；这里用整标题宽度做近似，
    // 并把色带压在关键词位置（右半段）——规格要求「贴着字底」，横向范围跟随关键词。
    const keywordRatio = keyword.length / text.length;
    const markLeft = (1 - keywordRatio) * 100;   // 关键词起始百分比
    const markSpan = keywordRatio * 100;

    return `<div class="stage">
      <span class="title" data-check="标题" style="font-size:${fontSize}px">
        ${lead}<span style="color:#7be0b0">${keyword}</span>
        <svg class="mark" data-check="马克笔" viewBox="0 0 ${markWidth} ${markHeight}" preserveAspectRatio="none"
             style="bottom:${(-fontSize * 0.1).toFixed(1)}px;height:${Math.round(fontSize * 0.22)}px;left:${markLeft.toFixed(2)}%;width:${markSpan.toFixed(2)}%;transform:rotate(${(-tiltDeg).toFixed(2)}deg);transform-origin:left bottom">
          <defs>
            <clipPath id="reveal">
              <rect x="0" y="0" width="${(markWidth * draw).toFixed(2)}" height="${markHeight}" />
            </clipPath>
          </defs>
          <path d="${brush}" fill="#ffd23f" clip-path="url(#reveal)" />
        </svg>
      </span>
    </div>`;
  },
};
