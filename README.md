# 住凯AI视频

把剧本、资产与视频片段整合进同一张无限画布的本机 AI 创作工具。项目与素材保存在自己的设备上。

> **本项目基于 [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app) 改造，遵循 MIT 许可证。**
> 原始版权：Copyright (c) 2026 HBAI-Ltd。完整许可证文本见 [LICENSE](./LICENSE)。
> 与上游的主要差异见下方「与上游的差异」。

---

## 1. 与上游的差异

这是一个面向本机使用的改造版本。相对上游的实质性改动：

| 项 | 上游 | 本项目 |
|---|---|---|
| 使用数据 | 默认开启匿名遥测并上报 | **无任何遥测**，不发送使用数据 |
| 模型来源 | 内置 TF-Router / APIMart / Meta 等第三方中转 | **只保留厂商直连**，不接任何中转 |
| 插件市场 | 有在线市场（依赖上游中转服务） | **已移除**；插件仍可用文件导入或 `zhukai://` 深链安装 |
| 默认配色 | Element Plus 出厂蓝 | 品牌绿色系 |
| 更新源 | 上游托管接口 | 只认 `UPDATE_BASE_URL` 或你自己填的地址 |

界面品牌已改为「住凯AI视频」。内部 npm 作用域（`@toonflow/*`）与插件宿主契约
（`window.toonflowNodes` 等）保留原名 —— 它们对用户不可见，改动会破坏插件兼容性与上游可合并性。

---

## 2. 功能

| 能力 | 说明 |
| --- | --- |
| 🏠 **本地部署** | 项目与素材保存在自己的设备或服务器，支持桌面与服务器部署。 |
| 🖼️ **无限画布** | 在同一画布中组织剧本、角色、场景与视频片段。 |
| 🔌 **MCP** | 通过 MCP 连接外部工具与服务。 |
| 🧩 **插件系统** | 节点、工具、技能、供应商均可扩充；支持文件导入与深链安装。 |
| 🤖 **开放 Agent** | 开放提示词、工具与 A2A，支持自定义 Agent 行为及外部协作。 |
| 🔧 **自由接入模型** | 自行配置供应商 API，也可接入本地 ComfyUI 与 LLM。 |
| 🌐 **多语言支持** | 支持 21 种界面语言。 |
| 🎙️ **配音与声音** | 语音合成、声音复刻与声音设计；音色存进素材库复用。 |
| 💬 **对齐字幕** | 把配音的**实际念法**对齐到口播稿，产出带逐字高亮的 ASS 字幕。 |
| ✅ **交付前质检** | 机器闸：帧率一致性、音画时长、全静止段、镜头落点保护带。 |
| 🎚️ **声音设计** | 音效钉帧（相对镜头起点）、输出音轨偏移补偿、BGM 卡点口径。 |
| 📐 **画面规范** | 反 PPT 方法论与排版规范（12 栏栅格、字阶、校验九项）。 |

---

## 3. 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| **Bun** | 1.3.14 | 运行时与包管理器，**必需**（项目使用 `bun:ffi`、`Bun.hash` 等） |
| Node.js | 20+ | 仅供 Vite 内部使用 |
| FFmpeg | 任意较新版本 | 也可由应用内下载（设置 → FFmpeg） |
| NSIS | 3.10 | **仅在打 Windows 安装包时需要** |

安装 Bun：

```powershell
# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash
```

---

## 4. 开发

```bash
bun install --linker hoisted
bun run dev
```

打开 **<http://localhost:5173>**。改 `apps/web/**` 与 `apps/server/**` 会热更新。

> **两个端口，别搞混**：`5173` 是 Vite 开发服务器，**页面看这个**；
> `3000` 是 API 服务端（`bun --watch src/index.ts`），Vite 把 `/api` 代理过去。
> 直接开 3000 只会拿到 `build/web` 里的**上一次构建产物**，看起来像"改动没生效"。

> **`bun run dev` 走的是 `scripts/dev.mjs`**，不是 `bun run --filter a --filter b`。
> 后者实测**只启动第一个 filter**（服务端），Vite 不会启动，而且**没有任何报错**——
> 结果就是 3000 上的旧产物看起来像"页面没更新"。`scripts/dev.mjs` 显式并行起两个进程，
> 任一退出即结束另一个。
>
> 只想单独起一个时：`bun run dev:web` / `bun run dev:server`。

> **Vite 必须带 `--configLoader runner`**（`apps/web/package.json` 的 `dev` 与 `build` 都已带）。
> 工作区包以裸 `.ts` 形式发布，默认的 `bundle` 加载器会报
> `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，dev 服务器会直接起不来 ——
> 此时 3000 上的旧产物仍能打开，非常容易被误认为"改动没生效"。

> **`--linker hoisted` 是必需的**：默认的隔离式链接器在部分环境会大量
> `failed to symlink dependencies` 失败，导致 `node_modules` 顶层为空。

### 改 `packages/**` 后要重启

工作区包不在 dev server 的监听范围内（启动时会提示
`... is not in the project directory and will not be watched`）。
改 `packages/**`（供应商、节点、工具、技能）后需**重启 `bun run dev`** 才生效。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | Web + 服务端开发模式 |
| `bun run dev:desktop` | 桌面端开发模式 |
| `bun run dev:plugins` | 插件 watch 构建 |
| `bun run build:nodes` / `build:tools` | 构建内置节点 / 工具 |
| `bun run --cwd apps/server routes` | 新增路由文件后重新生成路由表 |
| `bun run typecheck` | 类型检查 |
| `bun run preflight` | 开工断言：预置画布端口、插件同步、i18n key、音频格式、文档链接、供应商字面量 |

### 后期制作脚本

Agent 侧走「后期制作」工具（`checkVideo` / `makeSubtitle` / `resolveCues` / `exportDelivery` / `useCard`）；同一批算法也有命令行入口，便于单独跑与排查：

| 命令 | 作用 |
| --- | --- |
| `bun scripts/alignTiming.mjs <asr.json> <稿> <timestamps.json>` | 配音对齐到口播稿，报告每句覆盖率 |
| `bun scripts/makeSubtitles.mjs <timestamps.json> <out.ass>` | 生成 ASS 字幕（含逐字高亮） |
| `bun scripts/qaGate.mjs <视频>` | 成片机器闸 |
| `bun scripts/soundCue.mjs <cues.json> --shots <shots.json>` | 音效钉帧校验与绝对时刻换算 |
| `bun scripts/semanticAnnotate.mjs --init --script <稿> --out <semantics.json>` | 逐句语义标注（选卡与覆盖闸的依据） |
| `bun scripts/reviewKit.mjs <视频> --out <dir>` | 生成独立评审材料包与派发包 |
| `bun scripts/checkCards.mjs` | 逐张真跑配方卡的滤镜链并核语义效果 |
| `bun scripts/checkJianying.mjs` | 剪映草稿的字段结构与不变量对账 |
| `bun scripts/syncPlugins.mjs` | 把 build/ 产物与技能源码同步到 data/（插件只首次铺入，改完不会自动生效） |

**可编辑交付**：Agent 用 `exportDelivery` 产出镜头切段表（CSV）、标准 EDL（仅单源）与 SRT 字幕，
用户可在自己的剪辑软件里继续变速、重排、改字幕。导出前会对切段表对账（重叠 / 缝隙 / 零长段 / 总时长）。

> 不做剪映、Premiere 的内部工程文件：那些格式是私有的、随版本变，没有真机草稿做基准时照猜生成，
> 只会给出打不开的坏文件。本地装了剪映的话，可以用它自己写的草稿做基准再补这一层。

**剪映草稿导出**：`exportDelivery` 传 `jianying` 参数即额外产出 `draft_content.json` +
`draft_meta_info.json`（底片切成可单独变速/重排的段，字幕与音效各成独立可编辑轨）。
字段结构来自 [pyJianYingDraft](https://pypi.org/project/pyJianYingDraft/) 0.3.0 的序列化器与
模板资源 —— **不是猜的**；`scripts/checkJianying.mjs` 对 143 个字段与结构不变量做常驻对账（已接入 preflight）。

> ⚠️ **未验证**：「能被剪映打开」这一步**没有真机验证过**（开发机没装剪映）。
> 剪映对缺字段的反应是「内容已损坏」，所以**首次使用请先用一个最小草稿做冒烟**
> （只放一个底片段），确认能打开再做正式片。导出物只写在工作区，**不自动装进剪映草稿库** ——
> 装库涉及移动目录与用户改动，那一步留给用户。

**画面配方卡**：Agent 用 `useCard` 按素材类型与语义检索效果卡，取卡时拿到参数化的 FFmpeg
滤镜链、参数区间、已知坑与落位自检。首批 7 张（极缓推进 / 首尾淡入淡出 / 交叉淡化 /
降饱和底床 / 暗角收拢视线 / 冻结末帧留白 / 硬切闪白），每张都由 `scripts/checkCards.mjs` 真跑验证
并核语义效果，已接入 `preflight`。

```bash
bun scripts/checkCards.mjs     # 逐张跑滤镜链并核效果（preflight 会调它）
```

> 新增 workspace 包后需先 `bun install` 建立链接，否则 `@toonflow/*` 解析不到。

---

## 5. 安装 Windows 安装包

双击 `zhukai-<版本>-Setup.exe` 即可，**安装程序会请求管理员权限（会弹 UAC，选「是」继续）。**

> **必须允许提权，否则安装会失败。** 提权不是可选项：普通权限下 NSIS 引导层无法在
> TEMP 创建并执行自身副本，安装会中止并弹出
> `NSIS Error — Error writing temporary file. Make sure your temp folder is valid.`
> 安装脚本已声明 `RequestExecutionLevel admin`，因此正常情况下会自动弹 UAC；
> 若因策略被拒绝提权，请右键安装包选择「以管理员身份运行」。
>
> 曾误判为「TEMP 目录损坏」并去改 TEMP 路径 —— **那没用**，问题在完整性级别，不在路径。

默认安装到 `%LOCALAPPDATA%\local.zhukai.desktop\stable`，可以在向导里改到其他目录
（例如 `E:\zk_video`）。安装包**自带全部依赖**，不需要在目标机预先安装任何东西：

| 依赖 | 是否已打包 |
| --- | --- |
| Bun 运行时 | ✓ 约 86 MB |
| WebView2 检测程序与加载器 | ✓ |
| 微软 WebView2 官方安装引导 | ✓ 缺 WebView2 时由它静默安装，版本过旧时请求一次提权 |

安装后桌面会出现「住凯AI视频」快捷方式。

> **开始菜单快捷方式当前不会被创建。** `installer.nsi` 只创建桌面快捷方式
> （`CreateShortCut "$DESKTOP\..."`），`$SMPROGRAMS` 仅出现在卸载时的清理语句里。
> 实测开始菜单没有条目，这是已知缺口，不是安装失败。

卸载用安装目录下的 `UninstallNSIS.exe`（同样需要提权）。

---

## 6. 打包 Windows 安装包

```bash
bun run build:desktop      # 构建桌面应用
bun run package:desktop    # 生成 NSIS 安装包
```

产物在 `build/desktop/artifacts/`。

### 打包时可能遇到的环境问题

1. **TypeScript 必须锁 6.0.3**。根 `package.json` 已锁定。TS 7 移除了 `ts.sys`，
   而 `@vue/compiler-sfc` 依赖它，报错会写成「No fs option provided in non-Node environment」，
   与真实原因无关。
2. **Vite 需要 `--configLoader runner`**。各插件包的 `build` 脚本已带上。
   默认的 `bundle` 加载器无法处理工作区包里的裸 `.ts` 入口。
3. **`csc.exe` 无法由 Bun 拉起**（`CS0016 拒绝访问`）。`apps/desktop/scripts/build.ts`
   已改为产物存在时跳过编译；要强制重编就删掉 `build/desktop/protocol`。
4. **NSIS 路径**：默认找 `C:/Program Files (x86)/NSIS/makensis.exe`，
   可用环境变量 `NSIS_PATH` 指向便携版。
5. **发布前设置更新地址**，否则自动更新会指向占位仓库：

   ```powershell
   $env:UPDATE_BASE_URL = 'https://你的域名/zhukai'
   ```

6. **安装包保持 `RequestExecutionLevel admin`**。改成 `user` 会让普通双击安装失败，
   报 `Error writing temporary file`（原因见上一节）。用户机上同时还装着安全软件时
   更容易触发 —— 中完整性进程无法在 TEMP 落盘并执行自身副本。
7. **`checkWebView2.exe` 必须先存在**，否则 NSIS 的 `File` 指令会**致命失败、不产出安装包**
   （`Error in script ... aborting creation process`，退出码 1）。
   它由 `packageWindows.ts` 用 `csc.exe` 编译产出；若被清理需重新运行打包脚本。

---

## 7. 数据位置

| 内容 | 位置 |
| --- | --- |
| 设置与偏好 | 数据目录下的 `settings.json` |
| 内置插件副本 | 数据目录下的 `nodes/`、`tools/`、`skills/`、`providers/` |
| 项目与素材 | 你为项目选择的工作目录 |
| 对话历史 | 工作目录内的会话文件 |

数据目录的确定方式：环境变量 `TOONFLOW_DATA_DIR`；未设置时，
开发模式用仓库根目录的 `data/`，桌面端用安装目录下的 `data/`。

**本软件不收集任何使用数据。** 只有你配置的模型供应商、你手动触发的 FFmpeg 下载、
以及你主动装载的插件与 MCP 服务会发起网络请求。

---

## 8. 许可证

本项目采用 [MIT 许可证](./LICENSE)，遵循上游 Toonflow 的许可条款。
Copyright (c) 2026 HBAI-Ltd。

第三方依赖与素材遵循各自的许可与版权声明。
