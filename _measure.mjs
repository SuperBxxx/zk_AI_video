// 量 PNG 里实际绘制内容的边界（alpha > 0 的包围盒），判断留白是否真的对称。
// 起因：svg_audit 对紧凑版报"右侧 8 / 下侧 8"，与我的坐标计算（应为 56）矛盾；
// 渲染结果看着居中，所以需要独立测量来定论。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const f = process.argv[2];
const buf = readFileSync(f);

// 解析 PNG 头部
let pos = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") idat.push(data);
  else if (type === "IEND") break;
  pos += 12 + len;
}
if (bitDepth !== 8) throw new Error(`不支持位深 ${bitDepth}`);
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
if (!channels) throw new Error(`不支持颜色类型 ${colorType}`);

const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const px = Buffer.alloc(height * stride);
// 反滤波（PNG filter types 0..4）
let rp = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[rp++];
  const line = raw.subarray(rp, rp + stride);
  rp += stride;
  const out = px.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? out[x - channels] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= channels ? prev[x - channels] : 0;
    let v = line[x];
    if (filter === 1) v += a;
    else if (filter === 2) v += b;
    else if (filter === 3) v += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = v & 0xff;
  }
}

// 内容 = 有 alpha 或非白像素
let minX = width, maxX = -1, minY = height, maxY = -1;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const o = y * stride + x * channels;
    const opaque = channels === 4 ? px[o + 3] > 24 : true;
    const dark = channels >= 3 ? px[o] < 200 : px[o] < 200;
    if (opaque && dark) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) { console.log("  未检测到内容"); process.exit(0); }
const scale = 256 / width;
console.log(`  图像 ${width}×${height}（对应 viewBox 256，缩放 ${scale}）`);
console.log(`  内容边界: x ${minX}..${maxX}   y ${minY}..${maxY}`);
console.log(`  换算到 viewBox 单位: L ${(minX * scale).toFixed(1)}  R ${((width - 1 - maxX) * scale).toFixed(1)}  T ${(minY * scale).toFixed(1)}  B ${((height - 1 - maxY) * scale).toFixed(1)}`);
console.log(`  内容尺寸: ${((maxX - minX + 1) * scale).toFixed(1)} × ${((maxY - minY + 1) * scale).toFixed(1)}`);
