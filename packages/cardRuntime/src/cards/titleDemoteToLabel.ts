// 标题降格为标签。
//
// 按上游 video-talkcraft 的 references/cards/title-demote-to-label.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**全屏卡** —— 居中大标题先当主角站稳，再**降格**成路标移到角上，
// 三条要点在下方逐条长出。用于教程/方法论口播的小节交接。
//
// 关键语义：降格不是「消失+重画」，是**同一个元素变小并挪位** ——
// 观众看到的是「刚才那个标题退到一边去了」，因此知道内容仍属于这一节。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const titleDemoteToLabel: CardDefinition = {
  meta: {
    slug: "titleDemoteToLabel",
    title: "标题降格为标签",
    category: "文字",
    shape: "fullscreen",
    semantics: ["标题", "步骤"],
    inputs: ["文"],
    oneliner: "居中大标题站稳后降格——同一个小下来挪到左上角变成路标，三条要点在下方逐条长出。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/title-demote-to-label.md",
  },
  size: { width: 1920, height: 1080 },
  frames: 132,
  params: {
    holdFrames: { min: 4, max: 60, value: 27, description: "标题居中站稳的帧数（规格约 0.9s）" },
    demoteFrames: { min: 4, max: 40, value: 15, description: "降格用时（帧）" },
    points: { min: 1, max: 6, value: 3, description: "要点条数" },
    pointStagger: { min: 2, max: 30, value: 9, description: "要点逐条长出的错峰（帧）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; background: #ffffff; }
    /* 标题：绝对定位，靠 left/top/fontSize 三者的插值完成「降格并挪位」 */
    .title { position: absolute; color: #1a1a1a; font-weight: 800; white-space: nowrap; }
    .points { position: absolute; left: 12%; right: 12%; top: 40%;
              display: flex; flex-direction: column; }
    .point { display: flex; align-items: baseline; color: #1a1a1a; }
    .idx { color: #0066cc; font-weight: 700; }
    .txt { font-weight: 500; }
    .rule { position: absolute; left: 12%; right: 12%; top: 34%; height: 1px; background: #e0e0e0;
            transform-origin: left center; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const title = "第二步 · 拆解需求";
    const items = ["拆到一句话能说清", "标出不可协商的部分", "剩下的都可以谈"].slice(0, params.points);

    const centerSize = Math.round(design.h * 0.086);
    const labelSize = Math.round(design.h * 0.038);

    // 入场：标题在中央淡入站稳
    const intro = seg(frame, 0, 16, outBack);
    // 降格：中央 → 左上角，同时缩小
    const demote = seg(frame, params.holdFrames, params.holdFrames + params.demoteFrames, outCubic);

    const fontSize = lerp(demote, centerSize, labelSize);
    // 水平位置：从「居中」到「左边距 12%」
    // 居中时 left = 50% 再 translateX(-50%)；降格后用固定 left。
    // ACT: 用百分比插值再叠加 translateX 会让宽度变化时的视觉位置抖动，
    // 所以这里把 translateX 也一起插值到 0，位置随宽度线性收敛。
    const leftPercent = lerp(demote, 50, 12);
    const shiftPercent = lerp(demote, -50, 0);
    const topPercent = lerp(demote, 50, 8);
    const translateYPercent = lerp(demote, -50, 0);
    const titleColor = demote > 0.6 ? "#0066cc" : "#1a1a1a";

    // 横线：降格时在标题下方画出分隔
    const ruleIn = seg(frame, params.holdFrames + params.demoteFrames - 4,
      params.holdFrames + params.demoteFrames + 10, outCubic);

    // 要点：逐条长出（从左侧滑入 + 淡入）
    const demoteEnd = params.holdFrames + params.demoteFrames;
    const points = items.map((item, index) => {
      const start = demoteEnd + 8 + index * params.pointStagger;
      const grow = seg(frame, start, start + 14, outCubic);
      const offset = lerp(grow, Math.round(design.w * 0.02), 0);
      return `<div class="point" data-check="要点" style="font-size:${Math.round(design.h * 0.042)}px;line-height:1.9;opacity:${grow.toFixed(3)};transform:translateX(${offset.toFixed(1)}px)">
        <span class="idx" style="margin-right:0.6em">0${index + 1}</span><span class="txt">${item}</span>
      </div>`;
    }).join("");

    return `<div class="stage" data-check="舞台">
      <span class="title" data-check="标题" style="font-size:${fontSize.toFixed(1)}px;left:${leftPercent.toFixed(2)}%;top:${topPercent.toFixed(2)}%;transform:translate(${shiftPercent.toFixed(2)}%, ${translateYPercent.toFixed(2)}%);opacity:${intro.toFixed(3)};color:${titleColor}">${title}</span>
      <span class="rule" data-check="分隔线" style="transform:scaleX(${ruleIn.toFixed(4)})"></span>
      <div class="points">${points}</div>
    </div>`;
  },
};
