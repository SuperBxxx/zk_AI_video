import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

// 单张 HTML 卡的首帧预览页（「配方卡片库」用 iframe 呈现）。
//
// ACT: 卡运行时产出的是**自足 HTML**（不依赖外部文件），所以这里直接把它作为文档返回，
// 预览不需要项目目录、不启动 Chrome、也不落盘。
const router = Router();

export default router.get("/", validateFields({
  slug: z.string().min(1).max(64),
  width: z.coerce.number().int().min(64).max(4096).optional(),
  height: z.coerce.number().int().min(64).max(4096).optional(),
}, "query"), async (req, res) => {
  const page = await u.cardLibrary.getCardPreviewHtml(
    req.query.slug as string,
    req.query.width ? Number(req.query.width) : undefined,
    req.query.height ? Number(req.query.height) : undefined,
  );
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // ACT: 与素材读取一致 —— 卡页面里没有脚本要连外部，sandbox 足够且更安全。
    "Content-Security-Policy": "sandbox allow-scripts",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(page);
});
