import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import {
  agentImageGenerationSchema, agentVideoGenerationSchema,
  audioGenerationSchema, imageGenerationSchema, listMediaModelsSchema, videoGenerationSchema,
} from "./runtime";

const configSchema = z.strictObject({
  allowImage: z.boolean().default(true),
  allowVideo: z.boolean().default(true),
  allowAudio: z.boolean().default(true),
});

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    const { media, config } = context;
    if (!media) return [];
    const permissions = configSchema.parse(config);
    // 生成结果自动放到画布上，不依赖 agent 自觉调用画布工具。
    // 用各节点自己注册的 set* 函数写入，它们会做各自的校验（例如 videoNode 的
    // setVideo 会校验文件可读且不超过 100 MB），工具层不重复校验。
    // ACT: 与 tools/ffmpeg 的做法一致；任何失败只静默跳过，绝不影响生成结果本身。
    const nodeTargets = {
      image: { type: "remote-imageNode", setter: "node:setImage" },
      video: { type: "remote-videoNode", setter: "node:setVideo" },
      audio: { type: "remote-audioNode", setter: "node:setAudio" },
    } as const;
    async function placeOnCanvas(assets: { mediaType: "image" | "video" | "audio"; path: string; mimeType?: string }[]): Promise<string> {
      if (!context.canvas) return "";
      const placed: string[] = [];
      for (const asset of assets) {
        const target = nodeTargets[asset.mediaType];
        if (!target) continue;
        const name = asset.path.replaceAll("\\", "/").split("/").pop() || asset.path;
        try {
          const node = await context.canvas.call({
            name: "addNode",
            args: { type: target.type, position: { x: 0, y: 0 }, label: name },
          }) as { node?: { id?: string } };
          const nodeId = node?.node?.id;
          if (!nodeId) continue;
          await context.canvas.call({
            name: "nodeTools",
            args: { nodeId, name: target.setter, args: { path: asset.path, mimeType: asset.mimeType ?? "" } },
          });
          placed.push(name);
        } catch {
          // 单个素材失败不影响其余，也不影响工具本身的返回值。
        }
      }
      return placed.length ? `已将 ${placed.join("、")} 放到画布上。` : "";
    }

    const generationTools = ([
      {
        name: "generateImage", mediaType: "image", enabled: permissions.allowImage, label: "生成图片",
        parameters: imageGenerationSchema, agentParameters: agentImageGenerationSchema,
        description: "根据提示词和可选的工作区参考图生成图片。**调用前必须先把模型、尺寸/画幅、提示词与生成张数向用户说明并取得同意**，再带 userConfirmed=true 调用；未经确认会被拒绝。",
      },
      {
        name: "generateVideo", mediaType: "video", enabled: permissions.allowVideo, label: "生成视频",
        parameters: videoGenerationSchema, agentParameters: agentVideoGenerationSchema,
        description: "根据提示词和可选的工作区图片、视频、音频、首尾帧生成视频。按模型能力设置生成模式、时长、分辨率和音频。**视频生成很贵：调用前必须先把模型、画幅比例、分辨率、时长、提示词与生成次数向用户说明并取得同意**，再带 userConfirmed=true 调用；未经确认会被拒绝。",
      },
      {
        name: "generateAudio", mediaType: "audio", enabled: permissions.allowAudio, label: "生成音频",
        parameters: audioGenerationSchema,
        description: "根据文本或提示词和可选的工作区参考音频生成音频。按模型能力设置音色、语速、音量和格式。",
      },
    ] as const).filter(operation => operation.enabled);
    if (!generationTools.length) return [];
    const listTool: ToolDefinition = {
      name: "listMediaModels",
      label: "查询媒体模型",
      description: "查询已允许生成的媒体模型，返回 providerId、modelId、类型、模式及支持的画幅、时长、分辨率或音色。生成前先查询，不能猜测模型 ID。带 `preferred: true` 的是用户在设置里指定的该类型首选模型，未另行指定时应优先使用它。",
      parameters: z.toJSONSchema(listMediaModelsSchema, { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        listMediaModelsSchema.parse(params);
        signal?.throwIfAborted();
        const result = (await media.listModels()).filter(model => generationTools.some(operation => operation.mediaType === model.type));
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    };
    return [listTool, ...generationTools.map<ToolDefinition>(operation => ({
      name: operation.name,
      label: operation.label,
      description: `${operation.description}providerId 和 modelId 必须来自 listMediaModels。引用素材的 path 及 outputDirectory 均为工作区相对路径；省略输出目录使用默认媒体目录。等待生成完成后返回已保存的文件路径，不返回 Base64。`,
      promptSnippet: "生成媒体前先查询 listMediaModels，复用实际模型和工作区参考素材。",
      parameters: z.toJSONSchema("agentParameters" in operation ? operation.agentParameters : operation.parameters, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        signal?.throwIfAborted();
        // ACT: 先用**Agent 侧** schema 解析 —— 它要求 userConfirmed=true，缺了直接报错。
        // 再把该字段剥掉后交给内部 schema（strictObject 会拒绝未知键）。
        const confirmed = "agentParameters" in operation
          ? operation.agentParameters.parse(params) as Record<string, unknown>
          : operation.parameters.parse(params) as Record<string, unknown>;
        const { userConfirmed: _confirmed, ...request } = confirmed;
        const result = await media[operation.name](operation.parameters.parse(request), signal);
        const placed = await placeOnCanvas(result);
        const text = result.map(asset => {
          const url = asset.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
          const preview = asset.mediaType === "image" ? `![生成图片](<${url}>)` : `[${asset.mediaType === "audio" ? "播放生成音频" : "查看生成视频"}](<${url}>)`;
          return `${preview}\n工作区文件：${asset.path}`;
        }).join("\n\n");
        return { content: [{ type: "text", text: placed ? `${text}\n\n${placed}` : text }], details: result };
      },
    }))];
  },
};

export default plugin;
