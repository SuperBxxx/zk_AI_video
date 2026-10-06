// 动效公共件 —— 移植自上游 video-shotcraft 的 demos/_fixtures/Motion.tsx（Apache-2.0）。
// 它是上游 48 张 Motion 系卡共用的底座：缓动 / 分段进度 / 插值 / 确定性伪随机。
//
// 为什么照搬这套而不是各卡自己写：
//   · **确定性**是逐帧渲染的前提：随机必须是「同种子跨帧可复现」的纯函数。
//     不能用 Math.random（上游有 9 个卡文件直接用了，那是隐患）。
//   · seg(t, t0, t1, ease) 是统一的时间轴原语，把「什么时候做什么」写成一个表达式；
//     各卡自己写 if/else 会让时序散落、难以对齐。
//   · 缓动统一后，同一个品牌动效嗓音（上游 design-language 的要求）才守得住。
//
// ACT: 上游把缓动收在 `E` 对象里（`E.outQuart`）。这里改成**扁平具名导出**
// （`outQuart`），因为卡的 helpers 内联机制按「函数名 → 函数」序列化，
// 对象成员要额外处理嵌套；扁平化后机制不变、名称也更符合本仓库的命名规范。
// 语义与上游逐条一致，注释里标了上游原名。
//
// 这些函数必须由卡在 helpers 里显式声明，才会被内联进页面（见 types.ts）。

/** 二次。上游 E.inQuad。 */
export function inQuad(t: number): number { return t * t; }
/** 二次。上游 E.outQuad。 */
export function outQuad(t: number): number { return t * (2 - t); }
/** 三次。上游 E.inCubic。 */
export function inCubic(t: number): number { return t * t * t; }
/** 三次。上游 E.outCubic。 */
export function outCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
/** 三次。上游 E.inOutCubic。 */
export function inOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
/** 四次。上游 E.outQuart —— 计数冲刺默认用它。 */
export function outQuart(t: number): number { return 1 - Math.pow(1 - t, 4); }
/** 五次。上游 E.outQuint。 */
export function outQuint(t: number): number { return 1 - Math.pow(1 - t, 5); }
/** 指数。上游 E.outExpo。 */
export function outExpo(t: number): number { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
/** 指数。上游 E.inExpo。 */
export function inExpo(t: number): number { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); }
/** 回弹（过冲后落定）。上游 E.outBack，s 默认 1.70158。 */
export function outBack(t: number, s = 1.70158): number {
  return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
}
/** 回弹（起步前先退）。上游 E.inBack。 */
export function inBack(t: number, s = 1.70158): number { return (s + 1) * t * t * t - s * t * t; }
/** 弹性。上游 E.outElastic。 */
export function outElastic(t: number): number {
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}
/** 弹簧。上游 E.spring。 */
export function spring(t: number, bounce = 0.25): number {
  const w = 8 + 8 * (1 - bounce);
  return 1 - Math.exp(-6 * t) * Math.cos(w * t * bounce * 2.2);
}

/** 线性插值。上游 lerp。 */
export function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * t;
}

/** 分段进度：t 在 [t0,t1] 内归一化后过 ease，越界钳位。上游 seg。 */
export function seg(t: number, t0: number, t1: number, ease: (x: number) => number = linear): number {
  return ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
}

/** 恒等。上面 seg 的默认缓动。 */
export function linear(t: number): number { return t; }

/**
 * 确定性伪随机。等价 Remotion 的 random(seed)：同种子跨帧、跨渲染可复现。
 * **不要用 Math.random** —— 那会让逐帧抓帧出现不可复现的差异。
 */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 全片归一化进度 t∈[0,1]，**末帧恰为 1**。上游 useT。
 * 末帧恰为 1 这点重要：否则最后一帧的动作永远差一点没走完。
 */
export function normalizedT(frame: number, total: number): number {
  return Math.min(1, frame / Math.max(1, total - 1));
}

/** 会被内联进页面的公共动效函数。卡把它展开进自己的 helpers。 */
export function motionHelpers(): Record<string, (...args: never[]) => unknown> {
  const table: Record<string, (...args: never[]) => unknown> = {
    inQuad, outQuad, inCubic, outCubic, inOutCubic, outQuart, outQuint,
    outExpo, inExpo, outBack, inBack, outElastic, spring,
    lerp, seg, linear, rand, normalizedT,
  };
  return table;
}
