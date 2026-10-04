# 住凯AI视频 · 去 Toonflow 化改造计划

> **目标**：让产品在**界面、文案、交互、默认配置**上都不被认出是 Toonflow，同时保住 MIT 合规底线。
> **本文基于源码实测**（不是推测），所有路径与行号都可直接定位。
> **前置事实**：dev 模式已跑通（`http://localhost:3000`），改 `apps/web/**` 与 `apps/server/**` **即时热更新**；
> 改 `packages/**` 需重启 dev server（dev 日志明确提示 these files are not in the project directory and will not be watched）。

---

## 零、先看清现状：为什么"一眼就是 Toonflow"

实测设计体系只有三件事，**其中两件是"照抄默认值"**：

| 项 | 现状 | 问题 |
|---|---|---|
| 全局样式 | `apps/web/src/assets/main.scss`，**仅 65 行**，只定义圆角（`--ui-radius: 8px`）与滚动条 | 没有任何品牌色/字体/间距体系 |
| 配色 | **Element Plus 出厂默认**。`stores/settings.ts:29` → `primaryColor: "#409eff"` | `#409eff` 就是 EP 的标志性蓝。**"Toonflow 感"的技术根因就是这一行** |
| 主题预设 | `ui.vue:144-151` 六个预设，第一个是 `#409eff` 天空蓝 | 预设本身就是 EP 色板 |
| 动效 | `home/bg.vue`（SVG 光带 + 星点 + 指针光晕，17 处）、`hello/bg.vue`（canvas 胶片动画） | 视觉语言偏"通用 AI 风" + 胶片隐喻 |
| 字体 | `hello/index.vue:88` 等局部写 `"Inter","Segoe UI","PingFang SC"` | 无统一字体栈 |

**结论**：不需要"重做 UI"。**换掉 token + 换掉两个背景组件 + 清文案**，观感变化就是质变。这是本计划能低成本完成的原因。

---

## 一、四层总览（依赖顺序）

```
L1 文案清零        ← 独立，机械，先做（低风险）
      ↓
L2.0 视觉 token 体系  ← 建立品牌色/字体/圆角/间距（一处改，全站生效）
      ↓
L2.1 TF-Router 剥离   ← 首屏结构 + 插件市场 + 遥测（有功能影响，需决策）
      ↓
L3 视觉识别（除 Logo）← 背景动效、布局骨架、图标、空状态
      ↓
L4 产品气质          ← 内嵌提示词人设、默认引导、错误文案语气、社区入口
```

> L2 拆成 2.0/2.1 是因为：**2.0 是纯样式增量（零功能风险），2.1 涉及删功能（需回归验证）**。

---

## 二、L1 · 文案清零

### 2.1 已知清单（`grep` 实测，可信）

| 文件 | 行 | 原文 | 处置 |
|---|---|---|---|
| `pages/hello/index.vue` | 36,43 | `Toonflow` | ✅ **已改** |
| `pages/home/index.vue` | 21,22 | `alt="Toonflow"`、`<h1>Toonflow</h1>` | ✅ **已改**（含移除 GitHub/Star 区块） |
| `components/settings/panels/personalization.vue` | 5,16,27,36,79,249,309 | `Toonflow 说明` ×5、`Toonflow 记忆` | 改 `住凯AI视频 说明`／`本地记忆` |
| `components/settings/panels/mcp/index.vue` | 8,29,52,53,61 | `操作 Toonflow`、`需要 Toonflow 界面`、`Toonflow Skill` ×3 | 改品牌名；`Skill` 建议改 `技能` |
| `components/settings/panels/pluginMarket/ffmpeg.vue` | 76,113,115 | `当前 Toonflow 服务` ×3 | 改 `本机服务` |
| `components/settings/panels/ui.vue` | 105 | `Toonflow 每一个灵感，都值得被看见` | **整句换掉**（见 L4） |
| `components/updateBox.vue` | 16 | `<h2>Toonflow v{{version}}</h2>` | 改品牌名 |
| `components/agent/conversation.vue` | 11 | `你好，我是 Toonflow 助手` | 改品牌名 |
| `pages/workspace/index.vue` | 29,34 | `content="Toonflow Agent"`、`aria-label` | 改品牌名 |
| `pages/workspace/panels/canvas/components/canvasControls.vue` | 141,196 | `Toonflow 需求/BUG反馈表`、`Toonflow 是为爱发电的开源项目…` | **删掉整个社区区块**（见 L4） |

### 2.2 必做的两步（否则一定漏）

**① i18n 字典（21 个 locale，已在上一轮改完 1638 处）**
`packages/i18n/src/locales/*.json` —— 这套 i18n **以中文原文为 key**，
所以**key 和 value 必须一起改**，只改 value 会让中文界面仍显示旧名。

**② `plugin.author !== 'Toonflow'` 必须与产物 author 成对改**
`pluginMarket/index.vue` 有 **5 处**（173/194/195/231/652）在判断"插件是不是官方内置"：

```js
v-if="plugin.author !== 'Toonflow'"
```

它比较的是**节点/工具产物 manifest 里的 `author` 字段**。产物 author 来自：
- `packages/nodes/*/vite.config.ts` → `createNodeConfig({ author: "Toonflow" })`
- `packages/tools/*/build.ts` → `createToolConfig({ author: ... })`

**只改一边的后果**：内置插件被当成第三方插件，界面多出"启用/禁用"开关，逻辑错乱。

> **建议**：把 `author` 改成你的署名，判定处同步改。**这是唯一需成对修改的功能性文案**。

### 2.3 保留（MIT 合规底线，且不影响观感）

| 保留项 | 位置 | 理由 |
|---|---|---|
| `Copyright (c) 2026 HBAI-Ltd` + MIT 全文 | `LICENSE` | **MIT 署名义务，不可删** |
| "基于 Toonflow 改造"声明 | `about.vue:91` | 合规且放在"关于"页不显眼 |
| 上游仓库链接 | `about.vue:224` | 属于出处标注，建议保留 |

---

## 三、L2.0 · 视觉 token 体系（最高性价比）

**为什么放前面**：改 `main.scss` 一处 → 全站按钮、选中态、链接、焦点环、卡片圆角一起变。**零功能风险**。

### 3.1 建立品牌色（替换 EP 出厂蓝）

**动作 1** —— `stores/settings.ts:29` 改默认值：
```diff
- primaryColor: "#409eff",
+ primaryColor: "#0EA5A0",   // 示例：深青。此处换成你的品牌色
```

**动作 2** —— `main.scss` 补一层品牌 token（现在这里只有圆角）：
```scss
html:root {
  --brand-primary: #0EA5A0;
  --brand-primary-deep: #0B7F7B;
  --brand-accent: #C2703C;      // 强调色，用于 CTA / 高亮
  --ui-radius: 10px;            // 8 → 10，圆角更"自有"
  --ui-font-display: "Noto Serif SC", "Songti SC", serif;   // 标题字体，与 EP 默认区分开
  --ui-font-body: "Inter", "PingFang SC", "Microsoft YaHei", sans-serif;
}
```

**动作 3** —— `ui.vue:144-151` 把预设色板换成品牌色系（不要再用 EP 那六色）。

**动作 4** —— 检查 `main.ts` / `lib/i18n.ts` 里 EP 主题变量的注入点，确保 `--el-color-primary` 及其 `light-3/5/8/9`、`dark-2` 派生色由品牌色推导（否则按钮 hover/disabled 会回到 EP 蓝）。

> ⚠️ **必须同时生成派生色**。EP 组件大量引用 `--el-color-primary-light-*`。
> 只改主色不改派生色，会出现"按钮是青色、hover 是蓝色"的破绽。
> 实现方式二选一：① 用 EP 官方的 `--el-color-primary` 混合函数在 SCSS 里算；
> ② 在 JS 里按 EP 的 `mix(#fff, primary, N*10%)` 规则算好后注入。

### 3.2 圆角与密度

| token | 现值 | 建议 | 影响 |
|---|---|---|---|
| `--ui-radius` | 8px | 10–12px | 卡片、弹窗、输入框全局圆角 |
| `fontScale` 默认 | 100 | 100（不动） | — |
| 滚动条宽度 | 6px | 8px | 细节质感 |

### 3.3 验收

- 首屏按钮、设置页选中态、链接、`el-radio` 边框全部是品牌色，**无 EP 蓝残留**
- 明/暗两套模式都正确（`ui.vue` 的主题切换用了 `document.startViewTransition`，切换时看有无闪蓝）

---

## 四、L2.1 · 剥离 TF-Router

### 4.1 已完成

`pages/hello/index.vue`：删除登录按钮、`iframe`（`api.toonflow.net/login`）、`receiveLogin`/`configureProviders`/`openLogin`（约 110 行）、`anonymousData.track`。

### 4.2 待办清单

| 位置 | 内容 | 处置 |
|---|---|---|
| `pluginMarket/index.vue` | `填写 TF-Router API Key`(69,70)、`前往 TF-Router 获取 API Key`(75)、`api.toonflow.net/console/plugIn`(10)、错误文案(465,525,586) | **决策点**：见 4.3 |
| `tfAccount.vue` | `前往 TF-Router 官网 获取 API Key`(31,32) | 随 pluginMarket 一起 |
| `tfRechargeDialog.vue` | 标题 `TF-Router 充值`(2) | 随 pluginMarket 一起 |
| `about.vue:62,65` | `官方中转平台 TF-Router` 板块 | 删板块 |
| `lib/tf.ts:53,56` | 硬编码 `https://api.toonflow.net`，且用 URL origin 判断身份 | 改常量或整体删除 |
| `providers/src/language/tfRouter.ts:15,17` | `apiUrl` + `readme: "## Toonflow 官方中转平台…"` | **纯数据**，用户可见，易改 |
| `providers/src/media/tfRouter.ts:11,94,96` | 同上 | 同上 |
| `lib/anonymousData.ts:145` | 向 `api.toonflow.net/web/telemetry/report` **上报遥测** | **建议直接删除该模块** |
| `server/src/utils/desktop/index.ts:8` | `official: "https://api.toonflow.net/web/version/desktopUpdates"` | 改你自己的更新地址 |

### 4.3 关键决策：插件市场怎么办 —— **已决定：方案 A（整体移除）**

TF-Router 是**插件市场的鉴权与目录服务**（`getPlugIn` 拉列表、API Key 校验、充值）。

**✅ 决策（2026-10-05）：采用方案 A —— 整体移除插件市场。**

#### A 方案的精确删除范围

| 删除对象 | 路径 | 连带处理 |
|---|---|---|
| 插件市场主面板 | `apps/web/src/components/settings/panels/pluginMarket/index.vue`（约 1091 行） | 整个面板移除 |
| 同目录组件 | `pluginMarket/{a2aSettingsDialog,agentConnectDialog,agentEditorDialog,ffmpeg,pluginConfigDialog,skillEditorDialog}.vue`、`types.ts` | **注意 `ffmpeg.vue` 在同一个目录**——它提供 FFmpeg 下载/配置能力，**不是市场功能，需保留并搬家** |
| 账户面板 | `apps/web/src/components/settings/tfAccount.vue` | 删除 |
| 充值弹窗 | `apps/web/src/components/settings/tfRechargeDialog.vue` | 删除 |
| TF-Router 客户端 | `apps/web/src/lib/tf.ts` | 删除（被以上组件引用） |
| 遥测模块 | `apps/web/src/lib/anonymousData.ts` | 删除（见 4.4） |
| 设置左栏入口 | `apps/web/src/components/settings/index.vue` 里指向 pluginMarket / tfAccount 的导航项 | 仅删这两项，**其余设置面板保留** |
| 关于页外链板块 | `about.vue:62,65`（官方中转平台 TF-Router） | 删该 section |
| 提供商数据 | `packages/providers/src/{language,media}/tfRouter.ts` | 从 `packages/providers/index.ts` 的 `languageProviders`/`mediaProviders` 数组里移除注册 |
| 桌面端更新源 | `apps/server/src/utils/desktop/index.ts:8` | 改 `official` 为 `UPDATE_BASE_URL` |

#### ⚠️ 方案 A 的三个必须注意点

1. **`pluginMarket/ffmpeg.vue` 不能一起删**。它虽然放在 pluginMarket 目录下，但功能是
   **FFmpeg 的检测/下载/配置**（`packages/ffmpeg` 的 `auto|download|system` 三模式的界面），
   与插件市场无关。删除前必须把它移到独立位置（如 `panels/ffmpeg/`）并改引用。
   同一目录下的 `pluginConfigDialog.vue` 若被 ffmpeg 复用也需保留。
2. **`providers/index.ts` 要同步改**。`tfRouter` 被 `const autoInstallProviders = [tfRouter]`
   （`apps/server/src/utils/conf/index.ts:9`）引用，**每次启动会自动把 TF-Router 写入用户配置**。
   只删 provider 文件不删这行，会导致启动报错或写出脏配置。
3. **插件能力不会全丢**。移除市场后，插件仍可安装，路径有两条且都不依赖 TF-Router：
   - **文件导入**：`installPluginFile.ts` + `.umd.js`/`.tool.js`/`.agent.zip`
   - **深链**：`zhukai://install?type=node&url=...` → `apps/desktop/src/protocol.ts` 的 `parseInstallUrl`
   —— 所以"插件生态"这个卖点仍然成立，只是没有在线目录了。

> 若日后想要在线分发，走方案 C（自建服务）即可，届时需要恢复 `lib/tf.ts` 形态的客户端。

### 4.3b 备选方案（未采纳，留档）

| 方案 | 做法 | 代价 |
|---|---|---|
| **B. 改为纯本地** | 保留"已安装"页签，删"发现"页签与所有 TF-Router 调用 | 失去在线市场，保留本地管理 |
| **C. 换成自己的服务** | 替换 `lib/tf.ts` 的 baseURL 与接口协议 | 你需自建后端 |

### 4.4 顺带处理：遥测

`lib/anonymousData.ts` 会把使用数据发到 `api.toonflow.net`。
这既有**标识问题**（网络请求暴露上游）也有**隐私问题**。
→ **建议整体删除该模块及所有调用点**（`hello` 已删，另需查 `settings/panels/privacy.vue` 的开关）。

### 4.5 验收

- 全局搜 `toonflow.net` **零命中**
- 用浏览器 DevTools 的 Network 面板，**全程无对外请求**（除你自己配置的模型供应商）
- 设置里不再出现 TF-Router / 充值 / API Key 字样

---

## 五、L3 · 视觉识别（Logo 之外的"看起来像"）

> Logo 按你的决定**暂不动**。以下是除 Logo 外影响观感的部分，**按性价比排序**。

### 5.1 首屏与首页背景动效（改动最大，成本低）

| 组件 | 现状 | 建议 |
|---|---|---|
| `pages/home/bg.vue` | SVG 光带(`flowLines`+`flowPulse`) + 点阵(`dotGrid`) + 星点(`sparkleField`) + 环境光(`ambientLight`) + 指针光晕(`pointerLight`)。17 处动画 | **保留结构、换视觉语言**：把"通用 AI 光带"换成与视频创作相关的隐喻（如时间轴刻度、胶片齿孔、波形）；或降饱和做成品牌色系微光 |
| `pages/hello/bg.vue` | canvas 逐帧播放 `assets/image.png` 胶片动画（`frameDuration=80`、含抖动/颗粒/曝光） | 这是**最像 Toonflow 的视觉元素之一**（胶片隐喻 + 那张图）。建议换成品牌几何或纯色渐变 + 轻动效 |
| `assets/image.png` | 444 KB，被 `hello/bg.vue` 引用 | 若换掉上一条，此图可删（也省 444 KB） |

**注意**：两个 bg 都实现了 `prefers-reduced-motion` 处理（`hello/bg.vue` 有 `reducedMotion` MediaQueryList）——**改造时必须保留无障碍逻辑**。

### 5.2 布局骨架

| 位置 | 现状 | 建议 |
|---|---|---|
| `hello/index.vue` | **左右 1:2 分栏**：左侧品牌+引导（`welcomePanel`），右侧整块艺术面板（`artPanel`） | 保留结构（它是对的），换右侧视觉与左侧节奏；或改为**单列居中**（更"工具"、更少"营销页"感） |
| `hello/index.vue:44-52` | 次级操作一行：主按钮 + `添加私有提供商` + `或` + `稍后配置` | ✅ 已简化为"主按钮 + 稍后配置" |
| `home/index.vue` | 页头 `设置` 居左 + `githubAction` 居右（**已移除**） | 页头现在只剩"设置"，建议补品牌标识或项目切换 |
| `home/index.vue` | 主体是 `创建项目` 面板（标题+灵感提示+输入卡） | 保留；`灵感创作模式` 那个手绘箭头提示（`arrowHint`）是强"上游风格"，建议换或删 |
| `workspace/index.vue` | 无限画布 + 浮窗 Agent | 保留（这是产品核心） |

### 5.3 图标与插画

| 项 | 现状 | 建议 |
|---|---|---|
| 主图标库 | **`@tabler/icons-vue`**（第三方，通用线性图标） | 可保留（通用库不构成品牌识别）；但**品牌相关图标要换**：`icon-login`（已随登录删除）、GitHub 图标、社群二维码 |
| 供应商 Logo | `packages/modelIcons` 提供模型图标 | 与上游无关，保留 |
| 赞助商素材 | `docs/images/sponsors/*.svg`（apiMart、metaso、compshare）+ `about.vue` 的赞助商面板 | **建议整体删除**（`about.vue:97` 起的 `sponsorPanel` 区块） |
| 二维码 | `about.vue:88,113` 交流群/商务合作二维码 | **建议删除**（那是上游的社群） |

### 5.4 空状态 / 加载态 / 错误态

| 位置 | 现状 | 建议 |
|---|---|---|
| `pages/hello/index.vue` | 登录态有 `el-alert` 错误反馈（已随登录删除） | — |
| 各页 `empty` 组件 | `apps/web/src/.../empty-*.js` | 检查空状态文案与插画是否带上游风格 |
| 启动动画 | `uiSettings.startupAnimation`（`stores/settings.ts:29`）默认 **true** | `packages/startup` 的 splash（thorvg DLL / macOS Obj-C）。**换 Logo 时会一起变**；暂不动 Logo 则此项也暂不动 |
| `favicon` | dev 日志显示 `GET /favicon.ico 404` | **补一个 favicon**（现在直接 404，是明显破绽） |

### 5.5 字体

现状：无统一字体栈，组件里零散写 `"Inter","Segoe UI","PingFang SC","Microsoft YaHei"`。

建议：`main.scss` 定义 `--ui-font-display` / `--ui-font-body`，
标题（首页大标题、快速开始标题）用**衬线或半衬线**与 EP 默认无衬线拉开差异——
这是**低成本高辨识度**的一招。

> ⚠️ 中文字体若引入 webfont 体积很大（几 MB）。建议用**系统字体栈**（`Songti SC`/`SimSun`/`Noto Serif SC`）而非下载字体。

---

## 六、L4 · 产品气质（最主观，但最决定"像谁"）

### 6.1 内嵌提示词人设（影响最大的一处文案）

`components/settings/panels/mediaModel/providerPrompt.ts` 内嵌一份**很长的中文提示词**
（`addCustomProviderDialog` 打包后命中 **19 处** `Toonflow`），内容是：
> "你是一位耐心的 Toonflow 媒体模型接入助手…我是完全不懂编程的普通用户…"

它还包含 `Toonflow → 设置 → 媒体模型 → 添加自定义供应商` 这类**指路文案**、
以及 `Toonflow 的接口类型约定`、`Toonflow 画布生成入口` 等术语。

**处置**：整段重写人设与术语（品牌名、路径指路、口头禅）。
这是**用户会真实读到的一大段文字**，且决定了 AI 助手的"性格"。

### 6.2 社区与运营入口（建议整体删除）

| 位置 | 内容 |
|---|---|
| `canvasControls.vue:141` | `Toonflow 需求/BUG反馈表`（外链表单） |
| `canvasControls.vue:196` | `Toonflow 是为爱发电的开源项目。欢迎文明交流、友善反馈…` |
| `about.vue` | 赞助商面板、交流群二维码、商务合作二维码、`api.toonflow.net` 外链 |
| `updateBox.vue` | 更新提示（文案已列 L1） |

### 6.3 语气与措辞

| 现状特征 | 建议 |
|---|---|
| `ui.vue:105`：`Toonflow 每一个灵感，都值得被看见` —— **营销口号** | 换成工具向表述，或删除该行 |
| `canvasControls.vue:196`：`为爱发电…请避免责问或命令式沟通` —— **开源社群语气** | 商业产品不该有这段（已建议删） |
| 大量"灵感""创作""漫剧"等词 | 若面向通用视频创作，可保留；若面向其他场景需统一术语 |
| `hello/index.vue` 描述已改为技术向：`所有密钥与请求都只留在本机` | 这是**去营销化**的方向，建议全站统一 |

### 6.4 默认配置与品牌一致性

| 项 | 现状 | 建议 |
|---|---|---|
| 默认主题色 | `#409eff` | 品牌色（L2.0） |
| 默认语言 | `language: "system"` | 保留 |
| 默认主题 | `light` | 保留（或随品牌定深色优先） |
| 应用名 / identifier / 协议 | `zhukai` / `local.zhukai.desktop` / `zhukai://` | ✅ 已改 |
| 自动更新地址 | `electrobun.config.ts` 的 `UPDATE_BASE_URL` | ⚠️ **发布前必须设值**（当前是占位仓库） |
| 数据目录 | `data/`（`TOONFLOW_DATA_DIR`） | 变量名保留（改了要动服务端多处，收益低） |

---

## 七、执行顺序与验收（可直接照着做）

| 步骤 | 内容 | 风险 | 验收方式 |
|---|---|---|---|
| **S1** | L1 文案清零（含 `plugin.author` 成对改） | 低 | 全局搜 `Toonflow` 在 `apps/web/src` 零命中；插件市场无多余开关 |
| **S2** | L2.0 视觉 token（品牌色 + 派生色 + 圆角 + 字体） | 低 | 明/暗两模式无 EP 蓝；按钮 hover 不闪蓝 |
| **S3** | L2.1 剥离 TF-Router（选定 A/B/C 方案） | **中**（删功能） | 搜 `toonflow.net` 零命中；DevTools 无对外请求 |
| **S4** | L3 视觉识别（背景动效 + 布局节奏 + favicon + 字体） | 中 | 首屏/首页截图对比；`prefers-reduced-motion` 仍生效 |
| **S5** | L4 气质（提示词人设 + 删社区入口 + 统一语气） | 低 | 通读所有面向用户的文案，无上游痕迹与开源社群语气 |
| **S6** | 出包验证 | 中 | 安装包 + 运行截图走查 |

### 每步之后的验证手段

- **dev 模式**（`apps/web/**`、`apps/server/**`）：改完 **HMR 即时可见**，`http://localhost:3000`
- **改 `packages/**` 后**：需**重启 dev server**（不被 watch）
- **每完成一层**：出一次安装包做端到端走查（因为 dev 模式下 `data/` 用仓库根目录，与安装后的数据目录不同）
- **回归重点**：插件市场（若做 B 方案）、设置面板、画布、Agent

---

## 八、风险与红线

| 红线 | 说明 |
|---|---|
| **MIT 署名不可删** | `LICENSE` 的 `Copyright (c) 2026 HBAI-Ltd` 必须保留。这不是"像不像"的问题 |
| **不要改插件宿主契约** | `window.toonflowNodes` / `toonflowNodeHost` / `toonflowTool*` 是插件协议；改了已发布插件全部失效 |
| **不要改磁盘数据标记** | `toonflowCanvas` / `toonflowAgent` 改了旧画布/会话打不开 |
| **`@toonflow/*` 包名建议保留** | 内部作用域，用户不可见；改了要同步 33 包 + lockfile + tsconfig，且丢掉上游可合并性 |
| **EP 派生色必须一起改** | 只改 `--el-color-primary` 会有"主色青、hover 蓝"的破绽 |
| **无障碍不能丢** | `prefers-reduced-motion`、`aria-label`、焦点可见性在改背景动效与布局时**必须保留** |
| **改 `packages/**` 要重启 dev** | 否则你会以为"改了没效果" |

---

## 九、工作量与优先级速览

| 层 | 内容 | 相对工作量 | 观感收益 |
|---|---|---|---|
| L1 | 文案清零（~11 文件 + 21 locale + author 成对改） | 小 | 中 |
| **L2.0** | **视觉 token（1–2 文件）** | **极小** | **极大** |
| L2.1 | TF-Router 剥离（~9 文件，含删功能） | 中 | 大 |
| L3 | 视觉识别（2 个 bg + 布局 + favicon + 字体） | 中 | **极大** |
| L4 | 气质（1 段长提示词 + 删社区 + 语气统一） | 小 | 中 |

> **最高杠杆是 L2.0**：改 1–2 个文件，全站观感变化最大。
> 其次是 L3 的两个背景组件——它们是"AI 味/上游味"的视觉来源。

---

## 十、诚实交代边界

- 本文的现状描述**全部来自源码实测**（文件、行号可核对）；
  **我没有在浏览器里逐页目视比对过**，所以"哪一处最像上游"的判断基于代码结构，不是视觉走查。
- 视觉方案的**具体配色/字体是示例**（`#0EA5A0` 深青），需你确认品牌方向后替换。
- L2.1 的 A/B/C 三方案**尚未决定**，选定后我才能给出精确的删除范围。
- 我**没有运行过上游 Toonflow 的成品**做视觉对照，"像不像"的最终判断需要你或用户的直观感受。
- 改动的**实际回归风险未经测试验证**——本项目上游**没有测试套件**（`AGENTS.md` 甚至禁止编写测试），
  所以每一步都应**出包做端到端走查**，而不是只靠 dev 模式看着对。
