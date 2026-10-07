import { Router } from "express";
import { z } from "zod";
import { storyAnchorKeys } from "@toonflow/post-production";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 保存（或更新）一张「视频分析配方卡」。
// ACT: 这是用户的产物 —— Agent 分析完一条视频后，用户可以给它命名并保存下来，
// 下次做同类视频时再取用。所以字段是"这次分析学到了什么"，不是"怎么分析"。
export default Router().post("/", validateFields({
  slug: z.string().min(1).max(64).optional().describe("更新已有卡时给它的标识；不填表示新建"),
  name: z.string().min(1).max(80).describe("用户给这张卡起的名字"),
  source: z.object({
    path: z.string().max(4096).optional(),
    url: z.string().max(4096).optional(),
    title: z.string().max(300).optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }).optional(),
  pattern: z.string().max(8000).optional().describe("这类视频的套路：骨架、节奏、钩子位置"),
  intent: z.string().max(4000).optional().describe("意图与受众"),
  techniques: z.array(z.object({
    name: z.string().min(1).max(200),
    /** 它回应故事的哪一下。枚举限死 —— 写错的锚点会静默毁掉检索能力。 */
    respondsTo: z.enum(storyAnchorKeys as [string, ...string[]]).optional(),
    /** 参考片里它长什么样（形式，不是要照抄的像素）。 */
    form: z.string().max(2000).optional(),
    /** 参考片里的时点（仅观察记录，不是新片的时间）。 */
    atSeconds: z.number().min(0).optional(),
    /** 它替观众做了什么 —— 这才是要保留的东西。 */
    role: z.string().max(2000).optional(),
    /** 新片子里用什么形式完成同一件事。 */
    when: z.string().max(2000).optional(),
    evidence: z.string().max(4096).optional(),
  })).max(80).optional(),
  evidence: z.array(z.object({
    kind: z.string().min(1).max(64),
    label: z.string().min(1).max(300),
    ref: z.string().max(4096),
  })).max(200).optional(),
  pitfalls: z.array(z.string().max(2000)).max(60).optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { recipe, droppedAnchors } = await u.analysisRecipe.saveRecipe(req.body as never);
  res.json(success({
    ...recipe,
    // ACT: 把被丢掉的锚点回给调用方 —— 否则"这条手法以后搜不到了"是静默发生的。
    ...(droppedAnchors.length ? { droppedAnchors } : {}),
  }));
});
