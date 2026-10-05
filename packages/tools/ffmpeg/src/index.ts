import { basename, extname } from "node:path";
import { z } from "zod";
import { chainMethods, executeRemoteFfmpeg, queryMethods, runMethods } from "@toonflow/ffmpeg/remote";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";

const configSchema = z.strictObject({});
const probeSchema = z.strictObject({
  path: z.string().min(1).describe("工作区媒体文件，相对路径或工作区内的绝对路径"),
  options: z.array(z.string()).optional().describe("原生 ffprobe 选项，按参数数组原样传递"),
});
const processSchema = z.strictObject({
  options: z.strictObject({
    source: z.string().optional(),
    cwd: z.string().optional(),
    niceness: z.number().optional(),
    priority: z.number().optional(),
    stdoutLines: z.number().optional(),
    timeout: z.number().optional(),
  }).optional().describe("原生 fluent 构造选项；不设置固定超时"),
  steps: z.array(z.strictObject({
    method: z.enum(chainMethods),
    args: z.array(z.json()),
    undefinedArgs: z.array(z.number().int().nonnegative()).optional().describe("需要传 undefined 的参数位置，其他参数保持原值"),
  })).default([]).describe("按 fluent-ffmpeg 顺序配置，方法及其别名沿用宿主；选项、滤镜和文件序列原样传递"),
  operation: z.strictObject({
    method: z.enum([...runMethods, ...queryMethods]),
    args: z.array(z.json()),
    undefinedArgs: z.array(z.number().int().nonnegative()).optional(),
  }).default({ method: "run", args: [] }).describe("最后执行的方法，默认 run；也可 save、screenshots、concat 或查询编码器、格式、滤镜等"),
});

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    // 产出视频后自动放到画布上，不依赖 agent 自觉调用画布工具。
    // 用 node:setVideo（videoNode 注册的函数）写入路径，它会校验文件可读且不超过 100 MB，
    // 因此这里不必重复校验。任何失败都不影响 FFmpeg 本身的执行结果，只提示一句。
    const videoTypeId = "remote-videoNode";
    // setVideo 的 mimeType 参数要求形如 video/xxx；只处理这些已知的视频扩展名，
    // 其余产出（图片、音频等）不自动上画布。
    const videoMimeTypes: Record<string, string> = {
      ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
      ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    };
    async function placeVideoOnCanvas(files: string[]): Promise<string> {
      const videos = files.filter(file => extname(file).toLowerCase() in videoMimeTypes);
      if (!videos.length || !context.canvas) return "";
      const placed: string[] = [];
      for (const file of videos) {
        try {
          const node = await context.canvas.call({
            name: "addNode",
            args: { type: videoTypeId, position: { x: 0, y: 0 }, label: basename(file) },
          }) as { node?: { id?: string } };
          const nodeId = node?.node?.id;
          if (!nodeId) continue;
          const mimeType = videoMimeTypes[extname(file).toLowerCase()]!;
          await context.canvas.call({ name: "nodeTools", args: { nodeId, name: "node:setVideo", args: { path: file, mimeType } } });
          placed.push(basename(file));
        } catch {
          // 单个文件失败不影响其余，也不影响工具本身的返回值。
        }
      }
      return placed.length ? `已将 ${placed.join("、")} 放到画布上。` : "";
    }

    async function execute(request: z.infer<typeof processSchema>, signal?: AbortSignal) {
      const ffmpeg = await context.ffmpeg(signal);
      let details: unknown;
      let error: Error | undefined;
      let filenames: unknown;
      // ACT: 复用节点已有的 JSON 调用桥接，不在工具层重写参数、输出位置或原生执行规则。
      await executeRemoteFfmpeg(ffmpeg, {
        directory: context.cwd,
        requestId: crypto.randomUUID(),
        options: request.options ?? {},
        calls: request.steps,
        operation: request.operation,
      }, event => {
        if (event.event === "error") {
          const failure = event.args[0] as { message?: string };
          error = Object.assign(new Error(failure.message ?? "FFmpeg 执行失败"), failure);
        } else if (event.event === "result") details = event.args[0];
        else if (event.event === "filenames") filenames = event.args[0];
        else if (event.event === "end") details = { stdout: event.args[0], stderr: event.args[1], ...(filenames ? { filenames } : {}) };
      }, signal ?? new AbortController().signal);
      signal?.throwIfAborted();
      if (error) throw error;
      const produced = Array.isArray(filenames) ? filenames.filter((item): item is string => typeof item === "string") : [];
      const placed = produced.length ? await placeVideoOnCanvas(produced) : "";
      const payload = placed && details && typeof details === "object" ? { ...details, canvas: placed } : details;
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], details: payload };
    }

    return [{
      name: "ffprobe",
      label: "查询媒体信息",
      description: "使用本机 FFprobe 读取工作区媒体的格式、时长、尺寸、帧率和音轨等信息，支持原生探测选项。",
      parameters: z.toJSONSchema(probeSchema, { io: "input", target: "draft-07" }),
      execute(_id, params, signal) {
        const { path, options } = probeSchema.parse(params);
        return execute({ steps: [{ method: "input", args: [path] }], operation: { method: "ffprobe", args: options ? [options] : [] } }, signal);
      },
    }, {
      name: "ffmpeg",
      label: "处理媒体",
      description: "通过宿主 fluent-ffmpeg 处理工作区媒体。steps 原样传入链式方法及 args，支持全部宿主配置方法和别名、原始 inputOptions/outputOptions、复杂滤镜、多输入、多输出、文件序列及分片。operation 默认 run，也支持 save、screenshots、concat 和能力查询。不自动重命名输出、不限制执行时长；输出目录需已存在，文件覆盖遵循原生规则。**产出的视频文件会自动放到画布上，不要再用画布工具重复添加。**",
      promptSnippet: "使用 ffmpeg 处理本地媒体，ffprobe 查询媒体信息；按用户要求选择输出位置。",
      promptGuidelines: [
        '截帧示例：{"steps":[{"method":"input","args":["assets/input.mp4"]},{"method":"seekInput","args":[1]},{"method":"frames","args":[1]},{"method":"output","args":["assets/frame.png"]}]}。',
        'inputOptions/outputOptions 按 fluent 原生语法传参，不额外拆分空格。含空格的元数据使用 args:["-metadata","title=a b"]，不要再嵌套数组。先用 operation={"method":"availableEncoders","args":[]} 等查询实际能力，不猜测本机编码器。',
        "除非用户要求覆盖，否则使用新文件名；所有显式路径及参数、滤镜和媒体清单中引用的文件都应位于当前工作区。",
        "产出的视频会由工具自动创建视频节点并放到画布上，返回值里的 canvas 字段说明已放置的文件；不要自己再造视频节点或连线。",
      ],
      parameters: z.toJSONSchema(processSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      execute(_id, params, signal) {
        return execute(processSchema.parse(params), signal);
      },
    }];
  },
};

export default plugin;
