import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 配方卡片库：列出全部可用卡（分析卡 + HTML 卡 + FFmpeg 配方卡），供首页浏览。
export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(u.cardLibrary.getCardLibrary()));
});
