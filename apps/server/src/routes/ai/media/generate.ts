import { Router } from "express";
import { z } from "zod";
import { audioGenerationSchema, imageGenerationSchema, videoGenerationSchema } from "@toonflow/tool-media-generation/runtime";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { translateMessage, validationOptions } from "@/lib/i18n";

// ACT: mediaType 含 audio。音频此前只能由 agent 通过工具生成，没有 HTTP 入口，
// 素材库的「声音」面板需要合成试听，故在此一并暴露；
// generateMedia 本身就支持三种类型，这里只是补上 schema 选择与类型范围。
const schemas = { image: imageGenerationSchema, video: videoGenerationSchema, audio: audioGenerationSchema } as const;

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096), mediaType: z.enum(["image", "video", "audio"]),
}), async (req, res) => {
  const { directory, mediaType, ...request } = req.body as { directory: string; mediaType: keyof typeof schemas };
  const parsed = schemas[mediaType].safeParse(request, validationOptions());
  if (!parsed.success) {
    res.status(400).json(error("参数错误", parsed.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) })), 400));
    return;
  }
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    const files = await u.mediaGeneration.generateMedia(cwd, mediaType, parsed.data, controller.signal);
    if (!res.destroyed) res.json(success(files));
  } finally {
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
