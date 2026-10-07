// 把卡视频叠到目标视频上。
//
// 用 ffmpeg 的 overlay 滤镜。画幅必须一致 —— 卡是按目标画幅渲染的，这里再校验一次，
// 不一致就报错而不是悄悄缩放：二次缩放会让字幕与描边出现非整数像素抖动，
// 而那种抖动在预览里看不出来，只在成片里能看出来。

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** 合成入参。 */
export interface CompositeOptions {
  ffmpegPath: string;
  /** 底：AI 生成的视频。 */
  targetVideoPath: string;
  /** 上层：卡视频（叠加卡带 alpha）。 */
  overlayVideoPath: string;
  outputPath: string;
  /** 期望画幅。 */
  width: number;
  height: number;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 读一个视频流的宽高。 */
async function probeSize(ffprobePath: string, videoPath: string): Promise<{ width: number; height: number } | undefined> {
  return await new Promise(resolve => {
    const child = spawn(ffprobePath, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", videoPath,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout?.on("data", chunk => { output += String(chunk); });
    child.on("error", () => resolve(undefined));
    child.on("close", () => {
      const [width, height] = output.trim().split(",").map(Number);
      resolve(Number.isFinite(width) && Number.isFinite(height) ? { width, height } : undefined);
    });
  });
}

/** 跑一次 ffmpeg。 */
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
      if (signal?.aborted) { reject(new Error("合成已取消")); return; }
      if (code === 0) { resolve(); return; }
      reject(new Error(`合成失败（退出码 ${code}）：${stderr.slice(-400)}`));
    });
  });
}

/**
 * 把卡视频叠到目标视频上。
 *
 * `ffprobePath` 不给时按 ffmpeg 同目录推导。
 */
export async function compositeOverVideo(
  options: CompositeOptions & { ffprobePath?: string },
): Promise<void> {
  const ffprobePath = options.ffprobePath
    ?? options.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, match => (match.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"));

  // 校验画幅：不一致就报错。二次缩放造成的像素抖动预览里看不出来、成片里看得出来。
  const size = await probeSize(ffprobePath, options.targetVideoPath);
  if (size && (size.width !== options.width || size.height !== options.height)) {
    throw new Error(
      `画幅不一致：目标视频是 ${size.width}×${size.height}，而这次按 ${options.width}×${options.height} 渲染。`
      + `卡的画幅必须与成片一致（二次缩放会让字幕与描边出现非整数像素抖动）。`,
    );
  }

  // 输出路径可能是嵌套的，父目录要先建（与 encode 同一个理由）
  mkdirSync(dirname(options.outputPath), { recursive: true });
  await runFfmpeg(options.ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", options.targetVideoPath,
    "-i", options.overlayVideoPath,
    // shortest=1：卡比视频短时以卡为准，不要拉长
    "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:shortest=1[v]",
    "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
    options.outputPath,
  ], options.signal);
}
