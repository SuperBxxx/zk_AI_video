// 统一卡目录：把两个卡库合成一份可检索、可呈现给 Agent 的目录。
//
// 为什么要这一层：项目里有两套卡，机制、形态、许可都不同，但对 Agent 来说
// 「做这个镜头有什么现成的卡」是一个问题，不该让它自己知道去哪边找。
//
//   · FFmpeg 卡（packages/postProduction/cardLibrary）—— 滤镜链，作用在画面上，改不了画面内容
//   · HTML 卡（packages/cardRuntime）—— 浏览器渲染的整段画面（全屏卡）或透明叠加层（叠加卡）
//
// 两者的**输出形态完全不同**，所以目录里必须把「形态」说清楚：
// 用错形态比没有卡更糟（拿全屏卡去叠加会盖掉整个 AI 视频）。

import type { RecipeCard, CardInput, CardSemantic } from "./cardLibrary";
import { matchCards } from "./cardLibrary";
import type { CardShape, CardOcclusion } from "./cardFrame";
import type { AnalysisRecipeCard, AnalysisEvidence } from "./videoAnalysisCards";
import { videoAnalysisCards } from "./videoAnalysisCards";

/** 目录里的卡是哪种实现。 */
export type CardKind = "ffmpeg" | "html" | "analysis";

/** 统一目录项。两个卡库都被归一成这个形状。 */
export interface CardCatalogEntry {
  kind: CardKind;
  slug: string;
  title: string;
  category: string;
  oneliner: string;
  /** HTML 卡才有：输出形态。用错形态会盖掉整个画面。 */
  shape?: CardShape;
  /** HTML 卡的时长就不由 durationHint 表达了：它按帧数出。 */
  frames?: number;
  /** HTML 卡在设计坐标下声明的基础画幅；**实际按调用方画幅渲染**，这个只是默认值。 */
  baseSize?: { width: number; height: number };
  /** 卡自带文案（HTML 卡目前文案写在卡里，Agent 改不了）。 */
  textLocked?: boolean;
  /**
   * 叠加卡**占用**的画面区域（归一化 0~1）或 `"full"`。
   *
   * 这是给「生成视频」用的：查到这一段要用某张叠加卡后，先把这个区域写进视频生成提示词
   * （主体避开该区、别居中），**再**生成视频 —— 否则主体正好落在文字底下，视频已经产出，只能重做。
   */
  occlusion?: CardOcclusion;
  origin?: string;
  inputs: CardInput[];
  semantics: CardSemantic[];
  /**
   * 分析卡才有：产出哪些证据。
   *
   * ACT: 分析卡**不产画面**，所以没有 shape/frames/filters ——
   * 在目录里显式带上这一项，Agent 才不会拿它当可执行的滤镜卡。
   */
  evidence?: AnalysisEvidence[];
  /** 分析卡才有：为什么必须用它（不用会怎样）。 */
  why?: string;
}

/** HTML 卡的原型（与 cardRuntime 的 CardDefinition 结构兼容，避免这里引它的类型）。 */
interface HtmlCardLike {
  meta: {
    slug: string;
    title: string;
    category: string;
    shape: CardShape;
    /** 显式语义词（封闭词表）。 */
    semantics?: string[];
    /** 显式素材形态。不填则按 shape 推。 */
    inputs?: string[];
    /** 叠加卡占用的画面区域（归一化）或 "full"。 */
    occlusion?: CardOcclusion;
    oneliner: string;
    origin?: string;
  };
  size: { width: number; height: number };
  frames: number;
}

const knownInputs = new Set(["人", "V", "图", "截图", "文", "界", "场"]);

/**
 * HTML 卡的 category 归一到 FFmpeg 卡的分类词表，让两边的分类能放在一起筛。
 */
function normalizeCategory(category: string): RecipeCard["category"] {
  const name = category.trim();
  if (name === "转场") return "转场";
  if (name === "数据") return "文字";
  if (name === "强调") return "包装";
  if (name === "文字") return "文字";
  return "包装";
}

/**
 * HTML 卡的素材形态：优先用卡上**显式标注**的 inputs，没标才按 shape 推。
 *
 * 按 shape 推的兜底：全屏卡替代画面（不吃素材）；叠加卡叠在视频上（吃 V）；
 * 转场卡作用于前后两镜（吃 场）。局限：推不出「人」「截图」这类细分，需要时给卡补 inputs。
 */
function inputsForCard(card: HtmlCardLike): CardInput[] {
  const declared = (card.meta.inputs ?? []).filter(input => knownInputs.has(input));
  if (declared.length) return declared as CardInput[];
  const { shape } = card.meta;
  if (shape === "overlay") return ["V"];
  if (shape === "transition") return ["场"];
  return ["文"];
}

/** 把一张 HTML 卡归一成目录项。 */
export function htmlCardToCatalogEntry(card: HtmlCardLike): CardCatalogEntry {
  return {
    kind: "html",
    slug: card.meta.slug,
    title: card.meta.title,
    category: normalizeCategory(card.meta.category),
    oneliner: card.meta.oneliner,
    shape: card.meta.shape,
    frames: card.frames,
    baseSize: card.size,
    // HTML 卡的文案目前写在卡里（每张卡的 render 里），Agent 只能调参数、不能改字
    textLocked: true,
    ...(card.meta.occlusion ? { occlusion: card.meta.occlusion } : {}),
    origin: card.meta.origin,
    inputs: inputsForCard(card),
    // ACT: 语义是**显式标注**，不从文案里猜。踩过：先写过「从 oneliner 里查关键词」的推导，
    // 结果 24 张卡里 23 张语义为空数组，Agent 用语义检索时这些卡全部检索不到。
    semantics: (card.meta.semantics ?? []) as CardSemantic[],
  };
}

/** 把一张 FFmpeg 卡归一成目录项。 */
export function recipeCardToCatalogEntry(card: RecipeCard): CardCatalogEntry {
  return {
    kind: "ffmpeg",
    slug: card.slug,
    title: card.title,
    category: card.category,
    oneliner: card.oneliner,
    inputs: card.inputs,
    semantics: card.semantics,
  };
}

/**
 * 把一张分析卡归一成目录项。
 *
 * ACT: 分析卡的 `inputs` 用的是自己的词表（视频/音频/词表），
 * 与后期卡的封闭词表（人/V/图/…）不是一套；这里做映射而不是硬塞，
 * 免得把「视频」当成后期卡里的「V」（原片画面）而产生错误联想。
 */
export function analysisCardToCatalogEntry(card: AnalysisRecipeCard): CardCatalogEntry {
  return {
    kind: "analysis",
    slug: card.slug,
    title: card.title,
    category: card.category,
    oneliner: card.oneliner,
    inputs: card.inputs.map(input => input === "视频" ? "V" : input === "音频" ? "文" : "文") as CardInput[],
    semantics: [],
    evidence: card.evidence,
    why: card.why,
  };
}

/**
 * 三套卡合成一份目录。
 *
 * ACT: `analysisCards` 有默认值，所以已有调用方（脚本、工具、卡目录自检）不改也能跑，
 * 且不会因为漏传而让分析卡在目录里消失 —— 那是这次要修的核心缺口。
 */
export function buildCardCatalog(recipeCards: RecipeCard[], htmlCards: HtmlCardLike[], analysisCards: AnalysisRecipeCard[] = videoAnalysisCards): CardCatalogEntry[] {
  return [
    ...recipeCards.map(recipeCardToCatalogEntry),
    ...htmlCards.map(htmlCardToCatalogEntry),
    ...analysisCards.map(analysisCardToCatalogEntry),
  ];
}

/**
 * 在合并目录上检索，保留 matchCards 的打分与理由。
 *
 * 做法：把目录项**按 slug 就地补上** position / energy（先从 FFmpeg 卡原表里查回真实档位），
 * 再整体喂给 FFmpeg 卡库的 matchCards —— 它已经处理好了 inputs/semantics/position/energy
 * 的命中与排序规则，重写一套只会跟它漂移。
 *
 * ACT: position / energy 是 FFmpeg 卡才有的档位，HTML 卡没有。
 * 带这两个条件检索时 HTML 卡一律**不命中** —— 宁可漏，也不假装它有档位。
 */
export function matchCatalogDetailed(
  catalog: CardCatalogEntry[],
  recipeCards: RecipeCard[],
  query: { inputs?: CardInput[]; semantics?: CardSemantic[]; position?: RecipeCard["position"]; energy?: RecipeCard["energy"] },
): { entry: CardCatalogEntry; score: number; reasons: string[] }[] {
  const bySlug = new Map(catalog.map(entry => [entry.slug, entry]));
  const recipeBySlug = new Map(recipeCards.map(card => [card.slug, card]));

  const forMatching: RecipeCard[] = catalog.map(entry => {
    const original = recipeBySlug.get(entry.slug);
    if (original) return original;
    return {
      slug: entry.slug,
      title: entry.title,
      category: entry.category as RecipeCard["category"],
      oneliner: entry.oneliner,
      inputs: entry.inputs,
      semantics: entry.semantics,
      // HTML 卡没有档位：给空值，matchCards 在带档位条件时自然筛掉它们
      position: undefined as unknown as RecipeCard["position"],
      energy: undefined as unknown as RecipeCard["energy"],
      priority: "P1",
      durationHint: entry.frames ? `${entry.frames} 帧` : "",
      parameters: [],
      filters: [],
      pitfalls: [],
      checks: [],
    };
  });

  return matchCards(forMatching, query)
    .map(match => {
      const entry = bySlug.get(match.card.slug);
      return entry ? { entry, score: match.score, reasons: match.reasons } : undefined;
    })
    .filter((item): item is { entry: CardCatalogEntry; score: number; reasons: string[] } => Boolean(item));
}

/** 只要目录项的检索（不需要打分理由时用这个）。 */
export function matchCatalog(
  catalog: CardCatalogEntry[],
  recipeCards: RecipeCard[],
  query: { inputs?: CardInput[]; semantics?: CardSemantic[]; position?: RecipeCard["position"]; energy?: RecipeCard["energy"] },
): CardCatalogEntry[] {
  return matchCatalogDetailed(catalog, recipeCards, query).map(item => item.entry);
}
