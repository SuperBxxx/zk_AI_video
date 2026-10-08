import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const router = Router();

/**
 * 按用户偏好挑出唯一一个模型。
 *
 * ACT: 为什么放在服务端而不是前端 —— 视频生成节点是**插件**，构建里不含 web 的
 * Pinia store，读不到设置；而偏好存在服务端的 settings.json 里。
 * 让节点只问这一个接口，就不必给插件再加一条设置读取通道。
 *
 * 只存标识、使用时核对：供应商卸载或模型被删时该项自动跳过；
 * 全部失效返回 null，由调用方退回原本的默认选择。
 */
export default router.get("/", validateFields({
  scope: z.enum(["text", "video", "audio"]),
}, "query"), async (req, res) => {
  const scope = (req.query as unknown as { scope: "text" | "video" | "audio" }).scope;
  const settings = u.conf.get("settings", {}) as { preferredModels?: { scope?: string; providerId?: string; modelId?: string }[] };
  const preferred = Array.isArray(settings.preferredModels) ? settings.preferredModels : [];
  const wanted = preferred.filter(item => item?.scope === scope
    && typeof item.providerId === "string" && typeof item.modelId === "string");
  if (!wanted.length) {
    res.json(success(null));
    return;
  }

  // 文本模型来自已配置的文本供应商；视频/音频来自媒体供应商。
  const available = scope === "text"
    ? ((u.conf.get("settings", {}) as { customProviders?: { id?: string; label?: string; models?: { id?: string; label?: string }[] }[] }).customProviders ?? [])
      .flatMap(provider => (provider.models ?? []).map(model => ({
        providerId: String(provider.id ?? ""), providerLabel: String(provider.label ?? provider.id ?? ""),
        modelId: String(model.id ?? ""), modelLabel: String(model.label ?? model.id ?? ""),
      })))
    : (await u.mediaGeneration.listMediaModels())
      .filter(model => (scope === "audio" ? model.type === "audio" : model.type === "video" || model.type === "image"))
      .map(model => ({
        providerId: model.providerId, providerLabel: model.providerLabel,
        modelId: model.modelId, modelLabel: model.label,
      }));

  const pool = new Map(available.map(item => [`${item.providerId}::${item.modelId}`, item]));
  const hit = wanted.map(item => pool.get(`${item.providerId}::${item.modelId}`)).find(Boolean);
  res.json(success(hit ?? null));
});
