// 命令行入口：把时间表转成 ASS 字幕。
//
// 算法在 @toonflow/post-production（与 agent 工具共用）。本文件只读写文件与打印提示。
//
// 用法：bun scripts/makeSubtitles.mjs <timestamps.json> <out.ass> [--height 1080] [--width 1920] [--font 微软雅黑] [--size 60] [--no-karaoke]
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { buildAss } from "@toonflow/post-production";

const [timestampsPath, outputPath, ...rest] = process.argv.slice(2);
if (!timestampsPath || !outputPath) {
  console.error("用法：bun scripts/makeSubtitles.mjs <timestamps.json> <out.ass> [--height 1080] [--width 1920] [--font 微软雅黑] [--size 60] [--no-karaoke]");
  process.exit(2);
}

function readOption(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback;
}

const timestamps = JSON.parse(readFileSync(timestampsPath, "utf8").replace(/^\uFEFF/, ""));
const height = Number(readOption("height", "1080"));
const width = Number(readOption("width", "1920"));
const options = {
  width,
  height,
  fontName: readOption("font", "Microsoft YaHei"),
  fontSize: Number(readOption("size", String(Math.round(height * 0.056)))),
  karaoke: !rest.includes("--no-karaoke"),
};

writeFileSync(outputPath, buildAss(timestamps.sentences ?? [], options));

console.log("=== 字幕已生成 ===");
console.log(`  ${outputPath}`);
console.log(`  字号 ${options.fontSize}px（帧高 ${height}），字体 ${options.fontName}`);
console.log(`  逐字高亮 ${options.karaoke ? "开" : "关"}，入场/出场 267ms`);
console.log(`  ${(timestamps.sentences ?? []).length} 句`);
// 烧录提示：必须在该目录下执行 ffmpeg 且只传文件名，避开滤镜里的 Windows 路径转义
console.log("");
console.log("  烧录（在该目录执行，只传文件名）：");
console.log(`    ffmpeg -i <视频> -vf "subtitles=${basename(outputPath)}" -c:a copy <输出>`);
console.log(`  工作目录：${dirname(join(process.cwd(), outputPath))}`);
