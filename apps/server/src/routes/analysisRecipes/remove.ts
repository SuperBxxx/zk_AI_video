import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 删除一张「视频分析配方卡」。
export default Router().post("/", validateFields({
  slug: z.string().min(1).max(64),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  await u.analysisRecipe.removeRecipe(req.body.slug as string);
  res.json(success());
});
