// 卡库入口。
//
// 只做一层转出，让渲染内核不必到处写 `@toonflow/card-runtime/cards` 这个子路径。
// 卡定义与渲染逻辑仍在 cardRuntime 里（那才是它该在的地方）。

import { htmlCards, findHtmlCard, htmlCardSummaries } from "@toonflow/card-runtime/cards";
import type { CardDefinition } from "@toonflow/card-runtime";

/** 一张 HTML 卡。 */
export type HtmlCard = CardDefinition;

export { htmlCards, findHtmlCard, htmlCardSummaries };
