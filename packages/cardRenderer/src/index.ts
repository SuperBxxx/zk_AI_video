// 渲染内核的唯一入口：把一张 HTML 卡变成一段视频（可选：直接叠到目标视频上）。
//
// 为什么渲染要自成一个包：重活（起浏览器、逐帧截图、跑 ffmpeg）**必须在 server 侧**做，
// 因为 agent 工具的产物是自包含 bundle，不该直接管子进程与临时文件。
// 这与 `@toonflow/ffmpeg` 的既有模式一致：工具侧只做薄代理，真正的执行在 server。
//
// 交付边界：server 会被打包进 `app/`，所以这个包跟着 server 一起进安装目录；
// 而 `scripts/renderCard.mjs` **不在** `electrobun.config.ts` 的 copy 列表里，
// 安装后根本不存在 —— 那是这次要修的核心问题。

import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { buildCardPage } from "@toonflow/card-runtime";
import { htmlCards } from "@toonflow/card-runtime/cards";
import { findHtmlCard, type HtmlCard } from "./cards";
import { ensureBrowser, type BrowserOptions } from "./browser";
import { renderCardFrames } from "./page";
import { encodeFrames } from "./encode";
import { compositeOverVideo } from "./composite";

export { resolveBrowserPath, ensureBrowser, type BrowserOptions, type BrowserSession } from "./browser";
export { compositeOverVideo } from "./composite";

/** 渲染一张卡的入参。 */
export interface RenderCardOptions {
  /** 卡的 slug。 */
  slug: string;
  /** 输出画幅（**必须是成片画幅**）。 */
  width: number;
  height: number;
  /** 帧率。 */
  fps?: number;
  /** 覆盖卡的参数。 */
  parameters?: Record<string, number>;
  /** 输出视频路径。 */
  outputPath: string;
  /**
   * 临时工作目录（帧、页面、浏览器 profile 都放这里）。
   *
   * ACT: 调用方必须传一个**可写且不会被程序更新覆盖**的目录。
   * 交付环境用 `<data>/cardRender/`（Windows 上 `data/` 与 `app/` 同级），
   * 不要用程序资源目录 —— 那会被更新替换掉。
   */
  workDirectory: string;
  /** ffmpeg 可执行文件。 */
  ffmpegPath: string;
  /** 浏览器可执行文件（不给就按常见位置找）。 */
  browserPath?: string;
  /** CDP 端口。 */
  port?: number;
  /** 抓帧进度回调。 */
  onProgress?: (event: { stage: string; frame?: number; total?: number; message?: string }) => void;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 渲染结果。 */
export interface RenderCardResult {
  outputPath: string;
  slug: string;
  shape: HtmlCard["meta"]["shape"];
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  /** 输出是否带透明通道（叠加卡为 true）。 */
  hasAlpha: boolean;
}

const defaultPort = 9421;

/**
 * 渲染一张卡成视频。
 *
 * 全屏卡 / 转场卡出 H.264；叠加卡出 ProRes 4444（带 alpha），供后续合成。
 */
export async function renderCard(options: RenderCardOptions): Promise<RenderCardResult> {
  const card = findHtmlCard(options.slug);
  const fps = options.fps ?? 30;
  const port = options.port ?? defaultPort;
  const workDirectory = join(options.workDirectory, options.slug);
  const frameDirectory = join(workDirectory, "frames");
  const pagePath = join(workDirectory, "card.html");
  const profileDirectory = join(options.workDirectory, "browserProfile");

  mkdirSync(workDirectory, { recursive: true });
  mkdirSync(options.workDirectory, { recursive: true });

  const browserOptions: BrowserOptions = {
    port,
    profileDirectory,
    ...(options.browserPath ? { executablePath: options.browserPath } : {}),
  };
  const session = await ensureBrowser(browserOptions, reason => {
    options.onProgress?.({ stage: "browser", message: reason });
  });

  try {
    const rendered = await renderCardFrames(
      (target, parameters, size) => buildCardPage(target, parameters, { ...size, raster: "scale" }),
      {
        card,
        width: options.width,
        height: options.height,
        fps,
        parameters: options.parameters ?? {},
        frameDirectory,
        pagePath,
        port,
        ...(options.onProgress
          ? { onProgress: (frame: number, total: number) => options.onProgress?.({ stage: "render", frame, total }) }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    options.onProgress?.({ stage: "encode" });
    await encodeFrames({
      ffmpegPath: options.ffmpegPath,
      frameDirectory,
      extension: rendered.extension,
      fps,
      outputPath: options.outputPath,
      shape: card.meta.shape,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    return {
      outputPath: options.outputPath,
      slug: card.meta.slug,
      shape: card.meta.shape,
      width: options.width,
      height: options.height,
      fps,
      frames: rendered.frameCount,
      durationSeconds: Number((rendered.frameCount / fps).toFixed(3)),
      hasAlpha: card.meta.shape === "overlay",
    };
  } finally {
    // 帧文件清掉（大）；profile 留着（省去每次冷启动的十几秒）
    rmSync(frameDirectory, { recursive: true, force: true });
    session.dispose();
  }
}

/** 渲染并把卡叠到目标视频上（一步到位）。 */
export interface RenderAndCompositeOptions extends RenderCardOptions {
  /** 目标视频（AI 生成的素材）。 */
  targetVideoPath: string;
}

/**
 * 渲染一张卡并叠到目标视频上。
 *
 * ACT: 只对 `overlay` / `fullscreen` 有意义。转场卡是「接在两镜之间」的，调用方要自己
 * 决定怎么用（插在中点前后），这里不猜。
 */
export async function renderCardOverVideo(options: RenderAndCompositeOptions): Promise<RenderCardResult & { compositedPath: string }> {
  const card = findHtmlCard(options.slug);
  if (card.meta.shape === "transition") {
    throw new Error(`转场卡 ${options.slug} 不能直接叠到一段视频上：它作用在两个镜头之间，请由调用方决定如何插入。`);
  }
  // 先把卡渲成独立文件，再合成 —— 这样卡视频本身也能被复用（例如多处叠同一张）。
  // ACT: 中间产物放 temporary 子目录并在收尾时删掉。踩过：直接落在工作目录里，
  // 一次渲染就在工作区留下二十多 MB 的中间文件，用户看不到也不会去清。
  const scratchDirectory = join(options.workDirectory, options.slug, "intermediate");
  mkdirSync(scratchDirectory, { recursive: true });
  const cardOutput = join(scratchDirectory, card.meta.shape === "overlay" ? "card.mov" : "card.mp4");
  try {
    const result = await renderCard({ ...options, outputPath: cardOutput });
    await compositeOverVideo({
      ffmpegPath: options.ffmpegPath,
      targetVideoPath: options.targetVideoPath,
      overlayVideoPath: cardOutput,
      outputPath: options.outputPath,
      width: options.width,
      height: options.height,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { ...result, outputPath: options.outputPath, compositedPath: options.outputPath };
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}
