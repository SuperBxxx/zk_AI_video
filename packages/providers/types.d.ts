/// <reference types="bun" />

type ModelType = "text" | "image" | "video" | "audio";

type ImageMode = "text" | "singleImage" | "multiReference";
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`${"video" | "image" | "audio"}Reference:${number}`)[];

interface ProviderModel {
  id: string;
  label: string;
  type: ModelType;
  think?: boolean;
  mode?: (ImageMode | VideoMode)[];
  associationSkills?: string;
  audio?: "optional" | boolean;
  imageSizes?: string[];
  imageRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  voices?: { title: string; voice: string }[];
  /**
   * 价格（**可选，由供应商适配文件或用户自己填**）。
   *
   * ACT: 仓库里没有任何价格数据，也不能替平台编价格 —— 所以做成本字段：
   * 填了就如实展示给用户做选择依据，没填就显示「未提供」，不猜。
   * 单位用 `currency` 声明，避免不同平台币种混淆（如 "CNY" / "USD"）。
   */
  price?: { amount: number; per: "second" | "video" | "count"; currency?: string; note?: string };
}

interface ProviderFormRule {
  field: string;
  value: unknown;
}

type ProviderConfig<TRules extends readonly ProviderFormRule[]> = {
  [TRule in TRules[number] as TRule["field"]]: TRule["value"];
};

interface ProviderContext<TConfig = Record<string, unknown>> {
  config: TConfig;
  signal?: AbortSignal;
  /** 宿主直接注入工具，供应商无需 import；FFmpeg 为按需安装的插件能力。 */
  tool: ProviderTools;
}

interface MediaRequest {
  model: string;
  /** 仅放供应商专属参数；公共字段的映射与支持范围由供应商校验。 */
  other?: Record<string, unknown>;
}

/** 抽象层的媒体来源；供应商负责转换为平台需要的 URL、文件或字节。 */
type MediaInput =
  | { type: "url"; url: string; mimeType?: string }
  | { type: "base64"; data: string; mimeType: string }
  | { type: "binary"; data: Uint8Array; mimeType: string };

type MediaAsset = MediaInput & { mediaType: "image" | "video" | "audio" };

interface AudioConvertOptions {
  format: "wav" | "mp3";
  /** 裁剪起点，单位秒，含边界；缺省为 0。 */
  startSeconds?: number;
  /** 裁剪终点，单位秒，不含边界；缺省为音频末尾。 */
  endSeconds?: number;
  /** 目标采样率；缺省保持原采样率。 */
  sampleRate?: number;
  /** mp3 比特率，单位 kbps；缺省 128，仅 format 为 mp3 时生效。 */
  bitrateKbps?: number;
}

/** 缺少可用 FFmpeg 时抛出；由宿主前端询问下载安装，供应商应继续向上抛出。 */
interface FfmpegRequiredError extends Error {
  name: "FfmpegRequiredError";
  code: "FFMPEG_REQUIRED";
  status: 424;
}

interface ProviderTools {
  fetch: typeof globalThis.fetch;
  /** 提取供应商错误正文中的可读原因，并隐藏配置中的密钥和 URL 查询参数。 */
  errorMessage(value: unknown): string;
  hash: typeof Bun.hash;
  image: typeof Bun.Image;
  /**
   * 音频裁剪转码；仅接受 WAV 格式的内存字节并返回处理后的内存字节，不支持文件路径、URL 或其他压缩格式输入。
   */
  audio: {
    convert(input: Uint8Array, options: AudioConvertOptions): Promise<{ data: Uint8Array; mimeType: string }>;
  };
  /**
   * 获取绑定当前工作区的原生 @renmu/fluent-ffmpeg 工厂，沿用链式调用、事件、流和 ffprobe 回调。
   * 仅显式文件路径经过工作区边界检查；原始参数、滤镜及清单中的间接 I/O 不是沙箱。
   * 宿主始终注入此入口，调用时检查 FFmpeg/FFprobe；没有工作目录的调试上下文不能使用。
   * 缺失时抛出 FfmpegRequiredError，并通知在线前端询问下载；不会后台自动安装。
   * 安装后由用户重新发起操作，供应商不要捕获此错误后自动重试完整生成请求。
   * 输出覆盖行为沿用原生库；调用方负责文件命名、处理 end/error 及通过 command.kill 取消运行。
   * @throws {FfmpegRequiredError} 未安装或当前设置未找到可用的 FFmpeg。
   * @example const ffmpeg = await this.tool.ffmpeg(); const command = ffmpeg("assets/input.mp4").videoCodec("libx264");
   */
  ffmpeg(): Promise<import("@toonflow/ffmpeg/types").FfmpegFactory>;
}

interface ImageRequest extends MediaRequest {
  prompt: string;
  /** 参考图。 */
  images?: MediaInput[];
  mask?: MediaInput;
  /** 生成数量。 */
  n?: number;
  /** 画面宽高比，如 16:9。 */
  ratio?: string;
  /** 输出尺寸，如 1K、2K、4K 或 1024x1024；具体格式由供应商转换。 */
  size?: string;
  /** 画质档位，如 low、medium、high，由供应商映射。 */
  quality?: string;
  /** 输出编码格式，如 png、jpeg、webp。 */
  outputFormat?: string;
}

interface VideoRequest extends MediaRequest {
  prompt: string;
  /** 当前生成模式；参考模式数组声明各类参考媒体数量上限。 */
  mode?: VideoMode;
  /** 参考图；首尾帧通过 firstFrame、lastFrame 单独传入。 */
  images?: MediaInput[];
  videos?: MediaInput[];
  audios?: MediaInput[];
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  /** 输出时长，单位秒；支持范围由供应商按模型校验。 */
  duration?: number;
  /** 画面宽高比，如 16:9。 */
  ratio?: string;
  /** 分辨率档位，如 720p、1080p。 */
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
}

interface AudioRequest extends MediaRequest {
  text: string;
  audios?: MediaInput[];
  /** 音色标识，由供应商映射到平台的音色参数。 */
  voice?: string;
  /** 语速倍率，1 为正常语速。 */
  speed?: number;
  /** 音量增益，单位 dB，0 为原始音量。 */
  volume?: number;
  /** 输出编码格式，如 mp3、wav、pcm。 */
  format?: string;
  /** 输出采样率，单位 Hz。 */
  sampleRate?: number;
}

/**
 * 三种生成函数统一返回最终媒体数组，不能返回任务 ID 或原始平台响应。
 * ACT: 本层只约定完整结果；供应商内部处理轮询/流读取，失败时抛出异常。
 */
type GenerateMedia<TRequest, TConfig = Record<string, unknown>> = (
  this: ProviderContext<TConfig>,
  request: TRequest,
) => Promise<MediaAsset[]>;

interface ProviderUpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  notice: string;
}

interface ProviderDefinition<TRules extends readonly ProviderFormRule[] = readonly ProviderFormRule[]> {
  id: string;
  label: string;
  /** 适配文件版本，独立于模型版本；新增供应商应填写，缺省仅兼容旧文件。 */
  version?: string;
  apiUrl?: string;
  /**
   * 媒体模型列表 GET 地址，使用配置的 apiKey 作为 Bearer 凭据，返回 { data: 模型数组 }。
   * 模型须含 id，type 可由 URL 的 type 参数或同名已有模型补全。
   * 提供此字段后可手动获取；仅 TF-Router 在有 key 的程序启动时自动更新。
   */
  modelsUrl?: string;
  protocol?: "openai-completions" | "openai-responses" | "anthropic-messages";
  /** 厂商说明的 Markdown 内容。 */
  readme?: string;
  rules: TRules;
  models: ProviderModel[];
  /** 检查供应商适配文件是否有更新。 */
  checkForUpdates?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<ProviderUpdateInfo>;
  /** 获取更新文件的完整源码；写入与应用由宿主负责。 */
  updateVendor?: (this: ProviderContext<ProviderConfig<TRules>>) => Promise<string>;
  /** 未实现的方法保持缺省，调用方据此判断能力是否可用。 */
  generateImage?: GenerateMedia<ImageRequest, ProviderConfig<TRules>>;
  generateVideo?: GenerateMedia<VideoRequest, ProviderConfig<TRules>>;
  generateAudio?: GenerateMedia<AudioRequest, ProviderConfig<TRules>>;
  /**
   * 创建音色（声音复刻 / 声音设计），返回可供后续合成使用的音色标识。
   * 与 generate* 并列；未实现的供应商保持缺省，调用方据此判断能力是否可用。
   * 样本以 MediaInput 传入：宿主没有读工作区文件的能力，样本字节由调用方准备。
   */
  createVoice?: (this: ProviderContext<ProviderConfig<TRules>>, request: CreateVoiceRequest) => Promise<VoiceResult>;
  /**
   * 语音转写并返回带时间戳的词表，用于生成对齐字幕。
   * 与 generate* 并列；未实现的供应商保持缺省。
   *
   * ACT: 不挂 models 条目、由供应商内定模型 —— 同一平台的不同 ASR 模型对时间戳的
   * 支持并不一致（实测：某平台的 qwen3-asr-flash 只返回纯文本，
   * qwen-audio-3.0-asr-flash 才返回词级时间戳）。把选择交给调用方会很容易选错。
   * 样本以 MediaInput 传入，理由同 createVoice。
   */
  transcribe?: (this: ProviderContext<ProviderConfig<TRules>>, request: TranscribeRequest) => Promise<TranscriptResult>;
}

interface TranscribeRequest {
  /** 音频样本；建议先转成 wav（部分平台只接受特定容器）。 */
  audio: MediaInput;
  /** 语言提示，例如 ["zh", "en"]。 */
  languageHints?: string[];
  /** 覆盖供应商内定的模型。 */
  model?: string;
  /** 仅放供应商专属参数。 */
  other?: Record<string, unknown>;
}

/** 词级时间戳，单位毫秒（与多数平台的原始返回一致，避免来回换算丢精度）。 */
interface TranscriptWord {
  text: string;
  beginMs: number;
  endMs: number;
  /** 该词后紧跟的标点，用于切句；无则为空串。 */
  punctuation?: string;
}

interface TranscriptSentence {
  text: string;
  beginMs: number;
  endMs: number;
  words: TranscriptWord[];
  /** 整段音频的时长（毫秒），供调用方换算。 */
  totalMs?: number;
}

interface TranscriptResult {
  sentences: TranscriptSentence[];
  /** 供应商返回的原始文本，便于与原稿比对。 */
  text: string;
}

interface CreateVoiceRequest {
  model: string;
  /** 音色展示名；供应商按自己的命名规则映射（部分平台只允许字母数字且长度有限）。 */
  name: string;
  /** 声音复刻的样本音频。声音设计不需要样本。 */
  sample?: MediaInput;
  /** 声音设计的文字描述，例如「温暖的低音女声」。声音复刻不需要。 */
  description?: string;
  /** 后续用于合成的模型；部分平台要求与创建音色时声明的一致，否则合成失败。 */
  targetModel?: string;
  /** 仅放供应商专属参数。 */
  other?: Record<string, unknown>;
}

interface VoiceResult {
  /** 音色标识，用于后续合成的 voice 参数。 */
  voice: string;
  /** 供应商返回的展示名，可能与请求的 name 不同。 */
  label?: string;
}
