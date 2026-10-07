import { Router } from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 列出用户保存的「视频分析配方卡」。
export default Router().get("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store").json(success(await u.analysisRecipe.listRecipes()));
});
