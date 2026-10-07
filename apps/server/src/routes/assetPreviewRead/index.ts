import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

// 读取素材预览副本（由 /api/assetPreview/create 生成），供 <video> 播放。
// 与 assets/read 一样支持 Range —— 视频没有 Range 就没法拖进度。
const router = Router();

export default router.get("/", validateFields({
  key: z.string().min(1).max(4096),
  download: z.literal("true").optional(),
}, "query"), async (req, res) => {
  const path = u.assetPreview.resolvePreviewKey(req.query.key as string);
  await u.assetPreview.sendPreview(res, path, {
    download: req.query.download === "true",
    name: path.split(/[\\/]/).pop(),
  });
});
