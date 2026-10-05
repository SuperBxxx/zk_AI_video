import type { Edge, Node } from "@vue-flow/core";

// 创作模式：为首页提供几个起点。每个模式 = 一段开场提示词 + 一张预置画布。
//
// 设计目标：把「这条链路该怎么做」固化成每个节点自己的预置提示词，
// 让 agent 一进画布就知道每个环节的产出要求与上下游关系，而不必每次重新推导。
//
// 重要：画布里的 node.type 必须带 `remote-` 前缀 ——
// 画布把节点文件名映射为 `remote-<name>`（canvas/index.vue、canvasDrop.ts），
// 没有前缀的类型不会被注册，节点会渲染不出来。
//
// 端口（来自各节点定义，改动节点时需同步）：
//   remote-textNode             in(VIDEO|IMAGE|STRING) → text(STRING)   ← in 是直通，可省略
//   remote-imageNode            —                       → image(IMAGE)
//   remote-videoNode            —                       → video(VIDEO)
//   remote-audioNode            —                       → audio(AUDIO)   ← 只有输出，没有输入
//   remote-imageGenerationNode  in(IMAGE|STRING)        → image(IMAGE)
//   remote-videoGenerationNode  in(IMAGE|VIDEO|AUDIO|STRING) → video(VIDEO)
//   remote-director3dNode       in(STRING|IMAGE|VIDEO)  → （无输出，仅预演）
//
// 只有本文件里出现「生成」二字的节点（*GenerationNode）会产出内容；
// textNode 承载文本、imageNode/audioNode/videoNode 是素材载体（靠 setImage/setAudio/setVideo 填入）。
//
// 已知能力边界（写进提示词，避免 agent 许愿）：
//   · 内置媒体供应商 meta（秘塔版 MiniMax H3）**不支持独立的音频生成**，模型只有 video 类型。
//     所以「配音」环节默认是**手动上传**（audioNode），或依赖该模型自带的音画同步。
//     若用户接入支持 TTS 的供应商，可把该节点换成 audioGenerationNode。
//   · 「合规」环节没有对接任何合规服务，做成**逐条审查清单**，产出待改项。
//   · 「多平台分发」没有平台接口，做成**发布清单**。
//   · 自动剪辑统一由 agent 调 ffmpeg 完成（不做独立剪辑节点）。
//
// 画布坐标：按阶段从左到右分列（列间距 400），同列上下分行（行间距 300）。
// 节点 id 在每个模式内唯一即可，打开画布时不会与其它文件冲突。

export type CreateMode = {
  id: string;
  label: string;
  // 选中模式时填入输入框的开场提示词；自由创作保持为空。
  prompt: string;
  // 预置画布节点。空数组表示不铺节点。
  build: () => { nodes: Node[]; edges: Edge[] };
};

const node = (id: string, name: string, label: string, x: number, y: number, data: Record<string, unknown> = {}): Node =>
  ({ id, type: `remote-${name}`, position: { x, y }, data: { label, ...data } });

const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge =>
  ({ id, source, sourceHandle, target, targetHandle });

// 阶段列：第 n 列（从 0 起）。
const col = (index: number) => index * 400;
// 同列内的第 n 行。
const row = (index: number) => index * 300;

export const createModes: CreateMode[] = [
  {
    id: "free",
    label: "自由创作",
    prompt: "",
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    id: "marketing",
    label: "营销 / 推广",
    prompt: "我要做一支产品宣传片。先和我确认产品、目标人群、投放平台和时长，再按画布上的环节推进。",
    build: () => ({
      nodes: [
        node("m-brief", "textNode", "① 产品与卖点", col(0), row(0), {
          prompt: "先向用户确认：产品是什么、卖给谁、投放在哪个平台、成片时长。然后产出一份卖点清单（3–5 条，每条一句话、可验证、不夸大），并给出宣传片的整体调性与一句话主张。输出为结构化文本，供下游脚本节点使用。",
        }),
        node("m-script", "textNode", "② 宣传片脚本", col(1), row(0), {
          prompt: "基于上游卖点清单，写一支宣传片脚本：按秒分段（0–3s 钩子、3–10s 痛点、10–25s 卖点演示、结尾行动号召），每段写明画面内容、字幕文案与旁白。时长与投放平台以上游确认为准。",
        }),
        node("m-visual", "imageGenerationNode", "③ 主视觉", col(2), row(0), {
          prompt: "根据上游脚本，生成主视觉画面：产品在真实使用场景中的特写，光线干净、构图留出字幕安全区。风格以用户确认为准；先给出画面描述与尺寸比例让用户确认，再调用生成。",
        }),
        node("m-audio", "audioNode", "④ 配乐 / 旁白", col(2), row(1)),
        node("m-video", "videoGenerationNode", "⑤ 宣传片成片", col(3), row(0), {
          prompt: "把上游主视觉与配乐合成为成片。按脚本分段生成或一次生成，保持画面风格与产品外观一致；旁白与配乐混音平衡，字幕位置不遮挡产品。生成前先说明用哪个模型、时长与分辨率。",
        }),
        node("m-cut", "textNode", "⑥ 自动剪辑与输出", col(4), row(0), {
          prompt: "调用 ffmpeg 完成成片收尾：叠加产品 logo 与水印、烧录字幕（subtitles 滤镜）、按投放平台输出对应规格（竖版 9:16 / 方版 1:1 / 横版 16:9）、必要时裁切时长。先列出将要执行的滤镜链与输出清单让用户确认，再执行。",
        }),
      ],
      edges: [
        edge("m-e1", "m-brief", "text", "m-script", "in"),
        edge("m-e2", "m-script", "text", "m-visual", "in"),
        edge("m-e3", "m-script", "text", "m-video", "in"),
        edge("m-e4", "m-visual", "image", "m-video", "in"),
        edge("m-e5", "m-audio", "audio", "m-video", "in"),
        edge("m-e6", "m-video", "video", "m-cut", "in"),
      ],
    }),
  },
  {
    id: "talkingHead",
    label: "数字人 / 口播",
    prompt: "我要做一条真人数字人口播视频，请按画布上的环节依次推进：选题 → 拆解 → 文案 → 去 AI 味 → 合规预审 → 配音 → 数字人成片 → 自动剪辑 → 发布清单。每个环节先和我确认再往下走。",
    build: () => ({
      nodes: [
        node("t-topic", "textNode", "① 每日热点选题", col(0), row(0), {
          prompt: "用 webSearch 查询当天的热点（行业动态、平台热榜、社会话题均可），筛出 3 个「适合口播、有信息增量、不踩敏感线」的选题。每个选题给出一句话角度、目标受众、预估时长，并列明信息来源链接。让用户选一个再继续。",
        }),
        node("t-teardown", "textNode", "② 爆款视频拆解", col(1), row(0), {
          prompt: "用 webSearch 与 webFetch 找到同题材的爆款口播视频，拆解它们的结构：前 3 秒钩子怎么写的、节奏是几秒一个信息点、总时长、结尾有没有引导互动。总结出可复用的模板（不要照抄文案），作为下一步的写作参考。",
        }),
        node("t-script", "textNode", "③ 口播文案", col(2), row(0), {
          prompt: "综合上游的选题角度与爆款结构，写一份口播文案。要求：开头 3 秒给出钩子、全程口语化、每 2–3 句一个信息点、结尾自然收口（不喊口号）。标注每段的建议时长，总时长由用户确认。",
        }),
        node("t-human", "textNode", "④ 去 AI 味", col(3), row(0), {
          prompt: "把上游文案改写得更像真人说话：拆短句、加口语连接词与语气词、去掉「首先/其次/总之/值得注意的是」这类 AI 腔、把书面词换成日常说法、允许适度不完美的停顿。保留原意与信息点，不要新增事实。产出可直接念的版本。",
        }),
        node("t-review", "textNode", "⑤ 合规预审", col(4), row(0), {
          prompt: "逐条审查上游文案的合规风险（本仓库未对接合规服务，这里按清单人工判断）：绝对化用语（最/第一/唯一）、医疗与金融承诺、涉政涉黄涉赌、未证实的传闻、可能侵权他人素材的表述。按「风险等级 + 原文位置 + 建议改法」逐条列出，改完再进入配音。",
        }),
        node("t-audio", "audioNode", "⑥ 配音（需手动上传）", col(5), row(0)),
        node("t-image", "imageNode", "⑥ 形象参考图", col(5), row(1)),
        node("t-video", "videoGenerationNode", "⑦ 数字人口播成片", col(6), row(0), {
          prompt: "生成真人口播视频：用上游形象参考图作为人物形象，配合上游配音。注意：内置的秘塔版 MiniMax H3 **不支持独立音频生成**，配音只能来自上游手动上传的文件；若走该模型自带的音画同步，请把 generateAudio 打开并按文案直接生成。先说明用哪个模型、时长、分辨率与比例，并说明配音来源，再生成。",
        }),
        node("t-cut", "textNode", "⑧ 自动剪辑", col(7), row(0), {
          prompt: "调用 ffmpeg 完成口播成片的自动剪辑：画中画（overlay 叠加补充画面或数据卡片）、网感字幕（subtitles 或 drawtext 烧录重点词、关键词放大变色）、必要的节奏裁切与转场、片头片尾点缀。先列出即将执行的滤镜链与时间点让用户确认，再执行；输出到工作区新文件，不覆盖原片。",
        }),
        node("t-publish", "textNode", "⑨ 多平台发布清单", col(8), row(0), {
          prompt: "产出发布清单（本仓库未对接平台接口，这里只出清单）：按抖音 / 视频号 / 小红书 / B 站 / 快手分别给出标题（含话题词）、封面文案、简介、话题标签、建议发布时段、时长与画幅是否合规、需要额外补的素材。标出哪些平台需要重新导出不同画幅。",
        }),
      ],
      edges: [
        edge("t-e1", "t-topic", "text", "t-teardown", "in"),
        edge("t-e2", "t-teardown", "text", "t-script", "in"),
        edge("t-e3", "t-script", "text", "t-human", "in"),
        edge("t-e4", "t-human", "text", "t-review", "in"),
        // 文案与合规不直接连进音频节点：audioNode 只有输出端口，没有 target。
        edge("t-e5", "t-review", "text", "t-video", "in"),
        edge("t-e6", "t-audio", "audio", "t-video", "in"),
        edge("t-e7", "t-image", "image", "t-video", "in"),
        edge("t-e8", "t-video", "video", "t-cut", "in"),
        edge("t-e9", "t-cut", "text", "t-publish", "in"),
      ],
    }),
  },
  {
    id: "storyboard",
    label: "故事短剧",
    prompt: "我要把一个故事做成短剧。先按画布上的环节推进：故事设定 → 剧本 → 分镜脚本 → 分镜画面 → 镜头预演 → 分镜视频 → 剪辑成片。",
    build: () => ({
      nodes: [
        node("s-story", "textNode", "① 故事与人物", col(0), row(0), {
          prompt: "先向用户确认：故事类型、时长、目标平台、画面风格。然后产出故事设定：一句话故事核、主要人物（外观、性格、动机各一句话）、起承转合的四段结构。供下游剧本使用。",
        }),
        node("s-script", "textNode", "② 剧本", col(1), row(0), {
          prompt: "基于上游故事设定写短剧剧本：按场次划分，每场写明地点、人物、对白、动作提示与情绪走向。对白要口语化、有冲突、能在短时长内立住人物；给每场标注预估时长。",
        }),
        node("s-board", "textNode", "③ 分镜脚本", col(2), row(0), {
          prompt: "把上游剧本拆成分镜表，逐镜给出：镜号、景别（远/全/中/近/特）、机位与运动、画面内容、对白或旁白、时长（秒）。保持镜头总数与总时长可控，标出哪些镜头是同一场景可复用素材。",
        }),
        node("s-image", "imageGenerationNode", "④ 分镜画面", col(3), row(0), {
          prompt: "按上游分镜表逐镜生成画面。统一人物外观与场景风格（保持一致的角色特征描述），构图按景别要求。先给出画面描述与比例让用户确认，再分批生成；每张标注对应镜号。",
        }),
        node("s-3d", "director3dNode", "⑤ 镜头预演", col(3), row(1)),
        node("s-audio", "audioNode", "⑥ 旁白 / 对白", col(4), row(1)),
        node("s-video", "videoGenerationNode", "⑦ 分镜视频", col(4), row(0), {
          prompt: "按上游分镜画面生成分镜视频。保持人物与场景跨镜头一致；需要运动镜头时在提示词里写明运镜方式。逐镜生成，先说明用哪个模型、每镜时长与分辨率。注意：内置秘塔版 MiniMax H3 不支持独立音频生成，旁白对白需来自上游手动上传的文件，或开启该模型的音画同步。",
        }),
        node("s-cut", "textNode", "⑧ 剪辑成片", col(5), row(0), {
          prompt: "调用 ffmpeg 把分镜视频按分镜表顺序拼接成片：拼接与交叉转场、配上旁白与对白音轨、烧录字幕、按平台输出画幅。若有镜头需重排或补时长，先在清单里说明。输出到工作区新文件，不覆盖分镜原片。",
        }),
      ],
      edges: [
        edge("s-e1", "s-story", "text", "s-script", "in"),
        edge("s-e2", "s-script", "text", "s-board", "in"),
        edge("s-e3", "s-board", "text", "s-image", "in"),
        edge("s-e4", "s-board", "text", "s-3d", "in"),
        edge("s-e5", "s-board", "text", "s-video", "in"),
        edge("s-e6", "s-image", "image", "s-video", "in"),
        edge("s-e7", "s-audio", "audio", "s-video", "in"),
        edge("s-e8", "s-video", "video", "s-cut", "in"),
      ],
    }),
  },
];
