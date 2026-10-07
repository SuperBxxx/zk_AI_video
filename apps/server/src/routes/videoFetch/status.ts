import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// yt-dlp 工具状态：是否已安装、从哪来的、版本。
// 前端据此在「配方卡片库」里说明链接取流是否可用。
export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.ytDlp.getStatus()));
});
