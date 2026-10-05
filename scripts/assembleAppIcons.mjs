// 组装 packages/assets 下的二进制图标，替换上游遗留的 Toonflow 图标。
//
// 分工：渲染由 render_png.py 从 PowerShell 批量完成（从 Bun 内逐次调用会失败），
//       本脚本只做「用已渲染好的 PNG 组装 ICO / iconset / favicon」这一步，用 PIL。
//
// 前置：brand/logo/renders/applogo-{16,32,48,64,128,256,512,1024}.png 已存在。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";

const root = "E:/ai_video/zk-video";
const assets = `${root}/packages/assets`;
const renders = `${root}/brand/logo/renders`;
const publicDir = `${root}/apps/web/public`;

for (const n of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const f = `${renders}/applogo-${n}.png`;
  if (!existsSync(f)) throw new Error(`缺少渲染件：${f}（先由 PowerShell 调用 render_png.py 生成）`);
}

const py = `
from PIL import Image
import os

renders = r"${renders.replace(/\\/g, "\\\\")}"
assets  = r"${assets.replace(/\\/g, "\\\\")}"
public  = r"${publicDir.replace(/\\/g, "\\\\")}"

def load(n):
    return Image.open(os.path.join(renders, "applogo-%d.png" % n)).convert("RGBA")

# --- Windows 应用/窗口图标：多尺寸 ICO ---
ico_path = os.path.join(assets, "logo.ico")
load(256).save(ico_path, format="ICO",
               sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("  logo.ico            %d 字节" % os.path.getsize(ico_path))

# --- macOS 图标集：10 个文件（含 @2x） ---
iconset = os.path.join(assets, "logo.iconset")
os.makedirs(iconset, exist_ok=True)
plan = [(16,"icon_16x16.png"), (32,"icon_16x16@2x.png"),
        (32,"icon_32x32.png"), (64,"icon_32x32@2x.png"),
        (128,"icon_128x128.png"), (256,"icon_128x128@2x.png"),
        (256,"icon_256x256.png"), (512,"icon_256x256@2x.png"),
        (512,"icon_512x512.png"), (1024,"icon_512x512@2x.png")]
for size, name in plan:
    src = size if size in (16,32,64,128,256,512,1024) else 512
    img = load(src)
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(iconset, name))
print("  logo.iconset        %d 个文件" % len(plan))

# --- Web favicon：16/32/48 多尺寸 ICO 到 public/ ---
os.makedirs(public, exist_ok=True)
fav = os.path.join(public, "favicon.ico")
load(48).save(fav, format="ICO", sizes=[(16,16),(32,32),(48,48)])
print("  apps/web/public/favicon.ico  %d 字节" % os.path.getsize(fav))

# --- 校验 ---
for p in [ico_path, fav]:
    im = Image.open(p)
    print("  校验 %s → 主尺寸 %dx%d，帧 %s" % (os.path.basename(p), im.size[0], im.size[1], sorted(im.info.get("sizes", []))))
`;

process.stdout.write(execFileSync("python", ["-c", py], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));

// favicon.svg（浏览器标签页用符号，非字体依赖）
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="住凯AI视频">
<!-- 浏览器标签页图标。用「小尺寸简化版」：60px 以下去掉中心准星、缺口收窄到 76，
     否则 16px 下准星会糊成灰点。 -->
<g fill="#0E1110">
<rect x="32" y="32" width="68" height="24"/><rect x="32" y="56" width="24" height="44"/>
<rect x="156" y="32" width="68" height="24"/><rect x="200" y="56" width="24" height="44"/>
<rect x="32" y="200" width="68" height="24"/><rect x="32" y="156" width="24" height="44"/>
<rect x="156" y="200" width="68" height="24"/><rect x="200" y="156" width="24" height="44"/>
</g>
</svg>
`;
const { writeFileSync } = await import("node:fs");
writeFileSync(`${publicDir}/favicon.svg`, faviconSvg);
console.log(`  apps/web/public/favicon.svg  ${faviconSvg.length} 字节`);

console.log("\n=== packages/assets 最终内容 ===");
for (const dir of [assets, `${assets}/logo.iconset`]) {
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(dir).sort()) {
    const st = statSync(`${dir}/${f}`);
    if (st.isFile()) console.log(`  ${f.padEnd(28)} ${(st.size / 1024).toFixed(1)} KB`);
  }
}
