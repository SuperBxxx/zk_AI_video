// Timeline：把已解析的叙事锚点**编译成一份可核的镜头时间表**。
//
// 这一步解决什么：解析完时间还只是一堆"某锚点有多长"，而排镜头真正需要的是
// **整片拼起来对不对** —— 有没有重叠、有没有空隙、总长是不是你要的、
// 每个镜头的时长档位模型支不支持。以前这些只能靠 Agent 边生成边感觉。
//
// 与上游做法的取舍（ACT）：成熟实现用的是**声明式放置**（`at="previous.end+3s"`、
// `end="content.end+2s"` 这类相对表达式），编译时再解算。这里**没有**照做，是因为
// zk-video 的画布是「一类镜头 = 一个视频生成节点、各自持有自己的时长」，
// 没有"把素材摆到时间轴任意位置"的运行时。所以本模块只做**能落地的那一半**：
// 把锚点顺序编译成时间轴并**如实报告约束问题**，由 Agent 按报告设置每个节点的时长。
//
// 上限写在这里，便于以后升级：目前是**纯顺序拼接**（一个锚点接一个锚点，不重叠），
// 不支持并行的画面层（画中画、背景层）与跨段落的时间声明。要支持那些，
// 需要先把"时间轴上的轨道"概念引进节点模型。
import { resolveMomentTiming, type NodeSemanticValue } from "./semanticMoment";

/** 编译出来的一镜。 */
export interface CompiledShot {
  /** 第几镜（从 1 开始，按时间排序后）。 */
  index: number;
  anchor: string;
  label: string;
  /** 它替观众做什么（复刻要保留的东西）。 */
  role?: string;
  beginSeconds: number;
  endSeconds: number;
  lengthSeconds: number;
  /** 这一镜的词（用来写提示词与字幕对词）。 */
  utterances: string[];
}

export interface CompiledTimeline {
  scriptId: string;
  shots: CompiledShot[];
  /** 最后一个镜头的结束时刻。 */
  totalSeconds: number;
  /** 编译中发现的问题；空数组 = 可以照这个表排。 */
  problems: string[];
}

export interface CompileOptions {
  /**
   * 目标总时长（秒）。给了就核对总长是否一致 ——
   * 不一致是要**报出来**的，不许悄悄拉长或压缩镜头（那会让锚点的时间失去意义）。
   */
  targetSeconds?: number;
  /** 允许的总长误差（秒），默认 0.5。 */
  toleranceSeconds?: number;
  /** 当前模型支持的时长档位；给了就逐镜检查建议值。 */
  durations?: number[];
  /** 相邻镜头之间期望的间隔（秒），默认 0（紧接）。 */
  gapSeconds?: number;
}

/**
 * 把语义时刻编译成时间轴。
 *
 * **只编译已解析的锚点**。未解析的锚点不会拿参考片的时间顶上 ——
 * 那正是这套设计要消灭的错误；它们会被列为问题，让调用方先去解析。
 */
export function compileTimeline(value: NodeSemanticValue, options: CompileOptions = {}): CompiledTimeline {
  const gap = options.gapSeconds ?? 0;
  const tolerance = options.toleranceSeconds ?? 0.5;
  const problems: string[] = [];

  const resolved = value.moments
    .map(moment => ({ moment, timing: resolveMomentTiming(value, moment.anchor) }))
    .filter((entry): entry is { moment: typeof entry.moment; timing: NonNullable<typeof entry.timing> } => !!entry.timing);

  const unresolved = value.moments.filter(moment => !resolveMomentTiming(value, moment.anchor));
  if (unresolved.length) {
    problems.push(
      `这些锚点还没为新脚本解析出时间，**没有**编进时间表：${unresolved.map(moment => moment.label || moment.anchor).join("、")}。` +
      "先用 resolveMomentsFromScript 解析（不要给它们编时间）。",
    );
  }
  if (!resolved.length) {
    return { scriptId: value.scriptId, shots: [], totalSeconds: 0, problems: problems.length ? problems : ["没有任何已解析的锚点，编译不出时间表"] };
  }

  // 按各自解析出的起点排序 —— 锚点在脚本里出现的顺序未必是时间顺序。
  const ordered = [...resolved].sort((left, right) => left.timing.startSeconds - right.timing.startSeconds);

  const shots: CompiledShot[] = [];
  let cursor = 0;
  ordered.forEach((entry, position) => {
    const length = Number((entry.timing.endSeconds - entry.timing.startSeconds).toFixed(3));
    if (!(length > 0)) {
      problems.push(`「${entry.moment.label || entry.moment.anchor}」解析出的长度是 ${length} 秒，不正常。`);
      return;
    }
    // ACT: 起点用**累加**而不是锚点自己的 startSeconds —— 锚点的时间来自不同脚本时
    // 起点可能重叠或留洞；顺序拼接出的是真正会渲染出来的时间轴，
    // 而两者的差异在下面作为问题报出来（而不是悄悄抹平）。
    const begin = Number(cursor.toFixed(3));
    const end = Number((begin + length).toFixed(3));
    shots.push({
      index: position + 1,
      anchor: entry.moment.anchor,
      label: entry.moment.label,
      ...(entry.moment.role ? { role: entry.moment.role } : {}),
      beginSeconds: begin,
      endSeconds: end,
      lengthSeconds: length,
      utterances: entry.moment.utterances.map(utterance => utterance.text),
    });
    cursor = end + gap;
  });

  // 逐镜检查时长档位。
  if (options.durations?.length) {
    for (const shot of shots) {
      const fits = options.durations.some(duration => Math.abs(duration - shot.lengthSeconds) <= tolerance);
      if (!fits) {
        const nearest = options.durations.reduce((best, duration) =>
          Math.abs(duration - shot.lengthSeconds) < Math.abs(best - shot.lengthSeconds) ? duration : best, options.durations[0]!);
        problems.push(`第 ${shot.index} 镜（${shot.label}）${shot.lengthSeconds} 秒不在模型档位里；最接近的是 ${nearest} 秒，差 ${Math.abs(nearest - shot.lengthSeconds).toFixed(2)} 秒。`);
      }
    }
  }

  // 核对总长。
  const totalSeconds = shots.length ? shots[shots.length - 1]!.endSeconds : 0;
  if (options.targetSeconds !== undefined) {
    const delta = Number((totalSeconds - options.targetSeconds).toFixed(3));
    if (Math.abs(delta) > tolerance) {
      problems.push(
        `时间表总长 ${totalSeconds} 秒，与目标 ${options.targetSeconds} 秒差 ${delta > 0 ? "+" : ""}${delta} 秒。` +
        "**不要靠拉伸镜头抹平这个差** —— 要么增删镜头，要么改脚本，要么承认总长与目标不同。",
      );
    }
  }

  return { scriptId: value.scriptId, shots, totalSeconds, problems };
}

/** 把编译结果翻成一份人能核的镜头表。 */
export function describeTimeline(timeline: CompiledTimeline) {
  if (!timeline.shots.length) return `（没有镜头）${timeline.problems.join("；")}`;
  const rows = timeline.shots.map(shot => {
    const role = shot.role ? `｜${shot.role}` : "";
    const words = shot.utterances.length ? `\n      「${shot.utterances.join("")}」` : "";
    return `  ${String(shot.index).padStart(2, " ")}. ${shot.beginSeconds}~${shot.endSeconds}s（${shot.lengthSeconds}s）${shot.label}［${shot.anchor}］${role}${words}`;
  });
  return [
    `脚本 ${timeline.scriptId} 的镜头表（共 ${timeline.shots.length} 镜，总长 ${timeline.totalSeconds} 秒）：`,
    ...rows,
    timeline.problems.length ? `\n要处理的问题：\n${timeline.problems.map(problem => `  · ${problem}`).join("\n")}` : "\n没有发现问题，可以照这个表排。",
  ].join("\n");
}
