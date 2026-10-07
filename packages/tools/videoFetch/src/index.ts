// 取流与参考分析工具：给 Agent 一条链接或本地素材，跑完整个分析流程。
//
// 为什么合成一个工具：用户的原话是「当我给 Agent 一个链接让它分析这个视频时，
// 它会实现完整的分析流程，然后输出」—— 取流、探测、证据、词级时间是一条链，
// 拆成四个工具会让 Agent 自己拼顺序（它经常漏掉取证直接下结论）。
//
// ACT: 取流走**服务端自己的 HTTP 接口**（`/api/videoFetch`），不直接 import 服务端工具。
// 这样浏览器与 Agent 走同一条取流实现（yt-dlp 引导安装、站点被拒时的中文提示都在那一处）。
import type { ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import type { EvidenceFfmpeg, EvidenceFiles } from "@toonflow/tool-media-analysis/evidence";
import { generateEvidence, probeMedia } from "@toonflow/tool-media-analysis/evidence";

/** 服务端自己的地址：工具跑在 server 进程里，直接连本机即可。 */
function serverBase() {
  const port = process.env.TOONFLOW_PORT ?? process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

async function callServer<T>(path: string, init: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown }): Promise<T> {
  const url = new URL(`${serverBase()}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json", "x-toonflow-workspace": "1", origin: serverBase() },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload = await response.json().catch(() => undefined) as { code?: number; data?: T; message?: string } | undefined;
  if (!response.ok || payload?.code !== 200) throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`);
  return payload.data as T;
}

/** 取流：链接 → 工作区里的本地视频。 */
async function fetchToWorkspace(context: ToolContext, url: string, name?: string) {
  return await callServer<{ path: string; duration: number | null; width: number | null; height: number | null; hasAudio: boolean }>(
    "/api/videoFetch",
    { method: "POST", body: { directory: context.cwd, url, name } },
  );
}

/** 词级时间：转写由配置好的媒体供应商做，失败不阻断分析（要如实说明）。 */
async function transcribe(context: ToolContext, path: string, language?: string, signal?: AbortSignal) {
  try {
    const models = await callServer<{ providerId: string; providerLabel: string; type: string }[]>("/api/ai/media/models", { method: "GET" });
    const provider = models.find(model => model.type === "audio" || model.type === "video");
    if (!provider) return { ok: false as const, reason: "还没有配置可用的语音识别供应商，所以这次没有词级时间" };
    const result = await callServer<unknown>("/api/ai/media/transcript", {
      method: "POST",
      body: { providerId: provider.providerId, directory: context.cwd, path, languageHints: language ? [language] : undefined },
    });
    void signal;
    return { ok: true as const, provider: provider.providerLabel, transcript: result };
  } catch (error) {
    // ACT: 转写失败不该让整次分析失败 —— 画面证据仍然有用，
    // 但**必须如实说明这次没有词级时间**，不能假装有。
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ACT: 手写 JSON Schema 字面量，不调 z.toJSONSchema（工具产物被压缩后 zod 内部标记会丢）。
const fetchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: { type: "string", minLength: 1, maxLength: 4096, description: "视频页面链接（http/https），支持短链" },
    name: { type: "string", maxLength: 200, description: "保存的文件名（不含扩展名）；不填则用视频标题" },
  },
} as const;

const analyzeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source"],
  properties: {
    source: { type: "string", minLength: 1, maxLength: 4096, description: "视频页面链接（http/https）或工作区内的素材路径" },
    name: { type: "string", maxLength: 200, description: "保存的文件名（source 是链接时用）" },
    output: { type: "string", minLength: 1, maxLength: 4096, description: "证据输出目录，默认 analysis/<素材名>/evidence" },
    language: { type: "string", maxLength: 16, description: "语音识别语言（如 zh、en）；不填由供应商决定" },
    start: { type: "number", minimum: 0, description: "只分析这一段起点（秒）" },
    end: { type: "number", minimum: 0, description: "只分析到这一刻（秒）" },
    every: { type: "number", minimum: 0.02, description: "采样间隔（秒），默认区间内均匀取 12 点" },
    columns: { type: "number", minimum: 1, maximum: 12 },
    rows: { type: "number", minimum: 1, maximum: 12 },
    cell: { type: "number", minimum: 64, maximum: 1920 },
    skipTranscript: { type: "boolean", description: "跳过语音转写（只想看画面证据时用）" },
  },
} as const;

const plugin: ToolPlugin = {
  validateConfig: config => config,
  async createTools(context: ToolContext): Promise<ToolDefinition[]> {
    const ffmpegPromise = context.ffmpeg();

    return [
      {
        name: "video_fetch",
        label: "取视频",
        description: "把一个视频页面链接下载到工作区。支持 B站 等站点；站点拒绝自动下载时会给出可执行的替代办法。",
        promptSnippet: "用户给的是链接时，先取流成本地文件再分析；不要对链接直接做分析。",
        parameters: fetchSchema as never,
        async execute(_id, params) {
          const input = params as { url: string; name?: string };
          const result = await fetchToWorkspace(context, input.url, input.name);
          return {
            content: [{ type: "text", text: `已下载到 ${result.path}（${result.duration ?? "?"} 秒，${result.width ?? "?"}x${result.height ?? "?"}，${result.hasAudio ? "含音轨" : "无音轨"}）` }],
            details: result,
          };
        },
      } as ToolDefinition,
      {
        name: "analyze_reference",
        label: "分析参考视频",
        description: "对一条链接或素材跑完整个分析流程：取流（链接时）、读媒体信息、生成帧图与帧网格、找画面变化候选、取词级时间。产出的是**证据**；解读由你根据证据写出来并引用证据路径。",
        promptSnippet: "用户要分析一条视频时用这个工具一步跑完取证；拿到证据后再写你的解读，不要跳过取证直接下结论。",
        parameters: analyzeSchema as never,
        async execute(_id, params, signal) {
          const input = params as {
            source: string; name?: string; output?: string; language?: string;
            start?: number; end?: number; every?: number;
            columns?: number; rows?: number; cell?: number; skipTranscript?: boolean;
          };
          signal?.throwIfAborted();

          // 1) 链接先取流成本地文件 —— 分析一律针对本地文件，避免每次取样都走网络。
          const isLink = /^https?:\/\//i.test(input.source.trim());
          const localPath = isLink ? (await fetchToWorkspace(context, input.source, input.name)).path : input.source;

          // 2) 取证：媒体信息 + 帧图 + 网格 + 变化候选。
          const ffmpeg = await ffmpegPromise as unknown as EvidenceFfmpeg;
          const files = context.files as unknown as EvidenceFiles;
          const stem = localPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "reference";
          const output = input.output ?? `analysis/${stem}/evidence`;
          const evidence = await generateEvidence(ffmpeg, files, {
            source: localPath,
            output,
            start: input.start,
            end: input.end,
            every: input.every,
            columns: input.columns,
            rows: input.rows,
            cell: input.cell,
            signal,
          });
          void probeMedia;

          // 3) 词级时间（可选，失败不阻断，但如实说明）。
          const transcript = input.skipTranscript || !evidence.media.hasAudio
            ? { ok: false as const, reason: evidence.media.hasAudio ? "你选择了跳过语音转写" : "这条素材没有音轨，无法取词级时间" }
            : await transcribe(context, localPath, input.language, signal);

          const lines = [
            `参考素材：${localPath}${isLink ? `（来自 ${input.source}）` : ""}`,
            ...evidence.notes,
            transcript.ok
              ? `词级时间：已取到（供应商 ${transcript.provider}），完整结果见 details.transcript`
              : `词级时间：**没有取到** —— ${transcript.reason}`,
            "",
            "接下来由你写解读：这类视频的套路（骨架、节奏、钩子位置）、值得复用的手法（每条引用上面的证据路径）、已知坑。",
            "写完后如果用户认可，用 save_analysis_recipe 把它命名保存成一张配方卡，下次做同类视频可以直接取用。",
          ];

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              source: input.source,
              localPath,
              output,
              media: evidence.media,
              frames: evidence.frames,
              pages: evidence.pages,
              boundaries: evidence.boundaries,
              transcript: transcript.ok ? transcript.transcript : null,
              transcriptUnavailable: transcript.ok ? undefined : transcript.reason,
            },
          };
        },
      } as ToolDefinition,
    ];
  },
};

export default plugin;
