// 用定稿符号（取景框）生成 packages/assets/logo.svg，
// 替换上游遗留的 Toonflow 标志。
//
// 为什么保持 viewBox="0 0 2048 2048"：
//   上游 logo.svg 就是这个 viewBox，且被 5 处以不同方式消费，其中
//   conversation.vue 用 mask-image（读 alpha 通道）、hello 用 v-html 内联。
//   保持同一 viewBox 可避免任何尺寸/比例回归。符号几何按 8 倍放大（256 → 2048）。
//
// 颜色用 fill="#0E1110"（界面墨色）：这是界面内使用的主标志。
//   上游原本是双色，并靠 `filter: invert(1)` 适配深色；这里改为单色，
//   深色适配仍走既有 invert 逻辑，行为不变。
import { writeFileSync } from "node:fs";

const K = 8; // 256 → 2048
const r = (v) => v * K;

// 定稿几何：外沿 32..224，四角臂 64 厚 24 缺口 96，准星臂 30 厚 16
const rects = [
  // 四角
  [32, 32, 64, 24], [32, 56, 24, 40],
  [160, 32, 64, 24], [200, 56, 24, 40],
  [32, 200, 64, 24], [32, 160, 24, 40],
  [160, 200, 64, 24], [200, 160, 24, 40],
  // 中心准星（四段，中间为负空间环）
  [84, 120, 30, 16], [142, 120, 30, 16],
  [120, 84, 16, 30], [120, 142, 16, 30],
];

const body = rects
  .map(([x, y, w, h]) => `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"/>`)
  .join("");

const svg = `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="2048" height="2048" preserveAspectRatio="xMidYMid meet">
<!-- 住凯AI视频 · 标志符号「取景框」
     定稿几何（×8 自 256 基准）：外沿 32..224 → 256..1792；四角臂 64 厚 24 缺口 96；
     中心准星臂 30 厚 16，负空间环 24。
     单色实心形状 —— 因此可直接作为 CSS mask 使用（conversation.vue 依赖 alpha 通道）。
     刻意不用闭合方框（意为有界）与播放三角（属播放器）。 -->
<title>住凯AI视频</title>
<g fill="#0E1110">${body}</g>
</svg>
`;

writeFileSync("E:/ai_video/zk-video/packages/assets/logo.svg", svg);
console.log(`  已写出 packages/assets/logo.svg（${svg.length} 字节，viewBox 0 0 2048 2048，${rects.length} 个矩形）`);
