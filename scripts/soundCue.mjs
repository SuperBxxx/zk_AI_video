// 音效钉帧：把「画面动作」翻译成「音频轨上的绝对时间」。
//
// 为什么需要它（参考实现的两条实测教训）：
//
// 1. **钉帧一律相对镜头起点，绝不写裸帧号**。
//    参考实现的做法是 `SHOTS.x.from + offset`，于是时间线整体平移时全表自动跟随；
//    一旦把绝对帧号写进表里，任何一次改期都要重新逐个对帧。
//
// 2. **输出音轨有编码器 priming 偏移**。参考实现实测（2026-08-23，Remotion 4.x +
//    AAC 48kHz mp4，click/impact 双探针交叉相关）：整条音轨滞后 ≈1.28 帧。
//    ffmpeg 内置 aac 编码器的 priming 是 1024 samples（fdk-aac 2048、Apple 约 2112），
//    48kHz 下 1024 samples ≈ 21.3ms，30fps 下 ≈ 0.64 帧 —— **不能照抄别人的常数**，
//    必须按自己的渲染管线实测。所以本脚本把偏移做成显式参数，
//    默认 0 并在输出里提示「未补偿」，而不是塞一个看起来合理但其实错的值。
//
// 用法：bun scripts/soundCue.mjs <cues.json> --shots <shots.json> [--out cues-resolved.json]
//       bun scripts/soundCue.mjs <cues.json> --shots <shots.json> --offset-ms 21.3
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [cuePath, ...rest] = process.argv.slice(2);
if (!cuePath) {
  console.error("用法：bun scripts/soundCue.mjs <cues.json> --shots <shots.json> [--out out.json] [--offset-ms 0] [--fps 30] [--tail 0.5]");
  process.exit(2);
}
if (!existsSync(cuePath)) { console.error(`找不到文件：${cuePath}`); process.exit(2); }

function readOption(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

const shotsPath = readOption("shots", "");
if (!shotsPath || !existsSync(shotsPath)) { console.error("需要 --shots <shots.json>：钉帧必须相对镜头起点"); process.exit(2); }
const shots = readJson(shotsPath);
const shotById = new Map(shots.map(shot => [shot.id, shot]));

const fps = Number(readOption("fps", "30"));
const tail = Number(readOption("tail", "0.5"));
const offsetMs = Number(readOption("offset-ms", "0"));
const outPath = readOption("out", "");

/**
 * 音效 cue 表格式：
 *   [{ "shot": "s03", "offset": 0.4, "src": "whoosh-soft.mp3", "volume": 0.55, "what": "卡片上浮" }]
 * offset 是**相对镜头起点的秒数**；也允许 "anchor" 指定绝对秒（用于片头/全片级音效），
 * 但那种情况要显式写 absolute: true，避免误用绝对时间。
 */
const cues = readJson(cuePath);
const problems = [];
const warnings = [];
const resolved = [];

for (const [index, cue] of cues.entries()) {
  const label = `[${index}] ${cue.src ?? "?"}`;
  if (!cue.src) { problems.push(`${label} 缺少 src`); continue; }

  let absoluteSeconds;
  if (cue.absolute) {
    if (!Number.isFinite(Number(cue.anchor))) { problems.push(`${label} 标了 absolute 但没有有效的 anchor 秒数`); continue; }
    absoluteSeconds = Number(cue.anchor);
  } else {
    const shot = shotById.get(cue.shot);
    if (!shot) { problems.push(`${label} 引用了不存在的镜头「${cue.shot}」`); continue; }
    if (!Number.isFinite(Number(cue.offset))) { problems.push(`${label} 缺少有效的 offset`); continue; }
    absoluteSeconds = Number(shot.start) + Number(cue.offset);

    // 镜尾保护带：参考实现的判据是锚点距镜头出点 ≥ tail，
    // 否则音效落点会被转场吞掉（听起来像「没响」或「响晚了」）。
    const fromEnd = Number(shot.end) - absoluteSeconds;
    if (fromEnd < 0) {
      problems.push(`${label} 落在镜头 ${cue.shot} 之外：起点 ${Number(shot.start).toFixed(2)}s + offset ${Number(cue.offset).toFixed(2)}s = ${absoluteSeconds.toFixed(2)}s > 镜尾 ${Number(shot.end).toFixed(2)}s`);
      continue;
    }
    if (fromEnd < tail) {
      warnings.push(`${label} 距镜尾只有 ${fromEnd.toFixed(2)}s（< 保护带 ${tail}s），落点可能被转场吞掉`);
    }
  }

  // 音量是**乘法系数**不是目标音量：素材本身录得轻时给 1.0 也压不住 BGM。
  const volume = Number(cue.volume ?? 1);
  if (volume > 1) warnings.push(`${label} 音量 ${volume} > 1：说明素材本身偏轻，优先换素材或预归一化，而不是靠增益硬顶`);

  // 补偿：目标时刻减去输出音轨偏移
  const compensatedMs = absoluteSeconds * 1000 - offsetMs;
  if (compensatedMs < 0) {
    problems.push(`${label} 补偿后时刻为负（${compensatedMs.toFixed(1)}ms）：片头附近的钉点无法完成全部补偿，重音不要设计在片头`);
    continue;
  }

  resolved.push({
    src: cue.src,
    what: cue.what ?? "",
    shot: cue.absolute ? undefined : cue.shot,
    offset: cue.absolute ? undefined : Number(cue.offset),
    absoluteMs: Math.round(absoluteSeconds * 1000),
    startMs: Math.round(compensatedMs),
    frame: Math.round((compensatedMs / 1000) * fps),
    volume,
  });
}

resolved.sort((a, b) => a.absoluteMs - b.absoluteMs);

console.log("=== 音效钉帧 ===");
console.log(`  ${cues.length} 条 cue → ${resolved.length} 条可用`);
console.log(`  偏移补偿 ${offsetMs}ms（${(offsetMs / 1000 * fps).toFixed(2)} 帧 @${fps}fps）`);
console.log("");
if (!offsetMs) {
  console.log("  ⚠ 未做输出音轨偏移补偿。AAC 编码器的 priming 会让整条音轨滞后");
  console.log("    （ffmpeg 内置 aac 1024 samples ≈ 21.3ms @48kHz；fdk-aac 2048；Apple ≈2112），");
  console.log("    这个常数必须按自己的渲染管线实测，不能照抄。实测方法：抽音轨后拿 2~3 个");
  console.log("    尖锐音效做归一化交叉相关，残差 ≤0.5 帧为合格，再用 --offset-ms 传入。");
  console.log("");
}
for (const cue of resolved) {
  const where = cue.shot ? `${cue.shot}+${cue.offset}s` : "绝对";
  console.log(`  ${String(cue.startMs).padStart(8)}ms (帧 ${String(cue.frame).padStart(5)})  ${String(cue.volume).padEnd(5)} ${where.padEnd(12)} ${cue.src}${cue.what ? `  ← ${cue.what}` : ""}`);
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ offsetMs, fps, cues: resolved }, null, 2));
  console.log("");
  console.log(`  已写出 ${outPath}`);
}

if (warnings.length) {
  console.log("");
  console.log(`警告 ${warnings.length} 项：`);
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
}
console.log("");
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("全部 cue 可用");
