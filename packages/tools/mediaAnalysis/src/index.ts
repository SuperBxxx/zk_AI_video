// 素材分析工具：读一条视频/音频，产出**可核对的证据**。
//
// 为什么需要它：技能文档要求「参考素材先逐帧拆解成手法清单」，但在这之前 Agent
// 手上没有任何读素材的手段 —— 那条规则一直是空的。这个工具把「取证」这一步补上。
//
// 与后期卡的分工：后期卡产出**画面**，本工具产出**证据**。所以它不写滤镜链、不成片，
// 只把素材里的东西摊开给人核对。
//
// 取证实现与「参考分析节点」共用 `./evidence`（写两份必然漂移）。
import type { ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import type { EvidenceFfmpeg, EvidenceFiles } from "./evidence";
import { generateEvidence, probeMedia, sampleTimes } from "./evidence";

export * from "./evidence";

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/** 输出目录：默认按素材名分文件夹，避免不同素材的证据互相覆盖。 */
function defaultOutput(source: string, suffix: string) {
  const stem = source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "media";
  return `analysis/${stem}/${suffix}`;
}

function assertInsideWorkspace(path: string) {
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) throw new Error("输出目录必须是工作区内的相对路径");
  if (path.split(/[\\/]/).includes("..")) throw new Error("输出目录不能包含 ..");
}

/** 在某个时刻取一帧存成图片（单独导出给 Agent 的 frames 分支用）。 */
async function grabFrame(ffmpeg: EvidenceFfmpeg, source: string, at: number, target: string, signal?: AbortSignal) {
  await new Promise<void>((done, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else done();
    };
    const onAbort = () => { command.kill("SIGKILL"); finish(new Error("已取消")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const command = ffmpeg(source)
      .seekInput(at)
      .frames(1)
      .on("error", error => finish(error instanceof Error ? error : new Error(String(error))))
      .on("end", () => finish());
    command.save(target);
  });
}

// ACT: 与 postProduction 工具同样的理由 —— **手写 JSON Schema 字面量**，不调 z.toJSONSchema。
// 工具产物会被构建压缩，zod 的内部标记在产物里被抹掉，z.toJSONSchema 会在工具加载时直接抛错。
const analyzeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "source"],
  properties: {
    operation: {
      type: "string",
      enum: ["probe", "frames", "evidence"],
      description: "probe=只读媒体信息；frames=按精确时刻取帧图；evidence=一次生成完整证据（帧网格 + 变化候选）",
    },
    source: { type: "string", minLength: 1, maxLength: 4096, description: "素材路径（工作区内相对路径）" },
    output: { type: "string", minLength: 1, maxLength: 4096, description: "输出目录（工作区内相对路径）；不填则放在 analysis/<素材名>/ 下" },
    at: {
      type: "array", maxItems: 48,
      items: { type: "number", minimum: 0 },
      description: "frames 用：要取的时刻列表（秒）",
    },
    start: { type: "number", minimum: 0, description: "区间起点（秒）" },
    end: { type: "number", minimum: 0, description: "区间终点（秒），不含" },
    every: { type: "number", minimum: 0.02, description: "采样间隔（秒）；不填则区间内均匀取 12 点" },
    columns: { type: "number", minimum: 1, maximum: 12, description: "网格列数，默认 3" },
    rows: { type: "number", minimum: 1, maximum: 12, description: "网格行数，默认 3" },
    cell: { type: "number", minimum: 64, maximum: 1920, description: "每格画面宽度，默认 480" },
    rate: { type: "number", minimum: 1, maximum: 120, description: "变化检测的采样帧率，默认 12" },
    threshold: { type: "number", minimum: 0, maximum: 1, description: "变化分数阈值，默认 0.1" },
  },
} as const;

interface AnalyzeInput {
  operation: "probe" | "frames" | "evidence";
  source: string;
  output?: string;
  at?: number[];
  start?: number; end?: number; every?: number;
  columns?: number; rows?: number; cell?: number;
  rate?: number; threshold?: number;
}

const plugin: ToolPlugin = {
  // 本工具不需要可调配置（采样上限是防止产物爆炸的硬边界，写在 schema 里）。
  validateConfig: config => config,
  async createTools(context: ToolContext): Promise<ToolDefinition[]> {
    const tool: ToolDefinition = {
      name: "media_analyze",
      label: "分析素材",
      description: "读一条视频/音频，产出可核对的证据：媒体信息、精确时刻的帧图、帧网格与画面变化候选。不产出画面、不成片。",
      promptSnippet: "读参考视频取证：先 probe 看清编码与时长，再用 evidence 一次拿到帧网格与变化候选，最后按需 frames 补精确帧。",
      parameters: analyzeSchema as never,
      async execute(_id, params, signal) {
        const input = params as AnalyzeInput;
        signal?.throwIfAborted();
        const ffmpeg = await context.ffmpeg(signal) as unknown as EvidenceFfmpeg;
        const files = context.files as unknown as EvidenceFiles;

        if (input.operation === "probe") {
          const info = await probeMedia(ffmpeg, input.source);
          const lines = [
            `素材：${input.source}`,
            `容器：${info.container ?? "未知"}`,
            `时长：${info.duration ?? "未知"} 秒`,
            `画面：${info.width ?? "?"}x${info.height ?? "?"} @ ${info.fps ?? "?"} fps，编码 ${info.videoCodec ?? "无"}`,
            `声音：${info.hasAudio ? info.audioCodec ?? "有" : "无音轨"}`,
          ];
          // H.265 在桌面端（WebView2）没有解码器，会「有声音没画面」—— 提前点出来。
          if (info.videoCodec === "hevc") lines.push("提示：这是 HEVC(H.265)。桌面端预览可能只有声音没有画面；预览或送模型前建议先转 H.264。");
          return { content: [{ type: "text", text: lines.join("\n") }], details: { operation: "probe", ...info } };
        }

        if (input.operation === "frames") {
          if (!input.at?.length) throw new Error("frames 需要 at（时刻列表，秒）");
          const info = await probeMedia(ffmpeg, input.source);
          if (info.duration === null) throw new Error("读不到素材时长，无法按时间取样");
          const output = input.output ?? defaultOutput(input.source, "frames");
          assertInsideWorkspace(output);
          const times = [...new Set(input.at.map(at => round(clamp(at, 0, Math.max(0, info.duration! - 0.001)))))].sort((a, b) => a - b).slice(0, 48);
          if (!times.length) throw new Error("at 里没有有效的时刻");
          await files.mkdir(output, true);
          const frames: { at: number; path: string }[] = [];
          for (const at of times) {
            signal?.throwIfAborted();
            const target = `${output}/at-${at.toFixed(3).replace(".", "_")}s.jpg`;
            await grabFrame(ffmpeg, input.source, at, target, signal);
            frames.push({ at, path: target });
          }
          const text = [
            `已取 ${frames.length} 帧，输出目录：${output}`,
            ...frames.map(item => `${item.at} 秒 → ${item.path}`),
            "文件名里的时刻就是请求时刻；实际取到的是大于等于该时刻的第一帧，偏差小于一帧。",
          ].join("\n");
          return { content: [{ type: "text", text }], details: { operation: "frames", output, frames, media: info } };
        }

        // evidence：一次拿到帧网格与变化候选。
        const output = input.output ?? defaultOutput(input.source, "evidence");
        assertInsideWorkspace(output);
        const result = await generateEvidence(ffmpeg, files, {
          source: input.source,
          output,
          columns: input.columns,
          rows: input.rows,
          cell: input.cell,
          every: input.every,
          start: input.start,
          end: input.end,
          boundaryRate: input.rate,
          boundaryThreshold: input.threshold,
          signal,
        });
        const text = [
          `已生成证据，输出目录：${output}`,
          ...result.notes,
          "格内对应时刻以 notes 里的清单为准（图上没有烧时间码）。",
        ].join("\n");
        return { content: [{ type: "text", text }], details: { operation: "evidence", output, ...result } };
      },
    } as ToolDefinition;
    return [tool];
  },
};

export default plugin;
export { sampleTimes };
