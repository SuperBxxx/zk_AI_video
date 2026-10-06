// 评审材料制备：把成片打散成独立评审 subagent 能用的材料包。
//
// 为什么需要它：参考实现发现「只按句子抽帧看不见三类缺陷」——
//   1. 短命动效的错位（标注/箭头只活 1~2s，句级抽帧大概率错过）
//   2. 抖动/闪烁（时域缺陷，单帧永远看不见）
//   3. 设计没落地（计划里有的东西默默缺席，评审不知道「应该有」就不会报）
// 所以除了逐句帧，还要给：动效锚点帧、连拍帧（状态切换处）、镜头边界帧。
//
// 另一个关键点来自参考实现的审片协议：评审 subagent 的**全部世界 = 派发包 + 磁盘文件**，
// 它看不到制作过程的辩解与修改历史。所以材料必须自足、路径必须可复核，
// 且派发包里不能出现任何制作方的解释或预期结论（否则等于自证闭环）。
//
// 用法：bun scripts/reviewKit.mjs <video> --out <dir> [--timestamps t.json] [--shots shots.json] [--anchors anchors.json] [--sheet]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [videoPath, ...rest] = process.argv.slice(2);
if (!videoPath) {
  console.error("用法：bun scripts/reviewKit.mjs <video> --out <dir> [--timestamps t.json] [--shots shots.json] [--anchors anchors.json] [--sheet]");
  process.exit(2);
}
if (!existsSync(videoPath)) { console.error(`找不到文件：${videoPath}`); process.exit(2); }

function readOption(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[index + 1] : fallback;
}

/** 读 JSON，容忍工具写入的 UTF-8 BOM（踩过：BOM 会让 JSON.parse 直接抛错）。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

const outDir = resolve(readOption("out", "qa"));
const framesDir = join(outDir, "frames");
mkdirSync(framesDir, { recursive: true });

function ffmpeg(args) {
  const result = Bun.spawnSync({ cmd: ["ffmpeg", "-hide_banner", "-loglevel", "error", ...args], stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, err: result.stderr.toString() };
}

// ACT: 抽帧并发跑。一次评审可能上百帧，串行起上百次 ffmpeg 很慢；
// 每帧是一次独立的 -ss seek、彼此无依赖，并发度取 8 避免一次起太多进程。
const concurrency = 8;
let running = 0;
const waiting = [];

function extractFrame(seconds, name) {
  const path = join(framesDir, `${name}.png`);
  return new Promise(resolveFrame => {
    const start = () => {
      running++;
      Bun.spawn({
        cmd: ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", Math.max(0, seconds).toFixed(3), "-i", videoPath, "-frames:v", "1", path],
        stdout: "ignore",
        stderr: "ignore",
        onExit: () => {
          running--;
          if (waiting.length) waiting.shift()();
          resolveFrame(existsSync(path) ? path : undefined);
        },
      });
    };
    if (running < concurrency) start();
    else waiting.push(start);
  });
}

const manifest = { video: videoPath, generatedFrames: [], notes: [] };

// ── 材料 1：逐句定妆帧 ────────────────────────────────────────────
// 取句子中段，避开入场与出场的过渡态（参考实现的评审提醒：入场中间态不是缺陷）。
const timestampsPath = readOption("timestamps", "");
if (timestampsPath && existsSync(timestampsPath)) {
  const timestamps = readJson(timestampsPath);
  const results = await Promise.all((timestamps.sentences ?? []).map(sentence =>
    extractFrame((sentence.beginMs + sentence.endMs) / 2 / 1000, `sentence-${String(sentence.index).padStart(2, "0")}`)
      .then(path => ({ sentence, path }))));
  for (const { sentence, path } of results) {
    if (path) manifest.generatedFrames.push({ kind: "sentence", index: sentence.index, at: (sentence.beginMs + sentence.endMs) / 2000, text: sentence.text, path });
  }
  manifest.notes.push("逐句帧取句子中段，避开入场/出场过渡态；入场中间态不是缺陷。");
} else {
  manifest.notes.push("未提供 timestamps.json，跳过了逐句抽帧。");
}

// ── 材料 2：动效锚点帧 + 连拍帧 ────────────────────────────────────
// 参考实现的判据：短命动效的错位要用「每个重音 +0.25s 的定妆帧」逐个核
// 「框住/指向/圈住目标了没有」；状态切换处（两态翻转/换场/砸入落位）
// 要抽连拍三帧 —— 三帧间只该有设计内的连续运动，出现来回振荡即缺陷。
const anchorsPath = readOption("anchors", "");
if (anchorsPath && existsSync(anchorsPath)) {
  const anchors = readJson(anchorsPath);
  const anchorFrames = await Promise.all(anchors.map((anchor, index) => {
    const label = String(anchor.label ?? index).replace(/[^A-Za-z0-9_-]/g, "_");
    return extractFrame(Number(anchor.t) + 0.25, `anchor-${String(index).padStart(2, "0")}-${label}`)
      .then(path => ({ anchor, index, label, path }));
  }));
  for (const { anchor, index, label, path } of anchorFrames) {
    if (path) manifest.generatedFrames.push({ kind: "anchor", index, label, at: Number(anchor.t) + 0.25, what: anchor.what ?? "", path });
  }
  // 连拍：状态切换处三帧只该有设计内的连续运动
  const burstAnchors = anchors.filter(anchor => anchor.burst);
  const burstFrames = await Promise.all(burstAnchors.map((anchor, burstIndex) => {
    const label = String(anchor.label ?? burstIndex).replace(/[^A-Za-z0-9_-]/g, "_");
    const at = Number(anchor.t);
    return Promise.all([0, 0.033, 0.066].map(offset =>
      extractFrame(at + offset, `burst-${String(burstIndex).padStart(2, "0")}-${label}-${Math.round(offset * 1000)}`)))
      .then(paths => ({ label, at, paths: paths.filter(Boolean) }));
  }));
  for (const { label, at, paths } of burstFrames) {
    if (paths.length === 3) manifest.generatedFrames.push({ kind: "burst", label, at, paths });
  }
  manifest.notes.push("锚点帧在锚点 +0.25s（定妆态）；burst 锚点抽连拍三帧，帧间只该有设计内的连续运动。");
} else {
  manifest.notes.push("未提供 anchors.json，跳过了动效锚点与连拍抽帧。");
}

// ── 材料 3：镜头边界帧 ────────────────────────────────────────────
// 转场是最高频的缺陷区（裸切、运动方向不连续），边界两侧各抽一帧。
const shotsPath = readOption("shots", "");
if (shotsPath && existsSync(shotsPath)) {
  const shots = readJson(shotsPath);
  const boundaryFrames = await Promise.all(shots.map((shot, index) => {
    const end = Number(shot.end);
    return Promise.all([
      extractFrame(Math.max(0, end - 0.1), `boundary-${String(index).padStart(2, "0")}-out`),
      extractFrame(end + 0.1, `boundary-${String(index).padStart(2, "0")}-in`),
    ]).then(paths => ({ shot, paths: paths.filter(Boolean) }));
  }));
  for (const { shot, paths } of boundaryFrames) {
    if (paths.length) manifest.generatedFrames.push({ kind: "boundary", id: shot.id, paths });
  }
  manifest.notes.push("镜头边界两侧各抽一帧，核转场处置与运动方向连续性（禁止裸切）。");
} else {
  manifest.notes.push("未提供 shots.json，跳过了镜头边界抽帧。");
}

// ── 材料 4：拼图（整版浏览） ──────────────────────────────────────
// 参考实现的做法：评审先整版浏览、可疑帧再回原目录单张放大。
// 几十张图的图像 token 不进主上下文，所以拼图是控制上下文的手段。
if (rest.includes("--sheet")) {
  const sheets = join(outDir, "sheets");
  const sheetInput = join(outDir, "sheet-input");
  mkdirSync(sheets, { recursive: true });
  mkdirSync(sheetInput, { recursive: true });
  // 参考实现用 tile 拼图做整版浏览。两个约束：
  //   · 本机的 ffmpeg 构建不支持 pattern_type=glob，所以用顺序编号输入；
  //   · tile 每张要凑满 12 帧才输出，帧数不是 12 的倍数时会丢末尾几张。
  // 做法：把原帧**按顺序编号另存一份**到 sheet-input，拼图只读那份 ——
  // 不动原帧的文件名，评审仍按 sentence-NN / anchor-NN 这些名字核对。
  const frameFiles = manifest.generatedFrames
    .flatMap(frame => frame.paths ? frame.paths : [frame.path])
    .filter(Boolean);
  const missing = [];
  frameFiles.forEach((file, index) => {
    // ffmpeg 的 %03d 序列从 000 开始编号。
    // 注意：这里**不吞异常** —— 曾经把复制写在自己的 try/catch 里，
    // 而 import 漏了 copyFileSync，于是每张都抛 ReferenceError 被静默吃掉，
    // 表现为「sheet-input 是空的、拼图失败」，排查了很久才定位到根因。
    try {
      copyFileSync(file, join(sheetInput, `${String(index).padStart(3, "0")}.png`));
    } catch (error) {
      missing.push(`${file}: ${error.message}`);
    }
  });
  if (missing.length) manifest.notes.push(`${missing.length} 张帧复制失败（拼图会缺这些帧）：${missing.slice(0, 3).join("；")}`);
  const result = frameFiles.length
    ? ffmpeg([
        "-y", "-framerate", "1", "-i", join(sheetInput, "%03d.png"),
        "-vf", "scale=480:-1,tile=3x4:nb_frames=12:padding=4:color=black",
        join(sheets, "sheet-%02d.png"),
      ])
    : { ok: false, err: "没有可拼的帧" };
  if (!result.ok) manifest.notes.push(`拼图失败，评审仍需按帧目录逐张看。${result.err.slice(0, 200)}`);
  else manifest.notes.push("已生成拼图（3x4 网格，每张 12 帧），评审先整版浏览、可疑帧再回原目录单张放大。");
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

// 派发包：自足的 prompt 素材。评审 subagent 看不到制作过程，
// 所以这里只列「磁盘上有什么」和「该核什么」，不含任何制作方的解释或预期结论。
const countOf = kind => manifest.generatedFrames.filter(frame => frame.kind === kind).length;
const lines = [
  "# 独立评审材料包",
  "",
  `成片：${videoPath}`,
  "",
  "## 材料清单",
  "",
  `- 抽帧目录：${framesDir}`,
  `- 逐句定妆帧：${countOf("sentence")} 张（sentence-NN.png，NN 是句序号）`,
  `- 动效锚点帧：${countOf("anchor")} 张（anchor-NN-label.png）`,
  `- 连拍帧：${countOf("burst")} 组（burst-NN-label-毫秒.png）`,
  `- 镜头边界帧：${countOf("boundary")} 组（boundary-NN-in/out.png）`,
  "",
  "## 评审纪律",
  "",
  "- 只看成片与上面的帧，不要浏览任何制作对话、历史记录或中间产物。",
  "- 本条不提供、也不要求任何关于「制作方本来想做什么」的信息；不要据此推断。",
  "- 每条结论必须附**可复核的帧文件名**，例如「Q2 ✗（sentence-07.png 文字发糊）」。",
  "- 不要用「整体不错」代替逐项检查，也不要为了报告好看而全部标通过。",
  "- 入场中间态（淡入进行中、位移未落定）**不是**缺陷，不要报。",
  "- 缺陷分级：P0 = 观众必然察觉且伤害理解；P1 = 违反硬规则或明显走样；P2 = 质感瑕疵（记录不挡验收）。**修完 P0 + P1 才算过关。**",
  "",
  "## 检查项",
  "",
  "1. **可读性**：文字是否清晰、有无贴边裁切、字号是否够（缩到 390px 宽复看仍要能读）。",
  "2. **构图与排版**：主体是否居中或按规则偏置；同屏主体组是否超过 3 组；是否留有空象限；画面文字与字幕是否有整句重复。",
  "3. **信息传达**：每镜是否提供新信息；是否存在重复功能或重复标语。",
  "4. **质感**：有无压缩伪影、渲染残影、非有意的抖动或闪烁、廉价光效。",
  "5. **音画同步**：字幕与配音是否对得上（对照逐句帧的时间点）。",
  "6. **短命动效落位**：对照 anchor 帧核 —— 标注/箭头是否框住、指向、圈住了目标。",
  "7. **转场**：对照 boundary 帧核 —— 每个镜头边界是否有明确的转场处置（禁止裸切），前后运动方向是否连续。",
  "8. **设计落地**：若随包提供计划清单，核「计划里有的东西在不在」，不只是「摆上去的对不对」。",
  "",
  "## 报告格式",
  "",
  "每条结论一行，编号 + ✓/✗ + 帧文件名：",
  "",
  "```text",
  "1 ✓ 文字清晰，无贴边。",
  "6 ✗ anchor-03-punch.png：箭头没有指向目标，落在了文字左侧。",
  "7 ✗ boundary-04-in.png：硬切，无转场处置。",
  "```",
  "",
  "最后按严重程度列出：必须修复项（P0/P1）、建议优化项（P2）、无法验证项。",
  "",
];
writeFileSync(join(outDir, "REVIEW-PACKET.md"), lines.join("\n"));

console.log("=== 评审材料已就绪 ===");
console.log(`  输出目录 ${outDir}`);
console.log(`  抽帧 ${manifest.generatedFrames.length} 项：`);
const byKind = {};
for (const frame of manifest.generatedFrames) byKind[frame.kind] = (byKind[frame.kind] ?? 0) + 1;
for (const [kind, count] of Object.entries(byKind)) console.log(`    ${kind.padEnd(10)} ${count}`);
console.log(`  派发包 ${join(outDir, "REVIEW-PACKET.md")}`);
console.log("");
for (const note of manifest.notes) console.log(`  · ${note}`);
