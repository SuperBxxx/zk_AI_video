import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 音频转写：拿回带词级时间戳的结果，用于生成对齐字幕。
//
// 与音色创建的区别：音色的样本限 30 秒、由前端读成 base64 提交；
// 转写的音频可能到几十 MB，所以这里传工作区内的相对路径、由服务端读文件。
// 时间戳的用途与校验口径见 docs/creativeUpgradePlan.md P1。
export default Router().post("/", validateFields({
  providerId: z.string().min(1).max(256),
  // 工作区绝对目录；路径参数是工作区内的相对路径
  directory: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096),
  languageHints: z.array(z.string().min(1).max(16)).max(8).optional(),
}), async (req, res) => {
  const { providerId, directory, path, languageHints } = req.body as {
    providerId: string;
    directory: string;
    path: string;
    languageHints?: string[];
  };
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    const transcript = await u.mediaGeneration.transcribeAudio({
      providerId, directory, path, languageHints, signal: controller.signal,
    });
    if (!res.destroyed) res.json(success(transcript));
  } finally {
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
