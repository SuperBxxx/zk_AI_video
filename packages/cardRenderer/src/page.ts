// 逐帧渲染：把一张卡的页面在浏览器里按帧画出来，一帧一个 PNG。
//
// 这里集中了几条**不这样做就会出问题**的做法（都是实测踩出来的）：
//   · 设完帧必须**等一次真实绘制**再截图（双 rAF + 强制 reflow），不能 sleep 赌
//   · 正式抓帧前要**预热**若干帧，挡掉页面刚加载时的光栅化过渡态
//   · 叠加卡要**透明底**：CDP 的 setDefaultBackgroundColorOverride + 截图传
//     background:"transparent"，**两条缺一不可**（Chrome 默认把画面合成到白底上）
//   · 探针帧不能硬编码（短卡会被夹到末帧，确定性自检就永远通过）

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CardDefinition } from "@toonflow/card-runtime";
import type { CardShape } from "@toonflow/post-production";

/** 一个最小的 CDP 客户端。 */
export class CdpClient {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
      if (!message.id) return;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      message.error ? waiting.reject(new Error(JSON.stringify(message.error))) : waiting.resolve(message.result);
    };
  }

  static async connect(webSocketDebuggerUrl: string): Promise<CdpClient> {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("连不上浏览器调试端口"));
    });
    return new CdpClient(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里求值；页面抛错时把这个错误原样带出来。 */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "页面求值失败");
    }
    return result.result?.value;
  }
}

// ACT: 「设完帧等一次真实绘制」用双 rAF + 强制 reflow，而不是 sleep。
// sleep 是赌（赌多久都可能不够），等绘制是确定。踩过：只改 innerHTML 就立刻截图，
// 抓到的是上一帧还没提交的画面，表现为「同一帧两次截图不一致」。
const awaitPaint = `new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    void document.body.offsetHeight;
    resolve(true);
  }));
})`;

/** 逐帧渲染的入参。 */
export interface RenderFramesOptions {
  /** 卡定义（含 render 与 helpers）。 */
  card: CardDefinition;
  /** 输出画幅（**必须是成片画幅**）。 */
  width: number;
  height: number;
  /** 帧率。 */
  fps: number;
  /** 覆盖参数。 */
  parameters?: Record<string, number>;
  /** 帧目录（会被清空重建）。 */
  frameDirectory: string;
  /** 卡片 HTML 的落盘路径。 */
  pagePath: string;
  /** 浏览器调试端口。 */
  port: number;
  /** 抓帧进度回调（当前帧 / 总帧数）。 */
  onProgress?: (frame: number, total: number) => void;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 逐帧渲染的结果。 */
export interface RenderFramesResult {
  /** 落到磁盘的帧数。 */
  frameCount: number;
  /** 帧的扩展名（全屏卡 jpg / 叠加卡 png）。 */
  extension: "jpg" | "png";
  /** 渲染耗时（毫秒）。 */
  elapsedMs: number;
}

/** 叠加卡与转场卡是透明层，必须出带 alpha 的帧。 */
function needsAlpha(shape: CardShape): boolean {
  return shape === "overlay" || shape === "transition";
}

/**
 * 把一张卡逐帧画出来。
 *
 * 调用方要保证帧目录可写、页面路径可写、且浏览器已经在 `port` 上就绪。
 */
export async function renderCardFrames(
  buildPage: (card: CardDefinition, parameters: Record<string, number>, size: { width: number; height: number }) => string,
  options: RenderFramesOptions,
): Promise<RenderFramesResult> {
  const { card, width, height, fps, parameters = {}, frameDirectory, pagePath, port } = options;
  const total = card.frames;
  const wantAlpha = needsAlpha(card.meta.shape);

  // 生成自足页面并落盘：file:// 下直接打开就能渲，不依赖任何外部文件
  rmSync(frameDirectory, { recursive: true, force: true });
  mkdirSync(frameDirectory, { recursive: true });
  writeFileSync(pagePath, buildPage(card, parameters, { width, height }), "utf8");

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find(target => target.type === "page");
  if (!page) throw new Error("浏览器里没有可用页面目标");

  const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const { pathToFileURL } = await import("node:url");
  await cdp.send("Page.navigate", { url: pathToFileURL(pagePath).href });

  // ACT: 透明底靠这两条设置，**缺一不可**。
  // 踩过：一直以为 alpha 没问题，因为 ffprobe 报告 yuva444p12le（像素格式确实带 a）——
  // 但通道里全是 255，合成时把 AI 视频整块盖掉。根因是 Chrome 截图**默认把画面合成到
  // 不透明白底上**，哪怕页面自己写了 background: transparent。
  // Chrome 154 已不认启动参数 --default-background-color，CDP 是唯一有效路径。
  if (wantAlpha) {
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  }

  const started = Date.now();
  const shotFormat = wantAlpha ? { format: "png", background: "transparent" } : { format: "jpeg", quality: 90 };
  const extension = wantAlpha ? "png" : "jpg";

  // 页面加载完成后再操作；`renderAt` 由 buildCardPage 注入
  await new Promise(resolve => setTimeout(resolve, 600));
  if (await cdp.evaluate("typeof window.renderAt !== 'function'")) {
    throw new Error("卡片页面没有加载成功（window.renderAt 不存在）");
  }

  // 预热：渲染几帧并等稳定，再正式抓帧。
  // 踩过：预热前偶发「同一帧两次截图不一致」—— 页面刚加载时字体光栅化还没进稳态。
  for (const frame of [0, 20, 40, 20, 0]) {
    await cdp.evaluate(`window.renderAt(${Math.min(frame, total - 1)})`);
    await cdp.evaluate(awaitPaint);
  }

  // 确定性自检：同一帧两次截图必须字节级一致，否则逐帧渲染会闪。
  // 探针取动画中段：硬编码帧号时短卡会被夹到末帧，两次相同，自检就永远通过了。
  const probeFrame = Math.min(7, Math.max(0, total - 2));
  await cdp.evaluate(`window.renderAt(${probeFrame})`);
  await cdp.evaluate(awaitPaint);
  const firstShot = await cdp.send("Page.captureScreenshot", shotFormat);
  await cdp.evaluate(`window.renderAt(${probeFrame})`);
  await cdp.evaluate(awaitPaint);
  const secondShot = await cdp.send("Page.captureScreenshot", shotFormat);
  if (firstShot.data !== secondShot.data) {
    throw new Error("确定性自检失败：同一帧两次截图不一致（逐帧渲染会闪，先修卡）");
  }

  for (let frame = 0; frame < total; frame += 1) {
    options.signal?.throwIfAborted();
    await cdp.evaluate(`window.renderAt(${frame})`);
    await cdp.evaluate(awaitPaint);
    const shot = await cdp.send("Page.captureScreenshot", { ...shotFormat, captureBeyondViewport: false });
    writeFileSync(
      join(frameDirectory, `f${String(frame).padStart(5, "0")}.${extension}`),
      Buffer.from(shot.data as string, "base64"),
    );
    options.onProgress?.(frame + 1, total);
  }

  return { frameCount: total, extension, elapsedMs: Date.now() - started };
}
