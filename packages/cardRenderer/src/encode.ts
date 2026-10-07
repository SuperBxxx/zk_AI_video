// 把逐帧 PNG/JPEG 编成视频。
//
// 两条路径，按卡的形态分：
//   · 全屏卡 / 转场卡 → H.264 / yuv420p。**转场卡也是不透明的**（它要遮住接缝）
//   · 叠加卡 → ProRes 4444 / yuva444p10le，保 alpha，用来叠在 AI 视频上
//
// 为什么叠加卡不用 libvpx-vp9（体积小得多）：**实测本机的 libvpx-vp9 不支持 alpha** ——
// 喂 PNG 进去也输出 yuv420p，alpha 被悄悄丢掉。保得住 alpha 的只有
// prores_ks / qtrle / png 三种，选 ProRes 4444（剪辑软件与 Final Cut 的标准带透明格式）。

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CardShape } from "@toonflow/post-production";

/** 编码入参。 */
export interface EncodeOptions {
  /** ffmpeg 可执行文件。 */
  ffmpegPath: string;
  /** 帧目录。 */
  frameDirectory: string;
  /** 帧的扩展名。 */
  extension: "jpg" | "png";
  /** 帧率。 */
  fps: number;
  /** 输出文件路径。 */
  outputPath: string;
  /** 卡的形态（决定要不要 alpha）。 */
  shape: CardShape;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 跑一次 ffmpeg，失败时把 stderr 尾部带出来。 */
function runFfmpeg(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    const cancel = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", reject);
    child.on("close", code => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) { reject(new Error("编码已取消")); return; }
      if (code === 0) { resolve(); return; }
      reject(new Error(`ffmpeg 合成失败（退出码 ${code}）：${stderr.slice(-400)}`));
    });
  });
}

/** 把帧编成视频。 */
export async function encodeFrames(options: EncodeOptions): Promise<void> {
  const { ffmpegPath, frameDirectory, extension, fps, outputPath, shape, signal } = options;
  const input = join(frameDirectory, `f%05d.${extension}`);
  const base = ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(fps), "-i", input];

  // ACT: 输出路径可能是嵌套的（例如 `cards/keyword.mov`），父目录不存在时 ffmpeg 会以
  // 「No such file or directory」失败（退出码 254）。这里自己建，不让调用方去记得这件事 ——
  // 踩过：server 服务传了带子目录的输出路径，渲染走到编码这步才炸。
  mkdirSync(dirname(outputPath), { recursive: true });

  // 只有叠加卡需要 alpha；全屏卡与转场卡都是不透明的（转场卡要遮住接缝）
  const wantsAlpha = shape === "overlay";
  const args = wantsAlpha
    ? [...base, "-c:v", "prores_ks", "-pix_fmt", "yuva444p10le", "-profile:v", "4444", outputPath]
    : [...base, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", outputPath];

  await runFfmpeg(ffmpegPath, args, signal);
}
