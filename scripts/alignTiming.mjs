// 命令行入口：把 ASR 词级时间戳对齐到口播稿，产出可烧字幕的 timestamps.json。
//
// 算法在 @toonflow/post-production —— 与 agent 工具共用同一份实现，
// 避免两处副本各自漂移。本文件只负责读写文件与打印报告。
//
// 用法：bun scripts/alignTiming.mjs <asr.json> <script.txt|script.json> <timestamps.json>
import { readFileSync, writeFileSync } from "node:fs";
import { alignTiming } from "@toonflow/post-production";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function extractScriptSentences(scriptPath) {
  const raw = readFileSync(scriptPath, "utf8");
  if (scriptPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.sentences)) return parsed.sentences.map(item => String(item?.text ?? item));
    if (typeof parsed?.text === "string") return [parsed.text];
  }
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

const [asrPath, scriptPath, outputPath] = process.argv.slice(2);
if (!asrPath || !scriptPath || !outputPath) {
  console.error("用法：bun scripts/alignTiming.mjs <asr.json> <script.txt|script.json> <timestamps.json>");
  process.exit(2);
}

const asr = readJson(asrPath);
const rawWords = asr?.sentences?.[0]?.words ?? asr?.words ?? [];
if (!rawWords.length) { console.error("ASR 结果里没有 words"); process.exit(1); }

// 兼容本项目约定（beginMs/endMs）与参考实现的 start/end（秒）
const words = rawWords.map(word => ({
  text: String(word.text ?? ""),
  beginMs: Number.isFinite(word.beginMs) ? Number(word.beginMs) : Math.round(Number(word.start ?? 0) * 1000),
  endMs: Number.isFinite(word.endMs) ? Number(word.endMs) : Math.round(Number(word.end ?? 0) * 1000),
  punctuation: typeof word.punctuation === "string" ? word.punctuation : "",
}));

const scriptSentences = extractScriptSentences(scriptPath);
const result = alignTiming(scriptSentences, words);

console.log("=== 输入 ===");
console.log(`  ASR 词 ${words.length} 个`);
console.log(`  稿子 ${scriptSentences.length} 句`);

writeFileSync(outputPath, JSON.stringify({ source: { asr: asrPath, script: scriptPath }, ...result }, null, 2));

console.log("");
console.log("=== 输出 ===");
console.log(`  ${outputPath}`);
console.log(`  总时长 ${(result.totalMs / 1000).toFixed(2)}s`);
for (const sentence of result.sentences) {
  console.log(`  ${sentence.ok ? "✓" : "⚠"} [${String(sentence.beginMs).padStart(6)}–${String(sentence.endMs).padStart(6)}ms] match=${sentence.match.toFixed(2)}  ${sentence.text}`);
}
const weak = result.sentences.filter(sentence => !sentence.ok);
console.log("");
console.log(weak.length
  ? `  ⚠ ${weak.length} 句覆盖率 < 0.90，建议人工听核（ASR 与稿子措辞不一致时会偏低）`
  : "  全部句子覆盖率 ≥ 0.90");
