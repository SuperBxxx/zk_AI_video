import { z } from "zod";
import { executeRemoteFfmpeg } from "@toonflow/ffmpeg/remote";
import {
  alignTiming,
  buildAss,
  buildCardCatalog,
  buildEditList,
  buildJianyingDraft,
  buildSrt,
  builtInCards,
  checkAvDuration,
  checkEditList,
  checkFrameRate,
  checkFreeze,
  checkShotTail,
  editListToCsv,
  editListToEdl,
  findCard,
  fitCardToFrame,
  instantiateCard,
  matchCatalogDetailed,
  parseFreezeSpans,
  resolveSoundCues,
  usToTimecode,
  type AlignWord,
  type CardCatalogEntry,
  type CardEnergy,
  type CardInput,
  type CardPosition,
  type CardSemantic,
  videoAnalysisCards,
  storyAnchorKeys,
  storyAnchorGuide,
} from "@toonflow/post-production";
import { htmlCards } from "@toonflow/card-runtime/cards";
import type { ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";

/**
 * 两个卡库合成一份目录，供 useCard 检索。
 *
 * ACT: 放在模块顶层只算一次。两个卡库都是静态数组，没有 I/O，也没有运行时变化。
 */
// ACT: 显式传三套卡（FFmpeg 滤镜卡 + HTML 画面卡 + **分析卡**）。
// 分析卡以前完全不在 Agent 视野里 —— 它们描述的是"读素材"的动作，不是画面效果，
// 但"要复刻一条参考片"的第一步恰恰是它。
const cardCatalog: CardCatalogEntry[] = buildCardCatalog(builtInCards, htmlCards, videoAnalysisCards);

/** 把占位区转成 Agent 好读的百分比描述（给提示词用，不是给程序用）。 */
function formatOcclusion(occlusion: { x: number; y: number; w: number; h: number }) {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return `横向 ${pct(occlusion.x)}~${pct(occlusion.x + occlusion.w)}、纵向 ${pct(occlusion.y)}~${pct(occlusion.y + occlusion.h)}`;
}

const configSchema = z.object({
  targetFps: z.number().min(1).max(240).default(30),
  freezeDuration: z.number().min(0.1).max(10).default(0.8),
  shotTail: z.number().min(0).max(5).default(0.5),
  audioOffsetMs: z.number().min(0).max(500).default(0),
}).strict();

const checkSchema = z.strictObject({
  video: z.string().trim().min(1).max(512).describe("工作区内的成片路径"),
  shots: z.string().trim().max(512).optional().describe("分镜表 JSON（[{id,start,end}]，秒）；给了才核镜头落点"),
  skipFreeze: z.boolean().optional().describe("跳过静止段检测（默认不跳过）"),
}).strict();

const subtitleSchema = z.strictObject({
  script: z.string().trim().min(1).max(512).describe("口播稿：一行一句的文本，或含 sentences 的 JSON"),
  asr: z.string().trim().min(1).max(512).describe("语音识别结果 JSON（含 sentences[0].words 的词级时间戳）"),
  output: z.string().trim().max(512).optional().describe("输出的 ASS 路径，默认 assets/subtitles/caption.ass"),
  fontName: z.string().trim().max(128).optional().describe("字体名，默认微软雅黑"),
  fontSize: z.number().int().min(12).max(200).optional().describe("字号，默认帧高的 5.6%"),
  karaoke: z.boolean().optional().describe("逐字高亮，默认开"),
}).strict();

const cueSchema = z.strictObject({
  cues: z.array(z.object({
    shot: z.string().max(64).optional().describe("镜头 id；与 absolute 二选一"),
    offset: z.number().optional().describe("相对镜头起点的秒数"),
    absolute: z.boolean().optional().describe("该 cue 用绝对时间（片头/全片级音效）"),
    anchor: z.number().optional().describe("absolute 时的绝对秒数"),
    src: z.string().min(1).max(256).describe("音效文件"),
    volume: z.number().min(0).max(8).optional().describe("乘法系数，不是目标音量"),
    what: z.string().max(256).optional().describe("对应的画面动作"),
  })).max(2000),
  shots: z.array(z.object({ id: z.string(), start: z.number(), end: z.number() })).max(500).describe("分镜表（秒）"),
  offsetMs: z.number().min(0).max(500).optional().describe("输出音轨偏移；不给则用配置值"),
}).strict();

const deliverySchema = z.strictObject({
  shots: z.array(z.object({
    id: z.string().min(1).max(64),
    source: z.string().min(1).max(512).optional().describe("源素材；缺省继承上一段"),
    start: z.number().min(0).describe("镜头起点（秒）"),
    end: z.number().min(0).describe("镜头终点（秒）"),
    sourceStart: z.number().min(0).optional().describe("源素材入点（秒）；缺省等于 start"),
  })).min(1).max(2000).describe("镜头表（秒）"),
  source: z.string().trim().max(512).optional().describe("统一源素材；给了就不必每段写 source"),
  timestamps: z.string().trim().max(512).optional().describe("timestamps.json；给了就一并导出 SRT 字幕"),
  jianying: z.object({
    plate: z.string().min(1).max(512).describe("底片素材路径（绝对路径；无字幕无音效的干净成片）"),
    name: z.string().min(1).max(64).describe("草稿名（剪映列表里显示的名字）"),
    width: z.number().int().min(16).max(8192).optional().describe("画布宽，默认 1920"),
    height: z.number().int().min(16).max(8192).optional().describe("画布高，默认 1080"),
  }).strict().optional().describe("给了就额外导出剪映草稿（draft_content.json + draft_meta_info.json）"),
  outputDirectory: z.string().trim().max(512).optional().describe("输出目录，默认 assets/delivery"),
  name: z.string().trim().max(64).optional().describe("交付物文件名前缀，默认 delivery"),
}).strict();

const cardQuerySchema = z.strictObject({
  inputs: z.array(z.enum(["人", "V", "图", "截图", "文", "界", "场"])).max(7).optional()
    .describe("这一镜有哪些素材：人=口播人物在场 · V=B-roll 视频 · 图=图片 · 截图=网页界面 · 文=纯文字 · 界=界面自演 · 场=作用于前后两镜的转场"),
  semantics: z.array(z.string().min(1).max(16)).max(8).optional()
    .describe("这一句在做什么（用 semanticAnnotate 的词表：数据/对比/列举/强调/转场/金句…）"),
  position: z.enum(["开场", "中段", "收尾", "任意"]).optional(),
  energy: z.enum(["低", "中", "高"]).optional(),
  slug: z.string().trim().max(64).optional().describe("直接取某一张卡的完整内容（FFmpeg 卡给滤镜链；HTML 卡给画幅与参数）"),
  parameters: z.record(z.string(), z.number()).optional().describe("给某张卡传参数；越界或未知参数会被拒"),
  frameSize: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional().describe("目标成片画幅（成片的宽高，不是卡的）。取 HTML 卡时给出，能拿到该卡按这个画幅渲染后的设计画布尺寸与画幅提醒"),
}).strict();

// ACT: 这一份 JSON Schema 是**手写的字面量**，不调 z.toJSONSchema。
// 踩过的坑：工具产物会被构建压缩，zod 的内部标记（`schema._zod.def`）在产物里
// 被抹掉（实测产物中 `_zod` 出现 0 次），于是 z.toJSONSchema 在工具加载时就抛
// `undefined is not an object`，整个工具起不来。手写字面量不依赖 zod 内部结构。
// 代价：与上面的 cardQuerySchema 有两处需要同步维护 —— 改字段时两边都要动；
// 参数真正生效的校验仍走 cardQuerySchema.parse。
const cardQueryParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    inputs: {
      type: "array",
      maxItems: 7,
      items: { type: "string", enum: ["人", "V", "图", "截图", "文", "界", "场"] },
      description: "这一镜有哪些素材：人=口播人物在场 · V=B-roll 视频 · 图=图片 · 截图=网页界面 · 文=纯文字 · 界=界面自演 · 场=作用于前后两镜的转场",
    },
    semantics: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 16 },
      description: "这一句在做什么（用 semanticAnnotate 的词表：数据/对比/列举/强调/转场/金句…）",
    },
    position: { type: "string", enum: ["开场", "中段", "收尾", "任意"] },
    energy: { type: "string", enum: ["低", "中", "高"] },
    slug: { type: "string", maxLength: 64, description: "直接取某一张卡的完整内容（FFmpeg 卡给滤镜链；HTML 卡给画幅与参数）" },
    parameters: { type: "object", additionalProperties: { type: "number" }, description: "给某张卡传参数；越界或未知参数会被拒" },
    frameSize: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
      },
      required: ["width", "height"],
      description: "目标成片画幅（成片的宽高，不是卡的）。取 HTML 卡时给出，能拿到该卡按这个画幅渲染后的设计画布尺寸与画幅提醒",
    },
  },
};

interface RemoteResult {
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

/** 跑一次远端 ffmpeg 调用，拿到 stdout / stderr。 */
async function run(context: ToolContext, steps: unknown[], operation: unknown, signal?: AbortSignal): Promise<RemoteResult> {
  const ffmpeg = await context.ffmpeg(signal);
  let result: RemoteResult = {};
  let error: Error | undefined;
  await executeRemoteFfmpeg(ffmpeg, {
    directory: context.cwd,
    requestId: crypto.randomUUID(),
    options: {},
    calls: steps as never,
    operation: operation as never,
  }, event => {
    if (event.event === "error") {
      const failure = event.args[0] as { message?: string };
      error = Object.assign(new Error(failure.message ?? "FFmpeg 执行失败"), failure);
    } else if (event.event === "result") {
      const payload = event.args[0];
      result = typeof payload === "object" && payload !== null ? { ...(payload as RemoteResult) } : {};
    } else if (event.event === "end") {
      result = { ...result, stdout: String(event.args[0] ?? ""), stderr: String(event.args[1] ?? "") };
    }
  }, signal ?? new AbortController().signal);
  if (error) throw error;
  return result;
}

// ACT: 与 cardQueryParameters 同样的理由 —— **手写 JSON Schema 字面量**，不调 z.toJSONSchema。
// 工具产物会被构建压缩，zod 的内部标记在产物里被抹掉，z.toJSONSchema 会在工具加载时直接抛错、
// 整个工具起不来。手写字面量不依赖 zod 内部结构。代价：与下面的 zod schema 要同步维护。
const renderCardSchema = z.strictObject({
  slug: z.string().trim().min(1).max(64).describe("要渲染的 HTML 卡 slug（先用 useCard 检出来）"),
  width: z.number().int().positive().max(8192).describe("目标成片宽度（不是卡的默认画幅）"),
  height: z.number().int().positive().max(8192).describe("目标成片高度"),
  fps: z.number().int().positive().max(120).optional(),
  parameters: z.record(z.string(), z.number()).optional().describe("覆盖卡的参数；越界会被拒"),
  output: z.string().trim().min(1).max(4096).describe("输出文件（工作区内相对路径）"),
  targetVideo: z.string().trim().min(1).max(4096).optional()
    .describe("有值就顺带把卡叠到这段视频上（工作区内相对路径）；会校验画幅一致"),
}).strict();

const renderCardParameters = {
  type: "object",
  additionalProperties: false,
  required: ["slug", "width", "height", "output"],
  properties: {
    slug: { type: "string", minLength: 1, maxLength: 64, description: "要渲染的 HTML 卡 slug（先用 useCard 检出来）" },
    width: { type: "integer", minimum: 1, maximum: 8192, description: "目标成片宽度（不是卡的默认画幅）" },
    height: { type: "integer", minimum: 1, maximum: 8192, description: "目标成片高度" },
    fps: { type: "integer", minimum: 1, maximum: 120 },
    parameters: { type: "object", additionalProperties: { type: "number" }, description: "覆盖卡的参数；越界会被拒" },
    output: { type: "string", minLength: 1, maxLength: 4096, description: "输出文件（工作区内相对路径）" },
    targetVideo: { type: "string", minLength: 1, maxLength: 4096, description: "有值就顺带把卡叠到这段视频上（工作区内相对路径）；会校验画幅一致" },
  },
};

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    const config = configSchema.parse(context.config);

    const recipeTools: ToolDefinition[] = [
      {
        name: "save_analysis_recipe",
        label: "保存分析配方卡",
        description: "把这次对参考视频的分析成果命名保存成一张「视频分析配方卡」，下次做同类视频时可用 list_analysis_recipes 取回来照着做。用户认可分析结论后再调用。",
        promptSnippet: "分析完参考视频、用户认可结论后，问用户想给这张卡起什么名字，然后用这个工具保存。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80, description: "用户给这张卡起的名字" },
            slug: { type: "string", maxLength: 64, description: "更新已有卡时给它的标识；不填表示新建" },
            source: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", maxLength: 4096 },
                url: { type: "string", maxLength: 4096 },
                title: { type: "string", maxLength: 300 },
                durationSeconds: { type: "number", minimum: 0 },
              },
              description: "这条参考素材的来源信息，便于以后追溯",
            },
            pattern: { type: "string", maxLength: 8000, description: "这类视频的套路：骨架、节奏、钩子位置" },
            intent: { type: "string", maxLength: 4000, description: "意图与受众" },
            techniques: {
              type: "array", maxItems: 80,
              items: {
                type: "object", additionalProperties: false, required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200, description: "手法名（说清它是什么做法）" },
                  respondsTo: {
                    type: "string",
                    enum: storyAnchorKeys,
                    description: `它回应故事的哪一下。可选值：\n${storyAnchorGuide()}\n**这是复刻的关键** —— 写清关系而不是时刻，换个脚本它照样成立。`,
                  },
                  form: { type: "string", maxLength: 2000, description: "参考片里它长什么样（形式，不是要照抄的像素）" },
                  atSeconds: { type: "number", minimum: 0, description: "参考片里的时点（仅作观察记录，不是新片的时间）" },
                  role: { type: "string", maxLength: 2000, description: "它替观众做了什么 —— 这才是要保留的东西（例如：让价格可信、把注意力交给下一个想法）" },
                  when: { type: "string", maxLength: 2000, description: "新片子里用什么形式完成同一件事（复刻时的落法）" },
                  evidence: { type: "string", maxLength: 4096, description: "支撑这条手法的证据（帧图路径或时刻）" },
                },
              },
              description: "值得复用的手法清单。每条都要写 respondsTo（在回应什么）与 role（替观众做了什么），并引用证据",
            },
            evidence: {
              type: "array", maxItems: 200,
              items: {
                type: "object", additionalProperties: false, required: ["kind", "label", "ref"],
                properties: {
                  kind: { type: "string", minLength: 1, maxLength: 64, description: "证据种类，如 帧网格 / 变化候选 / 词级时间" },
                  label: { type: "string", minLength: 1, maxLength: 300 },
                  ref: { type: "string", maxLength: 4096, description: "证据指向（工作区路径或时刻）" },
                },
              },
            },
            pitfalls: { type: "array", maxItems: 60, items: { type: "string", maxLength: 2000 } },
          },
        } as never,
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const { data } = await recipeRequest<{ slug: string; name: string }>("/api/analysisRecipes/save", "POST", params as Record<string, unknown>);
          return {
            content: [{ type: "text", text: `已保存配方卡「${data.name}」（标识 ${data.slug}）。下次做同类视频时用 list_analysis_recipes 取回它。` }],
            details: data,
          };
        },
      } as ToolDefinition,
      {
        name: "list_analysis_recipes",
        label: "取用分析配方卡",
        description: "列出用户保存的「视频分析配方卡」，含每张卡记录下来的套路、手法与坑。做同类视频前先取一张照着做；不给 slug 时返回全部卡。",
        promptSnippet: "要复刻某类视频前，先 list_analysis_recipes 看有没有用户存过的同类配方卡，有就照它那套做法。",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { slug: { type: "string", maxLength: 64, description: "给标识时只取这一张的完整内容" } },
        } as never,
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const input = params as { slug?: string };
          if (input.slug) {
            const { data } = await recipeRequest<Record<string, unknown>>("/api/analysisRecipes/get", "GET", undefined, { slug: input.slug });
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], details: data };
          }
          const { data } = await recipeRequest<{ slug: string; name: string; pattern?: string; techniques?: unknown[] }[]>("/api/analysisRecipes/list", "GET");
          const lines = data.length
            ? data.map(recipe => `· ${recipe.name}（${recipe.slug}）：${recipe.pattern ?? "未写套路"}｜${recipe.techniques?.length ?? 0} 个手法`)
            : ["用户还没有保存过配方卡。"];
          return { content: [{ type: "text", text: lines.join("\n") }], details: data };
        },
      } as ToolDefinition,
    ];

    return [...recipeTools, ...buildTools(context, config)];
  },
};

/** 调服务端的配方卡接口。ACT: 与 videoFetch 工具同做法 —— 浏览器与 Agent 走同一条实现。 */
async function recipeRequest<T>(path: string, method: "GET" | "POST", body?: unknown, query?: Record<string, string>): Promise<{ data: T }> {
  const port = process.env.TOONFLOW_PORT ?? process.env.PORT ?? "3000";
  const url = new URL(`http://127.0.0.1:${port}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-toonflow-workspace": "1", origin: `http://127.0.0.1:${port}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => undefined) as { code?: number; data?: T; message?: string } | undefined;
  if (!response.ok || payload?.code !== 200) throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`);
  return { data: payload.data as T };
}

const buildTools = (context: ToolContext, config: ReturnType<typeof configSchema.parse>): ToolDefinition[] => {
  async function readJson<T>(path: string): Promise<T> {
      const buffer = await context.files.readFile(path);
      // 容忍工具写入的 UTF-8 BOM（PowerShell 等会让 JSON.parse 直接抛错）
      return JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, "")) as T;
    }

    /**
     * 探测媒体信息。
     *
     * ACT: 抽出来共用 —— checkVideo 与剪映草稿导出（要底片真实时长）都要它。
     * 注意 fluent 的 ffprobe 第一个参数是**要探测的文件名**而不是选项，
     * 所以用 `.input()` 配好输入后不再传参数（踩过：传选项数组会探测不到任何流）。
     */
    async function probeMedia(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
      const ffmpeg = await context.ffmpeg(signal);
      let probe: Record<string, unknown> = {};
      await executeRemoteFfmpeg(ffmpeg, {
        directory: context.cwd,
        requestId: crypto.randomUUID(),
        options: {},
        calls: [{ method: "input", args: [path] }] as never,
        operation: { method: "ffprobe", args: [] } as never,
      }, event => {
        if (event.event === "result") {
          const payload = event.args[0];
          if (typeof payload === "object" && payload !== null) probe = payload as Record<string, unknown>;
        }
      }, signal ?? new AbortController().signal);
      return probe;
    }

    /** 取媒体时长（微秒）。剪映的素材登记用微秒。 */
    async function probeDurationUs(path: string, signal?: AbortSignal): Promise<number> {
      const probe = await probeMedia(path, signal);
      const format = (probe.format ?? {}) as { duration?: string | number };
      const seconds = Number(format.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`读不到 ${path} 的时长，无法登记进剪映草稿`);
      }
      return Math.round(seconds * 1_000_000);
    }

    const tools: ToolDefinition[] = [
      {
        name: "checkVideo",
        label: "成片质量闸",
        description: "对成片跑交付前质检：帧率一致性、音画时长差、任意 0.8s 全静止段，以及（给了分镜表时）镜头落点保护带。返回逐项结论与可复核的具体数值。",
        promptSnippet: "交付成片前必须跑 checkVideo；失败项要真去修，不要只报告。",
        promptGuidelines: [
          "静止段失败的处置不是豁免：让画面里还有极缓的持续运动（例如相机微推），而不是把这一关关掉。",
          "帧率不一致多半是混入了不同帧率的素材，要回到源头统一帧率。",
        ],
        parameters: z.toJSONSchema(checkSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const { video, shots: shotsPath, skipFreeze } = checkSchema.parse(params);
          const passes: { name: string; detail: string }[] = [];
          const failures: { name: string; detail: string }[] = [];
          const warnings: { name: string; detail: string }[] = [];

          // 一次 ffprobe 同时取视频与音频流（探测细节见 probeMedia）。
          let probe: Record<string, unknown> = {};
          try {
            probe = await probeMedia(video, signal);
          } catch (error) {
            probe = { __error: error instanceof Error ? error.message : "探测失败" };
          }

          const streams = (Array.isArray(probe.streams) ? probe.streams : []) as {
            codec_type?: string; r_frame_rate?: string; avg_frame_rate?: string; duration?: string; width?: number; height?: number;
          }[];
          if (!streams.length) {
            failures.push({ name: "探测", detail: `读不到 ${video} 的流信息，质检无法进行${typeof probe.__error === "string" ? `：${probe.__error}` : ""}` });
          } else {
            const videoStream = streams.find(item => item.codec_type === "video");
            const audioStream = streams.find(item => item.codec_type === "audio");
            if (!videoStream) failures.push({ name: "帧率", detail: "没有视频流" });
            else {
              const frameFailures = checkFrameRate({
                rFrameRate: videoStream.r_frame_rate,
                avgFrameRate: videoStream.avg_frame_rate,
                width: videoStream.width,
                height: videoStream.height,
              }, config.targetFps);
              if (frameFailures.length) failures.push(...frameFailures);
              else passes.push({ name: "帧率", detail: `${config.targetFps}fps（与目标一致、恒定）${videoStream.width}×${videoStream.height}` });
            }
            if (videoStream && audioStream) {
              const avFailures = checkAvDuration(videoStream.duration, audioStream.duration, config.targetFps);
              if (avFailures.length) failures.push(...avFailures);
              else passes.push({ name: "音画时长", detail: `视频 ${Number(videoStream.duration).toFixed(3)}s / 音频 ${Number(audioStream.duration).toFixed(3)}s` });
            } else {
              warnings.push({ name: "音画时长", detail: "没有音频流，跳过" });
            }
          }

          if (!skipFreeze) {
            const freeze = await run(context, [
              { method: "input", args: [video] },
              { method: "videoFilters", args: [`freezedetect=n=0.003:d=${config.freezeDuration}`] },
              { method: "noAudio" },
              { method: "outputOptions", args: ["-f", "null"] },
              { method: "output", args: ["-"] },
            ], { method: "run", args: [] });
            const spans = parseFreezeSpans(freeze.stderr ?? "");
            const freezeFailures = checkFreeze(spans, config.freezeDuration);
            if (freezeFailures.length) failures.push(...freezeFailures);
            else passes.push({ name: "静止", detail: `没有 ≥ ${config.freezeDuration}s 的全静止段` });
          }

          if (shotsPath) {
            const shots = await readJson<{ id: string; start: number; end: number }[]>(shotsPath);
            const tailFailures = checkShotTail(shots, config.shotTail);
            if (tailFailures.length) failures.push(...tailFailures);
            else passes.push({ name: "镜头落点", detail: `${shots.length} 个镜头都 ≥ ${config.shotTail}s 保护带` });
          }

          const summary = failures.length
            ? `质检未通过：${failures.length} 项失败`
            : "质检通过";
          return {
            content: [{ type: "text", text: `${summary}\n${JSON.stringify({ passes, warnings, failures })}` }],
            details: { passes, warnings, failures },
          };
        },
      },
      {
        name: "makeSubtitle",
        label: "配音对齐出字幕",
        description: "把语音识别结果对齐到口播稿并生成 ASS 字幕（含逐字高亮）。返回每句的时间与 match 覆盖率，覆盖率低于 0.90 的句子需要人工听核。",
        promptSnippet: "makeSubtitle 产出的 ASS 用 ffmpeg 工具的 subtitles 滤镜烧录；match < 0.90 的句子要人工听核。",
        promptGuidelines: [
          "稿子是句子的权威：不要把语音识别的分句当成字幕分句。",
          "识别结果里数字可能被写成阿拉伯数字（三千→3000），工具会归一化，不需要先改稿。",
        ],
        parameters: z.toJSONSchema(subtitleSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const request = subtitleSchema.parse(params);

          // 稿子：一行一句，或含 sentences 的 JSON
          const scriptRaw = (await context.files.readFile(request.script)).toString("utf8").replace(/^\uFEFF/, "");
          let scriptSentences: string[];
          if (request.script.endsWith(".json") && scriptRaw.trim().startsWith("{")) {
            const parsed = JSON.parse(scriptRaw) as { sentences?: unknown[]; text?: string };
            scriptSentences = Array.isArray(parsed.sentences)
              ? parsed.sentences.map(item => String((item as { text?: string })?.text ?? item))
              : [String(parsed.text ?? "")];
          } else {
            scriptSentences = scriptRaw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
          }
          if (!scriptSentences.length) throw new Error("口播稿里没有可用句子");

          // 语音识别结果：本项目约定 beginMs/endMs，兼容 start/end（秒）
          const asr = await readJson<{ sentences?: { words?: Record<string, unknown>[] }[]; words?: Record<string, unknown>[] }>(request.asr);
          const rawWords = asr?.sentences?.[0]?.words ?? asr?.words ?? [];
          if (!rawWords.length) throw new Error("语音识别结果里没有词级时间戳");
          const words: AlignWord[] = rawWords.map(word => ({
            text: String(word.text ?? ""),
            beginMs: Number.isFinite(word.beginMs) ? Number(word.beginMs) : Math.round(Number(word.start ?? 0) * 1000),
            endMs: Number.isFinite(word.endMs) ? Number(word.endMs) : Math.round(Number(word.end ?? 0) * 1000),
            punctuation: typeof word.punctuation === "string" ? word.punctuation : "",
          }));

          const result = alignTiming(scriptSentences, words);
          const output = request.output ?? "assets/subtitles/caption.ass";
          const ass = buildAss(result.sentences, {
            fontName: request.fontName,
            fontSize: request.fontSize,
            karaoke: request.karaoke,
          });
          await context.files.mkdir(output.split("/").slice(0, -1).join("/") || ".", true).catch(() => undefined);
          await context.files.writeFile(output, ass);

          const weak = result.sentences.filter(sentence => !sentence.ok);
          const report = {
            output,
            totalMs: result.totalMs,
            sentences: result.sentences.map(sentence => ({
              index: sentence.index,
              text: sentence.text,
              beginMs: sentence.beginMs,
              endMs: sentence.endMs,
              match: sentence.match,
              ok: sentence.ok,
            })),
            needsReview: weak.map(sentence => ({ index: sentence.index, match: sentence.match, text: sentence.text })),
          };
          const summary = `字幕已生成：${output}（${result.sentences.length} 句，总时长 ${(result.totalMs / 1000).toFixed(2)}s）`
            + (weak.length ? `\n${weak.length} 句覆盖率 < 0.90，建议人工听核。` : "");
          return { content: [{ type: "text", text: `${summary}\n${JSON.stringify(report)}` }], details: report };
        },
      },
      {
        name: "resolveCues",
        label: "音效钉帧校验",
        description: "校验音效 cue 表并换算成音频轨上的绝对时刻，检查镜头越界、镜尾保护带、音量系数、片头补偿边界。钉帧必须先相对镜头起点。",
        promptSnippet: "音效钉帧一律用 {shot, offset} 相对镜头起点，不要写绝对时间。",
        promptGuidelines: [
          "音量是乘法系数不是目标音量：素材本身录得轻时优先换素材或预归一化。",
          "输出音轨偏移必须按自己的渲染管线实测后传入 offsetMs，不要照抄别家的常数。",
        ],
        parameters: z.toJSONSchema(cueSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const request = cueSchema.parse(params);
          const offsetMs = request.offsetMs ?? config.audioOffsetMs;
          const result = resolveSoundCues(request.cues, request.shots, {
            fps: config.targetFps,
            tail: config.shotTail,
            offsetMs,
          });
          const note = offsetMs
            ? ""
            : "\n未做输出音轨偏移补偿：AAC 编码器的 priming 会让整条音轨滞后（内置 aac 约 21ms @48kHz）。这个常数必须按自己的管线实测（抽音轨后做归一化交叉相关，残差 ≤0.5 帧为合格），再用 offsetMs 传入。";
          const summary = result.problems.length
            ? `钉帧校验未通过：${result.problems.length} 项问题`
            : `钉帧校验通过：${result.cues.length} 条 cue 可用`;
          return {
            content: [{ type: "text", text: `${summary}${note}\n${JSON.stringify({ cues: result.cues, warnings: result.warnings, problems: result.problems })}` }],
            details: { cues: result.cues, warnings: result.warnings, problems: result.problems },
          };
        },
      },
      {
        name: "exportDelivery",
        label: "导出可编辑交付物",
        description: "把镜头表与字幕导出成平台无关的可编辑交付物：镜头切段表（CSV，任何剪辑软件或表格工具可读）、可选的标准 EDL（仅单源时）、以及 SRT 字幕。并对切段表做对账（重叠/缝隙/零长段/总时长）。",
        promptSnippet: "交付时用 exportDelivery 导出切段表与 SRT，用户可在自己的剪辑软件里继续改。",
        promptGuidelines: [
          "导出前会先对账切段表：重叠或缝隙会直接失败——剪辑软件对同轨重叠是报错的，缝隙则会让播放闪一下。",
          "标准 EDL 只能表达单一源素材；多源时工具会拒绝导出 EDL 并让你改用 CSV，不要硬塞。",
          "剪映草稿是**例外而非通用做法**：它的格式来自 pyJianYingDraft 的实测序列化器（不是猜的），但「能被剪映打开」在本机无法验证 —— 首次使用必须先按 readme 的冒烟步骤验一个最小草稿，不要直接拿正式片去试。",
          "剪映草稿的底片（plate）必须是**无字幕无音效的干净成片**：字幕与音效在草稿里是可编辑的独立轨，重复烘焙会导致剪映里字幕叠两层。",
        ],
        parameters: z.toJSONSchema(deliverySchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const request = deliverySchema.parse(params);
          const directory = (request.outputDirectory ?? "assets/delivery").replace(/\/+$/, "");
          const prefix = request.name ?? "delivery";

          const { segments, totalUs } = buildEditList(
            request.shots.map(shot => ({
              id: shot.id,
              ...(shot.source ? { source: shot.source } : {}),
              start: shot.start,
              end: shot.end,
              ...(shot.sourceStart === undefined ? {} : { sourceStart: shot.sourceStart }),
            })),
            config.targetFps,
            request.source ?? "",
          );

          // 对账不过就不写文件：给出坏数据比不给更糟（用户会在剪辑软件里才发现）
          const report = checkEditList(segments);
          if (report.failures.length) {
            return {
              content: [{ type: "text", text: `切段表未通过对账，未写出任何文件：\n${report.failures.map(f => `  ✗ ${f.name}  ${f.detail}`).join("\n")}` }],
              details: { failures: report.failures },
            };
          }

          await context.files.mkdir(directory, true).catch(() => undefined);
          const written: string[] = [];
          const csvPath = `${directory}/${prefix}-edit.csv`;
          await context.files.writeFile(csvPath, editListToCsv(segments, config.targetFps));
          written.push(csvPath);

          // EDL 仅单源可用；多源不是错误，是格式本身的限制
          let edlNote = "";
          try {
            const edlPath = `${directory}/${prefix}-edit.edl`;
            await context.files.writeFile(edlPath, editListToEdl(segments, config.targetFps));
            written.push(edlPath);
          } catch (error) {
            edlNote = `\n未导出 EDL：${error instanceof Error ? error.message : "格式限制"}`;
          }

          let srtNote = "";
          let sentences: { text: string; beginMs: number; endMs: number }[] = [];
          if (request.timestamps) {
            const timestamps = await readJson<{ sentences?: { text: string; beginMs: number; endMs: number }[] }>(request.timestamps);
            sentences = timestamps.sentences ?? [];
            const srtPath = `${directory}/${prefix}.srt`;
            await context.files.writeFile(srtPath, buildSrt(sentences));
            written.push(srtPath);
            srtNote = `\n字幕 ${sentences.length} 条 → ${srtPath}（SRT 不带样式，便于在别的软件里改）`;
          }

          // ── 剪映草稿：两个文件写在 outputDirectory/<草稿名>/ 下 ──
          let jianyingNote = "";
          if (request.jianying) {
            const plateDurationUs = await probeDurationUs(request.jianying.plate);
            const draft = buildJianyingDraft({
              width: request.jianying.width ?? 1920,
              height: request.jianying.height ?? 1080,
              fps: config.targetFps,
              name: request.jianying.name,
              platePath: request.jianying.plate,
              plateDurationUs,
              // 镜头表是秒 → 转帧。切段表已经用同一套取整算过，这里必须用同样的换算，
              // 否则剪映里的切点会与 CSV 差一两帧。
              shots: request.shots.map(shot => ({
                id: shot.id,
                startFrame: Math.round(shot.start * config.targetFps),
                endFrame: Math.round(shot.end * config.targetFps),
              })),
              subtitles: sentences.map(sentence => ({
                text: sentence.text,
                beginMs: sentence.beginMs,
                endMs: sentence.endMs,
                size: 6.0,
                color: [1, 1, 1] as [number, number, number],
                // 剪映的 transform_y 按半高归一：屏幕 y = 540 × (1 − t)，底部字幕区 t ≈ −0.8
                y: -0.8,
              })),
            });
            const draftDirectory = `${directory}/${request.jianying.name}`;
            await context.files.mkdir(draftDirectory, true).catch(() => undefined);
            await context.files.writeFile(`${draftDirectory}/draft_content.json`, draft.content);
            await context.files.writeFile(`${draftDirectory}/draft_meta_info.json`, draft.meta);
            written.push(`${draftDirectory}/draft_content.json`, `${draftDirectory}/draft_meta_info.json`);
            jianyingNote = `\n剪映草稿 → ${draftDirectory}/（draft_content.json + draft_meta_info.json）`
              + "\n  首次使用请先按 readme 的冒烟步骤验一个最小草稿："
              + "本机没有剪映，「能被剪映打开」这一步未经真机验证。";
          }

          const detail = {
            totalUs,
            totalSeconds: Number((totalUs / 1_000_000).toFixed(3)),
            segments: segments.map(segment => ({
              id: segment.id,
              source: segment.source,
              sourceIn: usToTimecode(segment.sourceStartUs),
              duration: Number((segment.durationUs / 1_000_000).toFixed(3)),
              targetStart: usToTimecode(segment.targetStartUs),
            })),
            written,
          };
          const summary = `已导出 ${written.length} 个交付物（${segments.length} 段，总时长 ${detail.totalSeconds}s）`
            + `\n${written.map(path => "  " + path).join("\n")}${edlNote}${srtNote}${jianyingNote}`;
          return { content: [{ type: "text", text: `${summary}\n${JSON.stringify(detail)}` }], details: detail };
        },
      },
      {
        name: "useCard",
        label: "查/用画面配方卡",
        description: "查询内置的画面卡（按素材类型与语义检索），或取某一张的完整内容。库里有两类卡：FFmpeg 滤镜卡（给出滤镜链、已知坑、落位自检）与 HTML 画面卡（浏览器渲染的整段画面或透明叠加层，给出形态、时长、可调参数与按目标画幅渲染的设计画布尺寸）。",
        promptSnippet: "做镜头效果前先 useCard 查有没有现成的卡；库里既有滤镜卡也有整段画面/叠加层卡，不要每次临场写滤镜或自己画。**烧字幕、做转场、加镜头运动、做文字动画之前都必须先检索一次卡库。**",
        promptGuidelines: [
          // ACT: 这条原先太软（"做镜头效果前先查"），实测有 Agent 直接手写 ASS + subtitles 滤镜烧字幕、
          // 完全没检索卡库，还自称"这轮我跳过了卡库" —— 因为字幕/文字它不认为属于"镜头效果"。
          // 所以把范围写全，并把"跳过"变成一件必须声明的事。
          "**强制门槛**：在写任何滤镜链之前 —— 包括 subtitles/ASS 烧字幕、drawtext、转场、镜头运动、文字动画、调色包装 —— **先调一次 useCard 检索**（给 inputs + semantics）。没检索就动手，等于漏了这一步。",
          "确实没有合适的卡时**可以自己写**，但必须在回话里明确说「查过了卡库，X 类没有对应卡，原因……」。**不许不查就写，也不许假装用了卡。**",
          "先按素材类型与语义检索（inputs + semantics），再取具体卡 —— 卡是词汇表，不是关键词垃圾桶。",
          "卡上的「已知坑」必须逐条核，那些都是实际返工换来的；卡上的 checks 是做完要自检的项。",
          "实例化出的 filters 交给 ffmpeg 工具执行（按顺序接在 -vf 或 filter_complex 里）；卡若给了 secondInput，把它当成 `-f lavfi -i` 的第二路输入。参数越界会被拒，不要绕过校验自己拼字符串。",
          "**先看 kind**：ffmpeg 卡给滤镜链（接在 -vf/filter_complex 里）；html 卡是浏览器渲染的整段画面（fullscreen，替代这一段）或透明叠加层（overlay，叠在视频上），**不能当滤镜用**。",
          // ACT: 这句话要同时点明两件事：卡的 baseSize 只是默认值；以及取卡时给 frameSize 的收益。
          "**画幅**：所有卡都是分辨率无关的 —— 卡里声明的 `size`/baseSize 只是**未指定时的默认值**，与目标画幅不同是**预期的**，不是限制。取卡时**一律传 frameSize**（成片宽高）：HTML 卡据此算设计画布，滤镜卡据此填好尺寸参数（未传则用默认 1920×1080，竖屏会错）。不要以为卡「按横屏调好的」就去手改卡里的数字。",
          // ACT: 叠加卡是**反向依赖**：它叠在 AI 视频上，所以卡必须先定、视频后生成。
          // 顺序反了的话，主体落在文字底下时视频已经产出，只能重做。
          "**叠加卡（overlay）必须先定卡、再生成视频**。取到叠加卡后看它的 `occlusion`（占位区，归一化）或 `\"full\"`（整屏参与）：把「画面主体避开该区域、不要居中」写进**视频生成的提示词**，然后才生成那一段。`fullscreen` / `transition` 卡没有这个顺序要求（前者替代画面、后者作用于两镜之间）。",
        ],
        parameters: cardQueryParameters,
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const request = cardQuerySchema.parse(params);

          // 取某一张卡：按 kind 分流 —— FFmpeg 卡给滤镜链，HTML 卡给页面生成方式
          if (request.slug) {
            const entry = cardCatalog.find(item => item.slug === request.slug);
            if (!entry) {
              return {
                content: [{ type: "text", text: `没有这张卡：${request.slug}\n现有：${cardCatalog.map(item => item.slug).join("、")}` }],
                details: { available: cardCatalog.map(item => item.slug) },
              };
            }

            // —— HTML 卡：不能当滤镜用，给的是「按目标画幅生成一段页面」的说明 ——
            if (entry.kind === "html") {
              const definition = htmlCards.find(item => item.meta.slug === entry.slug);
              if (!definition) {
                return { content: [{ type: "text", text: `目录与卡库不一致：${entry.slug} 在目录里但卡库里没有。` }], details: {} };
              }
              const frameSize = request.frameSize;
              const fit = frameSize
                ? fitCardToFrame(
                  { slug: entry.slug, shape: definition.meta.shape, baseSize: definition.size },
                  frameSize,
                )
                : undefined;
              const params = Object.entries(definition.params ?? {})
                .map(([name, spec]) => `${name}(${spec.min}~${spec.max}，默认 ${spec.value})`);
              const shapeNote = definition.meta.shape === "fullscreen"
                ? "全屏卡：它**替代这一段画面**，不叠在 AI 视频上。"
                : definition.meta.shape === "overlay"
                  ? "叠加卡：**透明背景**，叠在 AI 视频上（输出带 alpha 通道）。"
                  : "转场卡：作用在**两个镜头之间**。";
              const text = [
                `${definition.meta.title}：${definition.meta.oneliner}`,
                `形态：${definition.meta.shape} — ${shapeNote}`,
                // ACT: 叠加卡必须把「占哪块屏」交出来，这是**生成视频之前**要用的信息。
                // 不知道它就会先做视频、再叠卡，主体正好落在文字底下时视频已经产出，只能重做。
                ...(definition.meta.occlusion
                  ? [definition.meta.occlusion === "full"
                    ? "**占位：整屏参与** —— 这张卡会压暗/盖住整个画面，底下视频只能当纹理，没有可让的位置。要用它就先接受这一点，或改短文案/换别的卡。"
                    : `**占位：${formatOcclusion(definition.meta.occlusion)}**（归一化，相对画幅）—— 生成这一段的视频时**先把这个区域写进提示词**（主体避开该区、不要居中），再生成；否则主体会被这张卡的文字压住，而视频已经产出、只能重做。`]
                  : []),
                `时长：${definition.frames} 帧 @30fps（${(definition.frames / 30).toFixed(2)}s）`,
                `可调参数：${params.join("、")}`,
                `形状：${definition.meta.shape}`,
                // ACT: 文案目前硬编码在卡里，如实告知 —— 不要让 Agent 以为它能改字
                "**文案不可改**：这张卡的文案写在卡内（render 里），只能调上面那些数值参数。",
                fit
                  ? `按目标画幅 ${frameSize!.width}×${frameSize!.height} 渲染 → 设计画布 ${fit.design.w}×${fit.design.h}，缩放 ${fit.design.scale.toFixed(3)}`
                    + (fit.warnings.length ? `\n提醒：\n${fit.warnings.map(w => "  · " + w).join("\n")}` : "")
                  : "未给 frameSize：**必须按目标画幅渲染**（全屏卡替代这一段画面，叠加卡的画幅要与视频一致）。给 frameSize 可以拿到设计画布尺寸与该卡的画幅提醒。",
                `来源：${definition.meta.origin ?? "（未标注）"}`,
              ].join("\n");
              return {
                content: [{ type: "text", text }],
                details: {
                  kind: "html",
                  slug: definition.meta.slug,
                  shape: definition.meta.shape,
                  frames: definition.frames,
                  baseSize: definition.size,
                  textLocked: true,
                  parameters: definition.params,
                  origin: definition.meta.origin,
                  ...(definition.meta.occlusion ? { occlusion: definition.meta.occlusion } : {}),
                  ...(fit ? { frameFit: fit } : {}),
                },
              };
            }

            // —— 分析卡：它**不产画面**，所以不能走滤镜实例化路径 ——
            // 直接告诉 Agent 该用哪个工具，而不是抛"没有这张卡"或拼出一条空滤镜。
            const analysisEntry = cardCatalog.find(item => item.slug === request.slug && item.kind === "analysis");
            if (analysisEntry) {
              return {
                content: [{ type: "text", text: `${analysisEntry.title}：${analysisEntry.oneliner}\n产出证据：${(analysisEntry.evidence ?? []).join("、")}\n为什么必须用它：${analysisEntry.why ?? "（未写）"}\n这张卡**不产出画面**，不能用它当滤镜 —— 用 videoFetch 工具的 analyze_reference 或 mediaAnalysis 工具的 media_analyze 执行对应的取证动作。` }],
                details: { slug: analysisEntry.slug, kind: "analysis", evidence: analysisEntry.evidence, why: analysisEntry.why },
              };
            }

            // —— FFmpeg 卡：原有的滤镜实例化路径 ——
            let card;
            try {
              card = findCard(builtInCards, request.slug);
            } catch (error) {
              return {
                content: [{ type: "text", text: `没有这张卡：${request.slug}\n现有：${cardCatalog.map(item => item.slug).join("、")}` }],
                details: { available: cardCatalog.map(item => item.slug) },
              };
            }
            let filters: string[] = [];
            let secondInput: string | undefined;
            let applied: Record<string, number> = {};
            try {
              // ACT: 滤镜卡与 HTML 卡一样要按目标画幅走。
              // 原先这里只把 request.parameters 传下去，frameSize 完全不参与 ——
              // 于是需要绝对像素的卡（slowPushIn 的 zoompan s=、flashCut 的第二路白场）
              // 只能把分辨率写死进字符串，靠 pitfalls 里一句「换画幅要手改」来兜。
              // 现在把 frameSize 填进卡的 width/height 参数（卡已声明这两个参数，默认 1920×1080），
              // Agent 传了画幅就自动对，与 HTML 卡的分辨率无关行为对齐。
              const parameters: Record<string, number> = { ...(request.parameters ?? {}) };
              const frameSize = request.frameSize;
              if (frameSize) {
                if (parameters.width === undefined) parameters.width = frameSize.width;
                if (parameters.height === undefined) parameters.height = frameSize.height;
              }
              const result = instantiateCard(card, parameters);
              filters = result.filters;
              secondInput = result.secondInput;
              applied = result.applied;
            } catch (error) {
              return {
                content: [{ type: "text", text: `参数不合法，未实例化：${error instanceof Error ? error.message : "未知错误"}\n卡声明的参数：${card.parameters.map(p => `${p.name}(${p.min}~${p.max}，默认 ${p.value})`).join("、")}` }],
                details: { slug: card.slug, parameters: card.parameters },
              };
            }
            const payload = {
              slug: card.slug,
              title: card.title,
              category: card.category,
              oneliner: card.oneliner,
              durationHint: card.durationHint,
              inputs: card.inputs,
              semantics: card.semantics,
              parameters: applied,
              filters,
              ...(secondInput ? { secondInput } : {}),
              pitfalls: card.pitfalls,
              checks: card.checks,
            };
            // ACT: 必须把画幅结论说清楚 —— 实测有 Agent 以为滤镜卡「写死了 1920×1080、竖屏要手改」，
            // 因为原先的文案只把 pitfalls 原样倒出来。现在把「这串滤镜实际按哪个画幅生成」明说。
            const frameNote = request.frameSize
              ? `输出画幅：${request.frameSize.width}×${request.frameSize.height}（已按它填好卡里的尺寸参数）`
              : "输出画幅：未给 frameSize，尺寸参数取默认 1920×1080 —— **竖屏成片必须传 frameSize**，否则输出尺寸不对";
            const secondNote = secondInput ? `\n第二路输入（lavfi 源，接成 -f lavfi -i "${secondInput}"）：${secondInput}` : "";
            return {
              content: [{ type: "text", text: `${card.title}：${card.oneliner}\n${frameNote}\n滤镜链：${filters.join(" , ")}${secondNote}\n已知坑：\n${card.pitfalls.map(p => "  · " + p).join("\n")}\n落位自检：\n${card.checks.map(c => "  · " + c).join("\n")}` }],
              details: payload,
            };
          }

          // 检索：给候选与排序理由，由 agent 决策（不替它选）
          // ACT: 走**统一目录**（FFmpeg 卡 + HTML 卡 + **分析卡**），否则 Agent 根本不知道
          // cardRuntime 里那 24 张 HTML 卡、以及"读素材"那 6 张分析卡存在。
          // 踩过两次：先漏了 HTML 卡，后漏了分析卡 —— 目录少了哪一套，Agent 就看不到哪一套。
          const matched = matchCatalogDetailed(cardCatalog, builtInCards, {
            ...(request.inputs ? { inputs: request.inputs as CardInput[] } : {}),
            ...(request.semantics ? { semantics: request.semantics as CardSemantic[] } : {}),
            ...(request.position ? { position: request.position as CardPosition } : {}),
            ...(request.energy ? { energy: request.energy as CardEnergy } : {}),
          });
          if (!matched.length) {
            return {
              content: [{ type: "text", text: `没有匹配的卡（库共 ${cardCatalog.length} 张：FFmpeg 滤镜卡 ${builtInCards.length} + HTML 画面卡 ${cardCatalog.filter(c => c.kind === "html").length} + 分析卡 ${cardCatalog.filter(c => c.kind === "analysis").length}）。这是真实缺口，不要假装用了卡——可以自己写滤镜，或列出可用卡让用户决定。\n可用：${cardCatalog.map(c => c.slug).join("、")}` }],
              details: { candidates: [], available: cardCatalog.map(c => c.slug) },
            };
          }
          const recipeBySlug = new Map(builtInCards.map(card => [card.slug, card]));
          const candidates = matched.map(({ entry, score, reasons }) => {
            const recipe = recipeBySlug.get(entry.slug);
            return {
              slug: entry.slug,
              title: entry.title,
              // kind 决定后续怎么用：ffmpeg 给滤镜链，html 给一段页面
              kind: entry.kind,
              ...(entry.shape ? { shape: entry.shape } : {}),
              // 候选阶段就带上占位区：分镜时才能判断「这一段要不要为它让位」
              ...(entry.occlusion ? { occlusion: entry.occlusion } : {}),
              oneliner: entry.oneliner,
              score,
              reasons,
              ...(entry.frames ? { frames: entry.frames } : {}),
              ...(entry.textLocked ? { textLocked: true } : {}),
              // FFmpeg 卡才有滤镜参数；HTML 卡的可调参数在取卡时单独给
              ...(recipe ? { parameters: recipe.parameters.map(p => `${p.name}(${p.min}~${p.max}，默认 ${p.value})`) } : {}),
            };
          });
          const htmlCount = candidates.filter(entry => entry.kind === "html").length;
          const overlayCandidates = candidates.filter(entry => entry.kind === "html" && entry.shape === "overlay");
          return {
            content: [{ type: "text", text: `${candidates.length} 张候选（按分排序；HTML 画面卡 ${htmlCount} 张）：\n${candidates.map(c => `  ${c.slug} [${c.kind}${c.shape ? "·" + c.shape : ""}] ${c.score} ${c.title} — ${c.reasons.join("；")}`).join("\n")}\n\n**kind 决定怎么用**：ffmpeg 卡取出来是滤镜链，接在 ffmpeg 的 -vf/filter_complex 里；html 卡是浏览器渲染的整段画面（fullscreen）或透明叠加层（overlay），**不能当滤镜用**。选定后用 slug 取卡的完整内容。`
              // ACT: 这里就把「顺序」点出来。叠加卡叠在 AI 视频上，所以**卡要先定、视频后生成** ——
              // 反过来（先生成视频再叠卡）一旦主体落在文字底下，只能重做视频。
              + (overlayCandidates.length
                ? `\n\n**顺序提醒**：候选里有 ${overlayCandidates.length} 张叠加卡（overlay）。叠加卡是**叠在 AI 视频上**的，所以**先定卡、再生成视频**：取卡时看它的 occlusion（占位区），把该区域写进视频生成提示词（主体避开、别居中），然后再生成。先生成视频再叠卡，主体被文字压住时视频已经产出，只能重做。`
                : "") }],
            details: { candidates },
          };
        },
      },

      // ── 渲染 HTML 卡 ────────────────────────────────────────────────
      {
        name: "renderCard",
        label: "渲染画面卡",
        description: "把一张 HTML 画面卡渲成视频。给 frameSize（目标成片画幅）、参数与输出路径；叠加卡可同时给 targetVideo，工具会渲出带透明通道的视频并直接叠到该视频上。",
        promptSnippet: "useCard 查到 html 卡之后，用 renderCard 把它渲出来；不要试图把 html 卡接进 filter_complex。",
        promptGuidelines: [
          "**frameSize 必须是成片画幅**，不是卡的默认画幅。卡是分辨率无关的，按目标画幅等比渲染；给错画幅会得到错尺寸的画面。",
          "全屏卡（fullscreen）渲出的是替代这一段的整段画面；叠加卡（overlay）渲出的是带 alpha 的透明层。转场卡不能直接叠到一段视频上，要由调用方决定插在哪两镜之间。",
          "给 targetVideo 时工具会顺带合成，并且**校验画幅一致** —— 不一致会明确报错，不要靠缩放绕过去（二次缩放会让字幕与描边抖动）。",
          "卡自带文案，只能调数值参数；用户要改字时要如实说明。",
        ] as const,
        parameters: renderCardParameters,
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const request = renderCardSchema.parse(params);
          if (!context.cardRender) {
            return {
              content: [{ type: "text", text: "当前环境没有卡渲染能力（宿主没有注入 cardRender 服务）。请如实告诉用户这张卡无法在这里渲染，不要假装已经渲好。" }],
              details: { available: false },
            };
          }
          const entry = cardCatalog.find(item => item.slug === request.slug);
          if (!entry || entry.kind !== "html") {
            const htmlOnly = cardCatalog.filter(item => item.kind === "html").map(item => item.slug);
            return {
              content: [{ type: "text", text: `renderCard 只能渲染 HTML 画面卡；${request.slug} ${entry ? "是 FFmpeg 滤镜卡，请用 useCard 取滤镜链" : "不在卡库里"}。\n可渲染的卡：${htmlOnly.join("、")}` }],
              details: { available: htmlOnly },
            };
          }
          try {
            const result = await context.cardRender(signal).render(request, () => {});
            return {
              content: [{ type: "text", text: `已渲染 ${result.slug}：${result.outputPath}\n${result.width}×${result.height} · ${result.frames} 帧 · ${result.durationSeconds}s @ ${result.fps}fps · ${result.shape}${result.hasAlpha ? " · 带透明通道" : ""}${request.targetVideo ? " · 已叠到目标视频" : ""}` }],
              details: result,
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `渲染失败：${error instanceof Error ? error.message : "未知错误"}\n不要假装渲染成功 —— 如实告诉用户失败原因。` }],
              details: { slug: request.slug },
            };
          }
        },
      },
    ];
    return tools;
};

export default plugin;
