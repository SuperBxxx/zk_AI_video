import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 生成流程用的转码：把工作区里的视频转成通用可解码的 H.264，返回**工作区相对路径**。
//
// ACT: 为什么需要它 —— 微信/苹果导出的 mp4 多是 HEVC，而桌面端（WebView2）没有 HEVC 解码器；
// 同一个坑不止影响预览，⑤ 视频生成节点把参考视频送进模型时也会踩。
// 这里在送出去之前转一份，调用方直接拿返回的 path 当素材路径用。
const router = Router();

export default router.post("/", validateFields({
  directory: z.string().min(1).max(4096),
  path: z.string().min(1).max(4096),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory as string);
  const result = await u.assetPreview.ensurePlayableWorkspaceVideo(directory, req.body.path as string);
  res.json(success(result));
});
