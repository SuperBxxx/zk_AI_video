// 用真实渲染出的 PNG 组装标志应用总览页，再交给 Chrome 截图。
//
// 为什么不手写 SVG 内联：上一次我在 HTML 里手抄了字标的一个 <path> 片段，
// 结果横排锁定只画出一个字形碎片。这条错误教训说明 —— 版面图一律引用真实
// 产出文件，不手工转录路径数据。
import { readFileSync, writeFileSync } from "node:fs";

const root = "E:/ai_video/zk-video/brand/logo";
const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const img = {
  lockupH: dataUri(`${root}/renders/lockupHorizontal.png`),
  lockupV: dataUri(`${root}/renders/lockupStacked.png`),
  black: dataUri(`${root}/renders/zhukai-black.png`),
  white: dataUri(`${root}/renders/zhukai-white.png`),
  mono: dataUri(`${root}/renders/zhukai-mono-2e9e6b.png`),
  small: dataUri(`${root}/renders/symbolSmall.png`),
  appIcon: dataUri(`${root}/dist/zhukai-app-icon-1024.png`),
  favicon: dataUri(`${root}/dist/favicon-48.png`),
};

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>住凯AI视频 — 标志应用总览</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { overflow: hidden; }
  body {
    width: 1600px; height: 1120px; background: #0e1110; color: #f2f4f2;
    font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased; padding: 44px 52px;
  }
  h1 { font-size: 30px; font-weight: 650; letter-spacing: -0.01em; }
  .lede { font-size: 17px; color: #7d8783; margin: 8px 0 24px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
  .card {
    background: #151a18; border: 1px solid #242b28; border-radius: 12px;
    padding: 18px; display: flex; flex-direction: column; gap: 10px;
  }
  .cap { font-size: 15px; color: #4a5450; letter-spacing: 0.05em; }
  .body { flex: 1; display: grid; place-items: center; min-height: 0; }
  img { display: block; max-width: 100%; max-height: 100%; }
  .c6 { grid-column: span 6; } .c4 { grid-column: span 4; }
  .c3 { grid-column: span 3; } .c12 { grid-column: span 12; }
  .tile { width: 100%; height: 128px; display: grid; place-items: center; border-radius: 8px; }
  .paper { background: #f2f4f2; } .dark { background: #0e1110; border: 1px solid #242b28; }
  .brand { background: #2e9e6b; }
</style>
</head>
<body>
<h1>住凯AI视频 — 标志应用总览</h1>
<p class="lede">
  符号「取景框」· 定稿几何：外沿 192 / 四角臂 64 厚 24 / 缺口 96 / 准星臂 30 厚 16 · 主色 #2E9E6B<br />
  下面每张图都是实际产出文件，不是示意。
</p>

<div class="grid">

  <div class="card c6">
    <span class="cap">主锁定 · 横排（字标已转曲）</span>
    <div class="body"><img src="${img.lockupH}" style="height:190px" alt="横排锁定" /></div>
    <span class="cap">净空 48 = 符号描边厚的 2 倍</span>
  </div>

  <div class="card c6">
    <span class="cap">方形场景 · 竖排</span>
    <div class="body"><img src="${img.lockupV}" style="height:190px" alt="竖排锁定" /></div>
    <span class="cap">用于社交头像、名片、包装正面</span>
  </div>

  <div class="card c4">
    <span class="cap">应用图标（80% 占比）</span>
    <div class="body"><img src="${img.appIcon}" style="height:160px" alt="应用图标" /></div>
    <span class="cap">深绿底 #14543C · 圆角 0.225</span>
  </div>

  <div class="card c4">
    <span class="cap">单色与底色适配</span>
    <div class="body" style="width:100%;grid-template-columns:1fr;gap:10px">
      <div class="tile paper"><img src="${img.black}" style="height:74px" alt="黑 on 纸" /></div>
      <div class="tile dark"><img src="${img.white}" style="height:74px" alt="白 on 黑" /></div>
      <div class="tile brand"><img src="${img.mono}" style="height:74px;filter:brightness(0) saturate(100%)" alt="绿底" /></div>
    </div>
    <span class="cap">黑 / 白 / 品牌绿 —— 无渐变</span>
  </div>

  <div class="card c4">
    <span class="cap">小尺寸简化版（≤32px）</span>
    <div class="body" style="gap:14px;grid-template-columns:1fr">
      <img src="${img.small}" style="height:120px" alt="简化版" />
    </div>
    <span class="cap">去掉准星、缺口 96→76</span>
  </div>

  <div class="card c12">
    <span class="cap">favicon 实际尺寸（16 / 32 / 48，来自 dist/favicon.ico 与 PNG）</span>
    <div class="body" style="justify-items:start">
      <div style="display:flex;align-items:flex-end;gap:34px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <div class="tile" style="width:96px;height:96px;background:#0e1110;border:1px solid #242b28">
            <img src="${img.favicon}" style="height:56px" alt="48px" />
          </div><span class="cap">48</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <div class="tile" style="width:64px;height:64px;background:#0e1110;border:1px solid #242b28">
            <img src="${img.favicon}" style="height:34px" alt="32px" />
          </div><span class="cap">32</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <div class="tile" style="width:32px;height:32px;background:#0e1110;border:1px solid #242b28">
            <img src="${img.favicon}" style="height:16px" alt="16px" />
          </div><span class="cap">16</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-left:16px">
          <div class="tile" style="width:64px;height:64px;background:#f2f4f2">
            <img src="${img.favicon}" style="height:34px;filter:invert(1)" alt="浅底" />
          </div><span class="cap">浅底</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <div class="tile" style="width:64px;height:64px;background:#2e9e6b">
            <img src="${img.favicon}" style="height:34px;filter:brightness(0)" alt="品牌绿" />
          </div><span class="cap">品牌绿</span>
        </div>
        <div style="flex:1;padding-left:20px" class="cap">
          favicon.ico 含 16/32/48 三档、32 位；另有 favicon.svg、apple-touch-icon 180、<br />
          icon-192/512、maskable-512、site.webmanifest 与 &lt;head&gt; 片段。
        </div>
      </div>
    </div>
  </div>

</div>
</body>
</html>`;

writeFileSync(`${root}/application.html`, html);
console.log(`  已写出 application.html（${(html.length / 1024).toFixed(0)} KB，内联 ${Object.keys(img).length} 张真实渲染图）`);
