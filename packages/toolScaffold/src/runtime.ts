import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@form-create/element-ui";
import type { FfmpegFactory } from "@toonflow/ffmpeg/types";
import type { Stats } from "@toonflow/file";
import { z } from "zod";

export type { ToolDefinition } from "@earendil-works/pi-coding-agent";
export type { FfmpegFactory, FfmpegCommand, FfprobeData } from "@toonflow/ffmpeg/types";
// 转写结果的形状由 @toonflow/providers 的全局声明文件定义。types.d.ts 不是模块，
// 不能 from 导入、也不能在这里重新导出（它只是环境声明），
// 所以用三斜线引用把它带进本模块的类型空间，下面直接按同一份定义书写。
/// <reference path="../../providers/types.d.ts" />

/** 词级时间戳；单位毫秒，与多数平台的原始返回一致，避免来回换算丢精度。 */
export interface TranscriptWord {
  text: string;
  beginMs: number;
  endMs: number;
  /** 该词后紧跟的标点，用于切句；无则为空串。 */
  punctuation?: string;
}

export interface TranscriptSentence {
  text: string;
  beginMs: number;
  endMs: number;
  words: TranscriptWord[];
  /** 整段音频的时长（毫秒）。 */
  totalMs?: number;
}

export interface TranscriptResult {
  sentences: TranscriptSentence[];
  /** 供应商返回的原始文本，便于与原稿比对。 */
  text: string;
}

export const toolNameSchema = z.string().max(96).regex(/^[a-z][a-zA-Z0-9]*$/);
export const toolMetadataSchema = z.object({
  name: toolNameSchema,
  version: z.string().trim().min(1).max(100).default(""),
  displayName: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  prompt: z.string().max(20000).default(""),
  readme: z.string().max(200000).default(""),
  components: z.array(z.string().max(96).regex(/^[a-z][a-zA-Z0-9_]*$/)).max(100)
    .refine(names => new Set(names).size === names.length, "工具组件名称不能重复").default([]),
  author: z.string().max(100),
  github: z.string().refine(value => !value || (URL.canParse(value) && new URL(value).origin === "https://github.com" && !new URL(value).username && !new URL(value).password)),
  configRules: z.array(z.record(z.string(), z.json())).max(100),
});

export interface ToolMetadata {
  name: string;
  version?: string;
  displayName: string;
  description: string;
  prompt?: string;
  readme?: string;
  components?: string[];
  author: string;
  github: string;
  configRules: Rule[];
}

export interface NodeToolInfo {
  nodeId: string;
  name: `node:${string}`;
  nodeLabel?: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NodeToolCall {
  nodeId: string;
  name: `node:${string}`;
  args: Record<string, unknown>;
}

export interface NodeToolsContext {
  readonly tools: NodeToolInfo[];
  readonly version: number;
  list(nodeIds: string[], names?: string[]): IterableIterator<NodeToolInfo>;
  call(request: NodeToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface CanvasToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface CanvasInfo {
  id: string;
  tools: NodeToolInfo[];
}

export interface CanvasContext extends CanvasInfo {
  getNodeLabel?(nodeId: string): string | undefined;
  call(request: CanvasToolCall, signal?: AbortSignal): Promise<unknown>;
}

export interface MediaModel {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  type: "image" | "video" | "audio";
  mode?: unknown;
  imageSizes?: string[];
  imageRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  audio?: boolean | "optional";
  voices?: { title: string; voice: string }[];
  /**
   * 价格（可选）。来自供应商适配文件；**仓库里没有内置价格数据**，
   * 没有这个字段就是「未提供」—— 不要替平台推算或编造。
   */
  price?: { amount: number; per: "second" | "video" | "count"; currency?: string; note?: string };
  /**
   * 用户是否把该模型设为了这个类型的首选（「设置 → 模型 → 优先选择模型」）。
   *
   * ACT: 由服务端在 `listMediaModels` 里标注 —— Agent 靠这个列表挑生成用的模型，
   * 不标它就看不到用户偏好，只能照提示词里的通用建议挑（"优先 gpt-image 系列"），
   * 于是设置里的偏好形同不存在。**用户明确指定模型时仍然优先于本字段。**
   */
  preferred?: boolean;
}

export interface MediaReference {
  path: string;
  mimeType: string;
}

export interface MediaGenerationRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  outputDirectory?: string;
  images?: MediaReference[];
  videos?: MediaReference[];
  audios?: MediaReference[];
  firstFrame?: MediaReference;
  lastFrame?: MediaReference;
  ratio?: string;
  size?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  voice?: string;
  speed?: number;
  volume?: number;
  format?: string;
  sampleRate?: number;
  mode?: "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text"
    | (`${"image" | "video" | "audio"}Reference:${number}`)[];
}

export interface GeneratedMedia {
  path: string;
  mimeType: string;
  mediaType: "image" | "video" | "audio";
}

export interface MediaContext {
  listModels(): Promise<MediaModel[]>;
  generateImage(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateVideo(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
  generateAudio(request: MediaGenerationRequest, signal?: AbortSignal): Promise<GeneratedMedia[]>;
}

export interface QuestionField {
  field: string;
  title: string;
  type: "input" | "textarea" | "radio" | "checkbox" | "select" | "inputNumber" | "switch";
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface QuestionRequest {
  title: string;
  question: string;
  options?: string[];
  fields?: QuestionField[];
}

export interface QuestionAnswer {
  answer: string;
  values?: Record<string, string | number | boolean | string[]>;
  skipped?: boolean;
}

export type ToolCall = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "success" | "error" | "interrupted";
  result?: string;
  question?: QuestionRequest & { callId: string };
};

export interface QuestionContext {
  ask(toolCallId: string, request: QuestionRequest, signal?: AbortSignal): Promise<QuestionAnswer>;
}

export type SkillScope = "workspace" | "global";
export type SkillLocation = { name: string; scope?: SkillScope; path?: string };
export type SkillDocument = { name: string; scope: SkillScope; path: string; content: string };

export interface SkillContext {
  list(scope?: SkillScope): { name: string; description: string; scope: SkillScope; filePath: string; disableModelInvocation: boolean }[];
  read(request: SkillLocation, signal?: AbortSignal): Promise<SkillDocument>;
  create(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
  update(request: SkillLocation & { content: string }, signal?: AbortSignal): Promise<Omit<SkillDocument, "content">>;
}

/**
 * 全局素材库的只读视图 + 一个受控的导入动作。
 * path 均为素材库内相对路径；宿主负责越界校验，工具不要自行拼接绝对路径。
 */
export interface ToolAssets {
  readdir(path?: string): Promise<{ name: string; path: string; type: "file" | "directory"; size?: number }[]>;
  /** 把素材库中的文件复制进工作区，返回工作区相对路径（画布节点需要的是这个）。 */
  importToWorkspace(path: string, targetDirectory?: string): Promise<string>;
}

export interface ToolFiles {
  readFile(path: string, readOnly?: boolean): Promise<Buffer>;
  access(path: string, readOnly?: boolean): Promise<void>;
  stat(path: string, readOnly?: boolean): Promise<Stats>;
  readdir(path: string, readOnly?: boolean): Promise<string[]>;
  detectImageMimeType(path: string, readOnly?: boolean): Promise<string | null>;
  writeFile(path: string, content: string | Uint8Array, exclusive?: boolean): Promise<void>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  copyFile(path: string, target: string, exclusive?: boolean): Promise<void>;
}

export interface ToolContext {
  ffmpeg(signal?: AbortSignal): Promise<FfmpegFactory>;
  /**
   * 卡渲染服务。
   *
   * 与 `ffmpeg` 同一个道理：**重活由宿主做，工具侧只传参数**。
   * HTML 卡要起无头浏览器逐帧截图再编码，这事不适合放在自包含的工具产物里
   * （要管子进程、临时目录、浏览器 profile）。所以由 server 侧实现并通过这里注入。
   *
   * 缺省表示当前环境没有卡渲染能力（例如只跑工具的裸环境），工具要给出明确提示，
   * 不要假装渲染成功。
   */
  cardRender?(signal?: AbortSignal): CardRenderContext;
  media?: MediaContext;
  canvas?: CanvasContext;
  question?: QuestionContext;
  skills?: SkillContext;
  /**
   * 全局素材库（工作区之外的 {数据目录}/assets）。缺省表示当前环境没有素材库。
   * ACT: 只给两个窄接口，不复用 ToolFiles —— 素材库的写操作由宿主代为完成
   * （见 importToWorkspace），工具拿不到任意路径的写权限。
   */
  assets?: ToolAssets;
  cwd: string;
  config: Record<string, unknown>;
  files: ToolFiles;
  resolvePath(path: string, readOnly?: boolean): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  sdk: Pick<typeof import("@earendil-works/pi-coding-agent"),
    "defineTool" | "createReadToolDefinition" | "createWriteToolDefinition" |
    "createEditToolDefinition" | "createLsToolDefinition" | "detectSupportedImageMimeTypeFromFile">;
}

/**
 * 卡渲染的宿主服务。
 *
 * 只给一个方法：把一张 HTML 卡渲成视频（有 `targetVideo` 时顺带叠到该视频上）。
 * 路径都是**工作区内相对路径**，与其它工具一致 —— 宿主负责解析与边界校验。
 */
export interface CardRenderContext {
  render(request: {
    /** 卡的 slug。 */
    slug: string;
    /** 目标成片画幅（不是卡的默认画幅）。 */
    width: number;
    height: number;
    fps?: number;
    parameters?: Record<string, number>;
    /** 输出文件（工作区内相对路径）。 */
    output: string;
    /** 有值就走「渲染并叠到这段视频上」（工作区内相对路径）。 */
    targetVideo?: string;
  }, onProgress?: (event: { stage: string; frame?: number; total?: number; message?: string }) => void): Promise<{
    outputPath: string;
    slug: string;
    shape: string;
    width: number;
    height: number;
    fps: number;
    frames: number;
    durationSeconds: number;
    hasAlpha: boolean;
  }>;
}

export interface ToolPlugin {
  validateConfig(config: Record<string, unknown>): Record<string, unknown>;
  createTools(context: ToolContext): ToolDefinition[] | Promise<ToolDefinition[]>;
}
