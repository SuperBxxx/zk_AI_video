// 证据生成：把一条素材摊成「可核对的证据」。
//
// 三个消费方共用这一份实现（写两份必然漂移）：
//   · Agent 工具 `media_analyze`（packages/tools/mediaAnalysis）
//   · 参考分析节点（packages/nodes/referenceAnalysisNode）
//   · 将来的卡片配方
//
// 所以这里**只依赖 fluent 工厂与文件读写接口**，不直接碰 fs、也不起进程 ——
// 调用方（server 或节点）把 `ffmpeg()` 与读写能力注入进来。
export type EvidenceFfmpegCommand = {
  input: (path: string) => EvidenceFfmpegCommand;
  seekInput: (seconds: number) => EvidenceFfmpegCommand;
  frames: (count: number) => EvidenceFfmpegCommand;
  videoFilters: (filters: string) => EvidenceFfmpegCommand;
  complexFilter: (filters: string[], output: string) => EvidenceFfmpegCommand;
  outputOptions: (options: string[]) => EvidenceFfmpegCommand;
  on: (event: string, handler: (value?: unknown) => void) => EvidenceFfmpegCommand;
  save: (target: string) => void;
  kill: (signal?: string) => void;
  ffprobe: (path: string, callback: (error: Error | null, data: unknown) => void) => void;
};

export type EvidenceFfmpeg = ((input?: string) => EvidenceFfmpegCommand) & {
  ffprobe: (path: string, callback: (error: Error | null, data: unknown) => void) => void;
};

export interface EvidenceFiles {
  mkdir(path: string, recursive?: boolean): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  remove(path: string, recursive?: boolean): Promise<void>;
}

export interface MediaInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  container: string | null;
}

export interface EvidenceOptions {
  /** 素材路径（工作区内相对路径）。 */
  source: string;
  /** 输出目录（工作区内相对路径）。 */
  output: string;
  /** 网格列数，默认 3。 */
  columns?: number;
  /** 网格行数，默认 3。 */
  rows?: number;
  /** 每格画面宽度，默认 480。 */
  cell?: number;
  /** 采样间隔（秒）；不填则区间内均匀取 12 点。 */
  every?: number;
  /** 只分析这一段（秒）。 */
  start?: number;
  /** 只分析到这一刻（秒）。 */
  end?: number;
  /** 边界比对的采样帧率，默认 12。 */
  boundaryRate?: number;
  /** 边界变化阈值，默认 0.1。 */
  boundaryThreshold?: number;
  /** 单次最多落多少帧（防止产物爆炸），默认 144。 */
  maxFrames?: number;
  signal?: AbortSignal;
}

export interface EvidenceResult {
  media: MediaInfo;
  /** 按时间顺序的帧图。 */
  frames: { at: number; path: string }[];
  /** 分页网格。 */
  pages: { path: string; times: number[] }[];
  /** 画面变化候选（**不是"镜头"**）。 */
  boundaries: { at: number; score: number }[];
  /** 证据清单，直接给人/Agent 读。 */
  notes: string[];
}

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

/** 读一条素材的媒体信息。 */
export async function probeMedia(ffmpeg: EvidenceFfmpeg, source: string): Promise<MediaInfo> {
  const data = await new Promise<{
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[];
    format?: { duration?: string; format_name?: string };
  }>((done, reject) => {
    ffmpeg.ffprobe(source, (error, metadata) => error ? reject(error) : done(metadata as never));
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

/**
 * 采样时刻：区间内均匀取点，或按 every。
 *
 * ACT: 取每格**中点**而不是格起点 —— 格起点会让第一帧落在区间边界上，
 * 常取到转场的那一帧，而不是这一格真正的内容。
 */
export function sampleTimes(options: { duration: number; start?: number; end?: number; every?: number; max: number }) {
  const start = options.start ?? 0;
  const end = options.end ?? options.duration;
  if (!(end > start)) throw new Error("end 必须大于 start");
  const every = options.every ?? (end - start) / 12;
  if (every < 0.02) throw new Error("采样间隔不能小于 0.02 秒，请扩大区间或加大 every");
  const times: number[] = [];
  for (let at = start + every / 2; at < end && times.length < options.max; at += every) times.push(round(at));
  if (!times.length) throw new Error("这个区间长度取不出采样点，请扩大区间");
  return times;
}

/** 在某个时刻取一帧存成图片。 */
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

/** 把多张帧图按 cols×rows 拼成网格。 */
async function buildGrid(ffmpeg: EvidenceFfmpeg, files: string[], target: string, options: { columns: number; rows: number; cell: number }, signal?: AbortSignal) {
  if (!files.length) throw new Error("没有可拼的帧");
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

/**
 * 找画面变化候选。
 *
 * ACT: 降采样成 32×32 原始像素写进工作区临时文件再读回比较 ——
 * 一次解码即可，且不需要远端桥支持"取回原始字节"（它没有这个能力）。
 * **不用任何模型**：快速运动、闪光、整句字幕出现都会造成高分，
 * 所以输出的是**候选**，不判定为「镜头」。
 */
async function findBoundaries(ffmpeg: EvidenceFfmpeg, files: EvidenceFiles, source: string, options: { rate: number; threshold: number; scratch: string; signal?: AbortSignal }) {
  const size = 32;
  const stride = size * size * 3;
  try {
    await new Promise<void>((done, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        if (error) reject(error); else done();
      };
      const onAbort = () => { command.kill("SIGKILL"); finish(new Error("已取消")); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const command = ffmpeg(source)
        .videoFilters(`fps=${options.rate},scale=${size}:${size},format=rgb24`)
        .outputOptions(["-f", "rawvideo", "-pix_fmt", "rgb24"])
        .on("error", error => finish(error instanceof Error ? error : new Error(String(error))))
        .on("end", () => finish());
      command.save(options.scratch);
    });
    const raw = await files.readFile(options.scratch);
    const candidates: { at: number; score: number }[] = [];
    for (let index = 1; index * stride + stride <= raw.length; index++) {
      const before = (index - 1) * stride;
      const after = index * stride;
      let total = 0;
      for (let byte = 0; byte < stride; byte++) total += Math.abs(raw[after + byte]! - raw[before + byte]!);
      const score = total / stride / 255;
      if (score >= options.threshold) candidates.push({ at: round(index / options.rate), score: round(score, 4) });
    }
    return { frames: Math.floor(raw.length / stride), candidates };
  } finally {
    // 中间文件用完即删：它是几十 KB 到几 MB 的原始像素，没有保留价值。
    await files.remove(options.scratch).catch(() => undefined);
  }
}

/**
 * 把一条素材摊成证据：媒体信息 + 帧图 + 网格 + 变化候选。
 *
 * 这是「取证」这一步的完整实现 —— 分析节点与 Agent 工具都调它，
 * 保证两边看到的证据完全一致。
 */
export async function generateEvidence(
  ffmpeg: EvidenceFfmpeg,
  files: EvidenceFiles,
  options: EvidenceOptions,
): Promise<EvidenceResult> {
  const media = await probeMedia(ffmpeg, options.source);
  if (media.duration === null) throw new Error("读不到素材时长，无法按时间取样");

  const columns = options.columns ?? 3;
  const rows = options.rows ?? 3;
  const cell = options.cell ?? 480;
  const perPage = columns * rows;
  const maxFrames = options.maxFrames ?? 144;

  const times = sampleTimes({ duration: media.duration, start: options.start, end: options.end, every: options.every, max: maxFrames });
  const frameDirectory = `${options.output}/frames`;
  await files.mkdir(frameDirectory, true);
  const frames: { at: number; path: string }[] = [];
  for (const at of times) {
    options.signal?.throwIfAborted();
    const target = `${frameDirectory}/at-${at.toFixed(3).replace(".", "_")}s.jpg`;
    await grabFrame(ffmpeg, options.source, at, target, options.signal);
    frames.push({ at, path: target });
  }

  const pages: { path: string; times: number[] }[] = [];
  for (let offset = 0; offset < frames.length; offset += perPage) {
    options.signal?.throwIfAborted();
    const slice = frames.slice(offset, offset + perPage);
    const target = `${options.output}/page-${String(pages.length + 1).padStart(2, "0")}.jpg`;
    await buildGrid(ffmpeg, slice.map(item => item.path), target, { columns, rows, cell }, options.signal);
    pages.push({ path: target, times: slice.map(item => item.at) });
  }

  const scratch = `${options.output}/.boundaries.rgb`;
  const found = await findBoundaries(ffmpeg, files, options.source, {
    rate: options.boundaryRate ?? 12,
    threshold: options.boundaryThreshold ?? 0.1,
    scratch,
    signal: options.signal,
  });

  const notes = [
    `素材：${options.source}（${media.width ?? "?"}x${media.height ?? "?"} @ ${media.fps ?? "?"}fps，${media.duration} 秒，编码 ${media.videoCodec ?? "无"}，${media.hasAudio ? `有声（${media.audioCodec ?? "未知"}）` : "无音轨"}）`,
    `帧图 ${frames.length} 张，在 ${frameDirectory}（文件名即时刻）`,
    `网格 ${pages.length} 页，在 ${options.output}`,
    ...pages.map((page, index) => `  第 ${index + 1} 页 ${page.path} 的格内时刻：${page.times.join("、")}`),
    `画面变化候选 ${found.candidates.length} 个：${found.candidates.slice(0, 40).map(item => `${item.at}s(${item.score})`).join("、") || "无"}`,
    // 这两条是纪律，写在证据里跟着走，避免下游只看到数字就当成结论。
    "变化候选只是候选，不是「镜头」：快速运动、闪光、整句字幕出现都会造成高分，必须回看确认。",
    media.videoCodec === "hevc" ? "这是 HEVC(H.265)：桌面端预览会「有声音没画面」，预览或送模型前先转 H.264。" : "",
  ].filter(Boolean);

  return { media, frames, pages, boundaries: found.candidates, notes };
}
