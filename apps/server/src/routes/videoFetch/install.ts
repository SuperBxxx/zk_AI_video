import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 手动安装 / 重装 yt-dlp：设置面板的「下载并安装」按钮用。
//
// 为什么需要手动入口：取流时的引导安装是**按需触发**的，装失败（网络、镜像、
// 校验不过）用户在当时只能看到一个笼统的取流错误。有了这个接口，面板可以
// 「检测 → 换线路 → 重装」自己闭环，不必先失败一次取流。
export default Router().post("/", validateFields({
  force: z.boolean().optional(),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  const lines: string[] = [];
  // ACT: 一次性返回全过程日志，不做 SSE 进度 —— 引导安装本身只有十几秒，
  // 而 ffmpeg 那套需要进度是因为它要下 100 MB 级的包。等真正需要进度时再加。
  const path = await u.ytDlp.ensureTool(controller.signal, line => { lines.push(line); });
  res.json(success({ path, lines }, "yt-dlp 已就绪"));
});
