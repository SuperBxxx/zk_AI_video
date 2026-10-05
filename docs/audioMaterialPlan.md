# 音频能力与素材库改造 · 实施计划

> 状态：**实施中**。本文描述做法；进度见下方「实施进度」。
>
> 已确认的决策来自用户明确要求，全部记录在 §2 与 §6；**本文已无待拍板项**。

## 实施进度

| 阶段 | 状态 | 提交 |
| --- | --- | --- |
| P0 独立素材库界面 | ✅ 完成 | `cb9cb13` |
| P1 APIMart 文本供应商 | ✅ 完成 | `52aec03` |
| P2 音频供应商（百炼 + APIMart TTS） | ✅ 完成 | `259182d`、`98f3ebe` |
| P3 语音模型面板 + 媒体面板按类型筛选 | ✅ 完成 | `a0cf6e1` |
| P4 素材库声音面板 | ✅ 完成 | `ffa4c1e`、`ab6592b`、`4e37c6a`、`8558cf0`、`4f709ba` |
| P5 给 agent 新增「素材库」工具 | ⬜ 未开始（设计已摸清，见下） | — |
| P6 打包与安装验证 | ⬜ 未开始 | — |

**P4 完成的细节**

- ✅ 媒体生成结果自动放到画布上（`ffa4c1e`）——配音没有节点 UI，靠它落到 `remote-audioNode`。
- ✅ 素材库上传能力（`ab6592b`）——原先只有 mkdir 与保存节点输出，没有上传。
- ✅ 服务端音色链路（`4e37c6a`）——供应商契约加 `createVoice`，百炼实现，接口
  `POST /api/ai/voices/create`。
- ✅ 浏览器端音频转 WAV（`8558cf0`）——解决 webm/opus 与百炼格式要求的冲突。
- ✅ 声音面板与音频生成入口（`4f709ba`）——素材库「素材/声音」分页、
  上传/录制样本、克隆、设计、试听、音色 json 落库；
  另把 `/api/ai/media/generate` 的 mediaType 扩到含 `audio`（此前音频只有
  agent 工具路径，没有 HTTP 入口，试听无法实现）。

**仍未验证**：没有真实百炼 API Key，因此「录音 → 克隆 → 试听 → 保存」的端到端
行为、`qwen-voice-enrollment` 的实际返回、MediaRecorder 真机行为、音色质量均未验证。

**P5 的准确设计（本轮已摸清代码链路，供下一轮直接实施）**

目标（D7/D10）：agent 能把素材库某个文件夹或指定素材导入画布，配音与素材不必手工搬运。

需要改 4 处：

1. **工具上下文要能看到素材库**。`ToolContext`（`packages/toolScaffold/src/runtime.ts:189`）
   目前只有 `cwd` / `files` / `canvas` / `media` / `question` / `skills` / `sdk`，
   而 `files` 经 `resolvePath` 被限制在工作区（`apps/server/src/agent/tools/index.ts:18-22`），
   够不到全局的 `{数据目录}/assets`。
   现成先例：同一处已允许 `readOnly` 时访问工作区之外的 `skillsDirectory`
   （`const root = readOnly && isWithin(skillsDirectory, absolute) ? skillsDirectory : cwd`），
   素材库照此加一个只读根即可，不必新造机制。

2. **新增工具包** `packages/tools/assetLibrary/`（名称待定），提供两个工具：
   · 列出素材库（可指定子文件夹）：返回相对路径、名称、类型、媒体种类；
   · 把素材放入画布：按媒体种类建 `remote-imageNode` / `remote-videoNode` /
     `remote-audioNode` 并调用对应 `node:set*`。
   放置逻辑与 `tools/mediaGeneration`、`tools/ffmpeg` 里已有的实现同构，
   可考虑是否抽公共函数（三处重复时再抽，先不抽）。
   注意：节点 setter 的 `path` 是**工作区相对路径**，而素材库在工作区之外，
   因此导入素材时必须先**复制到工作区**再建节点，否则 set 会因越界失败。
   这是 P5 最容易踩的坑。

3. **服务端装配**：`createAgentToolContext` 增加 `assets` 根（`u.assets.getAssetsDirectory()`），
   并让 `resolvePath` 在只读时也允许该根。

4. **工具分发机制（已确认无需额外处理）**：
   `listTools()` 读 `{数据目录}/tools`，`initializePlugins`
   （`apps/server/src/app.ts:39`）在启动时把 `build/tools` 复制过去并以
   `pluginRevision`（桌面端为 `apps/desktop/src/index.ts:121` 的 `hash`）判断是否重刷；
   开发环境 marker 为空、且无 revision，故每次启动都会同步，新增工具文件自动生效。
   只需保证新包被 `build:tools`（根 package.json 的 `--filter './packages/tools/*'`）覆盖。

**P4 进行中的细节**

- ✅ 已完成的前置：媒体生成结果自动放到画布上（`ffa4c1e`）。
  由于没有音频生成节点，配音生成后靠这个机制落到 `remote-audioNode`。
- ⬜ 待做，且**范围比原计划多一项**：素材库当前只有两个写操作
  （`POST /api/assets/mkdir` 与 `PUT /api/assets/save` 保存节点输出），
  **没有上传功能**。而声音面板必需上传样本与录制，
  因此 P4 需要先给素材库加上传能力。
  （服务端不必新增接口：`assets/save` 已用 `writeWorkspaceFile(..., exclusive=true)`
  按原始字节写入，前端补一个上传入口即可；注意 exclusive 表示不覆盖，重名需避让。）
- ⬜ 声音面板本体、音色创建（`voice-enrollment`）、声音设计、试听、音色 json 落库。

**P4 剩余部分的准确设计（本轮已探明，供下轮直接实施）**

1. **素材库上传已就绪**（`ab6592b`）：工具栏「上传素材」+ 隐藏 file input，落到当前文件夹，
   重名自动避让 `(1)(2)…`。服务端未改动。
2. **面板形态**：在 `assetLibrary.vue` 内加标签切换（「素材」/「声音」），
   而不是新建浮层——与 D1「加进现有素材库」一致。画布与首页两处入口自动同时获得。
3. **音色创建必须由前端提交字节**：`ProviderTools` 没有读取工作区文件的能力
   （只有 fetch / errorMessage / hash / image / audio.convert / ffmpeg），
   因此服务端拿不到样本文件内容。做法：前端用 `/api/assets/read` 读成 Blob，
   转成 `MediaInput`（`{ type: "base64", data: data URL, mimeType }`）随请求提交。
4. **服务端可复用既有解析**：`apps/server/src/utils/media/generation.ts:141-149` 已有
   `getMediaProvider(providerId)` → 校验 model → 读 `settings.mediaProviderConfigs` →
   `loadMediaProviderSource(...)` → 校验 apiKey 的完整流程。
   新增音色接口应沿用同一套，不要另写一份。
5. **供应商契约需要扩一个可选方法**（与 `generateImage/generateVideo/generateAudio` 并列）：
   建议 `createVoice?(request): Promise<{ voice: string }>`，由 generation.ts 在
   `mediaType === "audio"` 且 operation 为建音色时调用。百炼实现里区分两条路径：
   · `model: "voice-enrollment"` + `input.action: "create_voice"`，样本走 **`input.url`（公网 URL）**；
   · `model: "qwen-voice-enrollment"` + `input.action: "create"`，样本走 **`input.audio.data`（Base64）**。
   本产品无法提供公网托管，故**只走后者**（详见 §1.6 与 §3 P2 的设计影响 2）。
   `target_model` 必须与后续合成模型一致；音色 json 需记录它。
6. **录音**：按 D11 不选设备（系统默认麦克风）、限 30 秒。
   ✅ **格式问题已解决**（`8558cf0`）：浏览器 `MediaRecorder` 默认输出 webm/opus，
   而百炼要 `audio/wav|mpeg|mp4`；服务端的 `convertAudio` 只吃 WAV 输入
   （`audioProcessor.ts` 明确不解码压缩格式），帮不上忙。
   已改为**在浏览器端转码**：`apps/web/src/lib/audioWav.ts` 用
   `AudioContext.decodeAudioData` 解码后手工封装 16 位 PCM WAV，不依赖 ffmpeg、不引新依赖。
   录音流程因此为：录制 → 转 WAV → 存入素材库 → 克隆时读出转 base64 提交。
7. **音色落库**：按 D3 在素材库建「声音」文件夹，存
   `{ 名称, voiceId, targetModel, 来源(克隆/设计), 创建时间 }` 的 json。
   写入复用 `PUT /api/assets/save`（注意 exclusive 不覆盖，需避让重名）。

---

## 0. 目标

让「住凯AI视频」具备完整的**音频生成链路**，并把它接入已有的素材库与画布：

1. 新增 **APIMart 文本供应商**（OpenAI 兼容网关，含 GPT-5 / Claude / Gemini）
2. 新增 **百炼音频供应商**（TTS / 声音复刻 / 声音设计）
3. 同时支持 **APIMart 的 TTS**（其文档含 `POST TTS 文字转语音`）
4. 设置里新增 **TTS 模型**面板，可分别选择用哪家、哪个模型
5. 素材库里新增**声音面板**：上传/录制样本 → 克隆或设计音色 → 试听 → 保存
6. 克隆出的音色以 **json 素材**形式落在素材库的「声音」文件夹
7. 画布里只要求 agent 导入素材库某个文件夹或指定素材，即可使用

---

## 1. 现状核实（已逐项验证，非推测）

### 1.1 素材库已经存在，且**数据本来就是全局的**

| 项 | 实际情况 |
| --- | --- |
| 组件 | `apps/web/src/pages/workspace/panels/canvas/components/assetLibrary.vue`（503 行） |
| 形态 | **画布上的浮层卡片**，不是独立页面 |
| 入口 | **画布左下角工具栏的文件夹图标**（`canvasControls.vue:13-23`，`icon-folders`） |
| 可见性状态 | `assetsVisible`，由 `pages/workspace/panels/canvas/index.vue` 持有 |
| 宽度/高度 | 约 300px 宽，滚动区最高 `min(440px, calc(100dvh - 198px))` |
| 已有能力 | 搜索、新建文件夹、树形浏览、重命名/删除、**图片/音频/视频预览**、保存节点输出进来、拖拽 |
| 服务端接口 | `routes/assets/` 下 6 个：`list` / `mkdir` / `read` / `remove` / `rename` / `save` |

**关键：这 6 个接口全部以 `u.assets.getAssetsDirectory()` 为根，没有任何一个接受项目目录。**

```
getAssetsDirectory() = join(dirname(conf.path), "assets")   // apps/server/src/utils/assets/index.ts
```

| | 位置 |
| --- | --- |
| **素材库** | `{数据目录}/assets` —— **全局**，与项目无关 |
| 项目作品 | 用户自选的空文件夹 —— 每个项目各不相同 |

**结论**：素材库的数据层**本来就是全局的，服务端一个字节都不用改**。
现在"不开项目就用不到素材库"，**纯粹是前端入口问题**——`assetLibrary.vue` 只挂在画布里。

> `assetLibrary.vue` 的 `directory` prop 仅用于保存位置的显示文字，不构成项目依赖。
> 另 `apps/server/src/agent/runtime/mentions.ts:82` 已有 `globalAsset` 概念
> （`const root = globalAsset ? await getAssetsDirectory() : cwd`），说明"全局素材"是既有设计。

### 1.2 设置面板可直接扩展

`components/settings/index.vue` 的 `settingsPanels` 是一个数组，加一项即可：

```ts
const settingsPanels = [
  { id: "languageModel", label: "文本模型", ... },
  { id: "mediaModel",    label: "媒体模型", ... },
  { id: "ffmpeg",        label: "FFmpeg",   ... },
  { id: "about",         label: "关于",      ... },
];
```

**「语音模型」面板将作为第三个模型面板插入**（与「文本模型」「媒体模型」平级）。

### 1.3 音频链路：框架支持，但缺三样东西

| 环节 | 状态 |
| --- | --- |
| `ModelType` 含 `"audio"` | ✅ `packages/providers/types.d.ts:3` |
| `generateAudio` 工具 | ✅ `packages/tools/mediaGeneration` 已注册 |
| 服务端音频落盘（远程 URL → 工作区文件） | ✅ `apps/server/src/utils/media/generation.ts:82` `downloadAsset` + `assetBytes` |
| **音频供应商（`generateAudio` 实现）** | ❌ **全仓库 0 处** |
| **音频生成节点（UI 载体）** | ❌ 无（`audioNode` 只有"上传/替换音频"） |
| **服务端 TTS / 音频路由** | ❌ **0 个**（已确认无 `tts`/`audio`/`speech`/`voice` 路由） |

### 1.4 口型链路已验证可用

| 环节 | 证据 |
| --- | --- |
| 视频节点收集音频引用 | `videoGenerationNode/index.vue:287` `audios: refList.flatMap(AUDIO → {path, mimeType})` |
| 模型声明支持音频参考 | `apiMart.ts:149` 等 `mode: [..., ["imageReference:9", "videoReference:3", "audioReference:3"]]` |
| 供应商把音频发出去 | `apiMart.ts:259` `audioUrls`；`meta.ts:97` `role: "reference_audio"` |

**含义**：配音是作为 **`reference_audio` 交给视频模型**，由模型在生成时对齐口型 —— **不是后期拼接**。

> ⚠️ 链路可达 ≠ 口型一定准。**准确性是模型能力问题，必须拿到 API Key 后真机验证。**

### 1.5 既有约束（会限制交互设计）

- `audioNode` **只有 `audio` 输出端口、没有 target**：画布上无法把「文本 → 配音」连起来。
- `audioNode` 与 `videoNode` 都是**素材载体**，只能 `setAudio` / `setVideo`，本身不生成。

### 1.6 APIMart 文档要点（用户提供）

| 项 | 内容 |
| --- | --- |
| Base URL | **`https://api.apimart.ai/v1`**，OpenAI 完全兼容（SDK 只改 base_url） |
| 文本协议 | `openai-completions` ✅ 与本仓库支持的协议完全匹配 |
| 文本模型 | GPT-5、GPT-4o / 4o Mini、Claude Sonnet 4.5 / Haiku 4.5、Gemini 2.0 Flash 等 |
| **音频系列** | **`POST TTS 文字转语音`**、`POST Whisper-1 音频转录` |
| 语音能力范围 | 文档只提「TTS：多种音色」，**未提声音克隆 / 声音设计** |
| 国内接入域名 | `https://api.apib.ai/v1`（`isOverseas = 1`） |

---

## 2. 已确认的产品决策

| # | 决策 | 用户原话要点 |
| --- | --- | --- |
| D1 | 声音面板**加进现有素材库** | 「加进现有素材库」 |
| D2 | 样本来源**两者都要**，并**增加录制按钮** | 「(c) 两者都要，同时需要有一个录制声音按钮，允许用户录制声音并作为样本上传」 |
| D3 | 克隆音色存为**素材库「声音」文件夹里的 json**（含音色 ID + 名称） | 「(b) 在素材库里建一个"声音"文件夹，把音色 ID + 名称写成一个 json」 |
| D4 | **声音克隆与声音设计都做** | 「(c) 两个都做」 |
| D5 | **同时支持 APIMart 的 TTS** | 「同时支持 APIMart 的 TTS」 |
| D6 | **设置里新增语音模型面板**，与文本/媒体**并列**（第三个模型面板），命名「**语音模型**」 | Q1：命名答「语音模型」，位置答 (a) 并列 |
| D7 | 画布使用方式：**agent 导入素材库文件夹或指定素材** | 「只需要要求agent导入某个素材库文件夹的内容，或者指定内容，就可以在画布中使用这些内容」 |
| D8 | **新增独立的素材库界面**，入口放**首页顶栏** | 「可以新增一个素材库界面吗？这样可以在没有打开任何项目的时候新建文件夹，上传，生成内容等」＋ 答 (a) 首页顶栏加按钮 |
| D9 | 供应商**全局共享，按类型筛选** | Q2 答：全局共享按类型筛选 |
| D10 | 给 agent **新增一个「素材库」工具** | Q3 答：新增一个「素材库」工具 |
| D11 | 录音**不选设备、限制 30 秒** | Q4 答：不用选设备，限 30 秒 |
| D12 | **先不打包**，全部完成后再打包 | Q5 答：先不打包，完成了再打包 |

---

## 3. 阶段划分与实施内容

> 顺序：**P0 → P1 → P2 → P3 → P4 → P5 → P6**。P0/P1 最小、可立即验证；P3 之后有真实前置依赖。

### P0 · 独立素材库界面（入口在首页顶栏）

**为什么需要**：素材库数据本来就是全局的（见 §1.1），但组件只挂在画布里，不开项目就用不到。
新建文件夹、上传素材、生成内容这些操作**本来就不需要项目**。

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `apps/web/src/components/assetLibrary/`（或复用现有组件） | 抽出可脱离画布使用的素材库界面 |
| `apps/web/src/pages/home/index.vue` | 顶栏加「素材库」按钮，打开浮层 |
| `pages/workspace/panels/canvas/components/assetLibrary.vue` | 改为复用抽出的实现，避免两份 |

**要点**

- **服务端零改动**：6 个 assets 接口已全部基于全局根
- 需要与画布解耦的部分：`saveNodeToAssets`（保存节点输出）在首页场景下不存在，需可选化
- 复用时注意画布场景特有的能力（拖拽到画布、保存节点输出）在首页场景应隐藏或禁用
- **这是 P4 声音面板的挂载点**，所以排在 P4 之前

**验证**：不打开任何项目，首页点「素材库」→ 能新建文件夹、上传文件、看到已生成的内容；画布内的素材库仍照常工作。

### P1 · APIMart 文本供应商（最小，可立即做）

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `packages/providers/src/language/apiMart.ts` | 新增，仿 `deepSeek.ts`（约 12 行） |
| `packages/providers/index.ts` | `languageProviders` 注册 `apiMart` |

**要点**

- `apiUrl: "https://api.apimart.ai/v1"`，`protocol: "openai-completions"`
- `models: []`：与 `deepSeek` 一致，**填了 API Key 后由界面自动拉取模型列表**，不硬编码
- 需提供 `isOverseas` 切换（国内 `api.apib.ai/v1`）——与 `media/apiMart.ts` 的 rules 保持一致的用户体验

**验证**：`apps/web` typecheck 不新增错误；构建通过；产物含 `apiMart`；界面「添加供应商」列表出现 APIMart，填 Key 后能拉到模型。

---

### P2 · 音频供应商：百炼 + APIMart TTS

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `packages/providers/src/media/bailian.ts` | 新增：`audio` 类型模型 + `generateAudio` |
| `packages/providers/src/media/apiMart.ts` | 扩展：加 `audio` 类型模型 + `generateAudio`（走其 TTS 端点） |
| `packages/providers/index.ts` | 注册 `bailian` |

**百炼音频模型（按用户要求，在设置里可选）**

| 模型 ID | 标准合成 | 声音复刻 | 声音设计 | 指令控制 |
| --- | --- | --- | --- | --- |
| `qwen-audio-3.0-tts-plus` | ✅ | ✅ | ✅ | ✅ |
| `cosyvoice-v3.5-plus` | ✅ | ✅ | ✅ | ✅ |
| `qwen3-tts-flash` | ✅ | — | — | — |

> 建议默认 `qwen-audio-3.0-tts-plus`：四个能力全覆盖。

**要点**

- 接入方式用 **HTTP 非实时**（有声音合成需求即可，WebSocket 流式非必需）
- 返回 `{ mediaType: "audio", type: "url", url }`，服务端既有 `downloadAsset` 会自动落盘到 `outputDirectory`
- `rules` 增加**可选 `voiceId`**（音色 ID），用于克隆后的合成
- 声音复刻需先调 `voice-enrollment` 注册音色，见 P4

**已核实的百炼接口规格**（来源：官方《声音复刻 HTTP API 参考》）

音色创建端点（Qwen-Audio-TTS / CosyVoice / Qwen-TTS 共用）：

```
POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization
POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/customization
```

> 旧域名 `dashscope.aliyuncs.com` 仍可用（MiniMax 系列**只**支持旧域名）。
> `{WorkspaceId}` 为业务空间 ID。**这意味着 baseUrl 需要可配置**，不能硬编码。

请求体（两种复刻路径差异很大，**这是 P4 的关键设计点**）：

| | Qwen-Audio-TTS / CosyVoice | Qwen-TTS |
| --- | --- | --- |
| `model` | `voice-enrollment` | `qwen-voice-enrollment` |
| `input.action` | `create_voice` | `create` |
| **样本提交方式** | **`input.url`：公网可访问的音频 URL** | **`input.audio.data`：Data URL（Base64）** |
| 支持的音频格式 | 未在本文标注 | `audio/wav`、`audio/mpeg`、`audio/mp4` |
| 音色命名 | `prefix`（≤10 位，仅字母数字） | `preferred_name`（≤16 位，字母数字下划线） |
| 可选辅助 | `language_hints[]`、`max_prompt_audio_length`(3–30s，默认 10)、`enable_preprocess`、`enable_volume_normalization` | `text`（样本对应文本，提升效果）、`language` |
| 返回音色 ID | `output.voice_id` | `output.voice` |
| 额外返回 | — | `fallback_mode` / `fallback_reason`（音频质量差时降级） |

**⚠️ 由此产生的三个设计影响（重要）**

1. **`target_model` 必须与后续合成用的模型一致**，否则合成失败。
   → P3 的「TTS 模型」选择会**决定音色可用性**；音色 json 里必须记录 `targetModel`。

2. **CosyVoice / Qwen-Audio-TTS 的复刻要求样本是公网 URL**，而用户的样本是**本地文件或现场录音**。
   这直接影响 D2（上传 + 录制）的实现：
   - 方案 A：改用 **Qwen-TTS 路径**（`qwen-voice-enrollment`），它**支持 Base64**，本地文件可直接用
   - 方案 B：走 CosyVoice 路径，则需要先把样本上传到某个可公网访问的地方 —— **本产品没有这样的托管服务**，不可行
   → **P4 应优先走 Qwen-TTS 的 Base64 路径**（`qwen3-tts-vc-*` 系列），
     或核实 Qwen-Audio-TTS 是否也支持 Base64（本文档只写了 `url`）。

3. **Base64 有体积上限的现实风险**：录制的原始音频可能较大。
   → 需要限制时长（见 §6 Q4），必要时**先用 `ffmpeg` 工具转码/裁剪**再提交。

**仍待核实**

- 语音**合成**端点（把文本 + 音色 ID 变成音频的接口）的完整路径与请求体 —— 抓取失败，未取得
- 音色列表 / 详情 / 更新 / 删除接口的请求体（文档有，本次未抓全）
- MiniMax 系列走另一套端点（`/api/v1/services/aigc/multimodal-generation/generation`，
  `action: voice_clone`，音频需 mp3/m4a/wav、10 秒–5 分钟、≤20MB），且**不支持查询音色列表**

**验证**：typecheck / 构建通过；`listMediaModels` 能列出 audio 模型；拿 API Key 后真机合成一段音频并确认文件落盘。

---

### P3 · 设置里的「语音模型」面板

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `components/settings/panels/voiceModel/index.vue` | 新增面板 |
| `components/settings/index.vue` | `settingsPanels` 插入一项（与文本/媒体并列） |
| `components/settings/panels/mediaModel/index.vue` | 改为**按模型类型筛选**展示（音频类模型不再出现在媒体面板） |

**要点**

- 复用 `mediaModel` 面板的成熟组件（`editProviderDialog.vue`、`modelEditorDialog.vue`）
- 按 D9：供应商仍**全局注册**，两个面板各自按模型 `type` 筛选展示，不给供应商加类别标记
- 面板职责：选择**哪家供应商 + 哪个语音模型 + 默认音色 ID**
- 该选择存进设置，供 P4 的声音面板与 `generateAudio` 使用

**验证**：面板可打开、可选择并保存；重开应用后选择保留；媒体模型面板不再列出音频模型。

---

### P4 · 素材库「声音」面板

**这是工作量最大的一块。**

**产出文件（示意，实施时再定稿）**

| 文件 | 动作 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/components/voicePanel.vue` | 新增：声音面板 |
| `assetLibrary.vue` | 加一个「声音」入口/标签 |
| `apps/server/src/routes/audio/*.ts` | 新增：音色注册、TTS、声音设计接口（**当前 0 个，全新**） |

**功能（按 D2 / D3 / D4）**

1. **样本来源**
   - 从**素材库已有音频**选择
   - **现场上传**文件
   - **录制声音**（`MediaRecorder` / `getUserMedia`）→ 录完作为样本上传
2. **声音克隆**：把样本提交百炼 `voice-enrollment` → 得到**音色 ID**
3. **声音设计**：输入文字描述（如「温暖的低音女声」）→ 得到**音色 ID**
4. **试听**：用得到的音色合成一小段，直接在面板里播放
5. **保存**：在素材库建「声音」文件夹，把 `{ 名称, 音色 ID, 来源(克隆/设计), 创建时间 }` 写成 **json 素材**
6. **管理**：列出已有音色、可重命名/删除

**注意**

- 百炼**合成端点**（文本 + 音色 ID → 音频）尚未取得，**这是 P2/P4 的硬前置**，动工前必须先确认
- 百炼**音色创建**端点已核实（见 P2）。关键分歧：CosyVoice 路径要公网 URL（本产品无法提供），
  **应走 Qwen-TTS 的 Base64 路径**
- 录制需要 HTTPS 或 localhost；桌面端是 `http://127.0.0.1:<随机端口>`，属安全上下文，**可以录制**
- 浏览器录制的格式（多为 webm/opus）**大概率需要先用 `ffmpeg` 工具转成 wav/mp3** 才能提交复刻
- 需限制样本时长（**D11：不选设备，限 30 秒**）；克隆样本通常 10 秒左右足够（百炼 `max_prompt_audio_length` 默认 10 秒、上限 30 秒）

**验证**：录制一段声音 → 克隆得到音色 ID → 试听 → 保存 → 素材库出现「声音」文件夹与 json。

---

### P5 · 画布使用：agent 导入素材库内容（D7）

**要点**

- 让 agent 能：列出素材库、按文件夹或指定素材导入到画布
- 音频素材 → 生成 `audioNode` 并 `setAudio`；图片 → `imageNode` + `setImage`；视频 → `videoNode` + `setVideo`
- **复用已有机制**：`canvasHost.vue` 的 `provide` 注入、以及本次为 FFmpeg/视频生成写的「产出后自动上画布」实现
- 按 D10：**新增一个「素材库」工具**（list / 按文件夹取出 / 按名称取出），不复用文件工具直读

**验证**：对 agent 说「把素材库/声音 里的素材放到画布」，确认节点出现且内容正确。

---

### P6 · 打包与安装验证

- 重新打包（注意：`RequestExecutionLevel admin`、TEMP 需在 E 盘等既有经验）
- 安装后验证：首页素材库入口、语音模型面板、声音面板、克隆/设计、agent 导入全部可用

---

## 4. 依赖关系

```
P0（独立素材库界面）    ── 服务端零改动，纯前端解耦；是 P4 的挂载点
P1（APIMart 文本供应商） ── 独立，可先做
P2（音频供应商）        ── 必需前置：没有 generateAudio，P4 无东西可调
P3（语音模型面板）      ── 依赖 P2 提供的模型清单
P4（素材库声音面板）    ── 依赖 P0 + P2 + P3
P5（素材库工具给 agent） ── 依赖 P1~P4，可独立于 P4 先做素材导入部分
P6（打包）              ── 依赖全部
```

---

## 5. 风险与已如实标注的不确定项

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 口型对准精度 | ⚠️ **未验证** | 链路已确认可达；实际对准效果需真机验证，我无法保证 |
| 百炼 `voice-enrollment` 接口结构 | ✅ **已核实** | 端点、请求体、返回体均已取得，见 P2；但**合成端点仍未取得** |
| **复刻样本必须是公网 URL（CosyVoice 路径）** | 🔴 **设计约束** | `voice-enrollment` 的 `input.url` 要求公网可访问，而用户样本是本地文件/录音。**应改走支持 Base64 的 Qwen-TTS 路径**（方案见 P2 设计影响 2） |
| `target_model` 与合成模型必须一致 | 🔴 **设计约束** | 音色 json 必须记录 `targetModel`；P3 的模型选择会决定已有音色能否使用 |
| 录制音频格式兼容性 | ⚠️ **未核实** | Qwen-TTS 路径支持 `audio/wav`/`mpeg`/`mp4`，而浏览器 `MediaRecorder` 默认多为 webm/opus。**很可能需要先用 ffmpeg 转码** |
| 录制样本体积 | ⚠️ **风险** | Base64 提交有体积上限风险，需限制时长并可能先裁剪 |
| 百炼语音**合成**端点 | ⚠️ **未核实** | 抓取失败，未取得路径与请求体。**P2 实施前必须先确认** |
| APIMart TTS 端点路径与参数 | ⚠️ **未核实** | 文档目录只列出「POST TTS 文字转语音」，未读其具体请求格式 |
| APIMart 是否支持声音克隆 | ❌ **文档未提** | 只有「多种音色的 TTS」，克隆/设计应由百炼承担 |
| 音频生成节点（UI 载体） | 决定**不做** | 按用户选择「不做节点，agent 生成后自动上画布」 |

---

## 6. 决策记录（原待确认项，均已拍板）

| 原问题 | 结论 |
| --- | --- |
| Q1 · 语音面板位置与命名 | **并列**为第三个模型面板，命名「**语音模型**」 |
| Q2 · 供应商在面板间如何区分 | **全局共享，按类型筛选**（供应商仍是全局注册，「媒体模型」「语音模型」面板各按模型 `type` 筛选展示） |
| Q3 · agent 如何获取素材库内容 | **新增一个「素材库」工具**（不复用文件工具直读） |
| Q4 · 录音边界 | **不选设备**（用系统默认麦克风）、**限制 30 秒** |
| Q5 · 是否先打包 | **先不打包**，全部完成后再打包 |
| 追加 · 是否新增独立素材库界面 | **要**，入口在**首页顶栏**加按钮打开浮层 |

**已无待确认项，可以开始实施。**

---

## 7. 当前待打包的既有改动（与本计划无关，但会一起进包）

| # | 改动 | 提交 |
| --- | --- | --- |
| 1 | Markdown `defaultOrigin`（修「已拦截」） | `8a7d234` |
| 2 | FFmpeg 输出自动上画布 | `161557f` |
| 3 | 视频生成完自动上画布 + 唤醒 agent | `e6715f9` |
| 4 | 安装包 `RequestExecutionLevel admin` + README | `25f0d4e` |
| 5 | 四个创作模式展开（含预置提示词） | `4d738a7` |
| 6 | Seedance 口播路由修复 | `c1b1c81` |
| 7 | 恢复 APIMart 媒体供应商（已去返利与上游痕迹） | `26f3b7e` |

---

## 8. 附：关键文件索引

| 用途 | 路径 |
| --- | --- |
| 素材库组件 | `apps/web/src/pages/workspace/panels/canvas/components/assetLibrary.vue` |
| 素材库入口 | `apps/web/src/pages/workspace/panels/canvas/components/canvasControls.vue` |
| 素材服务端接口 | `apps/server/src/routes/assets/` |
| 设置面板注册 | `apps/web/src/components/settings/index.vue` |
| 媒体模型面板（可复用） | `apps/web/src/components/settings/panels/mediaModel/` |
| 供应商类型定义 | `packages/providers/types.d.ts` |
| 供应商注册 | `packages/providers/index.ts` |
| 媒体供应商样例 | `packages/providers/src/media/meta.ts`（TTS 可仿此结构） |
| 语言供应商样例 | `packages/providers/src/language/deepSeek.ts` |
| 媒体生成工具 | `packages/tools/mediaGeneration/src/index.ts` |
| 服务端媒体落盘 | `apps/server/src/utils/media/generation.ts` |
| 自动上画布机制 | `packages/nodeScaffold/src/nodeEvent.ts` `useCanvasOutput()` |
| 画布注入 | `apps/web/src/pages/workspace/panels/canvas/canvasHost.vue` |
