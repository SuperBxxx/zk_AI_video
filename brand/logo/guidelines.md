# 住凯AI视频 — 标志使用规范

标志符号「取景框」的定稿说明、资产清单、使用规则，以及**尚未完成的项**。

---

## 1. 符号是什么

**四角直角 + 中心准星。** 四角只到该到的地方就停（每边留 96 的缺口），因此读作
「正在框取一个比画面更大的东西」——这正是无限画布。中心准星把它从"裁切标记"
拉向"取景器"：一眼看出是「看」与「框」。

**它刻意不是什么**（这是它与上一版标志的根本区别）：

| 回避 | 原因 |
| --- | --- |
| 闭合方框 | 方框意为「有界」，而产品卖点是**无限画布**，语义相反 |
| 播放三角 | 属于**播放器**而非**创作工具**；且是本品类最被用尽的符号（库中 `youtube` / `leankit` / `google-play` 都用了） |

## 2. 定稿几何

`viewBox="0 0 256 256"`

| 部件 | 数值 |
| --- | --- |
| 外沿 | `32..224`（192 见方），四边留白 **32** |
| 四角 | 臂长 **64**、厚 **24**，每边缺口 **96** |
| 中心准星 | 臂长 **30**、厚 **16**，负空间环 **24** |
| 内容占比 | **75%** |

全部为 **8 的倍数** → 任何整数缩放都不产生半像素毛边。

### 小尺寸简化版

`viewBox="0 0 256 256"`，外沿同为 `32..224`：

- **去掉中心准星** —— 16px 下它只剩约 1px，必然糊成灰点，反而降低清晰度
- **缺口由 96 收窄到 76** —— 准星去掉后四角要承担全部识别，缺口太大在极小尺寸下会让四角散开

**分界线：32px。** 32px 以上用完整版，32px 及以下用简化版。

## 3. 色彩

| 用途 | 色值 |
| --- | --- |
| 主色 / 品牌绿 | `#2E9E6B` |
| 深色面板 / 应用图标底 | `#14543C` |
| 深色界面上的标志 | `#F2F4F2` |
| 浅色界面上的标志 | `#0E1110` |
| 单色黑 | `#000000` |
| 单色白 | `#FFFFFF` |

标志**不依赖颜色**：无渐变、无描边依赖，纯填充直角，因此单色、反白、刺绣、
烫金、低分辨率印刷都成立。

## 4. 资产清单

`dist/` 下为可直接使用的交付件：

| 文件 | 用途 |
| --- | --- |
| `zhukai-black.svg` / `zhukai-white.svg` | 单色黑 / 单色白 |
| `zhukai-mono-2e9e6b.svg` | 品牌绿单色 |
| `zhukai-square.svg` | 方形主版（社交头像） |
| `zhukai-favicon.svg` | 浏览器标签页专用（紧凑） |
| `zhukai-app-icon.svg` | 应用图标（深绿圆角底，标志占 80%） |
| `favicon.ico` | **含 16 / 32 / 48 三档、32 位** |
| `favicon-16/32/48.png` | 位图 favicon |
| `apple-touch-icon.png` | 180×180 |
| `icon-192.png` / `icon-512.png` | PWA 图标 |
| `maskable-512.png` | Android 自适应图标（安全区 50%） |
| `site.webmanifest` | PWA 清单 |
| `head-snippet.html` | 直接粘进 `<head>` 的标签片段 |
| `*-64/512/1024.png` | 各变体位图 |

主文件（`brand/logo/` 下）：

| 文件 | 说明 |
| --- | --- |
| `symbol.svg` | **主符号**，`currentColor`，单色/反白/品牌色共用同一份几何 |
| `symbolSmall.svg` | 小尺寸简化版 |
| `lockupHorizontal.svg` | 横排锁定：符号在左、**字标已转曲**，净空 48 |
| `lockupStacked.svg` | 竖排锁定：`viewBox 0 0 256 270` |
| `application.png` | 应用总览（各图均为真实产出文件） |

## 5. 使用规则

**净空**：四周至少留出等于**符号描边厚（24 单位）的 2 倍**。横排锁定已按此设定
（符号右边 192 → 文字左边 240，即 48 净空）。

**最小尺寸**：

| 介质 | 最小尺寸 |
| --- | --- |
| 屏幕 | **16px**（须用简化版） |
| 屏幕，完整版 | **32px** |
| 印刷 | 待打样确认（按 16px 比例推算约 **5mm**，**未验证**） |
| 刺绣 | 待打样（建议 ≥ 1.5 英寸，用简化版） |

**不要**：拉伸变形、加投影或描边、旋转、改色为非规范色、在半色调照片上直接放置
（需先加底或改用容器）、把准星单独取出使用。

## 6. 已实测 / 未实测

**已实测**（可用 `application.png` 复核）：

- ✅ 96 / 64 / 48 / 32 / 16px 逐级渲染 —— 32px 起清晰，**16px 用简化版仍可辨**
- ✅ 单色黑、单色白、品牌绿底、浅底 —— 四种底色均成立
- ✅ `favicon.ico` 结构校验：3 张图、16/32/48、32 位
- ✅ 转曲检查：锁定文件**无 live text**（`svg_audit` 的 FAIL 已消除）
- ✅ 几何审计：`symbol.svg` 与 `symbolSmall.svg` 均 **100/100 无问题**

**未实测**（不要当作已验证）：

| 项 | 状态 |
| --- | --- |
| 刺绣 / 烫金打样 | ❌ 未做 |
| 大幅招牌（曲线、锚点在大尺寸下的瑕疵） | ❌ 未做。本符号全为直角矩形，预期无问题，但未验证 |
| 圆形裁切（社交头像） | ❌ 未做。四角构图在圆形裁切下会切到角尖，**需实测** |
| 动效 | ❌ 未做。建议：准星先出现，四角随后收拢到位 |
| CMYK / 专色打样 | ❌ 未做。`#2E9E6B` 的印刷表现需打样确认 |
| 商标检索 | ❌ 未做。**无法给出法律结论**，发布前请自行检索商标库并做反向图片检索 |

## 7. ⚠ 未完成项（发布前必须处理）

### 字标字体授权 —— 这是唯一的阻塞项

`lockupHorizontal.svg` 与 `lockupStacked.svg` 的字标已转曲，但**转曲来源是
Microsoft YaHei Bold**（`msyhbd.ttc`）。

**Microsoft YaHei 是微软的商用字体，其字形轮廓不可随产品分发。**
这两个文件目前只适合用于**审阅与版式验证**，不可作为最终 master 发布。

处理方式（二选一）：

1. **取得授权** —— 若你有 Microsoft 的字体嵌入/分发授权
2. **换开源字体重做**（推荐）—— 思源黑体（Source Han Sans / Noto Sans CJK，SIL OFL）、
   或阿里巴巴普惠体等可商用字体。本仓库已有转曲脚本，换字体只需改脚本里的字体路径：

   ```
   scripts/outlineWordmark.mjs   ← FONT 常量
   scripts/outlineStacked.mjs    ← FONT 常量
   ```

   换完后**必须复核字距与基线**：不同字体的 cap height 与字面框不同，
   当前基线值（横排 148、竖排 248）是按 YaHei 的度量算的。

### 其他待办

- [ ] 符号自身的商标可注册性检索
- [ ] 圆形裁切实测（社交头像）
- [ ] 刺绣与烫金打样
- [ ] `#2E9E6B` 的 CMYK / 专色对应值
- [ ] 动效规范（入场/出场）
- [ ] **替换项目内仍在使用的上游 Toonflow 图标**：`packages/assets/`
      下的 `logo.svg`、`logo.ico`、10 个尺寸的 `icon_*.png`，以及
      `apps/web/public/favicon.svg`

## 8. 复现方式

所有产出都可从脚本重跑，无需手工操作：

```bash
# 符号与几何（手写 SVG）
brand/logo/symbol.svg
brand/logo/symbolSmall.svg

# 字标转曲（需系统有 msyhbd.ttc；换字体改 FONT 常量）
bun scripts/outlineWordmark.mjs    # → lockupHorizontal.svg
bun scripts/outlineStacked.mjs     # → lockupStacked.svg

# 变体与 Web 图标集（用 logo-design 技能的 export_variants.py）
python <skill>/scripts/export_variants.py brand/logo/symbol.svg \
  --name zhukai --title "住凯AI视频" --mono "#2E9E6B" \
  --icon-bg "#14543C" --icon-fg "#F2F4F2" --icon-scale 0.8 \
  --favicon-source brand/logo/symbolSmall.svg --web-icons --png 32 512 1024 \
  --out-dir brand/logo/dist

# 应用总览页
bun scripts/buildApplicationSheet.mjs
```
