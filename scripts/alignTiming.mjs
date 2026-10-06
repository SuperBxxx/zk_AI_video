// 把 ASR 词级时间戳对齐到口播稿，产出可烧字幕的 timestamps.json。
//
// 为什么要这一步：ASR 返回的是「它听到的文本」+ 时间，字幕要跟**我们的稿子**一致。
// 两者有系统性差异（2026-10-06 实测）：
//   · 数字规范化：稿子「三千」→ ASR「3000」；「十九万」→「19万」；「六十多倍」→「60多倍」
//   · 碎片化：ASR 把「19万」切成 "1" + "9" + "万"
//   · 不按标点分句：整段返回单个 sentence，标点挂在词的 punctuation 字段上
//
// 关键设计：**句子的权威是稿子，不是 ASR 的标点**。
// 踩过的坑：先按 ASR 的标点/气口切句、再与稿子按序号一一配对 ——
// ASR 会按自己的停顿把稿子的第 1、2 句并成一段，于是从第二句起整体错位，
// 匹配率全是 0。正确做法是反过来：以稿子每句为准，逐句在 ASR 词表里推进词区间。
//
// 同音字匹配需要拼音词库，本实现不引依赖；改用「匹配覆盖率」把不可信句子标出来交人工核。
import { readFileSync, writeFileSync } from "node:fs";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const digitValues = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const unitValues = { 十: 10, 百: 100, 千: 1000 };
const bigUnits = { 万: 10000, 亿: 100000000 };

function isDigitChar(char) { return char !== undefined && (/[0-9]/.test(char) || digitValues[char] !== undefined); }
function digitValue(char) { return /[0-9]/.test(char) ? Number(char) : digitValues[char]; }
function isUnitChar(char) { return char !== undefined && (unitValues[char] !== undefined || bigUnits[char] !== undefined); }
function isNumberChar(char) { return isDigitChar(char) || isUnitChar(char); }

/**
 * 解析一个数值 token 成统一的数值字符串，用来抹平稿子与 ASR 的写法差异。
 *
 * 为什么要统一：ASR 会把稿子的「三千」回成「3000」、把「十九万」回成「19万」，
 * 甚至把同一个数切成 "1"+"9"+"万" 三个 token。逐位转换与位值解析都无法同时覆盖
 * 「十九万」「19万」「190000」三种写法 —— 实测把「19万」解析成了 190。
 *
 * 规则（对两种写法都成立）：
 *   · 逐位读法（3000 / 一九七）→ 保持逐位；
 *   · 位值单位（万 / 亿）只对**积木段**（三千 / 19 / 十九）生效，把段值乘上位值。
 * 于是「三千」→3000、「3000」→3000、「十九万」→190000、「19万」→190000。
 */
function parseNumberToken(token) {
  const chars = [...token];
  const bigIndex = chars.findIndex(char => bigUnits[char] !== undefined);
  const hasBigUnit = bigIndex >= 0;
  const anyUnit = chars.some(char => unitValues[char] !== undefined);
  // 既无大单位也无小单位：整串都是数字 → 逐位读法
  if (!hasBigUnit && !anyUnit) return chars.map(char => digitValue(char) ?? "").join("");

  const evaluate = list => {
    let total = 0;
    let current = 0;
    for (const char of list) {
      if (isDigitChar(char)) { current = current * 10 + (digitValue(char) ?? 0); continue; }
      if (unitValues[char] !== undefined) { total += (current || 1) * unitValues[char]; current = 0; }
    }
    return total + current;
  };

  if (hasBigUnit) {
    const head = evaluate(chars.slice(0, bigIndex)) * bigUnits[chars[bigIndex]];
    const tailChars = chars.slice(bigIndex + 1);
    const tailIndex = tailChars.findIndex(char => bigUnits[char] !== undefined);
    const tail = tailIndex >= 0
      ? evaluate(tailChars.slice(0, tailIndex)) * bigUnits[tailChars[tailIndex]] + evaluate(tailChars.slice(tailIndex + 1))
      : evaluate(tailChars);
    return String(head + tail);
  }
  return String(evaluate(chars));
}

/**
 * 把稿子与 ASR 的文本统一成同一套写法，用于对齐比较。
 *
 * 数字处理成**单个占位符**：实测 ASR 会把「十九万」写成「19万」、把「三千」写成「3000」，
 * 甚至切成 "1"+"9"+"万"；稿子与 ASR 的数值虽然相同，但十进制展开后位数不同
 * （190000 是 6 位、190 是 3 位），逐位比较会让 LCS 从数字处整体漂移。
 * 折叠成一个字符后两边必然对齐，数字内部的时间由展开阶段线性插值给出 ——
 * 一个数字本来就是一个词，共用一个时间跨度是合理的。
 *
 * ACT: 同音字不做归一（需要拼音词库）；由覆盖率暴露并交人工核。
 */
function normalize(text) {
  const kept = [...text.normalize("NFKC")]
    .filter(char => /[0-9A-Za-z]/.test(char) || CJK.test(char))
    .join("")
    .toLowerCase();
  return kept.replace(/[0-9零〇一二两三四五六七八九十百千万亿]+/g, run => {
    if (![...run].some(char => isNumberChar(char))) return run;
    // 解析一次只为确认它是数值；展开位数不影响对齐，所以统一成一个占位符
    parseNumberToken(run);
    return "#";
  });
}

/** 合并被 ASR 切碎的 token：["1","9","万"] → "19万"；["三","千"] → "三千"。 */
function mergeNumericRuns(words) {
  const merged = [];
  for (const word of words) {
    const previous = merged[merged.length - 1];
    if (previous) {
      const previousIsDigit = /^[0-9]+$/.test(previous.text);
      const currentIsDigit = /^[0-9]+$/.test(word.text);
      const currentIsUnit = /^[万亿千百十]$/.test(word.text);
      if ((previousIsDigit && (currentIsDigit || currentIsUnit)) ||
          (CJK.test(previous.text) && previous.text.length === 1 && currentIsUnit)) {
        previous.text += word.text;
        previous.endMs = word.endMs;
        previous.punctuation = previous.punctuation || word.punctuation;
        continue;
      }
    }
    merged.push({ ...word });
  }
  return merged;
}

/** 把 token 时间按字数比例展开成逐字（参考实现 make_timing 的做法）。 */
function expandToChars(word) {
  const spoken = [...word.text.normalize("NFKC")].filter(char => /[0-9A-Za-z]/.test(char) || CJK.test(char));
  if (!spoken.length) return [];
  const width = word.endMs - word.beginMs;
  return spoken.map((char, index) => ({
    char,
    beginMs: word.beginMs + (width * index) / spoken.length,
    endMs: word.beginMs + (width * (index + 1)) / spoken.length,
  }));
}

/**
 * 稿子字符序列 → ASR 字符序号 的单调映射（最长公共子序列）。
 *
 * 为什么要全局 LCS 而不是逐句贪心：逐句推进只看「本句还剩几个字」，
 * ASR 多吐一个同音字就会把后续字符整体带偏（实测第 3 句只吃到 5/10 个字）。
 * 一次 LCS 求出两边的全局对应关系，句子边界再从映射里回推，稳定得多。
 * ACT: LCS 只做「相等」判断，不做拼音级同音字匹配（那需要词库）。
 * 同音字会被算作不匹配，由覆盖率（match）暴露并交人工核。
 */
function mapScriptToAsr(scriptChars, asrChars) {
  const rows = scriptChars.length + 1;
  const cols = asrChars.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = scriptChars.length - 1; i >= 0; i--) {
    for (let j = asrChars.length - 1; j >= 0; j--) {
      table[i][j] = scriptChars[i] === asrChars[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  // 回溯：scriptToAsr[i] = 与稿子第 i 个字符对应的 ASR 序号，未匹配为 -1
  const scriptToAsr = new Int32Array(scriptChars.length).fill(-1);
  const asrToScript = new Int32Array(asrChars.length).fill(-1);
  let i = 0;
  let j = 0;
  while (i < scriptChars.length && j < asrChars.length) {
    if (scriptChars[i] === asrChars[j]) {
      scriptToAsr[i] = j;
      asrToScript[j] = i;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return { scriptToAsr, asrToScript, matched: scriptToAsr.filter(value => value >= 0).length };
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

const asr = JSON.parse(readFileSync(asrPath, "utf8"));
const rawWords = asr?.sentences?.[0]?.words ?? asr?.words ?? [];
if (!rawWords.length) { console.error("ASR 结果里没有 words"); process.exit(1); }

// 兼容本项目约定（beginMs/endMs）与参考实现的 start/end（秒）
const words = rawWords
  .map(word => ({
    text: String(word.text ?? ""),
    beginMs: Number.isFinite(word.beginMs) ? word.beginMs : Math.round((word.start ?? 0) * 1000),
    endMs: Number.isFinite(word.endMs) ? word.endMs : Math.round((word.end ?? 0) * 1000),
    punctuation: word.punctuation ?? "",
  }))
  .filter(word => normalize(word.text));

const merged = mergeNumericRuns(words).map(word => ({ ...word, chars: expandToChars(word) })).filter(word => word.chars.length);
const sentenceTexts = extractScriptSentences(scriptPath);

// 打平 ASR 逐字流，同时记住每个字符属于哪个词（用来回推句子边界所在的词）
const flatChars = [];
const wordStarts = [];
for (const word of merged) {
  wordStarts.push(flatChars.length);
  flatChars.push(...word.chars);
}
wordStarts.push(flatChars.length);

// 稿子全文本（归一化）与 ASR 逐字流做一次全局 LCS
const scriptAll = sentenceTexts.map(text => normalize(text)).filter(text => text.length).join("");
const { scriptToAsr, matched } = mapScriptToAsr([...scriptAll], flatChars.map(item => item.char));

console.log("=== 输入 ===");
console.log(`  ASR 词 ${words.length} → 合并后 ${merged.length}（逐字 ${flatChars.length} 个）`);
console.log(`  稿子 ${sentenceTexts.length} 句（逐字 ${[...scriptAll].length} 个）`);
console.log(`  全局 LCS 匹配 ${matched}/${[...scriptAll].length} 字（${((matched / Math.max(1, [...scriptAll].length)) * 100).toFixed(1)}%）`);

// 给每个 ASR 字符分派句子序号：由 LCS 锚点决定，未锚定的字符沿用上一个锚点的句子
const sentenceOfAsr = new Int32Array(flatChars.length).fill(-1);
const scriptOffsets = [];
let offset = 0;
for (const raw of sentenceTexts) {
  const normalized = normalize(raw);
  if (!normalized.length) continue;
  scriptOffsets.push({ raw, text: normalized, start: offset, end: offset + [...normalized].length });
  offset += [...normalized].length;
}
let sentenceCursor = 0;
for (let scriptIndex = 0; scriptIndex < scriptToAsr.length; scriptIndex++) {
  while (sentenceCursor < scriptOffsets.length - 1 && scriptIndex >= scriptOffsets[sentenceCursor].end) sentenceCursor++;
  const asrIndex = scriptToAsr[scriptIndex];
  if (asrIndex >= 0) sentenceOfAsr[asrIndex] = sentenceCursor;
}
// 未锚定字符继承前一个已锚定字符的句子
let last = 0;
for (let index = 0; index < sentenceOfAsr.length; index++) {
  if (sentenceOfAsr[index] < 0) sentenceOfAsr[index] = last;
  else last = sentenceOfAsr[index];
}

const sentences = [];
for (let sentenceIndex = 0; sentenceIndex < scriptOffsets.length; sentenceIndex++) {
  const { raw, text, start, end } = scriptOffsets[sentenceIndex];
  const charIndexes = [];
  for (let index = 0; index < sentenceOfAsr.length; index++) if (sentenceOfAsr[index] === sentenceIndex) charIndexes.push(index);
  if (!charIndexes.length) { console.log(`  ⚠ 跳过无锚点的句子：${text}`); continue; }

  const firstChar = charIndexes[0];
  const lastCharIndex = charIndexes[charIndexes.length - 1];
  // 找到这些字符覆盖的词区间
  let startWord = 0;
  while (startWord < wordStarts.length - 1 && wordStarts[startWord + 1] <= firstChar) startWord++;
  let endWord = startWord;
  while (endWord < wordStarts.length - 1 && wordStarts[endWord] < lastCharIndex + 1) endWord++;

  const sentenceMatched = scriptToAsr.slice(start, end).filter(value => value >= 0).length;
  const match = (end - start) ? sentenceMatched / (end - start) : 0;

  // ACT: charTimes 给逐字时间（字幕要逐字高亮时用）；words 是词粒度，正文用后者更省体积。
  // 注意：一个词可能跨多个 ASR token，所以起始时间是「本组第一个 token 的起始」，
  // 不能沿用整句首字符的时间（踩过：写回退值后同句后半段的词起始变成 0）。
  const sliceFlat = [];
  for (let index = startWord; index < endWord; index++) {
    const wordStart = wordStarts[index];
    if (wordStart === undefined) continue;
    sliceFlat.push({ word: merged[index], charOffset: wordStart - firstChar });
  }
  const wordsOut = [];
  let pending = "";
  let pendingBegin = NaN;
  for (const { word, charOffset } of sliceFlat) {
    if (!word.chars.length) continue;
    if (pending === "" && charOffset >= 0 && flatChars[firstChar + charOffset]) {
      pendingBegin = flatChars[firstChar + charOffset].beginMs;
    }
    pending += word.text;
    const wordLast = word.chars[word.chars.length - 1];
    if (word.punctuation || pending.length >= 8) {
      wordsOut.push({ text: pending, beginMs: Number.isFinite(pendingBegin) ? pendingBegin : wordLast.beginMs, endMs: wordLast.endMs, punctuation: word.punctuation ?? "" });
      pending = "";
      pendingBegin = NaN;
    }
  }
  if (pending) {
    const tail = flatChars[lastCharIndex];
    wordsOut.push({ text: pending, beginMs: Number.isFinite(pendingBegin) ? pendingBegin : tail.beginMs, endMs: tail.endMs, punctuation: "" });
  }

  sentences.push({
    index: sentences.length,
    text: raw,
    beginMs: flatChars[firstChar].beginMs,
    endMs: flatChars[lastCharIndex].endMs,
    match: Number(match.toFixed(3)),
    ok: match >= 0.9,
    charTimes: charIndexes.map(index => ({ char: flatChars[index].char, beginMs: flatChars[index].beginMs, endMs: flatChars[index].endMs })),
    words: wordsOut,
  });
}

const totalMs = sentences.length ? sentences[sentences.length - 1].endMs : 0;
writeFileSync(outputPath, JSON.stringify({ source: { asr: asrPath, script: scriptPath }, totalMs, sentences }, null, 2));

console.log("");
console.log("=== 输出 ===");
console.log(`  ${outputPath}`);
console.log(`  总时长 ${(totalMs / 1000).toFixed(2)}s`);
for (const sentence of sentences) {
  console.log(`  ${sentence.ok ? "✓" : "⚠"} [${String(sentence.beginMs).padStart(6)}–${String(sentence.endMs).padStart(6)}ms] match=${sentence.match.toFixed(2)}  ${sentence.text}`);
}
const weak = sentences.filter(sentence => !sentence.ok);
console.log("");
console.log(weak.length
  ? `  ⚠ ${weak.length} 句覆盖率 < 0.90，建议人工听核`
  : "  全部句子覆盖率 ≥ 0.90");
