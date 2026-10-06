// 把时间表转成 ASS 字幕（纯字符串生成，不碰文件系统）。
//
// 字幕规范（借鉴参考实现并按其数值落地）：
//   · 素排、无标点、整句硬现；入场 8 帧、出场 8 帧（30fps 下约 267ms）
//   · 底部字幕 ≥56px（约 5.2% 帧高），本实现默认帧高的 5.6%，1080 下 60px
//   · 逐字高亮用 ASS 的卡拉 OK 标签 \k，与词级时间戳一一对应
//
// 三个坑（都在实测里踩到，注释写明以免重犯）：
//   1. PlayResX/PlayResY 必须显式写。不写时 libass 回退到默认脚本分辨率
//      （约 384x288）再缩放到画幅，Fontsize 被放大约 5 倍 —— 60px 实际渲染成 ~300px，
//      「字幕大得离谱」的真正原因，很容易误判成字号或换行的问题。
//   2. WrapStyle 0 是「智能换行」，但它只按空格断行；中文整句没有空格，
//      于是整句被当成一个词直接横向溢出画幅。所以断行必须自己按词边界插 \N。
//   3. WrapStyle 2 恰好是「不换行」，写成 2 时溢出更严重。

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

export interface AssWord {
  text: string;
  beginMs: number;
  endMs: number;
}

export interface AssSentence {
  text: string;
  beginMs: number;
  endMs: number;
  words?: AssWord[];
}

export interface AssOptions {
  width?: number;
  height?: number;
  fontName?: string;
  fontSize?: number;
  /** 是否输出逐字高亮（卡拉 OK）。关掉时只输出整句。 */
  karaoke?: boolean;
  /** 入场 / 出场淡入淡出时长（毫秒）。默认 267（30fps 下 8 帧）。 */
  fadeInMs?: number;
  fadeOutMs?: number;
}

/** 全角字符按 1 个宽度计，其余按 0.5。用于估算一行能放多少字。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += CJK.test(char) ? 1 : 0.5;
  return width;
}

/** 按显示宽度把一句切成几行（只在词边界断，不拆词）。 */
function wrapWords(words: AssWord[], maxWidth: number): AssWord[][] {
  const lines: AssWord[][] = [];
  let current: AssWord[] = [];
  let width = 0;
  for (const word of words) {
    const wordWidth = displayWidth(word.text);
    if (current.length && width + wordWidth > maxWidth) {
      lines.push(current);
      current = [];
      width = 0;
    }
    current.push(word);
    width += wordWidth;
  }
  if (current.length) lines.push(current);
  return lines;
}

/** ASS 时间格式：H:MM:SS.CC（厘秒）。 */
function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centis = Math.floor((total % 1000) / 10);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** \k 的单位是厘秒，且需要是整数。 */
function karaokeDuration(ms: number): number {
  return Math.max(0, Math.round(ms / 10));
}

/** ASS 用 {} 承载样式覆盖，正文里的花括号会破坏解析；反斜杠是转义前缀。 */
function escapeAss(text: string): string {
  return text.replace(/\\/g, "＼").replace(/\{/g, "（").replace(/\}/g, "）").replace(/\r?\n/g, "\\N");
}

export function buildAss(sentences: AssSentence[], options: AssOptions = {}): string {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fontName = options.fontName ?? "Microsoft YaHei";
  const fontSize = options.fontSize ?? Math.round(height * 0.056);
  const karaoke = options.karaoke ?? true;
  const fadeInMs = options.fadeInMs ?? 267;
  const fadeOutMs = options.fadeOutMs ?? 267;
  const marginBottom = Math.round(height * 0.093);
  const marginSide = Math.round(height * 0.021);
  // 可用宽度换算成「能放多少个 CJK 字」，再留一个字的余量给标点与描边
  const maxWidth = Math.max(6, (width - marginSide * 2) / fontSize - 1);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${fontSize},&H00FFFFFF,&H002E9E6B,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,3,2,2,${marginSide},${marginSide},${marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];
  for (const sentence of sentences) {
    const fade = `{\\fad(${fadeInMs},${fadeOutMs})}`;
    const useKaraoke = karaoke && (sentence.words?.length ?? 0) > 0;
    const words: AssWord[] = useKaraoke
      ? sentence.words!
      : [...sentence.text].map(char => ({ text: char, beginMs: sentence.beginMs, endMs: sentence.endMs }));
    const text = wrapWords(words, maxWidth)
      .map(line => line
        .map(word => useKaraoke ? `{\\k${karaokeDuration(word.endMs - word.beginMs)}}${escapeAss(word.text)}` : escapeAss(word.text))
        .join(""))
      .join("\\N");
    events.push(`Dialogue: 0,${assTime(sentence.beginMs)},${assTime(sentence.endMs)},Caption,,0,0,0,,${fade}${text}`);
  }

  return `${[...header, ...events].join("\n")}\n`;
}

/**
 * ffmpeg 烧录字幕的滤镜参数。
 *
 * ACT: **必须在该 ASS 所在目录执行 ffmpeg 并只传文件名** ——
 * 滤镜参数里的 Windows 路径（盘符冒号、反斜杠）需要逐层转义，
 * 绕过它的成本远低于写对它的成本。
 */
export function subtitleFilter(fileName: string): string {
  return `subtitles=${fileName}`;
}

/** SRT 时间格式：HH:MM:SS,mmm（逗号是 SRT 的规定，不是 ASS 的点）。 */
function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

/**
 * SRT 字幕：几乎所有剪辑软件与播放器都认的公开格式。
 *
 * 与 ASS 的分工：ASS 用于**烧录进成片**（要样式与逐字高亮）；SRT 用于
 * **交给用户在别的软件里继续编辑**（只带文本与时间，任何工具都能导入）。
 * 所以这里刻意不带任何样式标记 —— 带样式的 SRT 会被多数工具当正文显示出来。
 *
 * ACT: 多行文本按 SRT 规定加空行分隔；单条内换行保留（不转成 \N，那是 ASS 的写法）。
 */
export function buildSrt(sentences: AssSentence[], options: { maxCharsPerLine?: number } = {}): string {
  const maxChars = options.maxCharsPerLine ?? 0;
  const blocks: string[] = [];
  sentences.forEach((sentence, index) => {
    const text = sentence.text.replace(/\r?\n/g, " ").trim();
    if (!text) return;
    // 需要限制行宽时按字数硬折（SRT 没有排版能力，只能靠换行）
    const lines = maxChars > 0
      ? (text.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [text])
      : [text];
    blocks.push(`${index + 1}\n${srtTime(sentence.beginMs)} --> ${srtTime(sentence.endMs)}\n${lines.join("\n")}`);
  });
  return `${blocks.join("\n\n")}\n`;
}
