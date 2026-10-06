// 把 alignTiming 产出的 timestamps.json 转成 ASS 字幕，并可选地烧进视频。
//
// 字幕规范（借鉴参考实现并按其数值落地）：
//   · 素排、无标点、整句硬现；入场 8 帧、出场 8 帧（30fps 下约 267ms）
//   · 底部字幕 ≥56px（约 5.2% 帧高），本实现默认 60px，随画幅高度缩放
//   · 逐字高亮用 ASS 的卡拉 OK 标签 \k，与词级时间戳一一对应
//
// 烧录用 ffmpeg 的 subtitles 滤镜。**必须在 ASS 所在目录执行 ffmpeg 并只传文件名** ——
// 滤镜参数里的 Windows 路径（盘符冒号、反斜杠）需要逐层转义，
// 绕过它的成本远低于写对它的成本。
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

/** ASS 的时间格式：H:MM:SS.CC（厘秒，两位）。 */
function assTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const centis = Math.floor((total % 1000) / 10);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** \k 的单位是厘秒，且需要是整数。 */
function karaokeDuration(ms) {
  return Math.max(0, Math.round(ms / 10));
}

function escapeAss(text) {
  // ASS 用 {} 承载样式覆盖，正文里的花括号会破坏解析；反斜杠是转义前缀。
  return text.replace(/\\/g, "＼").replace(/\{/g, "（").replace(/\}/g, "）").replace(/\r?\n/g, "\\N");
}

/** 显示宽度：CJK 与全角算 1，其余算 0.5。 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) width += CJK.test(char) ? 1 : 0.5;
  return width;
}

/**
 * 按显示宽度把一句切成几行。
 *
 * 为什么必须自己做：ASS 的自动换行只在**空格**处断，中文整句没有空格，
 * 于是 libass 把整句当成一个词直接横向溢出画幅。实测把 WrapStyle 从 2 改成 0
 * 渲染结果字节完全相同 —— 指望 libass 处理中文换行是无效的。
 * ACT: 只在词边界断行，不拆词。单个词本身超宽时它会独占一行并略微溢出，
 * 口播字幕里这种情况只出现在特别长的英文/数字串上。
 */
function wrapWords(words, maxWidth) {
  const lines = [];
  let current = [];
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

function buildAss(timestamps, options) {
  const { fontName, fontSize, primaryColor, highlightColor, outlineColor, marginBottom, marginSide, karaoke } = options;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    // PlayResX/PlayResY 必须显式写，且要与成片分辨率一致。
    // 踩过的坑：不写时 libass 回退到默认脚本分辨率（约 384x288）再缩放到画幅，
    // 于是 Fontsize 被放大约 5 倍 —— 60px 实际渲染成 ~300px，长句直接横向溢出画幅。
    // 表现为「字幕大得离谱」，很容易误判成字号或换行的问题。
    `PlayResX: ${options.width}`,
    `PlayResY: ${options.height}`,
    // WrapStyle 0 = 智能换行；但只会按空格断行，中文整句没有空格，
    // 所以中文断行仍由本脚本自己按词边界插 \N 完成（见 wrapWords）。
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${fontName},${fontSize},${primaryColor},${highlightColor},${outlineColor},&H80000000,-1,0,0,0,100,100,1,0,1,3,2,2,${marginSide},${marginSide},${marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = [];
  // 可用宽度换算成「能放多少个 CJK 字」，再留一个字的余量给标点与描边
  const maxWidth = Math.max(6, (options.width - options.marginSide * 2) / options.fontSize - 1);
  for (const sentence of timestamps.sentences) {
    // 入场 8 帧 / 出场 8 帧：用 \fad 的毫秒形式表达，避免依赖帧率
    const fade = `{\\fad(${options.fadeInMs},${options.fadeOutMs})}`;
    const words = karaoke && sentence.words?.length
      ? sentence.words
      : sentence.text.split(/(?<=.)/).map(char => ({ text: char, beginMs: sentence.beginMs, endMs: sentence.endMs }));
    const lines = wrapWords(words, maxWidth);
    const text = lines.map(line => line
      .map(word => karaoke && sentence.words?.length
        ? `{\\k${karaokeDuration(word.endMs - word.beginMs)}}${escapeAss(word.text)}`
        : escapeAss(word.text))
      .join(""))
      .join("\\N");
    events.push(`Dialogue: 0,${assTime(sentence.beginMs)},${assTime(sentence.endMs)},Caption,,0,0,0,,${fade}${text}`);
  }
  return `${[...header, ...events].join("\n")}\n`;
}

const [timestampsPath, outputPath, ...rest] = process.argv.slice(2);
if (!timestampsPath || !outputPath) {
  console.error("用法：bun scripts/makeSubtitles.mjs <timestamps.json> <out.ass> [--height 1080] [--font 思源黑体] [--size 60] [--no-karaoke]");
  process.exit(2);
}

function readOption(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback;
}

const height = Number(readOption("height", "1080"));
const width = Number(readOption("width", "1920"));
const timestamps = JSON.parse(readFileSync(timestampsPath, "utf8"));
const options = {
  width,
  height,
  // ACT: 默认用微软雅黑 —— 它在简体中文 Windows 上必然存在，
  // 而思源黑体等字体不是每台机器都装了；装不到时 libass 会静默回退，字幕观感会变。
  fontName: readOption("font", "Microsoft YaHei"),
  // 参考实现的可读线是帧高的 5.2%（1080 下约 56px），这里默认取 60px
  fontSize: Number(readOption("size", String(Math.round(height * 0.056)))),
  primaryColor: "&H00FFFFFF",
  highlightColor: "&H002E9E6B",
  outlineColor: "&H00000000",
  marginBottom: Math.round(height * 0.093),
  // 竖屏与横屏都给足横向余地：留太宽会让长句被迫断成很多行
  marginSide: Math.round(height * 0.021),
  fadeInMs: 267,
  fadeOutMs: 267,
  karaoke: !rest.includes("--no-karaoke"),
};

writeFileSync(outputPath, buildAss(timestamps, options));

console.log("=== 字幕已生成 ===");
console.log(`  ${outputPath}`);
console.log(`  字号 ${options.fontSize}px（帧高 ${height}），字体 ${options.fontName}`);
console.log(`  逐字高亮 ${options.karaoke ? "开" : "关"}，入场/出场 ${options.fadeInMs}ms`);
console.log(`  ${timestamps.sentences.length} 句`);
// 烧录提示：必须在该目录下执行 ffmpeg 且只传文件名，避开滤镜里的 Windows 路径转义
console.log("");
console.log("  烧录（在该目录执行，只传文件名）：");
console.log(`    ffmpeg -i <视频> -vf "subtitles=${basename(outputPath)}" -c:a copy <输出>`);
console.log(`  工作目录：${dirname(join(process.cwd(), outputPath))}`);
