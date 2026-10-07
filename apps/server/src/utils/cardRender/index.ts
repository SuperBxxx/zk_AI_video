// 卡渲染服务（server 侧）。
//
// 为什么在 server 侧：agent 工具的产物是自包含 bundle，不该直接管子进程与临时文件；
// 而 server 会被打包进 `app/`，天然在安装边界内。这与 ffmpeg 的既有模式一致。
//
// 工作目录用 `<data>/cardRender/`：
//   · Windows 上 `data/` 与 `app/` 同级 → **程序更新不会覆盖它**（放资源目录会被更新替换）
//   · 与 ffmpeg 的下载目录同一个父目录（`<data>/ffmpeg/`），约定一致
//
// 浏览器 profile 留在工作目录里不删：省去每次冷启动的十几秒。
// 帧文件渲完就删（一张卡 60~150 帧 PNG，不删会一直涨）。

import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { renderCard, renderCardOverVideo } from "@toonflow/card-renderer";
import type { RenderCardOptions, RenderCardResult } from "@toonflow/card-renderer";
import conf from "@/utils/conf";
import { getStatus } from "@/utils/ffmpeg";

/** 卡渲染的工作根目录。 */
export function renderRoot() {
  return join(dirname(conf.path), "cardRender");
}

/** 进度事件（同时给 SSE 与工具侧用）。 */
export interface CardRenderProgress {
  stage: "browser" | "render" | "encode" | "composite" | "done";
  frame?: number;
  total?: number;
  message?: string;
}

/** 渲染入参。 */
export interface RenderCardRequest {
  /** 卡的 slug。 */
  slug: string;
  /** 目标成片画幅。 */
  width: number;
  height: number;
  fps?: number;
  parameters?: Record<string, number>;
  /** 输出文件的**绝对路径**（调用方负责落在工作区内）。 */
  outputPath: string;
  /** 有值就走「渲染并叠到这段视频上」。 */
  targetVideoPath?: string;
  signal?: AbortSignal;
}

/**
 * 取 ffmpeg 可执行文件路径。
 *
 * 与 `createWorkspaceFfmpeg` 用同一套检测结果：拿不到就抛同样的「需要 FFmpeg」错误，
 * 让上层的安装提示流程照常工作。
 */
async function requireFfmpegPath() {
  const { tools } = await getStatus();
  if (!tools.ffmpeg.path || tools.ffmpeg.error) {
    throw Object.assign(new Error("渲染卡需要 FFmpeg，但尚未检测到可用版本。请先安装 FFmpeg。"), {
      name: "FfmpegRequiredError", code: "FFMPEG_REQUIRED", status: 424,
    });
  }
  return tools.ffmpeg.path;
}

/**
 * 渲染一张卡（有 targetVideoPath 时顺带合成到该视频上）。
 *
 * 会先把工作目录建好：帧、页面、浏览器 profile 都写在这里。
 */
export async function renderCardToVideo(
  request: RenderCardRequest,
  onProgress?: (event: CardRenderProgress) => void,
): Promise<RenderCardResult> {
  const ffmpegPath = await requireFfmpegPath();
  const workDirectory = renderRoot();
  mkdirSync(workDirectory, { recursive: true });

  const common: RenderCardOptions = {
    slug: request.slug,
    width: request.width,
    height: request.height,
    ...(request.fps ? { fps: request.fps } : {}),
    ...(request.parameters ? { parameters: request.parameters } : {}),
    outputPath: request.outputPath,
    workDirectory,
    ffmpegPath,
    ...(onProgress ? { onProgress: event => onProgress(event as CardRenderProgress) } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  };

  if (!request.targetVideoPath) {
    const result = await renderCard(common);
    onProgress?.({ stage: "done" });
    return result;
  }

  const result = await renderCardOverVideo({ ...common, targetVideoPath: request.targetVideoPath });
  onProgress?.({ stage: "done" });
  return result;
}

/**
 * 给工具用的宿主服务（挂到 `ToolContext.cardRender`）。
 *
 * 与 `createWorkspaceFfmpeg` 同一形状：工具侧只传参数，路径在这里被解析进工作区、
 * ffmpeg 路径在这里取，工具拿不到任意路径的写权限。
 */
export function createCardRenderService(
  cwd: string,
  signal?: AbortSignal,
): {
  render: (request: {
    slug: string; width: number; height: number; fps?: number;
    parameters?: Record<string, number>; output: string; targetVideo?: string;
  }, onProgress?: (event: CardRenderProgress) => void) => Promise<Awaited<ReturnType<typeof renderCardToVideo>>>;
} {
  return {
    render: async (request, onProgress) => {
      signal?.throwIfAborted();
      return await renderCardToVideo({
        slug: request.slug,
        width: request.width,
        height: request.height,
        ...(request.fps ? { fps: request.fps } : {}),
        ...(request.parameters ? { parameters: request.parameters } : {}),
        // 输出与叠加视频都限定在工作区内
        outputPath: resolve(cwd, request.output),
        ...(request.targetVideo ? { targetVideoPath: resolve(cwd, request.targetVideo) } : {}),
        ...(signal ? { signal } : {}),
      }, onProgress);
    },
  };
}
