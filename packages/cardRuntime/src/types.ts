// HTML 卡的公共类型。
//
// 卡的契约（与 FFmpeg 卡库 packages/postProduction 的 cardLibrary 分工见下）：
//   meta    元数据：slug / title / category / shape / oneliner / origin
//   size    默认画幅；实际画幅由渲染器按成片覆盖（卡只按设计坐标作画）
//   frames  时长（帧）；渲染器据此算视频时长
//   params  可调参数（与 FFmpeg 卡同一套写法：区间 + 默认值 + 说明）
//   styles  卡的 CSS（注入页面 <style>）
//   helpers 渲染时要内联进页面的辅助函数（见下）
//   render  (frame, total, params, design) => 该帧的完整 innerHTML
//
// 关于 helpers 与为什么 render 返回整段 HTML：
//   · 页面是**自足**的（file:// 下直接打开就能看），所以卡引用的辅助函数
//     必须由 runtime 内联进去。若不显式声明，类型检查看不见这些名字（TS2304），
//     运行时却靠文本扫描注入 —— 那是隐式契约，改一次就会静默失效。
//   · 逐帧返回整段 HTML 而不是增量更新：卡的代码因此是纯函数，不必维护增量状态，
//     也不会因上一帧的残留产生非确定性（否则逐帧抓帧会闪）。

/** 一张卡的形状 —— 决定它怎么与 AI 视频搭配。 */
export type CardShape =
  /** 全屏卡：自己就是一整屏，**替代**这一段画面（不用 AI 视频）。 */
  | "fullscreen"
  /** 叠加卡：透明背景的信息层，**叠加**在 AI 视频上。 */
  | "overlay"
  /** 转场卡：作用在**两个镜头之间**。 */
  | "transition";

/**
 * 叠加卡在画面上**占用**的区域（归一化 0~1，相对画幅）。
 *
 * 为什么需要它：`overlay` 卡叠在 AI 视频上，而 12 张叠加卡里 8 张把文字**画在中间**、
 * 1 张贴底，`focusDimSpotlight` 更是**把整屏压暗、只留目标行**。生成视频时若不知道这件事，
 * 画面主体很容易正好落在文字底下 —— 而视频那时已经生成完，只能重做。
 *
 * 所以这里是个**反向依赖**：卡不迁就视频，是**视频必须给卡留位**。
 * 分镜阶段用 `useCard` 查到本区域后，把它写进视频生成的提示词（主体避开该区、别居中），再生成。
 *
 * ACT: 用归一化矩形而不是像素 —— 卡是分辨率无关的，区域也必须与画幅无关。
 * `"full"` 表示这张卡**整屏参与**（压暗/模糊全屏），底片只能当纹理，没有可让的位置。
 */
// ACT: 定义在 postProduction/cardFrame（画幅契约的唯一出处，与 CardShape 同处），
// 这里 import 进来供本文件使用、并 re-export 给卡的实现 —— 两处各写一份必然漂移。
import type { CardOcclusion } from "@toonflow/post-production";
export type { CardOcclusion } from "@toonflow/post-production";

/** 参数说明。与 postProduction 的 CardParameter 同构。 */
export interface CardParamSpec {
  min: number;
  max: number;
  value: number;
  description: string;
}

/** 解析后的参数（缺省已填、区间已校验）。 */
export type CardParams = Record<string, number>;

/** 设计画布（runtime 按成片画幅算出）。卡只在此坐标系里作画。 */
export interface CardDesign {
  w: number;
  h: number;
  scale: number;
}

/** 会被内联进页面的辅助函数表。 */
export type CardHelpers = Record<string, (...args: never[]) => unknown>;

export interface CardDefinition {
  meta: {
    slug: string;
    title: string;
    category: string;
    shape: CardShape;
    /**
     * 语义词（与 FFmpeg 卡库的封闭词表一致，见 postProduction/cardLibrary 的 CardSemantic）。
     *
     * ACT: 这个字段是**显式标注**，不从文案里猜。踩过：先写过「从 oneliner 里查关键词」
     * 的推导，结果 24 张卡里 23 张的语义是空数组 —— 文案里根本没有那些词，
     * 于是 Agent 用语义检索时这些卡全部检索不到。词表是**封闭**的，就必须显式填。
     */
    semantics?: string[];
    /** 这张卡吃什么素材（同 FFmpeg 卡的词表）。不填则由 shape 推。 */
    inputs?: string[];
    /**
     * 叠加卡占用的画面区域。**必须是显式标注的实测值**，不从 CSS 猜 ——
     * 卡的外层是 `inset: 0` 满屏容器，看 CSS 只会得出「整屏」（那是错的）。
     */
    occlusion?: CardOcclusion;
    oneliner: string;
    /** 移植来源（有的话），便于回溯上游组件。 */
    origin?: string;
  };
  size: { width: number; height: number };
  frames: number;
  params: Record<string, CardParamSpec>;
  styles?: string;
  helpers?: CardHelpers;
  render: (frame: number, total: number, params: CardParams, design: CardDesign) => string;
}

/** 渲染器需要的画幅与放大方式。 */
export interface CardRenderOptions {
  width: number;
  height: number;
  /**
   * 放大方式（照抄上游 DesignStage 的两个选项）：
   *   scale = transform（合成期放大，快，字形依赖亚像素抗锯齿）
   *   zoom  = CSS zoom（布局期放大，字形按目标尺寸重新光栅化，更清晰）
   */
  raster?: "scale" | "zoom";
}
