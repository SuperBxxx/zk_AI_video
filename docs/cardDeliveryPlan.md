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

## 1–3：让打包后真能跑（底线）✅ 已完成

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

## A：让 Agent 真能把卡渲进成片 ✅ 已完成

- `packages/tools/postProduction` 新增 op：`renderCard`
  - 入参：`slug` / `frameSize` / `parameters` / 输出路径 / （叠加卡）目标视频
  - 出参：成片路径 + 实测画幅与时长
- 工具侧只做参数校验 + 转交 server 服务（薄代理）
- 叠加卡：渲出带 alpha 的视频再与 AI 视频 overlay；全屏卡：直接渲出整段

## B：让卡在画布上可见可调（进行中）

### 已查清的上线路径（照现有节点做）

节点的形态与注册方式（实测，不是推测）：

| 环节 | 事实 |
|---|---|
| 节点是一个包 | `packages/nodes/<name>Node/`，含 `package.json`、`vite.config.ts`、`src/index.vue` |
| 构建 | `vite build --configLoader runner`，用 `createNodeConfig({ name, displayName, author, github }, import.meta.url)`（来自 `@toonflow/nodes-scaffold`） |
| 产物 | `build/nodes/<name>.umd.js`。命名规则：`/^[a-z][a-zA-Z0-9]*\.umd\.js$/` |
| 注册 | **不需要改任何注册表**。server 的 `routes/nodes/get.ts` 扫 `nodesDirectory` 下的 `*.umd.js`；web 侧 `loadNodeComponent` 用 `<script>` 加载该文件，组件从 `window.toonflowNodes[name]` 取 |
| 画布 | `apps/web/src/pages/workspace/panels/canvas/index.vue`：`nodeTypes` 按需装载；`nodeMenu.vue` 读组件的 `handles` 与 `icon` 来画连线点与菜单图标 |
| 打包 | `electrobun.config.ts` 已把 `build/nodes` 映射到 `nodes`，所以**新节点自动进安装包** |

### 组件契约

- 用 `@toonflow/nodes-scaffold` 的 `nodeSkeleton` + `useNode` + `useNodeEvent` 等组合式
  （`textNode` 是最简单的参考：`packages/nodes/textNode/src/index.vue`）
- `NodeHandle = { type, dataType }`，`dataType` 来自
  `"STRING" | "INT" | "FLOAT" | "BOOLEAN" | "IMAGE" | "MASK" | ...`（见 `nodeScaffold/src/connection.ts`）
- 节点数据由画布持久化（server 的 canvas 数据），节点本身只负责渲染与交互

### 已完成

`packages/nodes/cardNode/`：

1. 选卡（下拉，直接读 `@toonflow/card-runtime/cards`）→ 调参数（按卡声明的区间与默认值动态生成）
   → 选成片画幅与帧率 → 触发 `/api/card/render` → SSE 显示进度 → 输出成片
2. 输入端口：目标视频（只有叠加卡用得上）；输出端口：视频
3. 成片落在 `assets/<nodeId>/card-<时间戳>.mp4`，作为节点输出

## 验证要求

| 项 | 判据 | 结果 |
|---|---|---|
| 内核 | 渲一张叠加卡，量左上角 **RGBA alpha≈0**（不是看 ffprobe 的 pix_fmt —— 它会骗人） | ✅ `0,0,0,0` |
| 合成 | 竖屏 AI 视频 + 同画幅叠加卡 → 视频透出来、文字不重叠 | ✅ 左上角 RGB `12,53,96`（AI 视频的深蓝） |
| 进程 | 渲完**无残留**（按 pid 杀整棵树），且**不碰**用户已有浏览器 | ✅ 我的 profile 0 残留，机器上其它进程未受影响 |
| 打包边界 | 确认内核随 server 进 `app/` | ✅ desktop 产物含 `setDefaultBackgroundColorOverride` / `prores_ks` |
| 接口 | 真起 server 打 `/api/card/render`，事件顺序与产物 | ✅ `browser → render 25/50/75 → encode → done` |
| 节点 | 产物、元数据、全局名、类型检查、被 server 列出并可取到脚本 | ✅ 见下 |
| 回归 | `bun run preflight`、相关包 typecheck | ✅ preflight 13/13；server / 节点 / 内核 / 卡库 typecheck 零错误 |

## 进度

- ✅ 1–3：渲染内核进 server 的安装边界；工作目录定在 `<data>/cardRender/`；进程清理按 pid 杀整棵树
- ✅ A：`renderCard` 工具 op（宿主注入 cardRender 通道，工具侧薄代理）
- ✅ B：画布节点 `cardNode`（选卡 / 调参 / 成片画幅 / 目标视频输入 / SSE 进度 / 视频输出）

## 尚未验证的一项（如实记录）

**没有在浏览器里真打开画布、把节点拖出来点一遍。** 已证明的是它两侧的链路：
节点产物正确且被 server 列出、脚本能被取到、它依赖的 `/api/card/render` 端到端跑通。
剩下的是 UI 交互本身（拖拽、面板渲染、进度条），那要在跑起来的画布里点一次才算数。

