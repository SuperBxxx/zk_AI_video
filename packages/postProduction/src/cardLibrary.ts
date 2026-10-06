// 配方卡库：把「画面效果」变成可复用、可校验的词汇。
//
// 为什么需要它：没有词汇表时，每次做片都是临场写提示词/滤镜，风格会飘、
// 经验会丢。有了卡，选效果变成「按素材类型与语义检索」，
// 而且每张卡的参数与已知坑都写在卡上，不靠记忆。
//
// 卡的形态与参考实现的差异（必须说清楚）：参考实现的卡是**可直接渲染的组件**（tsx），
// 我们的画面由生成模型产出、由 FFmpeg 组装，所以这里的卡是
// **参数化的 FFmpeg 滤镜链 + 使用说明**。它不做逐帧程序化渲染 ——
// 那超出 FFmpeg 的表达能力，硬做只会得到一堆只能特例化的滤镜字符串。
//
// 本模块是纯逻辑（不碰文件系统），供 agent 工具与脚本共用。

/** 卡吃哪种输入。与参考实现的输入类型索引对齐，便于对照。 */
export type CardInput = "人" | "V" | "图" | "截图" | "文" | "界" | "场";

/**
 * 语义词表（封闭，与 semanticAnnotate 的 26 词对齐）。
 * 只列卡库实际会声明的那些，避免这里成为第二份词表来源。
 */
export type CardSemantic =
  | "钩子" | "论点" | "例证" | "数据" | "对比" | "列举" | "定义" | "步骤"
  | "转折" | "设问" | "金句" | "标题" | "引用" | "自我介绍" | "介绍他人"
  | "号召" | "时间地点" | "空间叙事" | "机制" | "选择" | "过程演示"
  | "章节" | "转场" | "强调" | "氛围" | "结尾";

export type CardPosition = "开场" | "中段" | "收尾" | "任意";
export type CardEnergy = "低" | "中" | "高";

export interface CardParameter {
  name: string;
  description: string;
  /** 允许区间；越界会在实例化时报错，而不是悄悄产出一个坏滤镜。 */
  min: number;
  max: number;
  /** 缺省值。 */
  value: number;
}

export interface RecipeCard {
  /** 卡标识（小驼峰），进文件名与提示词。 */
  slug: string;
  title: string;
  category: "镜头运动" | "转场" | "文字" | "调色" | "包装";
  /** 一句话说清「这是什么」。 */
  oneliner: string;
  inputs: CardInput[];
  semantics: CardSemantic[];
  position: CardPosition;
  energy: CardEnergy;
  priority: "P0" | "P1" | "P2";
  durationHint: string;
  parameters: CardParameter[];
  /**
   * FFmpeg 滤镜链模板。`{{name}}` 会被参数替换。
   * ACT: 只写滤镜表达式，不含输入输出参数 —— 输入输出由调用方按工作区路径拼，
   * 这样卡不会把路径拼错，也不会把绝对路径写进卡里。
   */
  filters: string[];
  /**
   * 需要第二路输入时，这一路的**构造方式**（`lavfi` 的源描述）。
   *
   * 多数卡只需一路输入，用 `filters` 接 `-vf` 即可；但有些效果（闪光、辉光、
   * 色卡叠加）本质是「再加一层」，必须走 `filter_complex` 把两路叠起来。
   * 给了这一项时，`filters` 会被当作 filter_complex 的整段（含标签），
   * 第二路的标签固定是 `[1:v]`。
   */
  secondInput?: string;
  /** 已知坑：写清楚什么情况下这张卡会翻车。 */
  pitfalls: string[];
  /** 落位自检：做完了该核什么。 */
  checks: string[];
}

export class CardError extends Error {}

/** 把模板里的 {{name}} 替换成参数值；缺参数或越界都直接报错。 */
export function instantiateCard(card: RecipeCard, values: Record<string, number> = {}): { filters: string[]; applied: Record<string, number> } {
  const applied: Record<string, number> = {};
  for (const parameter of card.parameters) {
    const raw = values[parameter.name] ?? parameter.value;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new CardError(`卡 ${card.slug} 的参数 ${parameter.name} 必须是数字`);
    }
    if (raw < parameter.min || raw > parameter.max) {
      throw new CardError(`卡 ${card.slug} 的参数 ${parameter.name}=${raw} 超出允许区间 [${parameter.min}, ${parameter.max}]`);
    }
    applied[parameter.name] = raw;
  }
  const unknown = Object.keys(values).filter(name => !card.parameters.some(parameter => parameter.name === name));
  if (unknown.length) throw new CardError(`卡 ${card.slug} 没有这些参数：${unknown.join("、")}`);

  const filters = card.filters.map(filter => {
    const replaced = filter.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      if (!(name in applied)) throw new CardError(`卡 ${card.slug} 的滤镜引用了未声明的参数 {{${name}}}`);
      return String(applied[name]);
    });
    const leftover = replaced.match(/\{\{\w+\}\}/);
    if (leftover) throw new CardError(`卡 ${card.slug} 的滤镜里还有未替换的 ${leftover[0]}`);
    return replaced;
  });
  return { filters, applied };
}

/** 按素材类型与语义检索卡；返回带排序理由的候选，供 agent 决策。 */
export function matchCards(
  cards: RecipeCard[],
  query: { inputs?: CardInput[]; semantics?: CardSemantic[]; position?: CardPosition; energy?: CardEnergy },
): { card: RecipeCard; score: number; reasons: string[] }[] {
  const results: { card: RecipeCard; score: number; reasons: string[] }[] = [];
  for (const card of cards) {
    let score = 0;
    const reasons: string[] = [];
    // 输入类型是硬条件：卡吃不了的素材直接不参选
    if (query.inputs?.length) {
      const hit = query.inputs.find(input => card.inputs.includes(input));
      if (!hit) continue;
      score += 3;
      reasons.push(`吃 ${hit}`);
    }
    // 给了语义时，一个都不匹配的直接不参选 ——
    // 否则「场 + 号召」会命中一张纯转场卡（实测踩到），候选表就失去筛选意义。
    if (query.semantics?.length) {
      const hits = query.semantics.filter(semantic => card.semantics.includes(semantic));
      if (!hits.length) continue;
      score += hits.length * 2;
      reasons.push(`语义匹配 ${hits.join("、")}`);
    }
    if (query.position && card.position !== "任意") {
      if (card.position !== query.position) continue;
      score += 1;
      reasons.push(`位置 ${card.position}`);
    }
    if (query.energy) {
      if (card.energy !== query.energy) reasons.push(`能量 ${card.energy}（与要求的 ${query.energy} 不同）`);
      else { score += 1; reasons.push(`能量 ${card.energy}`); }
    }
    score += card.priority === "P0" ? 2 : card.priority === "P1" ? 1 : 0;
    reasons.push(`优先级 ${card.priority}`);
    results.push({ card, score, reasons });
  }
  return results.sort((left, right) => right.score - left.score);
}

/**
 * 内置卡。这一批只收录**本机 ffmpeg 实际跑得通**的滤镜链，
 * 每张都在 scripts/preflight.mjs 里被真实执行验证（见 checkCards）。
 *
 * ACT: 首批刻意很小 —— 卡的内容来自对具体效果的调校经验，不是能凭空造出来的。
 * 机制（参数校验、检索、验证）已经完整，卡按实际需要往里加即可。
 */
export const builtInCards: RecipeCard[] = [
  {
    slug: "slowPushIn",
    title: "极缓推进",
    category: "镜头运动",
    oneliner: "整幅画面从 100% 极缓慢推到指定比例，全程连续。反 PPT 规范里最有效的一条：画面一直在动，静息帧也不会僵。",
    inputs: ["人", "V", "图", "截图", "界"],
    semantics: ["论点", "例证", "氛围", "强调"],
    position: "任意",
    energy: "低",
    priority: "P0",
    durationHint: "整镜时长（写速率不写固定秒数）",
    parameters: [
      { name: "fps", description: "成片帧率", min: 1, max: 120, value: 30 },
      { name: "seconds", description: "镜头时长（秒）", min: 0.2, max: 600, value: 5 },
      { name: "endZoom", description: "结束缩放（1.04~1.06 为宜；推得太快会像变焦炫技）", min: 1.005, max: 1.2, value: 1.05 },
    ],
    // 踩过的坑：写成 `z='1+{{endZoom}}-1*on/(...)'` 时，替换结果是
    // `1+1.05-1*on/(150)` —— 运算符优先级把它算成 `2.05 - on/150`，
    // 起始就是 2.05 倍且几乎不动，而 FFmpeg **不会报错**。
    // 必须把增量括起来：`1+({{endZoom}}-1)*on/(...)`。
    filters: ["zoompan=z='1+({{endZoom}}-1)*on/({{seconds}}*{{fps}})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps={{fps}}"],
    pitfalls: [
      "**表达式里做算术一定要加括号**：模板替换是纯文本，`1+{{endZoom}}-1*...` 会按优先级算错，而 FFmpeg 照样跑出画面（静默错误）。",
      "zoompan 的 z 表达式里用 on（输出帧序）而不是 in；写成 in 会在多输入时异常。",
      "缩放窗口必须居中（x/y 那两项），否则推进会让人误以为画面在漂移。",
      "本卡的 s=1920x1080 是写死的：换画幅（竖屏等）必须同时改这一项，否则输出尺寸不对。",
      "细密纹理（特征 ≤2px、间距 ≤24px）放进缩放层会亚像素爬行，整块读作「画面在抖」——那种素材要么把纹理放大，要么改用静态层。",
    ],
    checks: [
      "首末帧的缩放差等于 endZoom−1（1.05 意味着末帧比首帧大 5%）；差得离谱说明表达式被算错了",
      "末帧仍在上限内（没有推到 1.2 那种夸张幅度）",
      "推进方向与镜头意图一致（收束段才用拉出）",
    ],
  },
  {
    slug: "fadeEdges",
    title: "首尾淡入淡出",
    category: "转场",
    oneliner: "画面在开头与结尾各做一次黑场过渡。用于整片开场、收尾，或需要明确「一段结束」的位置。",
    inputs: ["人", "V", "图", "截图", "界"],
    semantics: ["章节", "结尾", "氛围"],
    position: "任意",
    energy: "低",
    priority: "P1",
    durationHint: "淡入淡出各 0.3~0.5s",
    parameters: [
      { name: "seconds", description: "镜头时长（秒）", min: 0.5, max: 600, value: 5 },
      { name: "fadeIn", description: "淡入时长（秒）", min: 0, max: 5, value: 0.4 },
      { name: "fadeOut", description: "淡出时长（秒）", min: 0, max: 5, value: 0.4 },
      { name: "fadeOutStart", description: "淡出起点（秒）＝镜头时长 − 淡出时长；由调用方算好传入", min: 0, max: 600, value: 4.6 },
    ],
    // ACT: 这里**不做模板算术**。踩过的坑：写成 st={{seconds}}-{{fadeOut}} 时，
    // 实例化结果是 `st=5-0.4`，而 FFmpeg 的滤镜选项解析把它断成 `st='5` 与独立选项 `-0.4`，
    // 报 "Error applying option 'st'"。表达式求值交给调用方（本卡用 fadeOutStart 承接）。
    filters: ["fade=t=in:st=0:d={{fadeIn}}", "fade=t=out:st={{fadeOutStart}}:d={{fadeOut}}"],
    pitfalls: [
      "fadeOutStart 必须小于镜头时长，否则 fade 会静默不生效（参数越界在滤镜层不报错）。",
      "**不要指望在滤镜模板里做算术**：FFmpeg 的选项解析按分隔符断参数，算出来的 `5-0.4` 不会被求值，只会报选项错误。需要派生值时由调用方算好再传。",
      "浅底上不要用「加模糊」代替淡出：会叠成白纱，读作画面变糊。",
    ],
    checks: ["首帧全黑、末帧全黑", "淡入淡出没有把主体动作吃掉（主体动作不要在首尾 0.4s 内）"],
  },
  {
    slug: "crossFade",
    title: "交叉淡化转场",
    category: "转场",
    oneliner: "两段画面在指定时长内叠加过渡。用于段落之间的软切换。",
    inputs: ["场"],
    semantics: ["转场"],
    position: "任意",
    energy: "低",
    priority: "P1",
    durationHint: "0.4~0.8s",
    parameters: [
      { name: "duration", description: "过渡时长（秒）", min: 0.1, max: 3, value: 0.6 },
      { name: "offset", description: "过渡起点（第一段的时间轴位置，秒）", min: 0, max: 3600, value: 4.4 },
    ],
    filters: ["xfade=transition=fade:duration={{duration}}:offset={{offset}}"],
    pitfalls: [
      "xfade 的 offset 是**第一段的**时间点，不是两段时长之和；算错会让过渡出现在错误位置或直接不出现。",
      "两段的分辨率、帧率、像素格式必须一致，否则 xfade 会报错 —— 先在各自输入上统一规格。",
      "反 PPT 规范要求转场靠运动承接而不是交叉淡化：本卡是兜底手段，能用运动承接就别用它。",
    ],
    checks: ["过渡处没有黑帧或跳帧", "前后段的运动方向是否连续（不连续就在评审里记 P1）"],
  },
  {
    slug: "desaturateBed",
    title: "降饱和底床",
    category: "调色",
    oneliner: "把素材压成低饱和、略暗的底床，让叠在上面的文字或主体读得出来。用于「素材当背景」而不是当主角的镜头。",
    inputs: ["V", "图", "截图"],
    semantics: ["氛围", "标题", "金句"],
    position: "任意",
    energy: "低",
    priority: "P1",
    durationHint: "整镜时长",
    parameters: [
      { name: "saturation", description: "饱和度倍数（0=完全去色）", min: 0, max: 1, value: 0.45 },
      { name: "brightness", description: "亮度偏移（负值压暗）", min: -0.5, max: 0.5, value: -0.06 },
      { name: "contrast", description: "对比度倍数", min: 0.5, max: 2, value: 1.02 },
    ],
    filters: ["eq=saturation={{saturation}}:brightness={{brightness}}:contrast={{contrast}}"],
    pitfalls: [
      "降饱和是「压成底床」，不是调透明度 —— 用透明度会让画面透出下层，读作重影。",
      "压暗之后要重新核文字与底床的对比度，别压到文字读不出来。",
    ],
    checks: ["叠字区域与底床对比度足够（缩到 390px 宽仍能读）", "底床没有比主体更抓眼"],
  },
  {
    slug: "vignetteFocus",
    title: "暗角收拢视线",
    category: "包装",
    oneliner: "四周压暗把视线收到中间。用于主体居中、周围信息量需要降低的镜头。",
    inputs: ["人", "V", "图", "截图", "界"],
    semantics: ["强调", "金句", "氛围"],
    position: "任意",
    energy: "低",
    priority: "P2",
    durationHint: "整镜时长",
    parameters: [
      { name: "angle", description: "暗角起始角（越小越紧）", min: 0.1, max: 1.5, value: 0.35 },
    ],
    filters: ["vignette=angle={{angle}}"],
    pitfalls: [
      "暗角过强会让画面显脏；参考实现在运动系统里把「呼吸 vignette」整套删掉了 —— 暗角应当是**静态**的一层，不要让它动。",
      "深底上叠暗角会看不出效果，别为此加大强度。",
    ],
    checks: ["四角压暗后主体仍清晰", "暗角没有把字幕带区域压到读不清"],
  },
  {
    slug: "holdLastFrame",
    title: "冻结末帧留白",
    category: "镜头运动",
    oneliner: "只保留画面开头到指定时刻、然后把那一帧冻结指定时长。用于「动作落定后停住」：标志入位、关键数字定格，让观众记住这一眼。",
    inputs: ["人", "V", "图", "截图", "界"],
    semantics: ["金句", "强调", "结尾", "标题"],
    position: "任意",
    energy: "低",
    priority: "P1",
    durationHint: "1~2s（品牌记忆点建议满 1s）",
    parameters: [
      { name: "fps", description: "成片帧率", min: 1, max: 120, value: 30 },
      { name: "freezeAt", description: "从第几秒起冻结（保留 0~freezeAt 的动作）", min: 0, max: 600, value: 1.6 },
      { name: "holdSeconds", description: "冻结时长（秒）", min: 0.2, max: 30, value: 1.2 },
    ],
    // ACT: 两条踩过的坑都在这里：
    //   1. `setpts` 的值**必须以时间基为单位** —— 裸秒要先 `/TB`。
    //      实测 `setpts='min(T,1.6)'` 输出只有 1.233s（时间轴塌掉），
    //      而 `setpts='min(T,1.6)/TB'` 才是 2.833s（= 1.6 + 1.2）。
    //   2. 原先把冻结写成 `gte(T,1/fps)`，那冻的是**第一帧**而不是落定帧；
    //      参数化 freezeAt 才是「落定后 hold」的语义。
    filters: ["setpts='min(T,{{freezeAt}})/TB'", "tpad=stop_mode=clone:stop_duration={{holdSeconds}}"],
    pitfalls: [
      "**`setpts` 的表达式值要除以 TB（时间基）**：写裸秒会让时间轴塌成单帧，输出时长只剩 holdSeconds 那么长，而 FFmpeg 不报错。",
      "定格会让「任意 0.8s 不允许全静止」的质量闸失败 —— 这正是反 PPT 规范里说的边界：**处置不是豁免，而是让相机继续极缓推进**（把本卡与 slowPushIn 叠用）。",
      "freezeAt 要落在动作已经落定之后；早了会冻在半途，晚了等于没冻。",
      "输出时长 ≈ freezeAt + holdSeconds，不是原时长 + holdSeconds —— 换时长时要按这个算。",
    ],
    checks: [
      "冻结的那一帧是动作落定态（不是入场中间态）",
      "定格时长够观众读完（信息卡的参考值是满 1s）",
      "定格段是否与相机微推叠用（否则质检会失败）",
    ],
  },
  {
    slug: "flashCut",
    title: "硬切闪白",
    category: "转场",
    oneliner: "在硬切处闪一层暖白，把两个镜头「焊」在一起。上游项目里叫 FlashCut，这是从它的组件移植过来的第一张卡。",
    inputs: ["场"],
    semantics: ["转场", "强调", "章节"],
    position: "任意",
    energy: "高",
    priority: "P1",
    durationHint: "0.4~1.0s（闪的进与出合计）",
    parameters: [
      { name: "peak", description: "峰值不透明度（1.0 = 纯白）", min: 0.1, max: 1, value: 1.0 },
      { name: "inDuration", description: "升到峰值用时（秒）", min: 0.05, max: 3, value: 0.4 },
      { name: "outDuration", description: "从峰值落回用时（秒）", min: 0.05, max: 3, value: 0.6 },
    ],
    // ACT: 用「白色源 + fade 做 alpha + overlay」而不是在 overlay 的 alpha 里写表达式。
    // 踩过的坑：`overlay=alpha='if(between(t,0,0.4),t/0.4*0.85,if(...))'` 直接报
    // `Undefined constant or missing '('` —— 表达式里嵌套 if 的**逗号被当成滤镜链
    // 分隔符**，句子从逗号处被切断。改用普通滤镜（format/fade/overlay）就不必与
    // ffmpeg 的转义规则搏斗，而且 fade 的 alpha 曲线正是我们要的形状。
    secondInput: "color=c=white:s=1920x1080:r=30",
    filters: [
      "[1:v]format=yuva420p,fade=t=in:st=0:d={{inDuration}}:alpha=1,fade=t=out:st={{inDuration}}:d={{outDuration}}:alpha=1,colorchannelmixer=aa={{peak}}[flash]",
      "[0:v][flash]overlay=format=auto",
    ],
    pitfalls: [
      "**滤镜表达式里不要写嵌套 if**：逗号会被当成滤镜链分隔符，报 `Undefined constant or missing '('`。要用条件分支就用普通滤镜表达，或给逗号转义。",
      "`secondInput` 的分辨率写死成 1920x1080（与底片同尺寸，overlay 才不会错位）；换画幅要一起改。",
      "闪光只该出现在**切点**上：它的时间轴是相对这一段的，所以本卡要作用在切点附近的短片段上，不是整镜。",
      "闪白是「焊接硬切」的手段，不能用来掩盖对不上的动作 —— 动作不连贯该重做，不该靠闪一下糊过去。",
    ],
    checks: [
      "峰值那一帧确实接近全白（不是淡淡的灰）",
      "首末帧回到原画面（没有把整段都提亮）",
      "切点两侧的动作是连贯的（闪白只做焊接）",
    ],
  },
];

/** 按 slug 取卡。 */
export function findCard(cards: RecipeCard[], slug: string): RecipeCard {
  const card = cards.find(item => item.slug === slug);
  if (!card) throw new CardError(`没有这张卡：${slug}（现有：${cards.map(item => item.slug).join("、")}）`);
  return card;
}

/** 卡的索引摘要，给「列出可用效果」用；正文（滤镜与坑）在取到具体卡时再给。 */
export function cardSummaries(cards: RecipeCard[]) {
  return cards.map(card => ({
    slug: card.slug,
    title: card.title,
    category: card.category,
    oneliner: card.oneliner,
    inputs: card.inputs,
    semantics: card.semantics,
    position: card.position,
    energy: card.energy,
    priority: card.priority,
    durationHint: card.durationHint,
    parameters: card.parameters.map(parameter => `${parameter.name}(${parameter.min}~${parameter.max}，默认 ${parameter.value})`),
  }));
}
