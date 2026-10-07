// 素材分析工具：读一条视频/音频，产出**可核对的证据**（媒体信息 / 证据帧 / 帧网格）。
//
// 为什么需要它：技能文档要求「参考素材先逐帧拆解成手法清单」，但在这之前 Agent
// 手上没有任何读素材的手段 —— 那条规则一直是空的。这个工具把「取证」这一步补上。
//
// 与后期卡的分工：后期卡产出**画面**，本工具产出**证据**。所以它不写滤镜链、不成片，
// 只把素材里的东西摊开给人核对。
//
// ACT: 帧与网格用**原生 fluent 工厂**直接落盘。`context.ffmpeg()` 在 server 进程里就是
// `createWorkspaceFfmpeg(cwd)`（原生 @renmu/fluent-ffmpeg），所以 `.save()` 可用；
// 而远端桥（executeRemoteFfmpeg）是给浏览器侧用的 fluent 链，没有"读回原始像素"这类能力，
// 所以画面变化检测不能用它 —— 见文件末尾说明。
import type { ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";

interface ProbeInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  container: string | null;
}

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

/** ffprobe 一条素材。 */
async function probe(context: ToolContext, path: string, signal?: AbortSignal): Promise<ProbeInfo> {
  const ffmpeg = await context.ffmpeg(signal);
  const data = await new Promise<{
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[];
    format?: { duration?: string; format_name?: string };
  }>((done, reject) => {
    ffmpeg.ffprobe(path, (error, metadata) => error ? reject(error) : done(metadata as never));
  });
  const video = data?.streams?.find(stream => stream.codec_type === "video");
  const audio = data?.streams?.find(stream => stream.codec_type === "audio");
  const rate = video?.avg_frame_rate && video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video?.r_frame_rate;
  const [numerator, denominator] = (rate ?? "").split("/").map(Number);
  return {
    duration: data?.format?.duration ? Number(data.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: numerator && denominator ? round(numerator / denominator) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    container: data?.format?.format_name ?? null,
  };
}

/** 采样时刻：`at` 显式给，或用 start/end/every 按区间取。 */
function sampleTimes(options: { duration: number; at?: number[]; start?: number; end?: number; every?: number; max: number }) {
  if (options.at?.length) {
    return [...new Set(options.at.map(at => round(clamp(at, 0, Math.max(0, options.duration - 0.001)))))].sort((a, b) => a - b).slice(0, options.max);
  }
  const start = options.start ?? 0;
  const end = options.end ?? options.duration;
  if (!(end > start)) throw new Error("end 必须大于 start");
  const every = options.every ?? (end - start) / 12;
  if (every < 0.02) throw new Error("采样间隔不能小于 0.02 秒，请扩大区间或加大 every");
  const times: number[] = [];
  // ACT: 取每格**中点**而不是格起点 —— 格起点会让第一帧落在区间边界上，
  // 常取到转场的那一帧，而不是这一格真正的内容。
  for (let at = start + every / 2; at < end && times.length < options.max; at += every) times.push(round(at));
  if (!times.length) throw new Error("这个区间长度取不出采样点，请扩大区间");
  return times;
}

/** 在某个时刻取一帧存成图片。 */
async function grabFrame(
  context: ToolContext,
  source: string,
  at: number,
  target: string,
  signal?: AbortSignal,
) {
  const ffmpeg = await context.ffmpeg(signal);
  await context.files.mkdir(target.split("/").slice(0, -1).join("/") || ".", true).catch(() => undefined);
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

/** 把一个目录下的帧拼成网格图。用 ffmpeg 的 tile 滤镜（它本来就是为分页拼图做的）。 */
async function buildGrid(
  context: ToolContext,
  files: string[],
  target: string,
  options: { columns: number; rows: number; cell: number },
  signal?: AbortSignal,
) {
  if (!files.length) throw new Error("没有可拼的帧");
  const ffmpeg = await context.ffmpeg(signal);
  await context.files.mkdir(target.split("/").slice(0, -1).join("/") || ".", true).catch(() => undefined);
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
    const command = ffmpeg();
    for (const file of files) command.input(file);
    command
      .complexFilter([
        `${files.map((_, index) => `[${index}:v]`).join("")}concat=n=${files.length}:v=1:a=0[joined]`,
        `[joined]scale=${options.cell}:-2,tile=${options.columns}x${options.rows}[grid]`,
      ], "grid")
      .outputOptions(["-frames:v", "1", "-q:v", "3"])
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
      enum: ["probe", "frames", "grid"],
      description: "probe=读媒体信息；frames=按时刻取帧图；grid=区间采样拼成帧网格",
    },
    source: { type: "string", minLength: 1, maxLength: 4096, description: "素材路径（工作区内相对路径）" },
    output: { type: "string", minLength: 1, maxLength: 4096, description: "输出目录（工作区内相对路径）；不填则放在 analysis/<素材名>/ 下" },
    at: {
      type: "array", maxItems: 48,
      items: { type: "number", minimum: 0 },
      description: "frames 用：要取的时刻列表（秒）。与 start/end/every 二选一",
    },
    start: { type: "number", minimum: 0, description: "区间起点（秒）" },
    end: { type: "number", minimum: 0, description: "区间终点（秒），不含" },
    every: { type: "number", minimum: 0.02, description: "采样间隔（秒）；不填则区间内均匀取 12 点" },
    columns: { type: "number", minimum: 1, maximum: 12, description: "grid 用：网格列数，默认 3" },
    rows: { type: "number", minimum: 1, maximum: 12, description: "grid 用：网格行数，默认 3" },
    cell: { type: "number", minimum: 64, maximum: 1920, description: "grid 用：每格画面宽度，默认 480" },
  },
} as const;

const plugin: ToolPlugin = {
  async createTools(context: ToolContext): Promise<ToolDefinition[]> {
    const tool: ToolDefinition = {
      name: "media_analyze",
      label: "分析素材",
      description: "读一条视频/音频，产出可核对的证据：媒体信息、指定时刻的帧图、区间帧网格。不产出画面、不成片。",
      promptSnippet: "读参考视频取证：先 probe 看清编码与时长，再用 frames 取关键帧或用 grid 看整段变化。",
      parameters: analyzeSchema as never,
      async execute(_id, params, signal) {
        const input = params as {
          operation: "probe" | "frames" | "grid";
          source: string;
          output?: string;
          at?: number[];
          start?: number; end?: number; every?: number;
          columns?: number; rows?: number; cell?: number;
        };
        signal?.throwIfAborted();

        const info = await probe(context, input.source, signal);

        if (input.operation === "probe") {
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

        if (info.duration === null) throw new Error("读不到素材时长，无法按时间取样");

        if (input.operation === "frames") {
          if (!input.at?.length) throw new Error("frames 需要 at（时刻列表，秒）");
          const output = input.output ?? defaultOutput(input.source, "frames");
          assertInsideWorkspace(output);
          const times = sampleTimes({ duration: info.duration, at: input.at, max: 48 });
          const frames: { at: number; path: string }[] = [];
          for (const at of times) {
            signal?.throwIfAborted();
            const target = `${output}/at-${at.toFixed(3).replace(".", "_")}s.jpg`;
            await grabFrame(context, input.source, at, target, signal);
            frames.push({ at, path: target });
          }
          const text = [
            `已取 ${frames.length} 帧，输出目录：${output}`,
            ...frames.map(item => `${item.at} 秒 → ${item.path}`),
            "文件名里的时刻就是请求时刻；实际取到的是大于等于该时刻的第一帧，偏差小于一帧。",
          ].join("\n");
          return { content: [{ type: "text", text }], details: { operation: "frames", output, frames, media: info } };
        }

        // grid：先按采样点落帧，再拼成网格（多于一页时自动分页）。
        const output = input.output ?? defaultOutput(input.source, "grid");
        assertInsideWorkspace(output);
        const columns = input.columns ?? 3;
        const rows = input.rows ?? 3;
        const cell = input.cell ?? 480;
        const perPage = columns * rows;
        const times = sampleTimes({ duration: info.duration, start: input.start, end: input.end, every: input.every, max: 144 });
        const frameDirectory = `${output}/frames`;
        const frames: { at: number; path: string }[] = [];
        for (const at of times) {
          signal?.throwIfAborted();
          const target = `${frameDirectory}/at-${at.toFixed(3).replace(".", "_")}s.jpg`;
          await grabFrame(context, input.source, at, target, signal);
          frames.push({ at, path: target });
        }
        const pages: { path: string; times: number[] }[] = [];
        for (let offset = 0; offset < frames.length; offset += perPage) {
          const slice = frames.slice(offset, offset + perPage);
          const target = `${output}/page-${String(pages.length + 1).padStart(2, "0")}.jpg`;
          await buildGrid(context, slice.map(item => item.path), target, { columns, rows, cell }, signal);
          pages.push({ path: target, times: slice.map(item => item.at) });
        }
        const text = [
          `已生成 ${pages.length} 页网格（每页 ${columns}x${rows}，每格宽 ${cell}px），输出目录：${output}`,
          `单帧原图在 ${frameDirectory}（文件名即时刻）`,
          ...pages.map((page, index) => `第 ${index + 1} 页：${page.path} —— 格内时刻（从左到右、从上到下）：${page.times.join("、")}`),
          "图上没有烧时间码，格子对应的时间以这份清单为准；最后一页不足时补黑格。",
        ].join("\n");
        return { content: [{ type: "text", text }], details: { operation: "grid", output, columns, rows, cell, pages, frames, media: info } };
      },
    } as ToolDefinition;
    return [tool];
  },
};

export default plugin;
