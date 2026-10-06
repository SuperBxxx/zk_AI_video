// 交付层：把镜头切分与字幕变成**平台无关**的编辑数据。
//
// 为什么需要它：成片交付后用户往往还要在自己的剪辑软件里改（变速、重排、改字幕）。
// 但剪辑软件的内部工程格式（剪映草稿、Premiere 工程）是私有的、会随版本变，
// 照猜生成只会给出打不开的坏文件。所以这里只产出**有公开格式、能自己校验**的东西：
//   · 镜头切段表（每个镜头的源区间与时间线落点，CSV/JSON）
//   · SRT 字幕（几乎所有剪辑软件与播放器都认）
// 再由调用方决定要不要转成某个软件的内部工程。
//
// 本模块是纯逻辑，不碰文件系统，与 align/subtitles 一起供脚本与 agent 工具共用。

/** 微秒是剪辑域的最小单位，全部时间量都以它为准，避免来回换算出累积误差。 */
export interface EditSegment {
  /** 镜头标识，供人工核对与排序。 */
  id: string;
  /** 源素材（工作区相对路径）。 */
  source: string;
  /** 从源素材的哪一微秒开始取。 */
  sourceStartUs: number;
  /** 取多少微秒。 */
  durationUs: number;
  /** 落在时间线的哪一微秒。 */
  targetStartUs: number;
}

export interface EditCheck {
  name: string;
  detail: string;
}

/**
 * 帧 → 微秒。
 *
 * 铁律（参考实现踩过的坑）：**相邻切段的边界必须「起点与终点各自取整后再相减」**，
 * 不能把起点与时长分别取整 —— 那会产生 1µs 级的缝隙或重叠，
 * 而剪辑软件对同轨重叠是直接报错的（pyJianYingDraft 会抛 SegmentOverlap）。
 * 所以下面 buildEditList 里 durationUs 一律由两个边界的差值算出，不做独立取整。
 */
export function frameToUs(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}

/** 微秒 → 帧（四舍五入）。 */
export function usToFrame(us: number, fps: number): number {
  return Math.round((us * fps) / 1_000_000);
}

/** 秒 → 微秒。 */
export function secondsToUs(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

export interface ShotSpec {
  id: string;
  /** 源素材路径；缺省表示与上一段同源。 */
  source?: string;
  /** 源区间与时间线落点，单位秒。 */
  start: number;
  end: number;
  /** 在源素材里的入点（秒）；缺省等于 start（即源与时间线同区间，便于单独变速/重排）。 */
  sourceStart?: number;
}

/**
 * 由镜头表构建切段表。
 *
 * ACT: 采用「按顺序紧密排列」而不是照抄每段的绝对落点 ——
 * 时间线位置由前面各段时长累加得出，所以任何一段改长度都会自动顺移后续段，
 * 不会留下缝隙。镜头表里的 start/end 只用于确定**每段的长度与源入点**。
 */
export function buildEditList(shots: ShotSpec[], fps: number, fallbackSource = ""): { segments: EditSegment[]; totalUs: number } {
  const segments: EditSegment[] = [];
  let cursor = 0;
  let lastSource = fallbackSource;
  for (const shot of shots) {
    const source = shot.source ?? lastSource;
    if (!source) throw new Error(`镜头 ${shot.id} 没有源素材，且前面也没有可继承的源`);
    lastSource = source;
    if (!(shot.end > shot.start)) throw new Error(`镜头 ${shot.id} 的 end 必须大于 start`);
    const sourceStartUs = frameToUs(Math.round((shot.sourceStart ?? shot.start) * fps), fps);
    // 长度由起止帧各自取整后相减，与下面的 targetEnd 同源，保证首尾相接
    const durationUs = frameToUs(Math.round(shot.end * fps), fps) - frameToUs(Math.round(shot.start * fps), fps);
    segments.push({ id: shot.id, source, sourceStartUs, durationUs, targetStartUs: cursor });
    cursor += durationUs;
  }
  return { segments, totalUs: cursor };
}

/**
 * 对账切段表：这是交付前必须过的一关。
 *
 * 检查的都是「肉眼看不出来、但剪辑软件会报错或画面会跳」的问题：
 * 同轨重叠（后续段起点早于前一段终点）、缝隙（起点晚于终点）、零长或负长段、
 * 以及总时长是否等于各段之和。
 */
export function checkEditList(segments: EditSegment[]): { failures: EditCheck[]; passes: EditCheck[] } {
  const failures: EditCheck[] = [];
  const passes: EditCheck[] = [];

  if (!segments.length) {
    failures.push({ name: "切段表", detail: "没有任何片段" });
    return { failures, passes };
  }

  let cursor = 0;
  let gaps = 0;
  let overlaps = 0;
  let invalid = 0;
  for (const segment of segments) {
    if (segment.durationUs <= 0) {
      invalid++;
      failures.push({ name: "切段表", detail: `${segment.id} 时长非法（${segment.durationUs}µs）` });
      continue;
    }
    if (segment.targetStartUs > cursor) gaps++;
    if (segment.targetStartUs < cursor) overlaps++;
    cursor = segment.targetStartUs + segment.durationUs;
  }
  if (overlaps) failures.push({ name: "切段表", detail: `${overlaps} 段与前一段重叠（剪辑软件会直接报错）` });
  if (gaps) failures.push({ name: "切段表", detail: `${gaps} 段与前一段之间有缝隙（播放会闪一下）` });
  if (!overlaps && !gaps && !invalid) passes.push({ name: "切段表", detail: `${segments.length} 段首尾相接、无重叠无缝隙` });

  const total = segments.reduce((sum, segment) => sum + segment.durationUs, 0);
  const end = segments[segments.length - 1]!.targetStartUs + segments[segments.length - 1]!.durationUs;
  if (end !== total) failures.push({ name: "总时长", detail: `末段终点 ${end}µs ≠ 各段之和 ${total}µs` });
  else passes.push({ name: "总时长", detail: `${(total / 1_000_000).toFixed(3)}s（等于各段之和）` });

  // 源入点不能为负（负入点会被剪辑软件截断或报错）
  const negative = segments.filter(segment => segment.sourceStartUs < 0);
  if (negative.length) failures.push({ name: "源入点", detail: `${negative.length} 段的源入点为负：${negative.map(s => s.id).join("、")}` });
  else passes.push({ name: "源入点", detail: "全部非负" });

  return { failures, passes };
}

/** 微秒 → 时间码 `HH:MM:SS.mmm`，给人工核对与 CSV 用。 */
export function usToTimecode(us: number): string {
  const total = Math.max(0, Math.round(us));
  const hours = Math.floor(total / 3_600_000_000);
  const minutes = Math.floor((total % 3_600_000_000) / 60_000_000);
  const seconds = Math.floor((total % 60_000_000) / 1_000_000);
  const millis = Math.floor((total % 1_000_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** 转成 CSV：列固定，便于任何表格工具或剪辑软件导入。 */
export function editListToCsv(segments: EditSegment[], fps: number): string {
  const header = "index,id,source,sourceIn,sourceInUs,durationUs,durationFrames,targetStart,targetStartUs";
  const rows = segments.map((segment, index) => [
    index + 1,
    segment.id,
    segment.source,
    usToTimecode(segment.sourceStartUs),
    segment.sourceStartUs,
    segment.durationUs,
    usToFrame(segment.durationUs, fps),
    usToTimecode(segment.targetStartUs),
    segment.targetStartUs,
  ].join(","));
  return `${[header, ...rows].join("\n")}\n`;
}

/**
 * 转成 CMX3600 风格的 EDL（单源、仅视频轨）。
 *
 * ACT: 只在**全部片段同源**时才允许导出 EDL —— 标准 EDL 的一条事件只能指向一个
 * 卷号，多源硬塞进去会让剪辑软件把后面的片段也解析成同一个文件，
 * 那是静默的错误结果，比不给更糟。多源时明确报错，让调用方改用 CSV。
 */
export function editListToEdl(segments: EditSegment[], fps: number, title = "ZHUKAI AI VIDEO"): string {
  const sources = [...new Set(segments.map(segment => segment.source))];
  if (sources.length > 1) {
    throw new Error(`标准 EDL 只能表达单一源素材，当前有 ${sources.length} 个源；请改用 CSV（editListToCsv）或按源分别导出`);
  }
  const toTimecode = (us: number) => {
    const frame = usToFrame(us, fps);
    const fpsInt = Math.round(fps);
    const frames = frame % fpsInt;
    const totalSeconds = Math.floor(frame / fpsInt);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  };
  const reel = (sources[0] ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "AX";
  const lines = [`TITLE: ${title}`, `FCM: NON-DROP FRAME`, ""];
  segments.forEach((segment, index) => {
    const event = String(index + 1).padStart(3, "0");
    lines.push(`${event}  ${reel.padEnd(8)} V     C        ${toTimecode(segment.sourceStartUs)} ${toTimecode(segment.sourceStartUs + segment.durationUs)} ${toTimecode(segment.targetStartUs)} ${toTimecode(segment.targetStartUs + segment.durationUs)}`);
    lines.push(`* FROM CLIP NAME: ${segment.source}`);
    lines.push("");
  });
  return lines.join("\n");
}
