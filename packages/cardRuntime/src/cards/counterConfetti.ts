// 数字冲刺彩屑。
//
// 移植自上游 video-shotcraft 的 demos/data/counter-confetti/CounterConfetti.tsx
// （规格见 gallery/source/counter-confetti.md，参数表在设计坐标 480×270 下标定）。
//
// 形态：**全屏卡** —— 里程碑/成绩数字的庆祝拍，替代这一段画面。
//
// 与上游一致的命门：
//   · 计数走 easeOutQuart（前 1/3 时间跑完 2/3 数值）—— 线性计数是最常见的「没有情绪」写法
//   · **抢拍**：纸屑 0.52 早于计数到位 0.56 —— 庆祝比结果先到约 5 帧，这半拍是这张卡的灵魂
//   · 52 片纸屑真物理（两侧出发 / 抛物线上抛 / 重力拉回 / 自转），8 色调色板
//   · 到位冲击环 + 标签字距 11→5 收紧（「落章」感）
//
// 与上游的差异：上游按帧取 useCurrentFrame()；这里是 render(frame, ...) 纯函数，
// 且在设计坐标里作画（输出分辨率由 runtime 等比放大）。

import type { CardDefinition, CardParams, CardDesign, CardHelpers } from "../types";
import { motionHelpers, lerp, rand, seg, outCubic, outQuart, outBack, normalizedT } from "../motion";

/**
 * 纸屑的静态参数。种子与上游逐条对齐 —— 确定性、可复现。
 *
 * ACT: 调色板写在**函数体内部**，不引用模块级变量。
 * 因为 helpers 是靠 `fn.toString()` 内联进页面的：闭包会带走对外部作用域的引用，
 * 而页面里没有那些常量，于是运行时报错（踩过：页面直接加载失败）。
 * **凡是进 helpers 的函数、以及 render 本身，都必须是自包含的。**
 */
function confettiBits(): { w: number; h: number; color: string; x0: number; y0: number; vx: number; vy: number; g: number; spin: number; delay: number }[] {
  const palette = ["#ff6b8b", "#ffb347", "#ffe86b", "#7bff9e", "#5fd8ff", "#6c8cff", "#c86cff", "#ff6cf0"];
  return Array.from({ length: 52 }, (_, i) => {
    const isRect = rand(i * 3) > 0.4;
    const w = 5 + rand(i + 2) * 6;
    const h = isRect ? 8 + rand(i + 5) * 7 : w;
    const side = i % 2 ? 1 : -1;
    return {
      w, h,
      color: palette[i % 8],
      x0: side * 250,
      y0: (rand(i + 30) - 0.5) * 60,
      vx: -side * (150 + rand(i * 5 + 1) * 300),
      vy: -(230 + rand(i * 7 + 3) * 220),
      g: 900 + rand(i + 60) * 520,
      spin: (rand(i + 90) - 0.5) * 1500,
      delay: rand(i + 120) * 0.06,
    };
  });
}

const helpers: CardHelpers = {
  ...motionHelpers(),
  confettiBits: confettiBits as unknown as (...args: never[]) => unknown,
};

export const counterConfetti: CardDefinition = {
  meta: {
    slug: "counterConfetti",
    title: "数字冲刺彩屑",
    category: "数据",
    shape: "fullscreen",
    semantics: ["数据", "金句"],
    inputs: ["文"],
    // 上游长度常量 COUNTER_CONFETTI_DURATION = 138
    oneliner: "里程碑数字的庆祝拍：大数字 easeOutQuart 冲刺计数并过冲放大，到位前 5 帧 52 片彩屑从两侧炸入，冲击环扩散、标签字距收紧。",
    origin: "移植自上游 video-shotcraft（Apache-2.0）demos/data/counter-confetti",
  },
  size: { width: 1920, height: 1080 },
  frames: 138,
  params: {
    // 设计坐标下的字号；0 = 按设计画布自动
    fontSize: { min: 0, max: 300, value: 0, description: "设计坐标下的字号；0 = 自动（按设计画布高）" },
    target: { min: 0, max: 1000000000, value: 1000, description: "终值（上游演示值 1000）" },
    confetti: { min: 0, max: 1, value: 1, description: "彩屑开关（1 开 / 0 关；关掉即纯计数+冲击环）" },
    duration: { min: 0.4, max: 1, value: 1, description: "时间轴整体缩放（1 = 上游原速 4.6s）" },
  },
  styles: `
    .stage { position: absolute; inset: 0; overflow: hidden;
             background: radial-gradient(80% 80% at 50% 45%, #161a2b, #07080e 75%); }
    .glow { position: absolute; left: 50%; top: 47%; border-radius: 50%;
            background: radial-gradient(circle, rgba(120,160,255,.28), transparent 66%); }
    .numWrap { position: absolute; left: 50%; top: 47%; transform-origin: 50% 50%; }
    .num { position: absolute; left: 0; top: 0; transform: translate(-50%,-50%);
           white-space: nowrap; font-weight: 800; font-variant-numeric: tabular-nums;
           background: linear-gradient(180deg, #ffffff, #a9c4ff);
           -webkit-background-clip: text; background-clip: text; color: transparent;
           letter-spacing: -0.02em; }
    .ring { position: absolute; left: 50%; top: 47%; border-radius: 50%;
            border: 2px solid rgba(150,185,255,.75); transform: translate(-50%,-50%); }
    .cap { position: absolute; left: 0; right: 0; text-align: center;
           color: #9fb4d8; font-weight: 500; }
    .bit { position: absolute; will-change: transform; }
  `,
  helpers,
  render(frame: number, total: number, params: CardParams, design: CardDesign): string {
    // ACT: 常量写在函数体内部 —— render 被 `toString()` 内联进页面，
    // 模块级常量不会跟着过去（踩过：`burstT is not defined`）。
    // **抢拍**：纸屑早于计数到位 —— 庆祝比结果先到，这半拍是这张卡的灵魂。
    const burstT = 0.52;
    // 时间轴整体缩放：上游 4.6s 按 p 处理，duration < 1 时同一条曲线压缩到更短
    const rawT = normalizedT(frame, total);
    const t = Math.min(1, rawT / params.duration);

    // 计数：easeOutQuart 冲刺
    const progress = seg(t, 0.06, 0.56, outQuart);
    const value = Math.round(progress * params.target);
    // scale 过冲：0.2 → 1.3（outCubic），计数到位后 1.3 → 1（outBack）
    const scaleIn = seg(t, 0.06, 0.3, outCubic);
    const scaleBack = seg(t, 0.56, 0.72, outBack);
    const scale = lerp(scaleIn, 0.2, 1.3) + scaleBack * (1 - 1.3);
    // 到位冲击环
    const ringProgress = seg(t, 0.545, 0.75, outQuart);

    // ACT: 字号要**同时受宽与高约束**。只按高算会在「位数多 + 窄画幅」时横向溢出
    // （踩过：竖屏 1080×1920 的设计画布只有 270 宽，7 位数字按高算出 163px，
    // 整行约 665px 远超画布 —— 自检的落位检查抓到的）。
    //   竖向：数字行大致占设计高的 34%
    //   横向：数字每字宽 ≈ 0.6em，留 12% 边距
    const digitCount = Math.max(1, String(params.target).replace(/[^0-9]/g, "").length + Math.floor((String(params.target).length - 1) / 3));
    const byHeight = design.h * 0.34;
    const byWidth = (design.w * 0.88) / (digitCount * 0.6);
    const fontSize = params.fontSize > 0 ? params.fontSize : Math.max(6, Math.round(Math.min(byHeight, byWidth)));
    const glowSize = Math.round(design.h * 1.26);
    // 中心辉光：0.5–0.62 亮起，0.72 后回落
    const glowOpacity = 0.35 + seg(t, 0.5, 0.62, outCubic) * 0.65 - seg(t, 0.72, 1) * 0.5;

    // 纸屑：从两侧出发的抛物运动。life = 相对 burst 的归一化时间（上游同式）
    let bitsMarkup = "";
    if (params.confetti > 0.5) {
      const life = (t - burstT) * 1.1;
      if (life > 0) {
        bitsMarkup = confettiBits().map(bit => {
          const u = Math.max(0, life - bit.delay);
          if (u <= 0) return "";
          const x = bit.x0 + bit.vx * u;
          const y = bit.y0 + bit.vy * u + 0.5 * bit.g * u * u;
          const rotation = bit.spin * u;
          // 尾段（0.74 起）衰减到 0.05：落定段需要干净背景
          const fade = 1 - seg(t, 0.74, 1) * 0.95;
          const opacity = Math.max(0, fade) * (u > 0.02 ? 1 : 0);
          if (opacity <= 0.01) return "";
          return `<span class="bit" style="left:calc(50% + ${x.toFixed(1)}px);top:calc(47% + ${y.toFixed(1)}px);`
            + `width:${bit.w.toFixed(1)}px;height:${bit.h.toFixed(1)}px;background:${bit.color};`
            + `opacity:${opacity.toFixed(3)};border-radius:${bit.w === bit.h ? "50%" : "1px"};`
            + `transform:translate(-50%,-50%) rotate(${rotation.toFixed(1)}deg)"></span>`;
        }).join("");
      }
    }

    // 标签：0.62 淡入，字距 11px→5px 收紧（「落章」感）
    const capProgress = seg(t, 0.62, 0.86, outCubic);
    const capTracking = lerp(capProgress, design.w * 0.023, design.w * 0.010);
    const capOpacity = capProgress;

    const ringScale = lerp(ringProgress, 0.35, 2.95);
    const ringOpacity = ringProgress <= 0 ? 0 : (1 - ringProgress) * 0.9;

    return `<div class="stage" data-check="舞台">
      <span class="glow" style="width:${glowSize}px;height:${glowSize}px;margin:${-glowSize / 2}px 0 0 ${-glowSize / 2}px;opacity:${glowOpacity.toFixed(3)}"></span>
      ${bitsMarkup}
      <span class="ring" style="width:${glowSize}px;height:${glowSize}px;transform:translate(-50%,-50%) scale(${ringScale.toFixed(3)});opacity:${ringOpacity.toFixed(3)}"></span>
      <span class="numWrap" style="transform:scale(${scale.toFixed(4)})">
        <span class="num" data-check="数字" style="font-size:${fontSize}px">${value.toLocaleString("en-US")}</span>
      </span>
      <span class="cap" data-check="标签" style="top:${Math.round(design.h * 0.78)}px;font-size:${Math.round(design.h * 0.075)}px;letter-spacing:${capTracking.toFixed(2)}px;opacity:${capOpacity.toFixed(3)}">累计服务用户</span>
    </div>`;
  },
};
