// 生成竖排锁定（符号在上、字标在下）与 favicon 专用版。
// 复用 outlineWordmark.mjs 的转曲结果思路：字标轮廓从字体取出后写入独立文件。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FONT = "C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc";
const fontFaceIndex = 0;
const wordmarkText = "住凯AI视频";
const tracking = -0.02; // em

const script = `
import json
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen

font = TTCollection(r"${FONT}").fonts[${fontFaceIndex}]
upm = font["head"].unitsPerEm
cmap = font.getBestCmap()
glyphSet = font.getGlyphSet()
hmtx = font["hmtx"]

tracking = ${tracking} * upm
out = []
x = 0.0
for ch in ${JSON.stringify(wordmarkText)}:
    gname = cmap[ord(ch)]
    pen = SVGPathPen(glyphSet)
    glyphSet[gname].draw(pen)
    out.append({"d": pen.getCommands(), "x": x})
    x += hmtx[gname][0] + tracking

print(json.dumps({
  "upm": upm,
  "capHeight": font["OS/2"].sCapHeight,
  "width": x - tracking,
  "glyphs": out,
}))
`;

const data = JSON.parse(execFileSync("python", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));

// 竖排：画布 256 宽；符号占上方，居中；字标在下方，居中并缩到画布宽度的约 88%
const canvas = 256;
const symbolBox = 192;            // 符号外沿 192，含自身 32 留白 → 占 256
const symbolTop = 8;              // 符号区起始
const textGap = 14;               // 符号与字标之间的净空
const textTargetCap = 34;         // 字标 cap height 目标（竖排要小一些）
const scale = textTargetCap / data.capHeight;
const textW = data.width * scale;
const textLeft = (canvas - textW) / 2;
const baseline = symbolTop + symbolBox + textGap + textTargetCap;

let paths = "";
for (const g of data.glyphs) {
  const tx = (textLeft + g.x * scale).toFixed(2);
  paths += `    <path transform="translate(${tx} ${baseline.toFixed(2)}) scale(${scale.toFixed(3)} -${scale.toFixed(3)})" d="${g.d}"/>\n`;
}

// 底部留白：文字下探约 0.13*capTarget（含「视频」的撇捺），再给到 22 使上下平衡。
// 上边距 32、底部 22 是刻意的——光学的视觉中心略高于几何中心。
const height = Math.ceil(baseline + 22);
const symbolScale = (symbolBox / 256).toFixed(3);
const symbolOffset = symbolTop;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${height}" role="img" aria-labelledby="t">
  <title id="t">住凯AI视频 — 竖排锁定</title>
  <!--
    竖排锁定：符号在上、字标在下。用于社交头像、名片、包装正面等方形或略高的位置。
    字标已转曲（无 live text）。

    排版规格:
      画布宽 256；符号缩到 192 后居中，上边距 ${symbolOffset}
      净空 ${textGap}；字标 cap height ${textTargetCap}，水平居中
      基线 y=${baseline.toFixed(1)}；总高 ${height}
      转曲来源 Microsoft YaHei Bold，缩放 ${scale.toFixed(3)}，字距 ${tracking}em

    ⚠ 版权：Microsoft YaHei 为微软商用字体，轮廓不可随产品分发。
      本文件用于审阅与版式验证；发布前须换可商用开源字体重做。
  -->
  <g fill="currentColor">
    <g transform="translate(32 ${symbolOffset}) scale(${symbolScale})">
      <rect x="32" y="32" width="64" height="24" />
      <rect x="32" y="56" width="24" height="40" />
      <rect x="160" y="32" width="64" height="24" />
      <rect x="200" y="56" width="24" height="40" />
      <rect x="32" y="200" width="64" height="24" />
      <rect x="32" y="160" width="24" height="40" />
      <rect x="160" y="200" width="64" height="24" />
      <rect x="200" y="160" width="24" height="40" />
      <rect x="84" y="120" width="30" height="16" />
      <rect x="142" y="120" width="30" height="16" />
      <rect x="120" y="84" width="16" height="30" />
      <rect x="120" y="142" width="16" height="30" />
    </g>
${paths}  </g>
</svg>
`;

writeFileSync("E:/ai_video/zk-video/brand/logo/lockupStacked.svg", svg);
console.log(`  已写出 lockupStacked.svg  viewBox 0 0 ${canvas} ${height}  字标宽 ${textW.toFixed(1)}  左起 ${textLeft.toFixed(1)}  基线 ${baseline.toFixed(1)}`);
