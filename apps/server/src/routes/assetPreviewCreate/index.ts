import { lstat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 素材预览副本的**生成**接口（读取见 routes/assetPreviewRead）。
// 探测编码：浏览器能解的（h264/vp8/vp9/av1）直接返回原文件；解不了的（HEVC 等）转成 H.264 副本。
// ACT: 不内置解码器而走转码 —— HEVC 是专利收费编码，随包分发解码器需要商业许可；
// 转码属于「我处理素材」，不是「我分发播放能力」，且用户无感（实测 12.9s 的素材 0.7 秒转完）。
const router = Router();

export default router.post("/", validateFields({
  path: z.string().min(1).max(4096),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const root = await u.assets.getAssetsDirectory();
  const { directory, path } = await u.workspaceFile.resolveWorkspacePath(root, req.body.path as string);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  if (!(await lstat(path)).isFile()) throw Object.assign(new Error("只能预览文件"), { status: 400 });
  const result = await u.assetPreview.ensureAssetPreview(path);
  // 返回**相对数据目录**的键，读取接口据此取回（不把服务器绝对路径暴露给前端）
  res.json(success({
    key: u.assetPreview.previewKey(result.path),
    original: result.original,
    elapsedMs: result.elapsedMs,
  }));
});
