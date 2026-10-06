# 创作能力升级 · 实施计划

> 状态：**计划中，尚未实施**。本文只描述打算怎么做。
>
> 来源：对 `E:\ai_video\video-shotcraft-main`（Apache-2.0）与
> `E:\ai_video\video-talkcraft-main`（PolyForm Noncommercial）的系统阅读。
> 许可边界见 §7，**不可越界**。

---

## 0. 目标与一个前置澄清

### 0.1 目标

把我们的创作链路从「agent 现编提示词 → 出片」升级为
**「有词汇库与规范 → 机器给候选 → agent 决策 → 机器闸与独立评审把关 → 可预览可微调」**。

### 0.2 前置澄清：现在**不会**自动选卡

核实结论（改动前的事实）：

| 项 | 现状 |
| --- | --- |
| 配方卡 / 镜头卡 | **不存在**（`packages/skills/**` 零处提及） |
| 字幕 / 动效 / 音效能力 | **完全没有**（无 caption/sfx/motion 相关包） |
| 模型选择 | 用户下拉，或 agent 按 `listMediaModels` 挑 |
| 画幅 / 时长 | 仅默认值（`data.ratio ??= "9:16"`、`resolution` 默认空） |

**即使改造后，选卡也不是全自动**：参考实现的正确分工是
「`card_match` **出候选**（含排序理由与落选理由）→ **agent 决策**并写「选卡行」→
`preflight` **对账**」。选候选之外的卡必须写一行
`- 语义偏离：<语义> ← 理由（≥4 字）`，闸门认这行放行。

**这条分工是本计划的设计基调**：机器负责枚举与核验，agent 负责判断。

---

## 1. 现状核实（已逐项验证）

### 1.1 我们有什么

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 画布节点 | `packages/nodes/`：text / image / video / audio / imageGeneration / videoGeneration / director3d | 有 |
| 节点函数 | `node:setText` / `setImage` / `setVideo` / `setAudio` | 有 |
| FFmpeg | `packages/tools/ffmpeg`：`ffprobe` + `ffmpeg`（`steps` 原样透传链式方法，支持任意滤镜） | 有，**够用来烧字幕** |
| 音频转换 | `apps/server/src/utils/media/audioProcessor.ts`：**只吃 WAV 输入**，可出 WAV/MP3 | 有，够用来预剪 |
| 媒体生成 | `packages/tools/mediaGeneration`：generateImage/Video/**Audio** + 自动上画布 | 有 |
| 素材库 | `data/assets`（全局）+ 上传 + 声音面板 | 有 |
| 技能 | `packages/skills/{canvas,workflow}` 两个 | 有 |

### 1.2 我们没有什么（本计划要补的）

- **字级时间戳 / 强制对齐** → 做不出网感字幕
- **字幕生成与烧录**（能力有、封装无）
- **声音设计**（BGM / SFX / 卡点）
- **配方卡库与语义选卡**
- **机器闸**（除 `scripts/checkModes.mjs` 外几乎为零）
- **独立评审**流程
- **排版 / 反 PPT 规范**
- **成片预览**（现在只能在聊天里看链接）

### 1.3 硬约束（决定怎么落地）

| 她们的实现 | 我们的约束 | 结论 |
| --- | --- | --- |
| 30+ Python 脚本 | **零 Python**；`build/server/index.js` 是 16.8 MB 单体 bundle | 闸要 **TS 实现**或走 **ffmpeg** |
| Remotion（React） | Vue + FFmpeg | 卡**代码**搬不过来，**只借元数据设计** |
| `librosa` 节拍分析 | 无 Python | 需 TS 方案或降级 |
| `opencv` + YuNet 人脸 | 无 opencv | 需另找轻量方案或暂缓 |
| `ffmpeg freezedetect` | **我们也有 ffmpeg** | ✅ **可直接照做** |
| AAC encoder priming ≈1.28f | 我们也用 AAC | ⚠️ **直接适用** |

---

## 2. 借鉴来源清单（读了什么）

| 来源 | 内容 | 用处 |
| --- | --- | --- |
| talkcraft `SKILL.md`（497 行） | 八阶段流程、六条机器闸、三重验收 | 流程骨架 |
| talkcraft `cinematography.md` | 反 PPT 四病根、七层模型、层预算、六式转场、SHOTBOOK 格式、排版预算 9 条、工程铁律 15 条 | P4 |
| talkcraft `layout.md` | 12 栏栅格、间距令牌、字阶、校验九项、并列句七式 | P4 |
| talkcraft `shot-design.md` | 三面分层工作单、七型镜头预设、多素材关系表、单 B-roll 七式 | P4 |
| talkcraft `semantic-annotation.md` | 26 词封闭词表、`weight` 主/陪衬、覆盖闸 | P2 |
| talkcraft `review-protocol.md` | 五件套材料、P0/P1/P2、增量落盘、派发原语表 | P3 |
| talkcraft `timestamps_cpu.py` 文档头 | 对齐算法与四配置精度实测 | P1 |
| shotcraft `pipeline.md` | 八阶段、品牌→动效参数表、素材采集三件套 | P0/P4 |
| shotcraft `sound-design.md`（27 KB） | 声音词汇、16 类目录、音量是乘法系数、AAC priming 偏移 | **P5** |
| shotcraft `music-beat-sync.md` | 网格最小二乘拟合、鼓点三分类、渲后回测 | P5 |
| shotcraft `final-review.md` | P/F/V/S/B/D/A/Q 八类检查项与报告格式 | P3 |
| shotcraft `aesthetic-rules.md` | R/Q/S/C/P 判例式准则（含 5% 帧高可读线） | P4 |
| shotcraft `Caption.tsx` | 字幕 8 帧入 / 8 帧出 | P1 |
| shotcraft `PageCam.tsx` | 2.5D 页面相机、CSS zoom 布局级缩放 | P6（可选） |

---

## 3. 阶段划分

> 顺序：**P0 → P1 → P2 → P3 → P4 → P5 → P6**。
> **P0/P1 可立即做且收益最大**；P2 依赖 P1；P5（声音）与 P1/P2 并行也可。

---

### P0 · 开工断言（最小成本、防已踩的坑）

**为什么排第一**：参考实现的原话是
「答案在文档里，但没人强制在正确的时刻去查 —— 所以不补文档，把它们做成开工前必跑的断言」。
我们**已经踩过 3 次同类坑**，这条直接命中。

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `scripts/preflight.mjs` | 新增；扩展现有 `scripts/checkModes.mjs` |
| `package.json` | 加 `"preflight": "bun scripts/preflight.mjs"` |

**断言清单**

| # | 断言 | 依据 |
| --- | --- | --- |
| 1 | 节点 setter 的 `path` 必须在工作区内 | 素材库路径传 `setVideo` 越界失败 |
| 2 | 提交供应商的媒体格式在白名单内 | webm/opus 提交百炼失败 |
| 3 | `build/**` 的文件必须都在 `data/**` | `initialized` marker 阻断工具同步 |
| 4 | 预置画布端口与节点声明一致 | 已有（`checkModes.mjs`） |
| 5 | 21 个 locale 的 key 集一致 | 已有基础 |
| 6 | `packages/skills` 与 `data/skills` 版本一致 | 刚发现：workflow 源码 v2.8.0 / 已安装 v2.7.0 |

**验证**：`bun run preflight` 全绿；**故意造一个违例**（如改一个 locale 的 key）能被抓出并指名文件行。

---

### P1 · 字级时间戳 → 字幕（能力分水岭）

**为什么**：**没有时间戳就做不出网感字幕**；这是"能出片"到"像样"的分界。

#### P1a · 先探"便宜路径" → ✅ 已完成，路径成立

**实测结论（2026-10-06，真实 API Key）**

| 探测 | 结果 |
| --- | --- |
| `qwen3-tts-flash`（TTS） | ❌ 只返回音频 URL，**无时间戳** |
| `qwen3-asr-flash` 系列（同步 ASR，`audio` 写法） | ❌ 只有纯文本，**无时间戳** |
| 换 5 组参数（`enable_timestamp` / `enable_words` / `result_format` / `timestamp_granularities` / `timestamp`） | ❌ 全部 200 但只有纯文本 |
| `qwen3-tts-flash-realtime`（WebSocket） | ❌ 事件里无任何时间/对齐事件 |
| **`qwen-audio-3.0-asr-flash`（同步 ASR，`input_audio` 写法）** | ✅ **返回字级时间戳** |

**可用调用形态**（已跑通两次）

```
POST {baseUrl}/services/aigc/multimodal-generation/generation
Headers: Authorization: Bearer <key>、Content-Type: application/json、X-DashScope-SSE: disable

{ "model": "qwen-audio-3.0-asr-flash",
  "input": { "messages": [ { "role": "user", "content": [
      { "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,..." } } ] } ] },
  "parameters": { "format": "wav", "sample_rate": "24000" } }
```

**返回**（毫秒，字/词组级）

```json
{ "sentence": { "begin_time": 160, "end_time": 10480, "text": "…",
    "words": [ { "begin_time": 160, "end_time": 560, "text": "去年", "punctuation": "" },
               { "begin_time": 1680, "end_time": 2160, "text": "3000", "punctuation": "" } ] },
  "text": "…", "request_id": "…" }
```

**四个关键判定**

| 判定 | 结论 |
| --- | --- |
| 需要公网托管吗 | ✅ **不需要** —— base64 Data URL 直传（解决了最大落地障碍） |
| 时间戳粒度 | ✅ **毫秒级、成词切分**（实测「我们的」「关键点」，非逐字） |
| 需要新依赖 / 本地模型吗 | ✅ **不需要** —— 纯 HTTP，无 Python、无 whisper.cpp |
| 成本 | 一次请求；`usage` 返回 `seconds` / `audio_tokens` |

**三个必须处理的坑（实测暴露）**

1. **ASR 输出与口播稿不一致**：`三千`→`3000`、`十九万`→`19万`。
   → **这正是参考实现用「数字转中文读法」当匹配键的原因**，我们做对齐时必须同样归一化。
2. **不自动按标点分句**：返回**单个 `sentence` 对象**，`words[]` 里带 `punctuation` 字段。
   → 分句要自己按 `punctuation` 与词间空隙切（空隙 > 0.3s 即气口）。
3. **碎片化**：`19万` 被切成 `1` + `9` + `万` 三个 token → 需合并短 token。

#### P1b · 对齐与清洗（工作量大幅缩小）

**原计划的重型后端选型问题被消解** —— 不需要 `whisper.cpp`、不需要 WASM/ONNX、
不需要按需下载重能力。`qwen-audio-3.0-asr-flash` 已给出词级时间表，
我们只需实现**把词表对齐到口播稿**的纯算法。

| 环节 | 做法 |
| --- | --- |
| 归一化 | 数字 → 中文读法；繁简归一；**无声调拼音**（同音字不算错） |
| 对齐 | 字符级序列对齐，把 ASR 词表映射到口播稿 |
| 合并 / 分句 | 合并碎片 token；按 `punctuation` 与空隙切句 |
| 清理 | 零时长 token 丢弃；偏离相邻锚点预期 >0.8s 的离群锚降级为插值 |
| 质检 | 每句 `match = CJK 锚点覆盖率`，**< 0.90 标 ok=false** 供人工听核 |

**产出 schema**（与参考实现同构）

```json
{ "sr": 24000, "total": 10.48,
  "sentences": [
    { "i": 0, "text": "去年我们的用户只有三千人", "start": 0.16, "end": 2.28,
      "match": 0.97, "ok": true,
      "words": [ { "text": "去年", "start": 0.16, "end": 0.56 } ] } ] }
```

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `packages/providers/src/media/bailian.ts` | 扩展：加 `qwen-audio-3.0-asr-flash` 模型 + 转录方法 |
| `apps/server/src/routes/ai/asr/*.ts` | 新增；读工作区音频 → base64 → 返回时间表 |
| `scripts/alignTimestamps.mjs` | 新增；归一化 + 对齐 + 清洗 |



#### P1b′ · 口播稿预剪（容易漏、但很关键）

参考实现把「剪口水词 / 结巴 / 过长停顿」放在**时间戳之前**，且**同一 EDL 剪人物视频**（音画逐帧同长）。规则：

- **稿子是真值，宁漏勿错**：只剪 ASR 里**稿子没有的插入段**
- 停顿 ≥0.7s 压到 0.35s（留真实房间音，不补数字零）
- **先 dry-run 出报告给用户过目再落盘**
- 顺序**不可换**：预剪 → 时间戳 → 其后一切

**产出**：`scripts/voiceTrim.mjs`（依赖既有 `audioProcessor`，只吃 WAV 输入）。

#### P1c · 字幕生成与烧录

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `scripts/makeSubtitles.mjs` | 新增；`timestamps.json` → ASS/SRT |
| `packages/tools/ffmpeg` | 复用（`subtitles=` 滤镜已在能力内） |

**借鉴其字幕规范**（照抄数值）：

- **素排、无标点、整句硬现**；跟读字幕不加动效、不含句读（停顿靠拆卡）
- **底部字幕 ≥56px（≥5.2% 帧高，推荐 60px）**；辅助文字 ≥32px（≥3%）
- **入场 8 帧 / 出场 8 帧**（`Caption.tsx` 实测值）
- 竖屏**常驻件必须左下**（右缘是抖音点赞栏）
- 逐字高亮用 ASS `\k` 卡拉 OK 标签

**验证**：按参考口径报告 **CJK 字级 |Δstart| 中位 / p95 / 最大** + `match<0.90` 句数；30s 视频烧出字幕，抽帧确认逐字高亮对齐。

---

### P2 · 语义标注 → 选卡（"该摆的东西在不在"）

**为什么**：参考实现用一支片换来的教训——
评审 rubric 只核"摆上去的东西对不对"，**不核"该摆的东西在不在"**，
所以「自我介绍」拿到了全库能量最低的文字卡，而 P0 级的人名条就在货架上没人查到。
根因是**需求侧没有结构化产物**。

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `scripts/semanticAnnotate.mjs` | 新增；`--init` / `--stats` / `--sync-shots` |
| `packages/skills/workflow/references/semantics.md` | 新增；词表与纪律 |
| `scripts/cardMatch.mjs` | 新增；出候选表 |
| `data/semantics.json`（工程内） | 产物 |

**标注字段**（照抄其设计）

| 字段 | 含义 |
| --- | --- |
| `sem` | **这句在做什么**，多选，**26 词封闭词表** |
| `weight` | `main` = 主句，**只有主句允许进新元素**；`sub` = 陪衬句只允许已有元素变化 |
| `entities` | 数字带单位 / 人名 / 品牌 / URL / 地点 → 素材检索词 |
| `need` | 证据 / 身份 / 量化 / 对比 / 结构 / 强调 / 无 |
| `exempt` | 豁免某条词法硬规，值是理由（≥4 字） |

**关键**：`weight` 把「**禁止一句一个新元素**」落成了**机器可读**的东西——
一镜至少一个 `main`，`sub` 句不配新卡。

**三条硬规**（机器粗筛，其余是 WARN）：我是/我叫 X → 自我介绍；点赞/订阅/三连 → 号召；数量词 → 数据。

**验证**：`semantics.json` 与时间戳逐字一致；词表封闭；**每镜至少一个 main**；
「自我介绍 / 介绍他人 / 号召」三类无对应卡 → FAIL。

---

### P3 · 机器闸 + 独立评审

#### P3a · 机器闸（优先可 ffmpeg 实现的）

| 闸 | 实现 | 可行性 |
| --- | --- | --- |
| **任意 1s 不允许全静止** | `ffmpeg freezedetect=n=0.003:d=0.8` | ✅ **原语直用** |
| 重复帧签名（素材帧率病） | `ffprobe r_frame_rate` vs `avg_frame_rate` | ✅ |
| 帧数断言（分段拼装） | 每段实数帧 == 拼装总帧数 | ✅ |
| **音画偏移补偿** | 归一化交叉相关量输出音轨滞后 | ✅ 见 §P5c |
| 字幕词落点 | \|Δ\| ≤ 0.10s；锚字在句里多次取最近一次 | ✅ |
| **镜尾保护带** | 锚点距镜头出点 ≥ 0.5s（否则被转场吞） | ✅ |
| 全片零 B-roll/图片 → FAIL | 扫画布节点 | ✅ |
| 人脸安全区 | 参考用 opencv YuNet（230 KB） | ⚠️ 我们无 opencv，**暂缓或另选** |

**产出**：`scripts/qaGate.mjs`（聚合各闸）+ 各闸独立脚本。

#### P3b · 独立评审（照抄协议）

**为什么**：参考实现的原话——
「**fork 出来的评审继承制作者视角，对照物又是制作者自己写的 SHOTBOOK，形成自证闭环**」。

**规则**

| 项 | 做法 |
| --- | --- |
| 独立性 | **全新上下文**；禁止 fork 制作对话；禁止对同一评审 followup |
| 落盘 | 开工先写 `REVIEW.md` 骨架，**每看完一镜追加一行** |
| 完成判据 | 出现结束行 `## 评审完成 · 已看 N/N 镜`（**不认完成通知**） |
| 判活 | 10 分钟无增量 → 终止重派 |
| 失败处置 | 3 次无报告 → 标「**未获独立评审**」交付，**禁止静默降级为自评** |
| 分级 | **P0**（观众必然察觉且伤害理解）/ **P1**（违反硬规则）/ **P2**（质感瑕疵） |
| 过关线 | **修完 P0 + P1** |
| 报告 | 每条**附帧号**（如 `Q2 ✗（第 615 帧文字发糊）`） |

**材料五件套**：分镜 + 评审拼图；原版卡对比帧；词落点核对表；音效可听度报告；语义标注与候选表。

**验证**：能对一段真实成片跑出一份**逐条带帧号**的评审报告。

---

### P4 · 视觉规范（反 PPT + 排版）

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `packages/skills/workflow/references/cinematography.md` | 新增；反 PPT 四病根 + 七层模型 + 层预算 |
| `packages/skills/workflow/references/layout.md` | 新增；栅格 + 令牌 + 字阶 + 校验九项 |
| `packages/skills/workflow/references/shotDesign.md` | 新增；三面工作单 + 镜头型预设 |
| `packages/skills/workflow/references/antiPpt.md`（可合并） | 新增 |

**注意落地形态**：我们**没有 Remotion**，这些是**给 agent 的约束与提示词模板**，
不是可运行代码。**这一点必须在文档里写明，避免 agent 误以为有对应的组件。**

**关键数值（照抄）**

- 反 PPT 四病根：无相机层 / 入场即死 / 硬切翻页 / 文档版式堆积
- 层预算：英雄时刻 4–6 层、过渡 2–3 层、静息允许只有相机在动
- **运动做减法**：只留相机极缓推拉（**0.5%/s**），"处处在动"那套已过
- 排版：安全边 96 / 标题边 160 / 字幕带 y≥900；令牌 8·16·24·32·48·64·96·160
- **层级铁律：外边距 ≥ 组间距 ≥ 组内间距**（反例"间距倒挂"）
- 字阶：hero 96–120 / title 64–72 / subtitle 44 / body 40–44 / caption 28–32 / micro 22–24
- **最小可读 28**；列表条目 ≥40；**同一行 ≤14 汉字**，超了拆行不缩字
- **可读性终检**：成片**缩到 390px 宽**复看

---

### P5 · 声音设计（我们最大的空白）

**产出文件**

| 文件 | 动作 |
| --- | --- |
| `packages/skills/workflow/references/soundDesign.md` | 新增 |
| `packages/skills/workflow/references/beatSync.md` | 新增 |
| `packages/skills/canvas/...` 或新技能 | 视形态定 |

#### P5a · 声音词汇与纪律

- 顺序：**画面锁定 → BGM 定能量骨架 → 逐拍钉 SFX**；画面一动，**全表重钉**
- **按"片种"选音，不按"事件"选**：禁游戏音包**音色**（合成器 pluck/bloop），
  但**禁音色不禁动作**——真有点击/开关/碎裂就该配拟音
- 判别问句：这音像**真实世界里那个物件发出的声音**，还是像**游戏引擎的反馈提示音**？
- 钉帧**一律相对镜头起点**（`SHOTS.x.from + offset`），**绝不写裸帧号**
- 长样本（>5s）必须显式给时长，否则拖到动作结束后还在响
- **`volume` 是乘法系数不是目标音量**：素材峰值低时给 1.0 也没用，首选换素材或预归一化

#### P5b · 防机枪感三招

双样本交替 + 音量阶梯递减（0.40→0.25）+ 间隔跟随动画加速；密到糊就**淡出成一条 swoosh**。

#### P5c · 音画偏移（**直接适用我们**）

参考实现实测：**AAC encoder priming 导致整条音轨滞后 ≈1.28 帧**（48kHz，2048 samples）。
统一公式：

```
Sequence.from = 目标峰值帧 − 音源峰值滞后帧 − 输出音轨偏移帧
```

**对我们的意义**：我们用 `-c:a aac` 混音，**同样会有这个偏移**。
补偿常数必须**按管线实测**（ffmpeg 内置 aac ≈1024、fdk-aac 2048、Apple ≈2112 samples，**不能预设常数**）。

**验证**：渲出后抽音轨，拿 2–3 个尖锐音效做归一化交叉相关，**残差 ≤0.5 帧**。

#### P5d · BGM 卡点（若用户指定音乐）

- **不要相信 `beat_track` 的 tempo 标量**（实测偏差 2%+：报 129.2、真值 131.97）
  → 对 beat 序列做**最小二乘拟合** `t_i = t0 + i·T`，验收**残差 ≤±15ms**
- **半倍/双倍歧义必查**（70 BPM 报成 140）
- 鼓点三分类驱动不同动效：kick 40–160Hz → slam；snare 150–500Hz+1–3kHz → 换场；hihat 6–14kHz → 微动密度
- **全画面级冲击全片 ≤3 处**、相邻 ≥16 拍（参考实现被用户投诉过"镜头随节奏抖动"）
- 渲后回测：全片切点误差 **≤3 帧**（感知阈值）
- **系统性同向偏移先查输出音轨偏移，不逐点手改**

**约束**：无 Python/librosa → 需 TS 方案（如 `essentia.js`）或**降级为"只做 BGM 淡入淡出、不做卡点"**。

#### P5e · 两版成片

配 BGM 的片子交付**带 BGM / 无 BGM 两版**（同一时间线）。

---

### P6 · 资产与交付（长期，可选）

| 项 | 内容 | 参考 |
| --- | --- | --- |
| **配方卡库** | 卡 = **参数化 FFmpeg 滤镜链 + 提示词模板 + 预览图**；元数据照抄五字段（输入类型 / 语义 / 素材形态 / 位置 / props） | talkcraft 卡库设计 |
| 卡索引 | 从卡 frontmatter **生成**，`--check` 校验，**手改索引无效** | `cards_index.py` |
| 卡库 UI | 素材库加第三个分页「配方」，按语义 × 类别筛选 | 我们的素材库 |
| **预览面板** | 工作区加 `[画布 | 文档 | 预览]`，能播成片 + 时间轴 + 字幕轨 | `workbench/` |
| 剪映草稿导出 | 生成可继续编辑的工程 | shotcraft（**Apache-2.0 可用**） |
| 素材采集三件套 | 全页 2x 截图 + 元素切片 + `layout.json` 坐标 | `capture-template.mjs` |

---

## 4. 依赖关系

```
P0（断言）           ── 独立，最小，先做
P1a（探供应商）      ── 需 API Key；有则可能省掉整个 P1b
  └→ P1b（对齐）     ── 依赖 P1a 结果 + 选型决策
  └→ P1b′（预剪）    ── 独立，但必须在 P1b 之前跑
  └→ P1c（字幕）     ── 依赖 P1b（或 P1a 直接给时间戳）
P2（语义标注）       ── 依赖 P1b（要逐句时间戳）
  └→ 选卡           ── 依赖 P2 + P6 的卡库（无卡库则只出语义，不出候选）
P3（机器闸/评审）    ── 字幕闸依赖 P1c；评审可独立
P4（视觉规范）       ── 独立（纯文档）
P5（声音）           ── 音画偏移依赖有混音链路；卡点依赖选型
P6（卡库/预览）      ── 卡库依赖 P2 + P4；预览独立
```

---

## 5. 风险与不确定项

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ~~无 API Key~~ | ✅ **已解决** | 已用真实 Key 完成 P1a 探测 |
| ~~P1b 后端选型~~ | ✅ **已解决** | `qwen-audio-3.0-asr-flash` 直接给词级时间戳，无需本地模型 |
| 无 Python | ✅ 已知 | 所有闸需 TS 或 ffmpeg 实现 |
| 无 opencv | ⚠️ | 人脸安全区闸暂缓或另选轻量方案 |
| 无 librosa | ⚠️ | BGM 卡点需 TS 方案或降级 |
| 我们还**没有配方卡** | ✅ 已知 | 选卡功能依赖 P6 先建卡库 |
| 我们**没有成片合成节点** | ✅ 已知 | 字幕烧录可走 `ffmpeg` 工具，但"成片"目前是拼接结果 |
| 参考值不可跨管线搬运 | ⚠️ | AAC priming 常数必须自测 |
| ASR 数字规范化与稿子不一致 | ⚠️ **需实现** | `三千`→`3000`，必须做数字转中文读法归一化 |
| ASR 不按标点分句 | ⚠️ **需实现** | 返回单个 sentence 对象，需自行按 punctuation + 空隙切句 |

---

## 6. 需拍板的决策点

| # | 问题 | 选项 |
| --- | --- | --- |
| Q1 | **范围** | 只 P0 / P0+P1 / P0–P3 / 全做 |
| ~~Q2~~ | ~~P1b 后端~~ | ✅ **已消解**：`qwen-audio-3.0-asr-flash` 同步接口返回词级时间戳，走供应商即可 |
| ~~Q3~~ | ~~是否接受新增按需下载的重能力~~ | ✅ **不需要**（无 whisper.cpp / WASM / 本地模型） |
| Q4 | **是否要声音设计（P5）** | 我们最大空白，但也是最大工作量 |
| Q5 | **BGM 卡点** | 上（需引入 TS 节拍分析）/ 降级（只做淡入淡出） |
| Q6 | **配方卡库（P6）** | 现在建 / 等 P1–P4 落地后再建 |

---

## 7. 许可边界（**不可越界**）

| 项目 | 许可 | 允许 |
| --- | --- | --- |
| `video-shotcraft-main` | **Apache-2.0** | 可复用代码（**须带声明**，保留 NOTICE） |
| `video-talkcraft-main` | **PolyForm Noncommercial** | 🔴 **只学思路，不复制代码或文档** |

**具体到本计划**：

| 可借鉴 | 不可搬 |
| --- | --- |
| shotcraft：`Caption.tsx` 时序值、`final-review` 检查项结构、`preflight` 断言思路、剪映导出实现（Apache-2.0） | talkcraft 的**任何**代码与文档原文 |
| talkcraft：**算法思想**（繁简归一 / 声调无关拼音 / 覆盖率闸）、**方法论**（反 PPT / 排版 / 语义标注）、**数值**（56px 可读线 / 8 帧入出 / 令牌序列） | talkcraft 的 `taxonomy.md` / `cinematography.md` 等文档原文、108 张卡的 tsx |

**做法**：talkcraft 的结论**用自己的话重新表述**，数值可作为实测目标但**需我们自己复现验证**。

---

## 8. 附：关键文件索引

| 用途 | 路径 |
| --- | --- |
| 现有断言脚本 | `scripts/checkModes.mjs` |
| 工具注册 | `packages/tools/*/src/index.ts` |
| 工具上下文 | `packages/toolScaffold/src/runtime.ts` |
| 节点注册与函数 | `packages/nodes/*/src/index.vue`、`packages/nodeScaffold/src/nodeTools.ts` |
| 音频转换 | `apps/server/src/utils/media/audioProcessor.ts` |
| 媒体生成与落盘 | `apps/server/src/utils/media/generation.ts` |
| 技能 | `packages/skills/{canvas,workflow}/` |
| 素材库（全局） | `apps/server/src/utils/assets/index.ts`、`data/assets` |
| 设置面板 | `apps/web/src/components/settings/index.vue` |
| 工作区布局 | `apps/web/src/pages/workspace/index.vue` |
