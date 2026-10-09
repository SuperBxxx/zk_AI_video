import { z } from "zod";

export type { MediaModel, MediaReference, MediaGenerationRequest, GeneratedMedia, MediaContext } from "@toonflow/tools-scaffold/runtime";

const relativePath = z.string().min(1).max(2048).refine(
  path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."),
  "路径必须是工作区内的相对路径，不能包含空路径段或 ..",
);
const imageReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i) });
const videoReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i) });
const audioReference = z.strictObject({ path: relativePath, mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/i) });
const sharedFields = {
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
  modelId: z.string().trim().min(1).max(256),
  prompt: z.string().trim().min(1).max(100000),
  outputDirectory: relativePath.optional(),
  images: z.array(imageReference).max(64).optional(),
  ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/).optional(),
};
const referenceMode = z.templateLiteral([z.enum(["image", "video", "audio"]), "Reference:", z.number()])
  .refine(value => /Reference:(?:[1-9]\d?|1\d{2}|2[0-4]\d|25[0-6])$/.test(value), "参考数量必须在 1 到 256 之间");

export const listMediaModelsSchema = z.strictObject({});
export const imageGenerationSchema = z.strictObject({
  ...sharedFields,
  size: z.string().trim().min(1).max(64).optional(),
});
export const videoGenerationSchema = z.strictObject({
  ...sharedFields,
  videos: z.array(videoReference).max(64).optional(),
  audios: z.array(audioReference).max(64).optional(),
  firstFrame: imageReference.optional(),
  lastFrame: imageReference.optional(),
  resolution: z.string().trim().min(1).max(64).optional(),
  duration: z.number().finite().positive().max(3600).optional(),
  generateAudio: z.boolean().optional(),
  mode: z.union([
    z.enum(["singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional", "text"]),
    z.array(referenceMode).min(1).max(3),
  ]).optional(),
});
export const audioGenerationSchema = z.strictObject({
  providerId: sharedFields.providerId,
  modelId: sharedFields.modelId,
  prompt: sharedFields.prompt,
  outputDirectory: sharedFields.outputDirectory,
  audios: z.array(audioReference).max(64).optional(),
  voice: z.string().trim().min(1).max(256).optional(),
  speed: z.number().finite().positive().optional(),
  volume: z.number().finite().optional(),
  format: z.string().trim().min(1).max(64).optional(),
  sampleRate: z.number().int().positive().optional(),
});

/**
 * Agent 侧 schema：在图片/视频生成上**强制**一个"已向用户确认"的字段。
 *
 * ACT: 为什么加在工具层而不是服务端 —— 生成是"消耗算力"的操作，很贵，
 * 而节点生成是用户自己点的按钮（本身即确认），**只有 Agent 会静默地决定去生成**。
 * 所以门槛加在 Agent 的工具入参上：缺这个字段 zod 直接拒，
 * Agent 会看到"必填缺失"，被引导去用 askUser 把方案（模型/画幅/时长/提示词/次数）
 * 给用户确认后再调用。内部调用与节点走的是原始 schema，不受影响。
 *
 * ACT: 它是一道**流程门槛**，不是防伪造 —— Agent 理论上可以自己填 true。
 * 真正的强制确认（服务端签发令牌）代价大得多，当前判断不值得。
 */
const confirmedField = {
  userConfirmed: z.literal(true).describe(
    "必填：仅当已把模型、画幅/分辨率、时长、提示词与生成次数向用户说明并取得明确同意后才传 true。未经确认的生成会被拒绝。",
  ),
};
export const agentImageGenerationSchema = z.strictObject({ ...imageGenerationSchema.shape, ...confirmedField });
export const agentVideoGenerationSchema = z.strictObject({ ...videoGenerationSchema.shape, ...confirmedField });
