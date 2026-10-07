import { Router } from "express";
import { z } from "zod";
import { join, resolve } from "node:path";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { validationOptions } from "@/lib/i18n";
import type { CardRenderProgress } from "@/utils/cardRender";

const inputSchema = z.object({
  requestId: z.uuid(),
  directory: z.string().min(1).max(4096),
  slug: z.string().min(1).max(64),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  fps: z.number().int().positive().max(120).optional(),
  parameters: z.record(z.string(), z.number()).optional(),
  /** 输出文件名（落在工作区内）。 */
  output: z.string().min(1).max(4096),
  /** 有值就走「渲染并叠到这段视频上」，同样是工作区内相对路径。 */
  targetVideo: z.string().min(1).max(4096).optional(),
}).strict();

// ACT: 与 ffmpeg 接口同一套做法 —— 单进程会话状态，按「工作目录 + requestId」键控取消。
// Bun 的静默 SSE 不保证触发断开事件，所以取消既走 close 事件也走显式的 cancel 方法。
const requests = new Map<string, AbortController>();

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const input = inputSchema.parse(req.body, validationOptions());
  const cwd = await u.workspace.resolveWorkspace(req, input.directory);
  const requestKey = `${cwd}\0${input.requestId}`;
  const controller = new AbortController();

  if (requests.has(requestKey)) throw Object.assign(new Error("卡渲染请求已在执行"), { status: 409 });
  requests.set(requestKey, controller);

  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    // 输出与叠加视频都限定在工作区内 —— 与其它接口一致，不允许写到工作区外
    const outputPath = resolve(cwd, input.output);
    const targetVideoPath = input.targetVideo ? resolve(cwd, input.targetVideo) : undefined;

    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 1000);
    const send = (event: CardRenderProgress) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };

    const result = await u.cardRender.renderCardToVideo({
      slug: input.slug,
      width: input.width,
      height: input.height,
      ...(input.fps ? { fps: input.fps } : {}),
      ...(input.parameters ? { parameters: input.parameters } : {}),
      outputPath,
      ...(targetVideoPath ? { targetVideoPath } : {}),
      signal: controller.signal,
    }, send);

    send({ stage: "done", message: JSON.stringify({ ...result, outputPath: join(input.output) }) });
    res.end();
  } finally {
    if (requests.get(requestKey) === controller) requests.delete(requestKey);
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
