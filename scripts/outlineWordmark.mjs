// 把字标「住凯AI视频」转成轮廓路径，消除 live text。
//
// 为什么需要：svg_audit 对含 <text> 的最终标志报 FAIL —— 字体因机器而异，
// 正式标志必须转曲。本仓库环境没有字体文件，但系统有 msyhbd.ttc，
// 因此用 fontTools 直接取字形轮廓，不依赖任何 SVG 渲染器。
//
// ⚠ 版权：Microsoft YaHei 是微软的商用字体，其轮廓**不可随产品分发**。
//   本脚本产出的是「用于审阅与版式验证」的轮廓；
//   正式发布前必须换成可商用的开源字体并重新转曲（见 guidelines.md）。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const FONT = "C:\\\\Windows\\\\Fonts\\\\msyhbd.ttc";
const FONT_INDEX = 0;
const TEXT = "住凯AI视频";
const TRACKING = -0.02; // em

const script = `
import json, sys
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen

font = TTCollection(r"${FONT}").fonts[${FONT_INDEX}]
upm = font["head"].unitsPerEm
cmap = font.getBestCmap()
glyphSet = font.getGlyphSet()
hmtx = font["hmtx"]
kern = None
if "GPOS" in font:
    try:
        from fontTools.otlLib.builder import buildStatTable  # noqa
    except Exception:
        pass

text = ${JSON.stringify(TEXT)}
tracking = ${TRACKING} * upm
out = []
x = 0.0
for ch in text:
    gname = cmap[ord(ch)]
    pen = SVGPathPen(glyphSet)
    glyphSet[gname].draw(pen)
    d = pen.getCommands()
    adv = hmtx[gname][0]
    out.append({"ch": ch, "glyph": gname, "d": d, "x": x, "adv": adv})
    x += adv + tracking

print(json.dumps({
  "upm": upm,
  "capHeight": font["OS/2"].sCapHeight,
  "ascender": font["hhea"].ascender,
  "descender": font["hhea"].descender,
  "width": x - tracking,
  "glyphs": out,
}))
`;

const raw = execFileSync("python", ["-c", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const data = JSON.parse(raw);
console.log(`  字体 unitsPerEm=${data.upm} capHeight=${data.capHeight} 字标总宽=${data.width.toFixed(0)} 单位`);

// 把字体单位换算到目标视觉高度。
// 目标：中文字面高度约 88（与之前 <text> font-size=88 的视觉量级一致）。
// 中文字形的实际高度约等于 em 的 0.86 左右；为可控，直接用 capHeight 对齐视觉高度。
const targetCap = 62; // 罗马字大写高度（AI 部分）目标像素
const scale = targetCap / data.capHeight;
console.log(`  缩放 ${scale.toFixed(3)}（capHeight ${data.capHeight} → ${targetCap}）`);

// 基线放在 y = baseline
// 基线取 176：文字上缘 = 176 - capHeight*scale = 176 - 62 = 114 … 不对，
// 实际中文字面上缘还要更高。用实测法：让文字与符号在同一垂直区间内居中。
// 符号占 32..224（中心 128）。文字的视觉高度用 ascender/descender 估算：
//   上探 = capHeight * scale = 62；下探 = |descender| * scale = 21.4
// 因此文字块高 ≈ 83.4。要让它居中于 128 → 文字块顶 = 128 - 41.7 = 86.3
//   → 基线 = 86.3 + 62 = 148.3，取 148。
const baseline = 148;
let paths = "";
for (const g of data.glyphs) {
  const tx = (240 + g.x * scale).toFixed(2);
  const ty = baseline.toFixed(2);
  const sc = scale.toFixed(3);
  // SVG 的 y 轴向下；字体 y 轴向上，因此 scale(s, -s)
  paths += `    <path transform="translate(${tx} ${ty}) scale(${sc} -${sc})" d="${g.d}"/>\n`;
}

const totalW = 240 + data.width * scale;
const W = Math.ceil(totalW + 32);
console.log(`  字标右端 x=${totalW.toFixed(0)} → viewBox 宽 ${W}`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 256" role="img" aria-labelledby="t">
  <title id="t">住凯AI视频 — 横排锁定</title>
  <!--
    横排锁定：符号在左、字标在右。**字标已转曲**（无 live text）。

    转曲来源：Microsoft YaHei Bold（msyhbd.ttc，unitsPerEm=${data.upm}）
      缩放 ${scale.toFixed(3)}（capHeight ${data.capHeight} → ${targetCap}），字距 ${TRACKING}em
      基线 y=${baseline.toFixed(1)}；符号占 0..192，净空 48，文字自 x=240 起

    ⚠ 版权：Microsoft YaHei 为微软商用字体，其轮廓不可随产品分发。
      本文件用于审阅与版式验证；正式发布前必须换成可商用开源字体并重新转曲。
  -->
  <g fill="currentColor">
    <g transform="translate(0,32)">
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

writeFileSync("E:/ai_video/zk-video/brand/logo/lockupHorizontal.svg", svg);
console.log(`  已写出 lockupHorizontal.svg（${svg.length} 字节，${data.glyphs.length} 个字形轮廓）`);
