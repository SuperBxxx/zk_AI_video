// 聚焦压暗切换。
//
// 按上游 video-talkcraft 的 references/cards/focus-dim-spotlight.md 规格独立实现。
// ⚠️ PolyForm Noncommercial：只照规格重写，未复制其实现文件。
//
// 形态：**叠加卡** —— 讲到哪里哪里亮：目标行保持原亮，其余整屏压暗。
// 与荧光笔的分工是尺度：荧光笔在**一行文字内**画重点，本卡在**版面尺度**上切焦点。
//
// 三条命门（规格原文）：
//   · **目标本身零改动** —— 一压暗就想给目标加放大/换色，三件套一起上就成了
//     PPT 强调预设；本卡的力量全在「其余变暗」这一个动作上
//   · **焦点是滑过去的不是切过去的** —— 0.2s 位移让观众眼睛跟得上
//   · **讲完必须整体恢复** —— 暗着不收观众会以为画面就是这么暗的

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, inOutQuad } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const focusDimSpotlight: CardDefinition = {
  meta: {
    slug: "focusDimSpotlight",
    title: "聚焦压暗切换",
    category: "强调",
    shape: "overlay",
    oneliner: "讲到哪里哪里亮——目标行保持原亮，其余整屏压暗，焦点随口播 0.2s 滑到下一目标，讲完整体恢复。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/focus-dim-spotlight.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：静置 0.45s → 焦点建立 0.3s → 首目标 1.25s → 跳转 0.2s × N → 恢复 0.45s
  frames: 150,
  params: {
    rows: { min: 2, max: 8, value: 4, description: "清单行数（演示数据）" },
    establishFrame: { min: 0, max: 60, value: 14, description: "焦点建立帧（规格：静置 0.45s ≈ 14 帧）" },
    holdFirst: { min: 0, max: 90, value: 38, description: "首目标停留帧数（规格 1.25s ≈ 38 帧）" },
    holdRest: { min: 0, max: 90, value: 30, description: "其余目标停留帧数（规格 1.0s = 30 帧）" },
    hopFrames: { min: 1, max: 20, value: 6, description: "焦点跳转用时（帧）；规格 0.2s = 6 帧，**滑过去不是切过去**" },
    dim: { min: 0, max: 0.9, value: 0.4, description: "窗口外压暗程度（规格：整屏压暗 40%）" },
    recover: { min: 0, max: 1, value: 1, description: "讲完整体恢复开关（规格：讲完必须整体恢复）" },
  },
  styles: `
    /* 叠加卡：清单卡浮在画面上 */
    .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .card { position: relative; background: #ffffff; border: 1px solid #e0e0e0;
            border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.35);
            overflow: hidden; }
    .body { position: relative; }
    .row { display: flex; align-items: baseline; color: #1a1a1a; }
    .idx { font-weight: 700; color: #0066cc; }
    .txt { font-weight: 500; }
    /* 聚光窗口：一个空元素，用超大 spread 的 box-shadow 把窗口以外整屏压暗
       （容器 overflow:hidden 裁掉溢出）。移动/缩放这个窗口 = 焦点跳转。 */
    .spot { position: absolute; pointer-events: none; border-radius: 6px;
            box-shadow: 0 0 0 9999px rgba(0,0,0,0); }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const items = [
      "把需求讲清楚",
      "把素材凑齐",
      "把节奏排好",
      "把交付验一遍",
      "把经验留下来",
      "把复用做起来",
      "把成本压下去",
      "把质量提上来",
    ].slice(0, params.rows);

    const cardWidth = Math.round(design.w * 0.58);
    const fontSize = Math.round(Math.min(design.h * 0.042, (cardWidth * 0.82) / 12));
    const rowHeight = Math.round(fontSize * 2.1);
    const padY = Math.round(fontSize * 0.8);
    const cardHeight = rowHeight * items.length + padY * 2;

    // 时间轴：建立 → 逐个目标停留 → 整体恢复
    // 每个目标的停留区间：第一个 holdFirst，其余 holdRest，跳转 hopFrames
    const timeline = [];
    let cursor = params.establishFrame;
    for (let i = 0; i < items.length; i += 1) {
      const hold = i === 0 ? params.holdFirst : params.holdRest;
      timeline.push({ index: i, from: cursor, to: cursor + hold });
      cursor += hold + params.hopFrames;
    }
    const stripEnd = cursor;
    const recoverFrames = 14;

    // 建立：窗口从无到有（压暗缓入），规格 0.3s ≈ 9 帧
    const establish = seg(frame, params.establishFrame - 9, params.establishFrame, outCubic);
    // 恢复：描边退、窗口撑到整卡、整体恢复
    const recover = params.recover > 0.5
      ? seg(frame, stripEnd, stripEnd + recoverFrames, outCubic)
      : 0;
    const dimAmount = params.dim * establish * (1 - recover);

    // 当前焦点：找出所在区间；跳转用 inOutQuad 在相邻目标间滑动
    let active = timeline[0];
    let hopProgress = 1;
    for (let i = 0; i < timeline.length; i += 1) {
      const slot = timeline[i];
      if (frame < slot.from) { active = slot; hopProgress = 0; break; }
      if (frame <= slot.to) { active = slot; hopProgress = 1; break; }
      const next = timeline[i + 1];
      if (next && frame < next.from) {
        // 在跳转途中
        active = next;
        hopProgress = inOutQuad(Math.min(1, Math.max(0, (frame - slot.to) / params.hopFrames)));
        break;
      }
      active = slot;
    }

    // 窗口位置：从上一个目标滑到当前目标（滑过去，不是切过去）
    const slotTop = (index: number) => padY + index * rowHeight;
    const prevIndex = hopProgress < 1 && active.index > 0 ? active.index - 1 : active.index;
    const windowY = lerp(hopProgress, slotTop(prevIndex), slotTop(active.index));
    const windowHeight = recover > 0 ? lerp(recover, rowHeight, cardHeight) : rowHeight;
    const windowTop = recover > 0 ? lerp(recover, windowY, 0) : windowY;

    const rows = items.map((item, index) => `<div class="row" style="height:${rowHeight}px;font-size:${fontSize}px">
        <span class="idx" style="margin-right:${Math.round(fontSize * 0.7)}px">${index + 1}.</span>
        <span class="txt">${item}</span>
      </div>`).join("");

    return `<div class="stage">
      <div class="card" data-check="清单卡" style="width:${cardWidth}px;padding:${padY}px ${Math.round(fontSize * 1.1)}px">
        <div class="body" data-check="清单">
          ${rows}
          <span class="spot" style="left:${Math.round(fontSize * 0.5)}px;right:${Math.round(fontSize * 0.5)}px;top:${windowTop.toFixed(1)}px;height:${windowHeight.toFixed(1)}px;box-shadow:0 0 0 9999px rgba(0,0,0,${dimAmount.toFixed(3)})"></span>
        </div>
      </div>
    </div>`;
  },
};
