import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 从链接取流：把一个视频页面链接下载成工作区里的本地文件。
// ACT: yt-dlp 缺失时这里会**按需下载并校验**（引导安装），不需要用户先去设置里装。
const router = Router();

export default router.post("/", validateFields({
  directory: z.string().min(1).max(4096),
  url: z.string().min(1).max(4096),
  name: z.string().max(200).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory as string);
  const result = await u.ytDlp.fetchVideo({
    directory,
    url: req.body.url as string,
    name: req.body.name as string | undefined,
  });
  res.json(success(result));
});
