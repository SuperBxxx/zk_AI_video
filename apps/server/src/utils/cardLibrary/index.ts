// 配方卡片库：把三套卡合成一份可呈现给用户的目录。
//
// 三套卡的机制完全不同，但对「我手上有什么现成做法」是同一个问题：
//   · ffmpeg 卡（@toonflow/post-production）—— 滤镜链，产出画面，改不了画面内容
//   · HTML 卡（@toonflow/card-runtime）—— 浏览器渲染的全屏/叠加画面
//   · 分析卡（@toonflow/post-production）—— **不产画面**，产出读素材的证据
// 合成逻辑本身在 @toonflow/post-production 的 buildCardCatalog 里（脚本与工具共用同一份，
// 避免这里再维护一份分类或形态判断而漂移）。
import { builtInCards, buildCardCatalog, videoAnalysisCards, type CardCatalogEntry } from "@toonflow/post-production";
import { buildCardPage } from "@toonflow/card-runtime";
import { findHtmlCard, htmlCards } from "@toonflow/card-runtime/cards";

export type CardLibraryGroup = {
  kind: CardCatalogEntry["kind"];
  label: string;
  description: string;
  cards: CardCatalogEntry[];
};

/**
 * 完整卡目录。
 *
 * ACT: `buildCardCatalog` 默认会带上分析卡，这里显式传三份是为了让调用点看得见
 * "分析卡也在目录里" —— 它们此前在 Agent 视野里完全不存在。
 */
export function getCardCatalog(): CardCatalogEntry[] {
  return buildCardCatalog(builtInCards, htmlCards, videoAnalysisCards);
}

/** 分组呈现用：前端按 kind 分块，顺序固定。 */
export function getCardLibrary() {
  const catalog = getCardCatalog();
  const groups: CardLibraryGroup[] = [
    {
      kind: "analysis",
      label: "视频分析配方卡",
      description: "读一条参考视频、把它拆成可核对的证据。不产出画面 —— 先用它们看清现有素材里发生了什么，再去生成。",
      cards: catalog.filter(entry => entry.kind === "analysis"),
    },
    {
      kind: "html",
      label: "HTML 卡（成品画面）",
      description: "浏览器逐帧渲染的整段画面或透明叠加层；按调用方画幅渲染，卡里声明的基础画幅只是默认值。",
      cards: catalog.filter(entry => entry.kind === "html"),
    },
    {
      kind: "ffmpeg",
      label: "FFmpeg 配方卡（滤镜）",
      description: "作用在画面上的滤镜链，分辨率无关；改不了画面内容，适合推进、转场、调色与包装。",
      cards: catalog.filter(entry => entry.kind === "ffmpeg"),
    },
  ];
  return {
    total: catalog.length,
    counts: Object.fromEntries(groups.map(group => [group.kind, group.cards.length])) as Record<CardCatalogEntry["kind"], number>,
    groups,
  };
}

/**
 * 单张 HTML 卡的首帧预览页。
 *
 * ACT: 卡在**设计坐标**下作画，实际画幅由调用方覆盖；预览给一个竖屏小画幅即可，
 * 不必按成片尺寸渲染 —— 面板只是让用户认出"这张卡长什么样"。
 * 只有 HTML 卡能这样预览；FFmpeg 卡是滤镜链，没有可独立呈现的画面。
 */
export async function getCardPreviewHtml(slug: string, width = 270, height = 480) {
  // ACT: findHtmlCard 找不到时会抛出带上全部可用 slug 的错误 —— 那个信息比这里再编一句更有用，
  // 所以不重复判断；只补一个 404 状态，别让它变成 500。
  // 必须写 `Promise.resolve().then(() => findHtmlCard(…))`：直接写成
  // `Promise.resolve(findHtmlCard(slug)).catch(…)` 时，函数是**同步求值**的，
  // 它在 Promise 建立之前就抛了，catch 接不住（踩过）。
  const card = await Promise.resolve()
    .then(() => findHtmlCard(slug))
    .catch(error => {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status: 404 });
    });
  const size = card.size;
  // 保持卡声明的宽高比，避免把卡拉变形
  const scale = Math.min(width / size.width, height / size.height);
  return buildCardPage(card, {}, {
    width: Math.max(64, Math.round(size.width * scale)),
    height: Math.max(64, Math.round(size.height * scale)),
  });
}
