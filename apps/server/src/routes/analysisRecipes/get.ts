import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 读取一张配方卡（Agent 取用它时读的就是这份内容）。
export default Router().get("/", validateFields({
  slug: z.string().min(1).max(64),
}, "query"), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const recipe = await u.analysisRecipe.readRecipe(req.query.slug as string);
  if (!recipe) throw Object.assign(new Error("找不到这张配方卡"), { status: 404 });
  res.set("Cache-Control", "no-store").json(success(recipe));
});
