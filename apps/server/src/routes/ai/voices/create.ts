import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

// 创建音色（声音复刻 / 声音设计）。
// 样本以 base64 Data URL 提交：宿主工具没有读取工作区文件的能力，
// 样本字节由前端从素材库读出后随请求带上。见 docs/audioMaterialPlan.md §3 P4。
const mediaInput = z.strictObject({
  type: z.literal("base64"),
  data: z.string().min(1),
  mimeType: z.string().regex(/^audio\/[a-zA-Z0-9.+-]+$/),
});

export default Router().post("/", validateFields({
  providerId: z.string().min(1).max(256),
  modelId: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(64),
  // 声音复刻传 sample，声音设计传 description；两者都不传时由供应商报错。
  sample: mediaInput.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  // 后续用于合成的模型；部分平台要求与创建时声明的一致。
  targetModel: z.string().min(1).max(256).optional(),
}), async (req, res) => {
  const { providerId, modelId, name, sample, description, targetModel } = req.body as {
    providerId: string;
    modelId: string;
    name: string;
    sample?: { type: "base64"; data: string; mimeType: string };
    description?: string;
    targetModel?: string;
  };
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  req.socket.once("close", close);
  try {
    const voice = await u.mediaGeneration.createMediaVoice({
      providerId, modelId, name, sample, description, targetModel, signal: controller.signal,
    });
    if (!res.destroyed) res.json(success(voice));
  } finally {
    res.off("close", close);
    req.off("aborted", close);
    req.socket.off("close", close);
  }
});
