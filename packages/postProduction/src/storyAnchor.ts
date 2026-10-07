// 叙事锚点：一个设计元素**在回应什么**。
//
// 为什么需要这一层（这是复刻路径的核心改造）：
//
// 旧的记法只能写「第 4 秒有一个硬切」—— 那是**观察**，不是**关系**。
// 换一个新脚本、换一个说话人，4 秒这个数字就失效了，那份分析也就没用了。
// 真正可复用的是**关系**：「在抛出价格那一刻切硬切」。
//
// 所以分析时记的是锚点（它回应故事的哪一下），复刻时用**新脚本自己的时间**去实例化：
// 你的钩子在第 2 秒还是第 5 秒都行，锚点照样成立。
//
// ACT: 词表是**封闭**的，和 cardLibrary 的 CardSemantic 同一个道理 ——
// 开放词表会让每一份分析各写各的说法（"开场钩子"/"hook"/"开头吸引"），
// 下游无法检索，也无法校验。代价是偶尔遇到归类不进去的段落，
// 那时用 `role` 字段自由描述它**替观众做了什么**，不要把词表撑大。
//
// 本包约束：不得依赖任何 node 内置模块 —— 这里只有纯数据与纯函数。

/** 叙事锚点的分类。 */
export type StoryAnchorGroup =
  /** 故事推进到哪一步 */
  | "叙事结构"
  /** 这一段在替观众做什么 */
  | "内容作用"
  /** 怎么落地的（画面与声音层面） */
  | "表现形式"
  /** 对观众提出的动作要求 */
  | "观众行动";

export interface StoryAnchorSpec {
  /** 机器用的标识（小驼峰）；进 JSON 与工具参数。 */
  key: string;
  /** 人看的中文名。 */
  label: string;
  group: StoryAnchorGroup;
  /** 一句话说清「什么时候用它」。 */
  meaning: string;
}

export const storyAnchors: StoryAnchorSpec[] = [
  // ── 叙事结构 ────────────────────────────────────────────────
  { key: "hook", label: "钩子", group: "叙事结构", meaning: "开场让人停下来的那一下；通常最先出现，后面全部让位给它。" },
  { key: "background", label: "背景", group: "叙事结构", meaning: "交代人物、地点或前提，让后面的话成立。" },
  { key: "problem", label: "问题", group: "叙事结构", meaning: "把观众自己的麻烦摆出来，制造要对下去的动机。" },
  { key: "turn", label: "转折", group: "叙事结构", meaning: "推翻前面建立的说法或预期。" },
  { key: "climax", label: "高潮", group: "叙事结构", meaning: "情绪或信息的最强点；通常只出现一次。" },
  { key: "ending", label: "收尾", group: "叙事结构", meaning: "把话收住；可以是总结、回扣或留白。" },

  // ── 内容作用 ────────────────────────────────────────────────
  { key: "establish", label: "建立", group: "内容作用", meaning: "让观众第一次认识一个人、一个地方或一件东西。" },
  { key: "compare", label: "对比", group: "内容作用", meaning: "把两个说法、两种状态或前后变化摆在一起。" },
  { key: "prove", label: "举证", group: "内容作用", meaning: "累积证据，让一个说法可信。" },
  { key: "amplify", label: "放大", group: "内容作用", meaning: "把一个反应、情绪或后果做大。" },
  { key: "explain", label: "说明", group: "内容作用", meaning: "让一个机制或流程看得懂。" },
  { key: "handoff", label: "交接", group: "内容作用", meaning: "把观众的注意力交给下一个想法。" },

  // ── 表现形式 ────────────────────────────────────────────────
  { key: "onScreenText", label: "屏幕文字", group: "表现形式", meaning: "文字作为主要信息载体出现（标题、字幕、数据）。" },
  { key: "graphicSystem", label: "图形系统", group: "表现形式", meaning: "成套的图形/动效在承载信息，而不是装饰。" },
  { key: "cut", label: "切点", group: "表现形式", meaning: "画面发生切换的位置。" },
  { key: "cameraMove", label: "镜头运动", group: "表现形式", meaning: "推、拉、摇、移等持续运动本身在起作用。" },
  { key: "soundCue", label: "声音提示", group: "表现形式", meaning: "音效、重音或音乐落点在标记某个时刻。" },

  // ── 观众行动 ────────────────────────────────────────────────
  { key: "callToAction", label: "行动号召", group: "观众行动", meaning: "要求观众做一件事（关注、下单、评论、跳转）。" },
  { key: "reveal", label: "揭晓", group: "观众行动", meaning: "把答案或结果交给观众的那一刻。" },
  { key: "askQuestion", label: "设问", group: "观众行动", meaning: "直接向观众提问，让他自己在心里回答。" },
  { key: "recall", label: "回扣", group: "观众行动", meaning: "重新提起前面出现过的东西，形成呼应。" },
];

/** 只要标识（校验与工具参数用）。 */
export const storyAnchorKeys = storyAnchors.map(anchor => anchor.key);

const anchorByKey = new Map(storyAnchors.map(anchor => [anchor.key, anchor]));

export function findStoryAnchor(key: string) {
  return anchorByKey.get(key);
}

/** 校验一个锚点标识是否合法。 */
export function isStoryAnchor(key: string) {
  return anchorByKey.has(key);
}

/** 给提示词/工具说明用的紧凑清单。 */
export function storyAnchorGuide() {
  const groups = new Map<StoryAnchorGroup, StoryAnchorSpec[]>();
  for (const anchor of storyAnchors) {
    const list = groups.get(anchor.group) ?? [];
    list.push(anchor);
    groups.set(anchor.group, list);
  }
  return [...groups.entries()]
    .map(([group, list]) => `${group}：${list.map(anchor => `${anchor.key}(${anchor.label})`).join("、")}`)
    .join("\n");
}

/**
 * 锚点参考（每个锚点配一句"什么时候用"），给分析阶段照着填。
 */
export function storyAnchorGuideDetailed() {
  return storyAnchors.map(anchor => `· ${anchor.key}（${anchor.label}／${anchor.group}）：${anchor.meaning}`).join("\n");
}
