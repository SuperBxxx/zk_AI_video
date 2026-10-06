// 成片机器闸：把「画面/素材/音画」的硬规变成渲染后必跑的断言。
//
// 为什么有这一步：这些问题的答案本来就在文档里，但没人在正确的时刻去查。
// 参考实现的复盘是「一次 7h21m 的制作里 6 个整片母版作废 5 个，其中两轮的触发条件
// 一条 ffprobe 就能查出来」——所以断言化，不靠自觉。
//
// 本实现只用 ffmpeg/ffprobe：参考实现里唯一需要 numpy 的那部分（并发光栅抖动）
// 没有对应原语，暂不实现，见 gateJitter 的说明。
//
// 用法：bun scripts/qaGate.mjs <video> [--fps 30] [--no-freeze] [--tail 0.5]
import { existsSync, readFileSync } from "node:fs";

const [videoPath, ...rest] = process.argv.slice(2);
if (!videoPath) {
  console.error("用法：bun scripts/qaGate.mjs <video> [--fps 30] [--shots shots.json] [--quiet]");
  process.exit(2);
}
if (!existsSync(videoPath)) {
  console.error(`找不到文件：${videoPath}`);
  process.exit(2);
}

function readOption(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] && !rest[index + 1].startsWith("--") ? rest[index + 1] : fallback;
}

const quiet = rest.includes("--quiet");
const targetFps = Number(readOption("fps", "30"));
const failures = [];
const warnings = [];
const passes = [];

function ffprobe(args) {
  const result = Bun.spawnSync({ cmd: ["ffprobe", "-v", "error", ...args], stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() };
}

function ffmpeg(args) {
  const result = Bun.spawnSync({ cmd: ["ffmpeg", "-hide_banner", ...args], stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, err: result.stderr.toString() };
}

function probeJson(entries) {
  const result = ffprobe(["-show_entries", entries, "-of", "json", videoPath]);
  if (!result.ok) return undefined;
  try { return JSON.parse(result.out); } catch { return undefined; }
}

/** 解析 "30000/1001" 这类分数为数值。 */
function parseRatio(value) {
  if (typeof value !== "string" || !value.includes("/")) return Number(value);
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : Number.NaN;
}

// ── 闸 1：素材/成片帧率一致性（参考实现里废掉母版的元凶） ────────────────
// r_frame_rate 与 avg_frame_rate 不等 = VFR 或丢帧；成片帧率与目标不符会导致
// 音画逐渐漂移、混入源片时每 N 帧出现一次重复帧。
function gateFrameRate() {
  const info = probeJson("stream=codec_type,r_frame_rate,avg_frame_rate,nb_frames,duration,width,height");
  const stream = info?.streams?.find(item => item.codec_type === "video");
  if (!stream) { failures.push(["帧率", "读不到视频流信息"]); return; }
  const real = parseRatio(stream.r_frame_rate);
  const average = parseRatio(stream.avg_frame_rate);
  if (!Number.isFinite(real) || !Number.isFinite(average)) { failures.push(["帧率", `帧率字段异常：${stream.r_frame_rate} / ${stream.avg_frame_rate}`]); return; }
  if (Math.abs(real - average) > 0.01) {
    failures.push(["帧率", `r_frame_rate(${real.toFixed(3)}) ≠ avg_frame_rate(${average.toFixed(3)})：变帧率或丢帧，混剪会出现重复帧`]);
    return;
  }
  if (Math.abs(real - targetFps) > 0.05) {
    failures.push(["帧率", `成片 ${real.toFixed(2)}fps ≠ 目标 ${targetFps}fps`]);
    return;
  }
  passes.push(["帧率", `${real.toFixed(2)}fps（与目标一致、恒定）${stream.width}×${stream.height}`]);
}

// ── 闸 2：音画时长差 ──────────────────────────────────────────────
// 参考实现的判据是「人物素材与配音时长差 > 1 帧即 FAIL」。
function gateAvDuration() {
  const info = probeJson("stream=codec_type,duration");
  const streams = info?.streams ?? [];
  const video = streams.find(item => item.codec_type === "video");
  const audio = streams.find(item => item.codec_type === "audio");
  if (!video || !audio) { warnings.push(["音画时长", "没有音频流，跳过"]); return; }
  const videoDuration = Number(video.duration);
  const audioDuration = Number(audio.duration);
  if (!Number.isFinite(videoDuration) || !Number.isFinite(audioDuration)) { warnings.push(["音画时长", "时长字段缺失，跳过"]); return; }
  const frameMs = 1000 / targetFps;
  const diffMs = Math.abs(videoDuration - audioDuration) * 1000;
  if (diffMs > frameMs) {
    failures.push(["音画时长", `差 ${diffMs.toFixed(0)}ms（> 1 帧 ${frameMs.toFixed(1)}ms）：视频 ${videoDuration.toFixed(3)}s / 音频 ${audioDuration.toFixed(3)}s`]);
    return;
  }
  passes.push(["音画时长", `差 ${diffMs.toFixed(0)}ms（≤ 1 帧）`]);
}

// ── 闸 3：任意 0.8s 不允许全静止 ──────────────────────────────────
// 阈值照参考实现：freezedetect=n=0.003:d=0.8（比「任意 1 秒」的口径更严）。
// 两个边界：素材本身要求静止的镜头（logo 落定、hold）会撞这一关，
// 参考实现的处置不是豁免，而是让场景相机继续微动。
function gateFreeze() {
  const duration = readOption("freezeDuration", "0.8");
  const noise = readOption("freezeNoise", "0.003");
  const result = ffmpeg(["-i", videoPath, "-vf", `freezedetect=n=${noise}:d=${duration}`, "-an", "-f", "null", "-"]);
  const starts = [...result.err.matchAll(/freeze_start:\s*([\d.]+)/g)].map(match => Number(match[1]));
  const ends = [...result.err.matchAll(/freeze_end:\s*([\d.]+)/g)].map(match => Number(match[1]));
  if (!starts.length) { passes.push(["静止", `没有 ≥ ${duration}s 的全静止段（noise=${noise}）`]); return; }
  const detail = starts.map((start, index) => `${start.toFixed(2)}s → ${ends[index] !== undefined ? `${ends[index].toFixed(2)}s` : "片尾"}`).join("、");
  failures.push(["静止", `${starts.length} 段 ≥ ${duration}s 全静止：${detail}（处置：让相机极缓推拉，而不是豁免这一关）`]);
}

// ── 闸 4：镜头落点保护带（需要 shots.json） ─────────────────────────
// 参考实现的判据：动效锚点距所在镜头出点必须 ≥ tail，否则落点被转场吞掉。
// 表现是「某个元素只活了 0.2s」，靠单帧永远看不出来。
function gateShotTail() {
  const shotsPath = readOption("shots", "");
  if (!shotsPath || !existsSync(shotsPath)) return;
  const tail = Number(readOption("tail", "0.5"));
  const shots = JSON.parse(readFileSync(shotsPath, "utf8"));
  const short = shots.filter(shot => Number(shot.end) - Number(shot.start) < tail);
  if (short.length) {
    failures.push(["镜头落点", `${short.length} 个镜头短于保护带 ${tail}s：${short.map(shot => `${shot.id}(${(Number(shot.end) - Number(shot.start)).toFixed(2)}s)`).join("、")}`]);
    return;
  }
  passes.push(["镜头落点", `${shots.length} 个镜头都 ≥ ${tail}s 保护带`]);
}

// ── 未实现：并发光栅抖动 ───────────────────────────────────────────
// 参考实现用 numpy 逐窗算帧差与重复帧签名，是「细密纹理被相机连续缩放导致
// 亚像素爬行」的专项闸。我们零 Python，ffmpeg 没有现成原语；
// 用 scene 分数近似会漏掉低频爬行，不如不做（做了会给出虚假的通过）。
// 已知后果：这类缺陷只能靠人工看片发现。
function gateJitter() {
  warnings.push(["抖动", "未实现（参考实现依赖 numpy，我们零 Python）；这类缺陷当前只能人工看片发现"]);
}

gateFrameRate();
gateAvDuration();
if (!rest.includes("--no-freeze")) gateFreeze();
gateShotTail();
gateJitter();

console.log("成片机器闸\n");
if (!quiet) {
  for (const [name, detail] of passes) console.log(`  ✓ ${name.padEnd(6)} ${detail}`);
}
if (warnings.length) {
  console.log("");
  console.log(`警告 ${warnings.length} 项：`);
  for (const [name, detail] of warnings) console.log(`  ⚠ ${name}  ${detail}`);
}
console.log("");
if (failures.length) {
  console.log(`失败 ${failures.length} 项：`);
  for (const [name, detail] of failures) console.log(`  ✗ ${name}  ${detail}`);
  console.log("");
  process.exit(1);
}
console.log("机器闸全部通过");
