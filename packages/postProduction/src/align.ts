// 把 ASR 词级时间戳对齐到口播稿，产出可烧字幕的时间表。
//
// 这个模块是**纯算法**：不碰文件系统、不碰网络，输入是稿子与 ASR 结果、输出是时间表。
// 之所以抽成独立包：脚本（scripts/alignTiming.mjs）与 agent 工具（tools/postProduction）
// 都要用它 —— 复制两份的代价是两处会各自漂移，而这段逻辑是本次改动里返工最多的部分。
//
// 为什么要对齐：ASR 返回的是「它听到的文本」+ 时间，而字幕要跟**我们的稿子**一致。
// 两者有系统性差异（实测）：
//   · 数字规范化：稿子「三千」→ ASR「3000」；「十九万」→「19万」；「六十多倍」→「60多倍」
//   · 碎片化：ASR 把「19万」切成 "1" + "9" + "万"
//   · 不按标点分句：标点挂在词的 punctuation 字段上
//
// 关键设计：**句子的权威是稿子，不是 ASR 的标点**。
// 踩过的坑：先按 ASR 的标点/气口切句、再与稿子按序号一一配对 ——
// ASR 会按自己的停顿把稿子的前两句并成一段，于是从第二句起整体错位、匹配率全是 0。
// 正确做法是反过来：以稿子每句为准，在 ASR 字符流里回推边界。
//
// 同音字匹配需要拼音词库，本实现不引依赖；改用「匹配覆盖率」把不可信句子标出来交人工核。

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const digitValues: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const unitValues: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const bigUnits: Record<string, number> = { 万: 10000, 亿: 100000000 };

export interface AlignWord {
  text: string;
  beginMs: number;
  endMs: number;
  punctuation?: string;
}

export interface AlignCharTime {
  char: string;
  beginMs: number;
  endMs: number;
}

export interface AlignWordSpan {
  text: string;
  beginMs: number;
  endMs: number;
  punctuation: string;
}

export interface AlignSentence {
  index: number;
  text: string;
  beginMs: number;
  endMs: number;
  /** CJK 锚点覆盖率；< 0.9 表示这句不可信，建议人工听核。 */
  match: number;
  ok: boolean;
  charTimes: AlignCharTime[];
  words: AlignWordSpan[];
}

export interface AlignResult {
  totalMs: number;
  sentences: AlignSentence[];
}

function isDigitChar(char: string | undefined): boolean {
  return char !== undefined && (/[0-9]/.test(char) || digitValues[char] !== undefined);
}
function digitValue(char: string): number | undefined {
  return /[0-9]/.test(char) ? Number(char) : digitValues[char];
}
function isUnitChar(char: string | undefined): boolean {
  return char !== undefined && (unitValues[char] !== undefined || bigUnits[char] !== undefined);
}
function isNumberChar(char: string): boolean {
  return isDigitChar(char) || isUnitChar(char);
}

/**
 * 解析一个数值 token 成统一的数值字符串，用来抹平稿子与 ASR 的写法差异。
 *
 * 为什么要统一：ASR 会把「三千」回成「3000」、把「十九万」回成「19万」，
 * 甚至切成 "1"+"9"+"万"。逐位转换与位值解析都无法同时覆盖
 * 「十九万」「19万」「190000」三种写法 —— 实测把「19万」解析成了 190。
 *
 * 规则（对两种写法都成立）：逐位读法保持逐位；位值单位（万/亿）只对积木段生效。
 */
function parseNumberToken(token: string): string {
  const chars = [...token];
  const bigIndex = chars.findIndex(char => bigUnits[char] !== undefined);
  const hasBigUnit = bigIndex >= 0;
  const anyUnit = chars.some(char => unitValues[char] !== undefined);
  if (!hasBigUnit && !anyUnit) return chars.map(char => digitValue(char) ?? "").join("");

  const evaluate = (list: string[]): number => {
    let total = 0;
    let current = 0;
    for (const char of list) {
      if (isDigitChar(char)) { current = current * 10 + (digitValue(char) ?? 0); continue; }
      if (unitValues[char] !== undefined) { total += (current || 1) * unitValues[char]!; current = 0; }
    }
    return total + current;
  };

  if (hasBigUnit) {
    const head = evaluate(chars.slice(0, bigIndex)) * bigUnits[chars[bigIndex]]!;
    const tailChars = chars.slice(bigIndex + 1);
    const tailIndex = tailChars.findIndex(char => bigUnits[char] !== undefined);
    const tail = tailIndex >= 0
      ? evaluate(tailChars.slice(0, tailIndex)) * bigUnits[tailChars[tailIndex]]! + evaluate(tailChars.slice(tailIndex + 1))
      : evaluate(tailChars);
    return String(head + tail);
  }
  return String(evaluate(chars));
}

/**
 * 把稿子与 ASR 的文本统一成同一套写法，用于对齐比较。
 *
 * 数字处理成**单个占位符**：稿子与 ASR 的数值虽然相同，但十进制展开后位数不同
 * （190000 是 6 位、190 是 3 位），逐位比较会让 LCS 从数字处整体漂移。
 * 折叠成一个字符后两边必然对齐；数字内部的时间由展开阶段线性插值给出 ——
 * 一个数字本来就是一个词，共用一个时间跨度是合理的。
 *
 * ACT: 同音字不做归一（需要拼音词库）；由覆盖率暴露并交人工核。
 */
export function normalizeForAlign(text: string): string {
  const kept = [...text.normalize("NFKC")]
    .filter(char => /[0-9A-Za-z]/.test(char) || CJK.test(char))
    .join("")
    .toLowerCase();
  return kept.replace(/[0-9零〇一二两三四五六七八九十百千万亿]+/g, run => {
    if (![...run].some(char => isNumberChar(char))) return run;
    parseNumberToken(run);
    return "#";
  });
}

/** 合并被 ASR 切碎的 token：["1","9","万"] → "19万"；["三","千"] → "三千"。 */
function mergeNumericRuns(words: AlignWord[]): AlignWord[] {
  const merged: AlignWord[] = [];
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
function expandToChars(word: AlignWord): AlignCharTime[] {
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
 */
function mapScriptToAsr(scriptChars: string[], asrChars: string[]): { scriptToAsr: number[]; matched: number } {
  const rows = scriptChars.length + 1;
  const cols = asrChars.length + 1;
  const table: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = scriptChars.length - 1; i >= 0; i--) {
    for (let j = asrChars.length - 1; j >= 0; j--) {
      table[i]![j] = scriptChars[i] === asrChars[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const scriptToAsr: number[] = new Array(scriptChars.length).fill(-1);
  let i = 0;
  let j = 0;
  while (i < scriptChars.length && j < asrChars.length) {
    if (scriptChars[i] === asrChars[j]) { scriptToAsr[i] = j; i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return { scriptToAsr, matched: scriptToAsr.filter(value => value >= 0).length };
}

/**
 * 对齐主入口。
 *
 * @param scriptSentences 口播稿的句子（每行一句，已去空行）
 * @param asrWords ASR 的词级结果（毫秒）
 */
export function alignTiming(scriptSentences: string[], asrWords: AlignWord[]): AlignResult {
  const words = asrWords
    .map(word => ({ ...word, punctuation: word.punctuation ?? "" }))
    .filter(word => normalizeForAlign(word.text).length > 0);
  const merged = mergeNumericRuns(words)
    .map(word => ({ ...word, chars: expandToChars(word) }))
    .filter(word => word.chars.length > 0);

  // 打平 ASR 逐字流，同时记住每个字符属于哪个词（用来回推句子边界所在的词）
  const flatChars: AlignCharTime[] = [];
  const wordStarts: number[] = [];
  for (const word of merged) {
    wordStarts.push(flatChars.length);
    flatChars.push(...word.chars);
  }
  wordStarts.push(flatChars.length);

  const scriptOffsets: { raw: string; text: string; start: number; end: number }[] = [];
  let offset = 0;
  for (const raw of scriptSentences) {
    const normalized = normalizeForAlign(raw);
    if (!normalized.length) continue;
    scriptOffsets.push({ raw, text: normalized, start: offset, end: offset + [...normalized].length });
    offset += [...normalized].length;
  }
  const scriptAll = scriptOffsets.map(item => item.text).join("");
  const { scriptToAsr } = mapScriptToAsr([...scriptAll], flatChars.map(item => item.char));

  // 给每个 ASR 字符分派句子序号：由 LCS 锚点决定，未锚定的字符沿用上一个锚点的句子
  const sentenceOfAsr: number[] = new Array(flatChars.length).fill(-1);
  let sentenceCursor = 0;
  for (let scriptIndex = 0; scriptIndex < scriptToAsr.length; scriptIndex++) {
    while (sentenceCursor < scriptOffsets.length - 1 && scriptIndex >= scriptOffsets[sentenceCursor]!.end) sentenceCursor++;
    const asrIndex = scriptToAsr[scriptIndex]!;
    if (asrIndex >= 0) sentenceOfAsr[asrIndex] = sentenceCursor;
  }
  let last = 0;
  for (let index = 0; index < sentenceOfAsr.length; index++) {
    if (sentenceOfAsr[index]! < 0) sentenceOfAsr[index] = last;
    else last = sentenceOfAsr[index]!;
  }

  const sentences: AlignSentence[] = [];
  for (let sentenceIndex = 0; sentenceIndex < scriptOffsets.length; sentenceIndex++) {
    const { raw, start, end } = scriptOffsets[sentenceIndex]!;
    const charIndexes: number[] = [];
    for (let index = 0; index < sentenceOfAsr.length; index++) if (sentenceOfAsr[index] === sentenceIndex) charIndexes.push(index);
    if (!charIndexes.length) continue;

    const firstChar = charIndexes[0]!;
    const lastCharIndex = charIndexes[charIndexes.length - 1]!;
    let startWord = 0;
    while (startWord < wordStarts.length - 1 && wordStarts[startWord + 1]! <= firstChar) startWord++;
    let endWord = startWord;
    while (endWord < wordStarts.length - 1 && wordStarts[endWord]! < lastCharIndex + 1) endWord++;

    const sentenceMatched = scriptToAsr.slice(start, end).filter(value => value >= 0).length;
    const match = end - start ? sentenceMatched / (end - start) : 0;

    // ACT: charTimes 给逐字时间（字幕要逐字高亮时用）；words 是词粒度，正文用后者更省体积。
    const wordsOut: AlignWordSpan[] = [];
    let pending = "";
    let pendingBegin = NaN;
    for (let index = startWord; index < endWord; index++) {
      const word = merged[index];
      if (!word || !word.chars.length) continue;
      const charOffset = wordStarts[index]! - firstChar;
      if (pending === "" && charOffset >= 0) pendingBegin = flatChars[firstChar + charOffset]?.beginMs ?? NaN;
      pending += word.text;
      const wordLast = word.chars[word.chars.length - 1]!;
      if (word.punctuation || pending.length >= 8) {
        wordsOut.push({
          text: pending,
          beginMs: Number.isFinite(pendingBegin) ? pendingBegin : wordLast.beginMs,
          endMs: wordLast.endMs,
          punctuation: word.punctuation ?? "",
        });
        pending = "";
        pendingBegin = NaN;
      }
    }
    if (pending) {
      const tail = flatChars[lastCharIndex]!;
      wordsOut.push({
        text: pending,
        beginMs: Number.isFinite(pendingBegin) ? pendingBegin : tail.beginMs,
        endMs: tail.endMs,
        punctuation: "",
      });
    }

    sentences.push({
      index: sentences.length,
      text: raw,
      beginMs: flatChars[firstChar]!.beginMs,
      endMs: flatChars[lastCharIndex]!.endMs,
      match: Number(match.toFixed(3)),
      ok: match >= 0.9,
      charTimes: charIndexes.map(index => ({ ...flatChars[index]! })),
      words: wordsOut,
    });
  }

  return {
    totalMs: sentences.length ? sentences[sentences.length - 1]!.endMs : 0,
    sentences,
  };
}
