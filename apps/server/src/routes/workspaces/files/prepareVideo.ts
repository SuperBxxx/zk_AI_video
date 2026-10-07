import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 把工作区里的一个视频转成通用可解码的 H.264，返回**工作区相对路径**。
//
// ACT: 为什么放在工作区文件接口下 —— 前端组件统一复用 `useWorkspaceFiles` 这个入口
// （仓库规范：不重复封装 Axios 或直接拼 /api/workspaces/files/*），所以走同一客户端。
// 用途是「送进模型/后续环节的参考视频必须能被通用解码」：微信、苹果导出的 mp4 多是 HEVC，
// 桌面端（WebView2）没有 HEVC 解码器。已是 h264/vp8/vp9/av1 时直接返回原路径、不转码。
const router = Router();

export default router.post("/", validateFields({
  directory: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096),
}), async (req, res) => {
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory as string);
  const absolute = resolve(directory, req.body.path as string);
  if (!(await stat(absolute).catch(() => undefined))?.isFile()) throw Object.assign(new Error("只能处理文件"), { status: 400 });
  const result = await u.assetPreview.ensurePlayableWorkspaceVideo(directory, req.body.path as string);
  res.json(success(result));
});
