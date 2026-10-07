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
import { designCanvasFor, buildCardCatalog, builtInCards, videoAnalysisCards } from "@toonflow/post-production";
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

// ── 4. 目录必须三套卡都收进来，且 slug 不重复 ──────────────────────
// ACT: 分析卡也进同一份目录。少了这段等式检查，分析卡漏接时目录会「静默变小」，
// Agent 就查不到「读参考视频」这一类做法 —— 那正是加分析卡时要修的缺口。
const catalog = buildCardCatalog(builtInCards, htmlCards, videoAnalysisCards);
const expected = builtInCards.length + htmlCards.length + videoAnalysisCards.length;
if (catalog.length !== expected) {
  failures.push(`目录条数（${catalog.length}）≠ 三个卡库之和（${builtInCards.length} + ${htmlCards.length} + ${videoAnalysisCards.length}）`);
}
const seen = new Set();
for (const entry of catalog) {
  if (seen.has(entry.slug)) failures.push(`slug 重复：${entry.slug}`);
  seen.add(entry.slug);
}

// ── 4b. 叠加卡必须标占位区（occlusion），且区域合法 ──────────────────
// 这条守的是**顺序依赖**：叠加卡叠在 AI 视频上，视频必须先给卡留位。
// 没有这个信息，「主体避开文字」就无从谈起 —— 而视频一旦生成完，主体被压住只能重做。
// 踩过：12 张叠加卡的 meta 里原先没有这个字段，卡库只说了「它会叠在视频上」，
// 没说「它占哪块屏」，于是 Agent 只能先出视频、再叠卡，顺序天然是反的。
for (const card of htmlCards) {
  const shape = card.meta.shape;
  const occlusion = card.meta.occlusion;
  if (shape !== "overlay") {
    if (occlusion !== undefined) {
      failures.push(`${card.meta.slug}：shape 是 ${shape}，不该有 occlusion（占位区只对叠加卡有意义）`);
    }
    continue;
  }
  if (occlusion === undefined) {
    failures.push(`${card.meta.slug}：叠加卡没有标 occlusion —— Agent 无法知道要为它让开哪块屏，只能先出视频再叠卡（顺序反了，主体被压住就得重做）`);
    continue;
  }
  if (occlusion === "full") continue;
  const { x, y, w, h } = occlusion;
  const values = [x, y, w, h];
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    failures.push(`${card.meta.slug}：occlusion 的 x/y/w/h 必须是数字`);
    continue;
  }
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
    failures.push(`${card.meta.slug}：occlusion ${JSON.stringify(occlusion)} 越界（应满足 0≤x、0≤y、w>0、h>0、x+w≤1、y+h≤1）`);
  }
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

// ── 5. 分析卡：必须写清产出什么证据、以及为什么必须用它 ────────────
// 分析卡最容易退化成"一句说明"，那样 Agent 就不会去用它。
for (const card of videoAnalysisCards) {
  if (!card.evidence?.length) failures.push(`分析卡 ${card.slug} 没写产出哪些证据（evidence）`);
  if (!card.why?.trim()) failures.push(`分析卡 ${card.slug} 没写为什么必须用它（why）`);
  if (!card.oneliner?.trim()) failures.push(`分析卡 ${card.slug} 缺少一句话说明`);
  // 分析卡不产画面，带上 filters 会让 Agent 以为能直接喂给 ffmpeg
  if ("filters" in card) failures.push(`分析卡 ${card.slug} 不该带 filters —— 它不产出画面`);
}
const analysisEntries = catalog.filter(entry => entry.kind === "analysis");

if (failures.length) {
  console.log(`卡目录自检失败 ${failures.length} 项：`);
  for (const failure of failures) console.log("  ✗ " + failure);
  process.exit(1);
}
if (!quiet) {
  console.log(
    `卡目录自检通过（FFmpeg ${builtInCards.length} 张 + HTML ${htmlCards.length} 张 + 分析 ${videoAnalysisCards.length} 张：`
    + `全屏 ${shapeCount.fullscreen} / 叠加 ${shapeCount.overlay} / 转场 ${shapeCount.transition}；`
    + `未标语义 ${unnamedSemantics} 张）`,
  );
}
if (notes.length && !quiet) for (const note of notes) console.log("  · " + note);
