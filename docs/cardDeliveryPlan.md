# HTML 配方卡的落地计划（安装边界内可用 → 工具可调 → 画布可见）

## 背景：卡做完了，但装完之后用不了

24 张 HTML 卡已实现并通过 96/96 自检（渲染确定性 + 帧间变化 + 落位），
`useCard` 也能检索到它们。但**打包安装后点不动**，原因不是浏览器，是**边界**：

```
electrobun.config.ts 的 copy 列表：
  build/web → views/mainview    build/tools → tools     build/nodes → nodes
  build/mcp → mcp               packages/providers/src → providers
  packages/skills → skills
  ↑ 没有 scripts/          → scripts/renderCard.mjs 不会被安装
```

已安装版 `E:\zk_video` 实测确认：有 `tools/`、`skills/`、`nodes/`，**没有 `scripts/`**。

所以现状是：**Agent 能查到卡，但没有任何东西能把卡变成画面。**

## 浏览器不是瓶颈（已实测）

| 事实 | 证据 |
|---|---|
| Electrobun 不自带浏览器 | `node_modules/electrobun/bin` 只有两个 `.cjs`，没有 libcef / chrome.exe / resources.pak |
| 它依赖系统 WebView2 | 内核就是 Edge；**能装上本应用的机器一定有 Edge** |
| Edge 能带沙箱起、能连 CDP、能截出带 alpha 的 PNG | 实测 `rgba`，alpha=0 |
| **本任务环境**限制 Chrome 的沙箱初始化 | Chrome 默认沙箱起不来；`--no-sandbox` 能起；**Edge 默认沙箱能起** |

结论：**Edge 是稳的兜底，不需要随包分发 Chromium**（省 150MB+）。

## 架构决策（照 ffmpeg 的既有模式）

重活（起浏览器、逐帧截图、编码）**必须由 server 侧的服务承担**：

- 工具产物是自包含 bundle，跑在 agent 进程里，不该直接管子进程与临时文件
- `@toonflow/ffmpeg` 已经确立了模式：工具侧只做薄代理，server 侧通过
  `createAgentToolContext` 提供 `ffmpeg: signal => createWorkspaceFfmpeg(cwd, signal)`

所以新增：

```
packages/cardRenderer/            渲染内核（起浏览器 + CDP + 逐帧 + 编码）
  src/chrome.ts                   找浏览器、起它、连 CDP、杀整棵进程树
  src/page.ts                     用 buildCardPage 生成页面并逐帧截图
  src/encode.ts                   帧 → 视频（全屏 H.264 / 叠加 ProRes 4444）
  src/index.ts                    renderCardToVideo() 单一入口
apps/server/src/utils/cardRender/ 服务器侧服务（解析路径、选输出、调内核）
apps/server/src/routes/card/render.ts   HTTP 路由（SSE 进度 + 取消）
packages/tools/postProduction     新增 renderCard op（薄代理）
```

## 1–3：让打包后真能跑（底线）

### 1. 把渲染逻辑移进安装边界内

- 渲染内核做成 `packages/cardRenderer`，由 **server** import（server 会打包进
  `app/`，天然在安装边界内）
- 不再依赖 `scripts/renderCard.mjs`；那个脚本保留为**开发期命令行工具**，
  改为调用同一份内核（一份实现，两处使用）

### 2. 定临时目录与浏览器 profile 目录

- 落帧与 profile 都写 **`<dataDirectory>/cardRender/`**
  （Windows 上 `<data>/` 与 `app/` 同级：可写、且**程序更新不覆盖**）
- 卡页面 HTML 写进同一个目录，`file://` 打开
- 渲完清理帧目录；profile 保留（省去每次冷启动的十几秒）

### 3. 进程清理必须正确

踩过两次，都写进代码注释：

- **必须杀整棵进程树**：Chromium 是多进程，只杀父进程会留 8~10 个孤儿子进程，
  它们占着 profile，下次启动可能失败
- **不能因为「启动器已退出」就跳过清理**：Windows 上 `chrome.exe` / `msedge.exe`
  是启动器，起完真正的浏览器进程就自己退了 —— `exitCode !== null` 恰恰是
  **最需要清理**的时刻（我在这里加过「已退出就 return」，结果一次都没清掉）
- **只能按 pid 杀自己起的实例，绝不按进程名杀**（这条是血的教训：按名杀
  `msedge.exe` 会打掉用户正在用的界面，因为 Electrobun 的界面就是 WebView2 = Edge）

## A：让 Agent 真能把卡渲进成片

- `packages/tools/postProduction` 新增 op：`renderCard`
  - 入参：`slug` / `frameSize` / `parameters` / 输出路径 / （叠加卡）目标视频
  - 出参：成片路径 + 实测画幅与时长
- 工具侧只做参数校验 + 转交 server 服务（薄代理）
- 叠加卡：渲出带 alpha 的视频再与 AI 视频 overlay；全屏卡：直接渲出整段

## B：让卡在画布上可见可调

- 新增画布节点（照 `packages/nodes/videoGenerationNode` 的形态）：
  选卡 → 调参数 → 选目标画幅 / 目标视频 → 渲预览 → 输出成片
- 节点调 server 的 `/api/card/render` 拿进度与结果
- 节点注册进 `packages/nodes` 与构建流程

## 验证要求

| 项 | 判据 |
|---|---|
| 内核 | 渲一张叠加卡，量左上角 **RGBA alpha≈0**（不是看 ffprobe 的 pix_fmt —— 它会骗人） |
| 合成 | 竖屏 AI 视频 + 同画幅叠加卡 → 视频透出来、文字不重叠 |
| 进程 | 渲完**无残留**（按 pid 杀整棵树），且**不碰**用户已有浏览器 |
| 打包边界 | 确认内核随 server 进 `app/`；`scripts/` 的不再是依赖 |
| 回归 | `bun run preflight`、相关包 typecheck、`bun run build` |

## 顺序

1–3（底线）→ A（工具）→ B（画布节点）。每步做完单独提交并汇报。
