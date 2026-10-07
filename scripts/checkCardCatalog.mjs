// 卡目录一致性自检（不需要浏览器，可放进 preflight）。
//
// 为什么存在：这几件错都实际发生过，而且**都是静默的** —— 没有任何报错，
// 只是 Agent 检索不到卡、或者把转场卡当全屏卡用：
//
//   · 语义没标 → 24 张卡里 23 张 semantics 是空数组，语义检索全军覆没
//   · 形态标错 → wipeTransition / flashCutLogo 写成 fullscreen，目录统计里「转场」为 0
//   · 类别拼写漂移 → category 与 shape 对不上（转场类卡却不是转场形态）
//   · 画幅契约破损 → 设计画布短边不再是 270（卡的参数是按这个短边标定的）
//
// 用法：bun scripts/checkCardCatalog.mjs [--quiet]
import { designCanvasFor, buildCardCatalog, builtInCards } from "@toonflow/post-production";
import { htmlCards } from "@toonflow/card-runtime/cards";

const quiet = process.argv.includes("--quiet");
const failures = [];
const notes = [];

// ── 1. 每张卡必须有语义（否则语义检索找不到它）─────────────────────
for (const card of htmlCards) {
  const semantics = card.meta.semantics ?? [];
  if (!semantics.length) {
    failures.push(`${card.meta.slug}：没有标语义（meta.semantics 为空），Agent 用语义检索时找不到它`);
  }
}

// ── 2. 类别与形态必须一致（转场类卡必须是 transition 形态）──────────
for (const card of htmlCards) {
  const category = card.meta.category.trim();
  const shape = card.meta.shape;
  if (category === "转场" && shape !== "transition") {
    failures.push(`${card.meta.slug}：类别是「转场」但 shape 是 ${shape} —— 转场卡要作用在两个镜头之间，形态写错会让它被当成全屏卡用`);
  }
  if (category !== "转场" && shape === "transition") {
    failures.push(`${card.meta.slug}：shape 是 transition 但类别是「${category}」`);
  }
  if (!["fullscreen", "overlay", "transition"].includes(shape)) {
    failures.push(`${card.meta.slug}：shape 取值非法（${shape}）`);
  }
}

// ── 3. 画幅契约：设计画布短边必须恒为 270 ───────────────────────────
// 卡的参数都是按短边 270 标定的（字号、间距、圆角都是设计坐标）。
// 若这个数变了，所有卡的观感都会漂，而且不会有任何报错。
const expectedShortSide = 270;
for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080], [2560, 1080], [3840, 2160]]) {
  const design = designCanvasFor(width, height);
  const shortSide = Math.min(design.w, design.h);
  if (shortSide !== expectedShortSide) {
    failures.push(`${width}×${height}：设计画布短边是 ${shortSide}，应为 ${expectedShortSide}`);
  }
  // 放大倍数在各画幅间应可通约（参数通用性的前提）
  if (design.scale <= 0) {
    failures.push(`${width}×${height}：缩放倍数非法（${design.scale}）`);
  }
}

// ── 4. 目录必须两张库都收进来，且 slug 不重复 ──────────────────────
const catalog = buildCardCatalog(builtInCards, htmlCards);
if (catalog.length !== builtInCards.length + htmlCards.length) {
  failures.push(`目录条数（${catalog.length}）≠ 两个卡库之和（${builtInCards.length} + ${htmlCards.length}）`);
}
const seen = new Set();
for (const entry of catalog) {
  if (seen.has(entry.slug)) failures.push(`slug 重复：${entry.slug}`);
  seen.add(entry.slug);
}

// ── 5. 每张 HTML 卡都要能被检索到（至少能被自己的语义检索到）────────
for (const card of htmlCards) {
  const semantics = card.meta.semantics ?? [];
  if (!semantics.length) continue;
  const entry = catalog.find(item => item.slug === card.meta.slug);
  if (!entry) { failures.push(`${card.meta.slug}：不在目录里`); continue; }
  const hit = semantics.some(word => entry.semantics.includes(word));
  if (!hit) failures.push(`${card.meta.slug}：目录里的语义与卡上的不一致`);
}

// ── 统计 ────────────────────────────────────────────────────────────
const htmlEntries = catalog.filter(entry => entry.kind === "html");
const shapeCount = {
  fullscreen: htmlEntries.filter(entry => entry.shape === "fullscreen").length,
  overlay: htmlEntries.filter(entry => entry.shape === "overlay").length,
  transition: htmlEntries.filter(entry => entry.shape === "transition").length,
};
const unnamedSemantics = htmlCards.filter(card => !(card.meta.semantics ?? []).length).length;

if (failures.length) {
  console.log(`卡目录自检失败 ${failures.length} 项：`);
  for (const failure of failures) console.log("  ✗ " + failure);
  process.exit(1);
}
if (!quiet) {
  console.log(
    `卡目录自检通过（FFmpeg ${builtInCards.length} 张 + HTML ${htmlCards.length} 张：`
    + `全屏 ${shapeCount.fullscreen} / 叠加 ${shapeCount.overlay} / 转场 ${shapeCount.transition}；`
    + `未标语义 ${unnamedSemantics} 张）`,
  );
}
if (notes.length && !quiet) for (const note of notes) console.log("  · " + note);
