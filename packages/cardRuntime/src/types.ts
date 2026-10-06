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
