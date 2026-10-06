// 成片机器闸的**判据**（纯函数）。
//
// 抽取理由同 align.ts：脚本与 agent 工具都要用。这里只做判定与生成提示文本，
// 取数据（ffprobe / ffmpeg freezedetect）留在调用方 —— 脚本用子进程、工具用宿主能力。
//
// 为什么有这一步：这些问题的答案本来就在文档里，但没人在正确的时刻去查。
// 参考实现的复盘是「一次 7h21m 的制作里 6 个整片母版作废 5 个，
// 其中两轮的触发条件一条 ffprobe 就能查出来」。

export interface GateFinding {
  name: string;
  detail: string;
}

export interface GateResult {
  passes: GateFinding[];
  warnings: GateFinding[];
  failures: GateFinding[];
}

/** 解析 "30000/1001" 这类分数为数值。 */
export function parseRatio(value: unknown): number {
  if (typeof value !== "string") return Number(value);
  if (!value.includes("/")) return Number(value);
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator! / denominator! : Number.NaN;
}

/**
 * 闸 1：素材/成片帧率一致性（参考实现里废掉母版的元凶）。
 *
 * r_frame_rate 与 avg_frame_rate 不等 = 变帧率或丢帧；成片帧率与目标不符会导致
 * 音画逐渐漂移，混入源片时每 N 帧出现一次重复帧。
 */
export function checkFrameRate(video: { rFrameRate?: unknown; avgFrameRate?: unknown; width?: number; height?: number }, targetFps: number): GateFinding[] {
  const real = parseRatio(video.rFrameRate);
  const average = parseRatio(video.avgFrameRate);
  if (!Number.isFinite(real) || !Number.isFinite(average)) {
    return [{ name: "帧率", detail: `帧率字段异常：${String(video.rFrameRate)} / ${String(video.avgFrameRate)}` }];
  }
  if (Math.abs(real - average) > 0.01) {
    return [{ name: "帧率", detail: `r_frame_rate(${real.toFixed(3)}) ≠ avg_frame_rate(${average.toFixed(3)})：变帧率或丢帧，混剪会出现重复帧` }];
  }
  if (Math.abs(real - targetFps) > 0.05) {
    return [{ name: "帧率", detail: `成片 ${real.toFixed(2)}fps ≠ 目标 ${targetFps}fps` }];
  }
  return [];
}

/** 闸 2：音画时长差。判据照参考实现「差 > 1 帧即 FAIL」。 */
export function checkAvDuration(videoDuration: unknown, audioDuration: unknown, fps: number): GateFinding[] {
  const video = Number(videoDuration);
  const audio = Number(audioDuration);
  if (!Number.isFinite(video) || !Number.isFinite(audio)) return [];
  const frameMs = 1000 / fps;
  const diffMs = Math.abs(video - audio) * 1000;
  if (diffMs > frameMs) {
    return [{ name: "音画时长", detail: `差 ${diffMs.toFixed(0)}ms（> 1 帧 ${frameMs.toFixed(1)}ms）：视频 ${video.toFixed(3)}s / 音频 ${audio.toFixed(3)}s` }];
  }
  return [];
}

export interface FreezeSpan {
  startMs: number;
  endMs?: number;
}

/**
 * 闸 3：任意 0.8s 不允许全静止。
 *
 * 阈值照参考实现 freezedetect=n=0.003:d=0.8（比「任意 1 秒」的口径更严）。
 * 两个边界：素材本身要求静止的镜头（标志落定、定格）会撞这一关，
 * **处置不是豁免，而是让场景相机继续微动**。
 */
export function checkFreeze(spans: FreezeSpan[], thresholdSeconds: number): GateFinding[] {
  if (!spans.length) return [];
  const detail = spans
    .map(span => `${(span.startMs / 1000).toFixed(2)}s → ${span.endMs === undefined ? "片尾" : `${(span.endMs / 1000).toFixed(2)}s`}`)
    .join("、");
  return [{ name: "静止", detail: `${spans.length} 段 ≥ ${thresholdSeconds}s 全静止：${detail}（处置：让相机极缓推拉，而不是豁免这一关）` }];
}

/**
 * 闸 4：镜头落点保护带。
 *
 * 锚点距镜头出点 < tail 时落点会被转场吞掉，表现为「某个元素只活了 0.2s」，
 * 靠单帧永远看不出来。
 */
export function checkShotTail(shots: { id: string; start: number; end: number }[], tailSeconds: number): GateFinding[] {
  const short = shots.filter(shot => Number(shot.end) - Number(shot.start) < tailSeconds);
  if (!short.length) return [];
  return [{
    name: "镜头落点",
    detail: `${short.length} 个镜头短于保护带 ${tailSeconds}s：${short.map(shot => `${shot.id}(${(Number(shot.end) - Number(shot.start)).toFixed(2)}s)`).join("、")}`,
  }];
}

/** 从 ffmpeg 的 stderr 里解析 freezedetect 的起止时刻。 */
export function parseFreezeSpans(stderr: string): FreezeSpan[] {
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map(match => Number(match[1]) * 1000);
  const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map(match => Number(match[1]) * 1000);
  return starts.map((startMs, index) => ({ startMs, endMs: ends[index] }));
}

/**
 * 音效 cue 表：把相对镜头起点的 offset 解析成音频轨上的绝对时刻。
 *
 * 两条实测教训：
 *   1. **钉帧一律相对镜头起点**（`{shot, offset}`），绝不写裸帧号或裸秒数 ——
 *      时间线整体平移时全表自动跟随。
 *   2. **输出音轨有编码器 priming 偏移**（ffmpeg 内置 aac 1024 samples ≈21.3ms @48kHz），
 *      常数必须按自己的管线实测，所以这里做成显式参数、默认 0 并提示未补偿。
 */
export interface SoundCueInput {
  shot?: string;
  offset?: number;
  absolute?: boolean;
  anchor?: number;
  src: string;
  volume?: number;
  what?: string;
}

export interface ResolvedCue {
  src: string;
  what: string;
  shot?: string;
  offset?: number;
  absoluteMs: number;
  startMs: number;
  frame: number;
  volume: number;
}

export interface SoundCueResult {
  cues: ResolvedCue[];
  problems: string[];
  warnings: string[];
}

export function resolveSoundCues(cues: SoundCueInput[], shots: { id: string; start: number; end: number }[], options: { fps?: number; tail?: number; offsetMs?: number } = {}): SoundCueResult {
  const fps = options.fps ?? 30;
  const tail = options.tail ?? 0.5;
  const offsetMs = options.offsetMs ?? 0;
  const shotById = new Map(shots.map(shot => [shot.id, shot]));
  const problems: string[] = [];
  const warnings: string[] = [];
  const resolved: ResolvedCue[] = [];

  for (const [index, cue] of cues.entries()) {
    const label = `[${index}] ${cue.src ?? "?"}`;
    if (!cue.src) { problems.push(`${label} 缺少 src`); continue; }

    let absoluteSeconds: number;
    if (cue.absolute) {
      if (!Number.isFinite(Number(cue.anchor))) { problems.push(`${label} 标了 absolute 但没有有效的 anchor 秒数`); continue; }
      absoluteSeconds = Number(cue.anchor);
    } else {
      const shot = cue.shot ? shotById.get(cue.shot) : undefined;
      if (!shot) { problems.push(`${label} 引用了不存在的镜头「${cue.shot}」`); continue; }
      if (!Number.isFinite(Number(cue.offset))) { problems.push(`${label} 缺少有效的 offset`); continue; }
      absoluteSeconds = Number(shot.start) + Number(cue.offset);
      const fromEnd = Number(shot.end) - absoluteSeconds;
      if (fromEnd < 0) {
        problems.push(`${label} 落在镜头 ${cue.shot} 之外：起点 ${Number(shot.start).toFixed(2)}s + offset ${Number(cue.offset).toFixed(2)}s = ${absoluteSeconds.toFixed(2)}s > 镜尾 ${Number(shot.end).toFixed(2)}s`);
        continue;
      }
      if (fromEnd < tail) warnings.push(`${label} 距镜尾只有 ${fromEnd.toFixed(2)}s（< 保护带 ${tail}s），落点可能被转场吞掉`);
    }

    // 音量是**乘法系数**不是目标音量：素材本身录得轻时给 1.0 也压不住 BGM。
    const volume = Number(cue.volume ?? 1);
    if (volume > 1) warnings.push(`${label} 音量 ${volume} > 1：说明素材本身偏轻，优先换素材或预归一化，而不是靠增益硬顶`);

    const compensatedMs = absoluteSeconds * 1000 - offsetMs;
    if (compensatedMs < 0) {
      problems.push(`${label} 补偿后时刻为负（${compensatedMs.toFixed(1)}ms）：片头附近的钉点无法完成全部补偿，重音不要设计在片头`);
      continue;
    }

    resolved.push({
      src: cue.src,
      what: cue.what ?? "",
      ...(cue.absolute ? {} : { shot: cue.shot, offset: Number(cue.offset) }),
      absoluteMs: Math.round(absoluteSeconds * 1000),
      startMs: Math.round(compensatedMs),
      frame: Math.round((compensatedMs / 1000) * fps),
      volume,
    });
  }

  resolved.sort((a, b) => a.absoluteMs - b.absoluteMs);
  return { cues: resolved, problems, warnings };
}
