import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";

const configSchema = z.object({
  maxEntries: z.number().int().min(10).max(1000).default(200),
  maxImport: z.number().int().min(1).max(100).default(20),
}).strict();

// ACT: 按扩展名判定媒体种类，不重复实现魔数检测 —— 画布节点的 set* 函数
// 各自用正则校验 mimeType，类型不符会直接报错，这里只负责给出候选种类。
const extensionKinds: Record<string, "image" | "video" | "audio"> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", avif: "image", bmp: "image", svg: "image",
  mp4: "video", m4v: "video", webm: "video", mov: "video", mkv: "video", avi: "video", ogv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", opus: "audio", flac: "audio", m4a: "audio", aac: "audio",
};
const mimeTypePrefix = { image: "image/", video: "video/", audio: "audio/" } as const;
const mimeTypeByExtension: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/opus", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// 画布节点类型与各自的取值函数；音频节点没有输入端口，只能这样把成品放上去。
const nodeTargets = {
  image: { type: "remote-imageNode", setter: "node:setImage" },
  video: { type: "remote-videoNode", setter: "node:setVideo" },
  audio: { type: "remote-audioNode", setter: "node:setAudio" },
} as const;

const listSchema = z.strictObject({
  path: z.string().trim().max(512).optional().describe("素材库内的相对文件夹路径；省略表示根目录"),
  recursive: z.boolean().optional().describe("是否递归列出子文件夹"),
}).strict();

const importSchema = z.strictObject({
  paths: z.array(z.string().trim().min(1).max(512)).min(1).describe("要导入的素材库相对路径，可含文件夹"),
  targetDirectory: z.string().trim().max(512).optional().describe("复制到工作区的目标文件夹，默认 assets/imported"),
  placeOnCanvas: z.boolean().optional().describe("是否同时放到画布上，默认 true"),
}).strict();

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    // ACT: 传成函数参数而不是闭包捕获 —— 闭包里 TypeScript 不会保留
    // context.assets 的非空窄化，参数则是必填类型。
    const store = context.assets;
    if (!store) return [];
    const { maxEntries, maxImport } = configSchema.parse(context.config);

    // 递归展开，便于一次拿到文件夹下的全部素材。
    async function collect(assets: NonNullable<ToolContext["assets"]>, path: string, recursive: boolean): Promise<{ name: string; path: string; type: string; kind?: string; size?: number }[]> {
      const entries = await assets.readdir(path || undefined);
      const result: { name: string; path: string; type: string; kind?: string; size?: number }[] = [];
      for (const entry of entries) {
        if (entry.type === "directory") {
          if (!recursive) continue;
          result.push(...await collect(assets, entry.path, recursive));
          continue;
        }
        const kind = extensionKinds[extensionOf(entry.name)];
        result.push({ name: entry.name, path: entry.path, type: entry.type, ...(kind ? { kind } : {}), ...(entry.size === undefined ? {} : { size: entry.size }) });
      }
      return result;
    }

    async function placeOnCanvas(kind: "image" | "video" | "audio", path: string, mimeType: string, name: string) {
      if (!context.canvas) return false;
      const target = nodeTargets[kind];
      const node = await context.canvas.call({ name: "addNode", args: { type: target.type, position: { x: 0, y: 0 }, label: name } }) as { node?: { id?: string } };
      const nodeId = node?.node?.id;
      if (!nodeId) return false;
      await context.canvas.call({ name: "nodeTools", args: { nodeId, name: target.setter, args: { path, mimeType } } });
      return true;
    }

    const tools: ToolDefinition[] = [
      {
        name: "listAssets",
        label: "浏览素材库",
        description: "列出全局素材库（与当前工作目录无关）中的文件与文件夹，标注图片、视频或音频种类。导入前先用它确认实际路径。",
        promptSnippet: "素材库是跨项目共用的；导入前先 listAssets 确认实际存在哪些文件。",
        parameters: z.toJSONSchema(listSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const { path = "", recursive = false } = listSchema.parse(params);
          const entries = await collect(store, path, recursive);
          const shown = entries.slice(0, maxEntries);
          const text = shown.length
            ? `${JSON.stringify(shown)}${entries.length > shown.length ? `\n（共 ${entries.length} 项，仅显示前 ${shown.length} 项，可指定更具体的 path）` : ""}`
            : `素材库${path ? ` / ${path}` : ""} 下没有文件。`;
          return { content: [{ type: "text", text }], details: { entries: shown, total: entries.length } };
        },
      },
      {
        name: "importAssets",
        label: "导入素材到画布",
        description: "把素材库中的图片、视频或音频复制进工作区，并按种类放到画布对应节点上（图片节点、视频节点、音频节点）。返回落地后的工作区路径。",
        promptSnippet: "导入素材后要引用的是返回的工作区路径，不是素材库路径。",
        parameters: z.toJSONSchema(importSchema, { io: "input", target: "draft-07" }),
        executionMode: "sequential",
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const { paths, targetDirectory, placeOnCanvas: place = true } = importSchema.parse(params);
          // 允许直接传文件夹，展开成其中的文件。
          const files: { name: string; path: string }[] = [];
          for (const item of paths) {
            const listed = await collect(store, item, true).catch(() => []);
            const single = listed.length ? listed : [{ name: item.split("/").pop() ?? item, path: item, type: "file" }];
            for (const entry of single) if (entry.type === "file") files.push({ name: entry.name, path: entry.path });
          }
          if (!files.length) throw new Error("没有找到可导入的素材，请先用 listAssets 确认路径");
          const limited = files.slice(0, maxImport);
          const imported: { name: string; assetPath: string; workspacePath: string; kind?: string; placed?: boolean }[] = [];
          for (const file of limited) {
            signal?.throwIfAborted();
            try {
              const workspacePath = await store.importToWorkspace(file.path, targetDirectory);
              const kind = extensionKinds[extensionOf(file.name)];
              let placed: boolean | undefined;
              if (kind && place) {
                const mimeType = mimeTypeByExtension[extensionOf(file.name)] ?? `${mimeTypePrefix[kind]}${extensionOf(file.name)}`;
                placed = await placeOnCanvas(kind, workspacePath, mimeType, file.name).catch(() => false);
              }
              imported.push({ name: file.name, assetPath: file.path, workspacePath, ...(kind ? { kind } : {}), ...(placed === undefined ? {} : { placed }) });
            } catch (error) {
              imported.push({ name: file.name, assetPath: file.path, workspacePath: `失败：${error instanceof Error ? error.message : "导入失败"}` });
            }
          }
          const failed = imported.filter(item => item.workspacePath.startsWith("失败：")).length;
          const summary = `已导入 ${imported.length - failed} 个素材${failed ? `，${failed} 个失败` : ""}${files.length > limited.length ? `（共 ${files.length} 个，本次只处理前 ${limited.length} 个）` : ""}。`;
          return { content: [{ type: "text", text: `${summary}\n${JSON.stringify(imported)}` }], details: imported };
        },
      },
    ];
    return tools;
  },
};

export default plugin;
