// 语义时刻：一个**带身份的时间段**，它的时间是**解析出来的**，不是写死的。
//
// 这是复刻路径从阶段 1 走到阶段 2 的那一步：
//   阶段 1 只让分析产物**记录**关系（respondsTo / role）
//   阶段 2 让这个关系**能在画布上流动** —— 节点之间传的不再只是素材，而是"哪一下、多久"
//
// 为什么不能只传秒数：参考片的「钩子在第 0.4 秒」是新脚本里毫无意义的数字。
// 该传的是**身份**（hook）+ **它由哪些词构成**，由下游用**当前脚本自己的词**去解出时间。
//
// 于是同一份分析可以复用到任意长度的新片子上：换个脚本、换个人说，
// 时间自己重新解出来，关系不变。
//
// 与 `NodeValueMap` 的关系：本类型**不是**节点值类型（那 8 种不动）。
// 它是挂在 `SEMANTIC` 值类型上的载荷，由节点按需产生与消费。
import { isStoryAnchor, findStoryAnchor, type StoryAnchorGroup } from "./storyAnchor";

/** 一段话（一次连续说话）。它是解析时间的**唯一依据**。 */
export interface SemanticUtterance {
  /** 脚本里的原话。 */
  text: string;
  /**
   * 这段话说出来占多久（秒）。
   * ACT: 这是**估算或实测**得到的时长，不是参考片里的时点 ——
   * 参考片的秒数只用于理解参考片，绝不能拿来当新片的时间。
   */
  durationSeconds: number;
  /** 词级时间（有的话）：每个词在整片里的起止。 */
  words?: { text: string; beginMs: number; endMs: number }[];
}

/**
 * 一个语义时刻：身份 + 由哪些词构成 + 每个脚本各自解出的时间。
 *
 * `resolved` 是**每个脚本一份**的 —— 同一张配方卡配不同的脚本，各自解出不同的秒数。
 * 这就是"锚定在词上而不是秒上"的落地形态。
 */
export interface NodeSemanticMoment {
  /** 锚点标识（storyAnchor 的 key）。 */
  anchor: string;
  /** 人看的名字（"价格锚点""开场钩子"）。 */
  label: string;
  /** 它由哪些词构成 —— 换脚本时这些会被新的词替换。 */
  utterances: SemanticUtterance[];
  /**
   * 每个脚本各自解出的时间，键是脚本标识。
   *
   * ACT: 允许缺 —— 还没为新脚本解析过时就是没有。那时 `resolveMomentTiming` 会返回 undefined，
   * 调用方**必须处理这种情况**（要么先解析，要么如实说"这个锚点还没落到新脚本上"），
   * 不要拿参考片的秒数顶上。
   */
  resolved?: Record<string, { startSeconds: number; endSeconds: number }>;
  /** 它在替观众做什么 —— 从配方卡的 role 带过来，这是复刻要保留的东西。 */
  role?: string;
}

export type NodeSemanticValue = {
  /** 这些时刻属于哪个脚本（用于查 resolved）。 */
  scriptId: string;
  moments: NodeSemanticMoment[];
};

/** 解析结果。 */
export interface ResolvedTiming {
  startSeconds: number;
  endSeconds: number;
  /** 从哪个脚本解出来的。 */
  scriptId: string;
}

/**
 * 取一个语义时刻在**指定脚本**下的时间。
 *
 * 返回 undefined 表示"还没为新脚本解析过" —— 调用方不许拿别的脚本的时间顶上，
 * 那正是这套设计要消灭的错误。
 */
export function resolveMomentTiming(value: NodeSemanticValue, anchor: string, scriptId = value.scriptId): ResolvedTiming | undefined {
  const moment = value.moments.find(item => item.anchor === anchor);
  const window = moment?.resolved?.[scriptId];
  if (!window) return undefined;
  return { startSeconds: window.startSeconds, endSeconds: window.endSeconds, scriptId };
}

/**
 * 按脚本的逐词时间，把一个时刻的时间解出来。
 *
 * 做法：先把 utterances 按顺序拼起来，在脚本的逐词序列里找到这段文本，
 * 取首词起点到末词终点。找不到就返回 undefined（**不猜**）。
 *
 * ACT: 用的是**整段文本匹配**而不是逐词 —— 口播稿与实际念法常有出入
 * （数字、专有名词），逐词匹配太脆；整段匹配失败时如实返回 undefined，
 * 由调用方决定是让用户确认原句，还是退回按画面结构排时间。
 */
export function resolveMomentFromScript(
  moment: NodeSemanticMoment,
  scriptId: string,
  words: { text: string; beginMs: number; endMs: number }[],
): NodeSemanticMoment {
  const wanted = normalize(moment.utterances.map(item => item.text).join(""));
  if (!wanted) return moment;
  const joined = words.map(word => normalize(word.text)).join("");
  const index = joined.indexOf(wanted);
  if (index < 0) return moment;

  // 把字符下标映射回词：累计每个词的规范化长度，找出覆盖 [index, index+wanted.length) 的词区间。
  let cursor = 0;
  let first: number | undefined;
  let last: number | undefined;
  for (let position = 0; position < words.length; position++) {
    const length = normalize(words[position]!.text).length;
    const from = cursor;
    const to = cursor + length;
    cursor = to;
    if (first === undefined && to > index) first = position;
    if (from < index + wanted.length) last = position;
  }
  if (first === undefined || last === undefined) return moment;

  return {
    ...moment,
    resolved: {
      ...(moment.resolved ?? {}),
      [scriptId]: {
        startSeconds: Number((words[first]!.beginMs / 1000).toFixed(3)),
        endSeconds: Number((words[last]!.endMs / 1000).toFixed(3)),
      },
    },
  };
}

/** 匹配用的规范化：去空白、去标点、小写。与 phraseRanges 同一套思路。 */
function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

/**
 * 校验一个时刻是否自洽。返回问题清单（空数组 = 通过）。
 *
 * ACT: 这些错都会**静默产生错时间**，所以值得单独校验：
 * 锚点写错 → 下游按锚点找不到它；没有 utterances → 无法为新脚本解析；
 * utterances 有时长但没有 resolved → 看起来能用，实际拿到的是 undefined。
 */
export function checkSemanticMoment(moment: NodeSemanticMoment) {
  const problems: string[] = [];
  if (!moment.anchor?.trim()) problems.push("缺少 anchor（下游无法按锚点找到它）");
  else if (!isStoryAnchor(moment.anchor)) problems.push(`anchor "${moment.anchor}" 不在词表里`);
  if (!moment.label?.trim()) problems.push("缺少 label（人看不懂这是哪一下）");
  if (!moment.utterances?.length) problems.push("缺少 utterances（无法为新脚本解析时间）");
  if (moment.utterances?.some(item => !(item.durationSeconds > 0))) problems.push("utterances 里有非正时长");
  return problems;
}

/** 一个锚点的中文名与分组（提示词与 UI 用）。 */
export function describeMomentAnchor(anchor: string): { label: string; group: StoryAnchorGroup } | undefined {
  const spec = findStoryAnchor(anchor);
  return spec ? { label: spec.label, group: spec.group } : undefined;
}

/**
 * 把这些时刻翻成一句人能核的话，给 Agent 与用户看。
 *
 * 已解析的给出秒数区间；没解析的明说"还没落到这个脚本上"——
 * 不要把未解析的伪装成 0 秒。
 */
export function describeMoments(value: NodeSemanticValue) {
  return value.moments.map(moment => {
    const window = moment.resolved?.[value.scriptId];
    const timing = window
      ? `${window.startSeconds}~${window.endSeconds}s`
      : "**还没为新脚本解析时间**";
    const role = moment.role ? `（${moment.role}）` : "";
    return `· ${moment.label}［${moment.anchor}］${timing}${role}`;
  }).join("\n");
}
