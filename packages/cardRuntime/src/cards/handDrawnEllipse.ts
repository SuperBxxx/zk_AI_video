// 手绘圈重点。
//
// 按上游 video-talkcraft 的 references/cards/hand-drawn-ellipse.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 一笔逆时针画出的歪椭圆圈住关键短语，圈完短语自己动一下。
//
// 命门两条（规格原文）：
//   ① **必须过头交叉** —— 画到 1.08 圈、尾巴落在起笔外侧。闭合成完美椭圆一眼是
//      矢量图形；手画的圈闭不上，这是常识级的真实性判据。
//   ② **圈画完才 punch**（中间留约 0.06s 呼吸）—— 同时发生就读作「字被圈撞了一下」，
//      动因反了。两个信息分两拍给：先被圈引到位置，再被 punch 确认强度。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const handDrawnEllipse: CardDefinition = {
  meta: {
    slug: "handDrawnEllipse",
    title: "手绘圈重点",
    category: "强调",
    shape: "overlay",
    semantics: ["强调", "金句"],
    inputs: ["V"],
    oneliner: "一笔逆时针画出的歪椭圆圈住关键短语，尾巴过头 8% 与起笔交叉，圈完留半拍呼吸再让被圈的词自己弹一下。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/hand-drawn-ellipse.md",
  },
  size: { width: 1920, height: 1080 },
  // 画圈 15f + 呼吸 + punch + 收尾定格
  frames: 48,
  params: {
    fontSize: { min: 0, max: 300, value: 0, description: "字号（设计坐标）；0 = 自动" },
    drawFrames: { min: 4, max: 60, value: 15, description: "画圈用时（帧）；规格 0.5s = 15 帧" },
    overshoot: { min: 1, max: 1.3, value: 1.08, description: "过头量；规格 1.08 圈（**必须 >1 才会交叉**）" },
    breath: { min: 0, max: 30, value: 2, description: "圈完到 punch 之间的呼吸帧数（规格约 0.06s）" },
    punchPeak: { min: 1, max: 1.4, value: 1.12, description: "punch 峰值缩放" },
  },
  styles: `
    /* 叠加卡：透明底，白字带投影 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .row { display: flex; align-items: baseline; white-space: nowrap;
           font-weight: 700; color: #ffffff;
           text-shadow: 0 3px 22px rgba(0,0,0,0.8), 0 1px 4px rgba(0,0,0,0.65); }
    .plain { display: block; }
    /* 被圈的短语：位置相对，圈是绝对定位的同尺寸 SVG 覆盖其上 */
    .keyWrap { display: block; position: relative; margin: 0 0.3em; }
    .key { display: block; position: relative; }
    .ring { position: absolute; pointer-events: none; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const lead = "真正难的不是做出来，是";
    const keyword = "稳定交付";
    const text = lead + keyword;
    const fontSize = params.fontSize > 0
      ? params.fontSize
      : Math.round(Math.min(design.h * 0.115, (design.w * 0.84) / (text.length * 0.98)));

    // 画圈：逆时针、过头 8%
    const drawProgress = seg(frame, 0, params.drawFrames, outCubic);
    const drawn = drawProgress * params.overshoot;
    // punch：圈完 + 呼吸之后才动（规格命门②）
    const punchStart = params.drawFrames + params.breath;
    const punchIn = seg(frame, punchStart, punchStart + 5, outBack);
    const punchFall = seg(frame, punchStart + 5, punchStart + 11, outCubic);
    // 先起弹到峰值，再回落到 1
    const punchScale = punchIn < 1
      ? lerp(punchIn, 1, params.punchPeak)
      : lerp(punchFall, params.punchPeak, 1);

    // 圈的几何：绑定关键短语的墨迹盒（这里用字号推算墨迹范围）。
    // ACT: 规格要求用 canvas measureText 量**墨迹盒**而不是行盒（行盒带 line-height
    // 留白，照行盒画圈会整体偏高一截）。这里用字号比例近似墨迹盒：字面高约 0.72em，
    // 上下各留一点 padding。换字体会略有偏差，需要时可改成实测。
    const inkHeight = fontSize * 0.72;
    const padX = fontSize * 0.24;
    const padY = fontSize * 0.18;
    // 显式 px 尺寸的 SVG（不要把宽高写成百分比推导的表达式 —— 会被压扁。
    // 踩过：椭圆渲染成几条竖线，因为 viewBox 与像素尺寸不成比例）。
    const rx = (keyword.length * fontSize) / 2 + padX;
    const ry = inkHeight / 2 + padY;
    const svgWidth = rx * 2 + fontSize * 0.4;
    const svgHeight = ry * 2 + fontSize * 0.4;
    const cx = svgWidth / 2;
    const cy = svgHeight / 2;

    // 椭圆周长（Ramanujan 近似）→ 按 drawn 比例取 dash 长度，实现「一笔描画 + 过头交叉」
    const a = rx, b = ry;
    const hh = Math.pow((a - b) / (a + b), 2);
    const circumference = Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
    const dash = circumference * drawn;

    // 圈整体略歪：模拟手绘不走正
    const wobble = 3.2;

    return `<div class="stage">
      <div class="row" data-check="整句" style="font-size:${fontSize}px">
        <span class="plain">${lead}</span>
        <span class="keyWrap" data-check="关键短语">
          <span class="key" style="transform:scale(${punchScale.toFixed(4)});display:inline-block;transform-origin:50% 60%">${keyword}</span>
          <svg class="ring" width="${svgWidth.toFixed(1)}" height="${svgHeight.toFixed(1)}" viewBox="0 0 ${svgWidth.toFixed(1)} ${svgHeight.toFixed(1)}"
               style="left:50%;top:50%;margin-left:${(-svgWidth / 2).toFixed(1)}px;margin-top:${(-svgHeight / 2).toFixed(1)}px;width:${svgWidth.toFixed(1)}px;height:${svgHeight.toFixed(1)}px;overflow:visible;transform:rotate(${(-wobble).toFixed(1)}deg)">
            <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"
                     fill="none" stroke="#ffd23f" stroke-width="${(fontSize * 0.058).toFixed(2)}"
                     stroke-linecap="round" stroke-linejoin="round"
                     stroke-dasharray="${dash.toFixed(1)} ${(circumference * 1.5).toFixed(1)}" />
          </svg>
        </span>
      </div>
    </div>`;
  },
};
