// 结论数字（色块先落、数字后弹）。
//
// 移植自上游 video-talkcraft 的 references/cards/number-slab-pop.md 规格
// （实现形态：demos/number-slab-pop/index.html）。
//
// ⚠️ 授权说明：video-talkcraft 是 **PolyForm Noncommercial**（非商用免费，商用需授权）。
// 本项目按「只学规格、独立实现」处理：下面的代码是照它的**动效规格与参数表**重写的，
// 未复制其实现文件。若将来取得商用授权，可另行评估直接接入其实现。
//
// 形态：**叠加/信息卡** —— 口播抛出一个结论数字时立住的钩子（"23.6%，这是去年的增幅"）。
//
// 两条命门（规格原文标为一号与二号命门，必须守住）：
//   ① **块和数字不能同时进**：块先落定 0.24s，块稳住那一帧数字才开始弹。
//      同时进就是一整块 PNG 飞进来，数字失去主语地位。中间那 0.24s 的空块
//      是"位置已经占好了、内容马上到"的预告。
//   ② **小数/单位延后单独淡入**：整数先立住，小数是精度补充。
//      且它们**从一开始就占位**（只动 opacity，绝不用 display 切换）——
//      否则淡入那一帧整行宽度变了，整数被推着横向挪一下（最隐蔽的坑）。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, seg, outCubic, outBack } from "../motion";

const helpers: CardHelpers = { ...motionHelpers() };

export const numberSlabPop: CardDefinition = {
  meta: {
    slug: "numberSlabPop",
    title: "结论数字",
    category: "数据",
    shape: "overlay",
    semantics: ["数据", "钩子"],
    inputs: ["V"],
    oneliner: "色块先从上方落定、块稳住那一帧巨大整数一次弹出，小数与单位再延后 6 帧单独淡入——结论感，不给过程。",
    origin: "按上游 video-talkcraft（PolyForm Noncommercial）规格独立实现：references/cards/number-slab-pop.md",
  },
  size: { width: 1920, height: 1080 },
  // 规格：静置 0.3s → 块落 0.24s → 数字弹 0.28s → 小数 +0.2s → 说明行 → hold 1.8s，共约 3.0s
  frames: 90,
  params: {
    // 全部为设计坐标下的数值；输出分辨率由 runtime 等比放大
    value: { min: 0, max: 1000000, value: 23, description: "整数部分" },
    decimal: { min: 0, max: 1, value: 1, description: "小数与单位是否显示（1 显示 / 0 只有整数）" },
    accent: { min: 0, max: 1, value: 1, description: "色块强调（1 上 accent 色 / 0 用中性深色）" },
  },
  styles: `
    /* ACT: 居中用 margin:auto 而不是 flex 居中 —— 说明行是绝对定位的，
       而绝对定位子元素会参与 flex 子项的尺寸计算，末尾一帧会让色块悄悄上移
       （自检抓不到，是看抽帧发现的）。margin:auto 不受此影响。 */
    .stage { position: absolute; inset: 0; display: flex; background: #f5f5f7; }
    .wrap { position: relative; margin: auto; }
    .slab { display: inline-block; border-radius: 28px; padding: 26px 40px 30px;
            background: #0066cc; color: #ffffff; }
    .row { display: flex; align-items: baseline; white-space: nowrap;
           font-variant-numeric: tabular-nums; font-weight: 600; }
    .int { display: block; }
    .dec { display: block; }
    .pct { display: block; font-weight: 600; }
    .cap { position: absolute; left: 0; color: #8a8a8a; font-weight: 500; }
  `,
  helpers,
  /**
   * 在设计坐标里作画。
   *
   * 字号按设计画布推：规格说「整数字号 = 舞台高的 18%，竖屏取**舞台宽**的 22%
   * （竖屏可用宽度是瓶颈，不是高度）」—— 这正是我们别的卡踩过的同一类坑。
   */
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    const t = Math.min(1, frame / Math.max(1, total - 1));
    // 字号：横屏按高、竖屏按宽（规格明写）
    const portrait = design.h > design.w;
    const intSize = Math.round(portrait ? design.w * 0.22 : design.h * 0.18);
    const decSize = intSize;              // 规格：.dec 与 .int 必须同号，差一号读作两个数字
    const pctSize = Math.round(intSize * 0.55);
    const capSize = Math.round(intSize * 0.21);
    const slabDrop = Math.round(intSize * 0.2);   // 规格：slabDrop 按整数字号的 20%
    const capRise = Math.round(capSize * 0.3);    // 规格：capRise 按说明行字号的 30%

    const accentColor = params.accent > 0.5 ? "#0066cc" : "#2a2a2c";

    // ① 块先落：0.30 → 0.54（0.24s），上方落（y −drop → 0）+ scale 0.94 → 1
    const slabIn = seg(t, 0.3, 0.54, outCubic);
    const slabY = lerp(slabIn, -slabDrop, 0);
    const slabScale = lerp(slabIn, 0.94, 1);
    // ACT: clamp 不能省 —— 不 clamp 时 t<0.30 会算出负 opacity 与 >1 的 scale（规格点名）。
    const slabOpacity = slabIn;

    // ② 数字弹出：块落定那一帧（0.54）起，scale 0.72 → 1，back.out(1.7)
    const numIn = seg(t, 0.54, 0.82, outBack);
    const numScale = lerp(numIn, 0.72, 1);

    // ②b 小数与单位：延后 0.20s（≈6 帧）单独淡入，**从第 0 帧就占位，只动 opacity**
    const decIn = seg(t, 0.74, 0.92, outCubic);

    // ③ 说明行：块外注解，最后淡入上浮
    const capIn = seg(t, 0.92, 1, outCubic);
    const capY = lerp(capIn, capRise, 0);

    const showDecimal = params.decimal > 0.5;
    const integer = String(params.value);

    return `<div class="stage" data-check="舞台">
      <div class="wrap" data-check="色块" style="opacity:${slabOpacity.toFixed(3)};transform:translateY(${slabY.toFixed(1)}px) scale(${slabScale.toFixed(4)})">
        <div class="slab" style="background:${accentColor}">
          <div class="row" data-check="数字行" style="font-size:${intSize}px;transform-origin:50% 60%;transform:scale(${numScale.toFixed(4)})">
            <span class="int">${integer}</span>
            ${showDecimal ? `<span class="dec" style="font-size:${decSize}px;opacity:${decIn.toFixed(3)}">.6</span>` : ""}
            ${showDecimal ? `<span class="pct" style="font-size:${pctSize}px;opacity:${decIn.toFixed(3)}">%</span>` : ""}
          </div>
        </div>
        ${showDecimal ? `<div class="cap" data-check="说明行" style="top:calc(100% + 22px);font-size:${capSize}px;opacity:${capIn.toFixed(3)};transform:translateY(${capY.toFixed(1)}px)">较去年增长</div>` : ""}
      </div>
    </div>`;
  },
};
