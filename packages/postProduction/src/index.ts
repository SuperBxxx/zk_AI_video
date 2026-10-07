// 后期制作的纯逻辑：对齐、字幕、机器闸、音效钉帧。
//
// 抽成独立包的原因：脚本（scripts/*.mjs）与 agent 工具（tools/postProduction）
// 都要用同一批算法。复制两份的代价是它们会各自漂移 ——
// 而这里的对齐逻辑是本次改动里返工最多的部分（改了四轮才稳定）。
//
// 约束：本包**不得依赖任何 node 内置模块**（不留网络与文件系统），
// 因为 agent 工具的产物跑在沙箱里、且构建时会把本包打进工具产物。
// 取数据（读文件、跑 ffprobe）留在调用方。

export {
  alignTiming,
  normalizeForAlign,
  type AlignCharTime,
  type AlignResult,
  type AlignSentence,
  type AlignWord,
  type AlignWordSpan,
} from "./align";

export {
  buildAss,
  buildSrt,
  subtitleFilter,
  type AssOptions,
  type AssSentence,
  type AssWord,
} from "./subtitles";

export {
  checkAvDuration,
  checkFrameRate,
  checkFreeze,
  checkShotTail,
  parseFreezeSpans,
  parseRatio,
  resolveSoundCues,
  type FreezeSpan,
  type GateFinding,
  type GateResult,
  type ResolvedCue,
  type SoundCueInput,
  type SoundCueResult,
} from "./gate";

export {
  buildEditList,
  checkEditList,
  editListToCsv,
  editListToEdl,
  frameToUs,
  secondsToUs,
  usToFrame,
  usToTimecode,
  type EditCheck,
  type EditSegment,
  type ShotSpec,
} from "./delivery";

export {
  builtInCards,
  cardSummaries,
  CardError,
  findCard,
  instantiateCard,
  matchCards,
  type CardEnergy,
  type CardInput,
  type CardParameter,
  type CardPosition,
  type CardSemantic,
  type RecipeCard,
} from "./cardLibrary";

export {
  buildJianyingDraft,
  type JianyingOptions,
} from "./jianying";

export {
  designCanvasFor,
  designShortSide,
  fitCardToFrame,
  sameAspect,
  type CardShape,
  type CardOcclusion,
  type FrameFit,
  type FrameSize,
} from "./cardFrame";

export {
  buildCardCatalog,
  htmlCardToCatalogEntry,
  analysisCardToCatalogEntry,
  matchCatalog,
  matchCatalogDetailed,
  recipeCardToCatalogEntry,
  type CardCatalogEntry,
  type CardKind,
} from "./cardCatalog";

export {
  videoAnalysisCards,
  videoAnalysisCategories,
  type AnalysisRecipeCard,
  type AnalysisInput,
  type AnalysisEvidence,
} from "./videoAnalysisCards";

export {
  storyAnchors,
  storyAnchorKeys,
  findStoryAnchor,
  isStoryAnchor,
  storyAnchorGuide,
  storyAnchorGuideDetailed,
  type StoryAnchorSpec,
  type StoryAnchorGroup,
} from "./storyAnchor";

export {
  resolveMomentTiming,
  resolveMomentFromScript,
  checkSemanticMoment,
  describeMomentAnchor,
  describeMoments,
  type NodeSemanticMoment,
  type NodeSemanticValue,
  type SemanticUtterance,
  type ResolvedTiming,
} from "./semanticMoment";

export {
  compileTimeline,
  describeTimeline,
  type CompiledShot,
  type CompiledTimeline,
  type CompileOptions,
} from "./timeline";
