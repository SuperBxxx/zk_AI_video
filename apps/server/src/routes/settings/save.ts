import u from "@/utils";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { downloadSources } from "@toonflow/ytDlp";
import { maxSystemPromptLength } from "@/agent/runtime/prompt";
import { t } from "@/lib/i18n";

const router = Router();

export default router.put("/", validateFields({ settings: z.record(z.string(), z.json()).and(z.object({
  agentSystemPrompt: z.string().max(maxSystemPromptLength, { error: () => t`系统提示词不能超过 ${maxSystemPromptLength} 个字符` }).optional(),
  desktopUpdateSource: z.enum(["official", "github", "custom"]).optional(),
  desktopUpdateCustomUrl: z.string().max(2048).refine(value => !value || u.desktop.isValidUpdateUrl(value),
    "自定义更新源必须是不含账号、查询参数或锚点的 HTTP(S) 地址").optional(),
  mcp: z.object({ enabled: z.boolean().optional(), token: z.string().optional(), port: z.number().int().min(1).max(65535).optional() }).optional(),
  // 取流工具（yt-dlp）：模式与下载线路。线路 id 必须在源表里，避免存进一个不存在的源。
  ytdlp: z.object({
    mode: z.enum(["auto", "download", "system"]).optional(),
    source: z.string().max(64).refine(value => !value || downloadSources.some(source => source.id === value),
      "未知的 yt-dlp 下载线路").optional(),
  }).optional(),
  // ACT: 用户偏好的模型，**数组顺序即优先级**（排在前面的先用）。
  // scope 对应三处设置页面的用途：text 供对话选默认模型，video / audio 供节点与配音选默认模型。
  // 只存标识（供应商 + 模型），**不缓存模型能力** —— 能力随供应商变化，使用时按当前列表核对，
  // 找不到就跳过；这样卸载某个供应商不会让整份设置失效。
  preferredModels: z.array(z.object({
    scope: z.enum(["text", "video", "audio", "image"]),
    providerId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(256),
  })).max(64).optional(),
})).refine(value => value.desktopUpdateSource !== "custom" || !!value.desktopUpdateCustomUrl, {
  path: ["desktopUpdateCustomUrl"], message: "选择自定义更新源前，请先填写有效地址",
}) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { settings } = req.body;
  u.removeLegacySettings(settings);
  u.conf.set("settings", settings);
  await u.mcpRuntime.reloadMcpRuntime();
  res.json(success(null, "设置已保存"));
});
