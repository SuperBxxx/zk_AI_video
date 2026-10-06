// 逐张验证配方卡的滤镜链在本机 ffmpeg 上真能跑通。
//
// 为什么要常驻：卡的机制再好，滤镜链跑不通就是废的。而且卡的坑几乎都是
// 「语法看着对、FFmpeg 不认」这一类（踩过：`st=5-0.4` 的算术不会被求值，
// 报选项错误）—— 只有真跑一遍才拦得住。
//
// 用法：bun scripts/checkCards.mjs [--quiet]
// preflight 会调用它（--quiet），失败即视为必需项失败。
import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtInCards, instantiateCard } from "@toonflow/post-production";

const quiet = process.argv.includes("--quiet");
const work = join(tmpdir(), `zk-cardcheck-${process.pid}`);
mkdirSync(work, { recursive: true });

function ffmpeg(args) {
  return spawnSync("ffmpeg", args, { encoding: "utf8" });
}

function log(message) {
  if (!quiet) console.log(message);
}

/**
 * 帧内容校验和。用来判定「两帧是否同一画面」。
 *
 * 为什么需要它：滤镜链能跑通不等于效果对。踩过的坑：慢推卡的 z 表达式
 * 因运算符优先级被算成 `2.05 - on/150`，起始就放大 2.05 倍且几乎不动，
 * 而 FFmpeg 一声不响 —— 只看退出码根本发现不了。所以对每张卡再核一遍
 * 「它声称要做的事有没有发生」。
 */
function frameSum(file, frame) {
  const result = ffmpeg(["-hide_banner", "-loglevel", "error", "-i", file,
    "-vf", `select='eq(n\\,${frame})'`, "-f", "framemd5", "-"]);
  const line = (result.stdout ?? "").split("\n").find(item => item.startsWith("0,"));
  return line ? line.split(",").pop().trim() : "";
}

/** 某帧是否全黑（YAVG 接近 0）。 */
/** 某帧的平均亮度（YAVG）。取不到返回 undefined。 */
function luma(file, frame) {
  const result = ffmpeg(["-hide_banner", "-loglevel", "info", "-i", file,
    "-vf", `select='eq(n\\,${frame})',signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-frames:v", "1", "-f", "null", "-"]);
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // 注意 stderr 里的前缀形如 `[Parsed_metadata_2 @ 0x...] lavfi.signalstats.YAVG=125.221`，
  // 正则必须容忍前缀，否则永远取不到值（踩过）。
  const match = text.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * 有效黑场的亮度阈值。
 *
 * 取 22 而不是 8：H.264 用有限范围亮度（16–235），纯黑编码出来约等于 16 ——
 * 阈值 8 会把真正的黑场判成「不是黑」（实测踩到：淡入首帧 YAVG=16，
 * 而同一素材未处理时是 125，两者差异极其明显）。
 */
const blackLuma = 22;

/**
 * 语义检查：按卡声称的效果核实际输出。
 * 只对能可靠量化的卡写检查 —— 写不出来的宁可不写，避免给出「已验证」的错觉。
 */
function semanticCheck(card, output) {
  if (card.slug === "slowPushIn") {
    // 推进 = 末帧与首帧画面不同；若表达式被算坏导致几乎不动，这里会抓到
    const first = frameSum(output, 1);
    const last = frameSum(output, 140);
    if (!first || !last) return "取不到帧校验和";
    if (first === last) return "首末帧完全相同 —— 推进没有发生（多半是表达式被算错，而不是写法报错）";
    return "";
  }
  if (card.slug === "fadeEdges") {
    // 这张卡要保证的性质是「首尾确实在变黑」，而不是「末帧必须恰好全黑」——
    // 实测末帧 YAVG=25：淡出窗口 4.6→5.0s，编码输出正好 150 帧（5.000s），
    // 末帧落在 4.9667s，淡出还差一点没走完。那是编码边界的舍入，
    // 不是卡的缺陷，所以判定写成「首帧是黑的 + 末帧亮度远低于中段」。
    const head = luma(output, 0);
    const middle = luma(output, 75);
    const tail = luma(output, 148);
    if (head === undefined || middle === undefined || tail === undefined) return "取不到亮度";
    if (head >= blackLuma) return `首帧不是黑的（YAVG=${head}，淡入没生效）`;
    if (middle < blackLuma) return `中间帧也是黑的（YAVG=${middle}，整段被压黑了，不只是首尾）`;
    if (tail > middle * 0.5) return `末帧亮度 ${tail} 没有明显低于中段 ${middle}（淡出没生效）`;
    return "";
  }
  if (card.slug === "desaturateBed") {
    // 降饱和 = 与未处理的同一素材相比，画面确实变了
    const raw = frameSum(join(work, "a.mp4"), 1);
    const treated = frameSum(output, 1);
    if (!raw || !treated) return "取不到帧校验和";
    if (raw === treated) return "与未处理素材完全相同 —— 调色没有生效";
    return "";
  }
  if (card.slug === "holdLastFrame") {
    // 冻结末帧 = 输出时长 ≈ freezeAt + holdSeconds（默认 1.6 + 1.2 = 2.8s），
    // 而不是原时长 + holdSeconds。核这个是为了抓「时间轴塌成单帧」那类错误。
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output], { encoding: "utf8" });
    const duration = Number((probe.stdout ?? "").trim());
    if (!Number.isFinite(duration)) return "读不到输出时长";
    const expected = 1.6 + 1.2;
    if (Math.abs(duration - expected) > 0.2) {
      return `输出时长 ${duration.toFixed(2)}s，期望约 ${expected.toFixed(2)}s（freezeAt + holdSeconds）`;
    }
    return "";
  }
  if (card.slug === "flashCut") {
    // 闪白 = 中灰起 → 峰值接近白 → 落回中灰。必须量亮度：
    // 「闪了但只到淡灰」在视觉上完全不是这个效果，而滤镜链并不报错。
    const base = luma(join(work, "gray.mp4"), 0);
    if (base === undefined) return "取不到底片亮度";
    const peak = luma(output, 12);   // inDuration 0.4s @30fps
    const tail = luma(output, 45);
    if (peak === undefined || tail === undefined) return "取不到亮度";
    if (peak < base + 40) return `峰值 ${peak} 相对底片 ${base} 提亮不足（闪白没闪起来）`;
    if (tail > base + 12) return `尾帧 ${tail} 没有落回底片 ${base}（整段被提亮了）`;
    return "";
  }
  return "";
}

const failures = [];
try {
  // 单输入素材：一版 1280x720、一版 1920x1080（有卡的滤镜把尺寸写死成 1920x1080）
  const fixtures = [
    ["a.mp4", "testsrc=s=1280x720:d=5:r=30"],
    ["b.mp4", "testsrc2=s=1280x720:d=5:r=30"],
    ["hd.mp4", "testsrc=s=1920x1080:d=5:r=30"],
    // 均匀中灰：用来量「闪白有没有真的把画面顶到白」——
    // testsrc 的花纹会把整体亮度抬得很高，量不出闪光（踩过）。
    ["gray.mp4", "color=c=0x808080:s=1920x1080:d=5:r=30"],
  ];
  for (const [name, source] of fixtures) {
    const result = ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", join(work, name)]);
    if (result.status !== 0) {
      failures.push({ slug: "-", detail: `造测试素材 ${name} 失败：${(result.stderr ?? "").slice(-200)}` });
    }
  }

  for (const card of builtInCards) {
    let filters;
    try {
      filters = instantiateCard(card).filters;
    } catch (error) {
      failures.push({ slug: card.slug, detail: `默认参数无法实例化：${error.message}` });
      continue;
    }
    // 三种输入形态：
    //   ① 自带第二路（secondInput，如闪白）→ 自己就是完整的 filter_complex，第二路标签固定 [1:v]
    //   ② 「场」类转场 → 两路各给一个视频，用 [0:v][1:v] 接起来
    //   ③ 普通单路 → 接 -vf
    const output = join(work, `${card.slug}.mp4`);
    let result;
    if (card.secondInput) {
      result = ffmpeg(["-y", "-hide_banner", "-loglevel", "error",
        "-i", join(work, card.slug === "flashCut" ? "gray.mp4" : "a.mp4"),
        "-f", "lavfi", "-i", card.secondInput,
        "-filter_complex", filters.join(";"), "-an", "-t", "2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
    } else if (card.inputs.includes("场")) {
      result = ffmpeg(["-y", "-hide_banner", "-loglevel", "error",
        "-i", join(work, "a.mp4"), "-i", join(work, "b.mp4"),
        "-filter_complex", `[0:v][1:v]${filters.join(",")}[v]`, "-map", "[v]", "-an", "-t", "5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
    } else {
      const input = card.slug === "slowPushIn" ? "hd.mp4" : "a.mp4";
      result = ffmpeg(["-y", "-hide_banner", "-loglevel", "error",
        "-i", join(work, input), "-vf", filters.join(","), "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
    }
    if (result.status !== 0) {
      const tail = (result.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" / ");
      failures.push({ slug: card.slug, detail: `滤镜链跑不通：${tail}` });
      log(`  ✗ ${card.slug}`);
      continue;
    }
    const semantic = semanticCheck(card, output);
    if (semantic) {
      failures.push({ slug: card.slug, detail: `效果不对：${semantic}` });
      log(`  ✗ ${card.slug}  ${semantic}`);
      continue;
    }
    log(`  ✓ ${card.slug}  ${filters.join(" ; ")}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`卡库验证失败 ${failures.length} 项：`);
  for (const failure of failures) console.log(`  ✗ ${failure.slug}  ${failure.detail}`);
  process.exit(1);
}
log(`\n卡库验证通过（${builtInCards.length} 张卡）`);
// ACT: --quiet 只压掉逐卡明细，**结果行再单独打印一次** ——
// preflight 靠这一行报出验证了多少张卡；全压掉会让断言只说「通过」而看不出覆盖面。
if (quiet) console.log(`卡库验证通过（${builtInCards.length} 张卡）`);
