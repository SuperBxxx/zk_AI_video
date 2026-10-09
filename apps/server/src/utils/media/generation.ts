import { t, translateMessage } from "@/lib/i18n";
import { mkdir, readFile, realpath, stat, unlink } from "@toonflow/file";
import { join, relative } from "node:path";
import { mediaProviders, type Provider } from "@toonflow/providers";
import type { GeneratedMedia, MediaGenerationRequest, MediaModel, MediaReference, TranscriptResult } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getMediaProvider, listMediaProviders, loadMediaProviderSource } from "@/utils/media/provider";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";

const maxMediaSize = 100 * 1024 * 1024;
const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a", "audio/opus": "opus", "audio/pcm": "pcm",
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageOptions(value: unknown, pattern: RegExp) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 64 && item === item.trim() && pattern.test(item)))] : undefined;
}

/**
 * 价格：可选字段，来自供应商适配文件（用户可安装 → 当不可信输入校验）。
 * ACT: 仓库里没有价格数据、也不替平台编价格 —— 有就如实展示给用户做选择依据，没有就不带这个字段。
 */
function priceOption(value: unknown): { amount: number; per: "second" | "video" | "count"; currency?: string; note?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { amount?: unknown; per?: unknown; currency?: unknown; note?: unknown };
  if (typeof candidate.amount !== "number" || !Number.isFinite(candidate.amount) || candidate.amount < 0) return undefined;
  if (candidate.per !== "second" && candidate.per !== "video" && candidate.per !== "count") return undefined;
  return {
    amount: candidate.amount,
    per: candidate.per,
    ...(typeof candidate.currency === "string" && candidate.currency.length <= 8 ? { currency: candidate.currency } : {}),
    ...(typeof candidate.note === "string" && candidate.note.length <= 200 ? { note: candidate.note } : {}),
  };
}

export async function listMediaModels(): Promise<MediaModel[]> {
  const installedProviders = await listMediaProviders();
  // ACT: 标出用户偏好，并把偏好项排在前面。
  //
  // 为什么必须标：Agent 生成图片/视频时靠 listMediaModels 挑模型（工具说明写着
  // "providerId 和 modelId 必须来自 listMediaModels"），而它此前**完全看不到**用户设的偏好
  // —— 于是照提示词里"优先 gpt-image 系列"去挑，用户设的偏好形同不存在。
  // 排前面是给"按列表顺序取"的消费方（节点默认值、界面下拉）也留一条一致的暗示。
  const settings = conf.get("settings", {}) as { preferredModels?: { scope?: string; providerId?: string; modelId?: string }[] };
  const preferred = Array.isArray(settings.preferredModels) ? settings.preferredModels : [];
  // scope 与模型 type 的对应：文本模型不在这里（listMediaModels 只列 image/video/audio）。
  const preferredKeys = new Set(preferred
    .filter(item => item && typeof item.providerId === "string" && typeof item.modelId === "string")
    .map(item => `${item.scope}::${item.providerId}::${item.modelId}`));
  const isPreferred = (type: string, providerId: string, modelId: string) =>
    preferredKeys.has(`${type}::${providerId}::${modelId}`);

  const models = installedProviders.flatMap(provider => provider.models.flatMap(model => {
    if (model.type !== "image" && model.type !== "video" && model.type !== "audio") return [];
    const builtIn = (mediaProviders as readonly Provider[]).find(item => item.id === provider.id)?.models.find(item => item.id === model.id);
    const price = priceOption(model.price);
    return [{
      providerId: provider.id, providerLabel: provider.label, modelId: model.id, label: model.label, type: model.type,
      mode: model.mode, durationResolutionMap: model.durationResolutionMap, audio: model.audio,
      ...(price ? { price } : {}),
      ...(model.type === "audio" ? { voices: model.voices } : {}),
      ...(model.type === "image" ? {
        imageSizes: imageOptions(Array.isArray(model.imageSizes) ? model.imageSizes : builtIn?.imageSizes, /^[^\u0000-\u001f\u007f]+$/),
        imageRatios: imageOptions(Array.isArray(model.imageRatios) ? model.imageRatios : builtIn?.imageRatios, /^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      } : {}),
      ...(isPreferred(model.type, provider.id, model.id) ? { preferred: true } : {}),
    } as MediaModel];
  }));
  // 稳定排序：偏好项在前，其余保持原有顺序。
  return [...models.filter(model => model.preferred), ...models.filter(model => !model.preferred)];
}

function detectMimeType(bytes: Uint8Array, fallback: string) {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 16));
  const text = header.toString("ascii");
  const mimeType = fallback.split(";")[0].trim().toLowerCase();
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(text)) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE") return "audio/wav";
  if (text.startsWith("fLaC")) return "audio/flac";
  if (text.startsWith("OggS")) return mimeType.startsWith("video/") ? "video/ogg" : mimeType === "audio/opus" ? "audio/opus" : "audio/ogg";
  if (header[0] === 0xff && (header[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (text.startsWith("ID3") || (header[0] === 0xff && (header[1]! & 0xe0) === 0xe0 && (header[1]! & 0x06) !== 0)) return "audio/mpeg";
  if (text.slice(4, 8) === "ftyp") {
    if (/avif|avis/.test(text.slice(8))) return "image/avif";
    if (/^M4[AB] $/.test(text.slice(8, 12)) || mimeType.startsWith("audio/")) return "audio/mp4";
    return text.slice(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (header.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return mimeType.startsWith("audio/") ? "audio/webm" : "video/webm";
  return ({ "image/jpg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-flac": "audio/flac" } as Record<string, string>)[mimeType] ?? mimeType;
}

export async function readReference(cwd: string, reference: MediaReference, mediaType: string, signal?: AbortSignal): Promise<Extract<MediaInput, { type: "base64" }>> {
  signal?.throwIfAborted();
  const { path } = await resolveWorkspacePath(cwd, reference.path);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxMediaSize) invalid("参考媒体须为不超过 100 MB 的文件");
  const bytes = await readFile(path, { signal });
  if (!bytes.length || bytes.length > maxMediaSize) invalid("参考媒体为空或超过 100 MB");
  const mimeType = detectMimeType(bytes, reference.mimeType);
  if (!mimeType.startsWith(`${mediaType}/`)) invalid(t`参考媒体类型须为 ${mediaType}`);
  return { type: "base64", data: bytes.toString("base64"), mimeType };
}

async function downloadAsset(url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) invalid("生成结果必须使用 HTTP 或 HTTPS 地址");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(t`下载生成结果失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > maxMediaSize) {
    await response.body?.cancel();
    invalid("生成文件不能超过 100 MB");
  }
  const reader = response.body?.getReader();
  if (!reader) invalid("生成结果为空");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxMediaSize) invalid("生成文件不能超过 100 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { bytes: Buffer.concat(chunks, size), mimeType: response.headers.get("content-type") ?? "" };
}

async function assetBytes(asset: MediaAsset, mediaType: "image" | "video" | "audio", signal?: AbortSignal) {
  if (!asset || asset.mediaType !== mediaType) invalid("供应商返回的媒体类型不正确");
  let bytes: Uint8Array;
  let mimeType = asset.mimeType ?? "";
  if (asset.type === "url") {
    const result = await downloadAsset(asset.url, signal);
    bytes = result.bytes;
    mimeType = result.mimeType || mimeType;
  } else if (asset.type === "base64") {
    const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(asset.data);
    const content = (data?.[2] ?? asset.data).replace(/\s/g, "");
    if (content.length > Math.ceil(maxMediaSize / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) invalid("生成结果的 base64 内容无效或超过 100 MB");
    bytes = Buffer.from(content, "base64");
    mimeType = data?.[1] ?? mimeType;
  } else if (asset.type === "binary" && ArrayBuffer.isView(asset.data) && asset.data.BYTES_PER_ELEMENT === 1) {
    bytes = asset.data;
  } else { return invalid("供应商返回了无效的媒体结果"); }
  if (!bytes.byteLength || bytes.byteLength > maxMediaSize) invalid("生成文件为空或超过 100 MB");
  mimeType = detectMimeType(bytes, mimeType);
  if (!mimeType.startsWith(`${mediaType}/`) || !mediaExtensions[mimeType]) invalid("生成结果不是支持的图片、视频或音频格式");
  return { bytes, mimeType };
}

// ACT: 把「加载供应商 + 校验 API Key」抽出来，供生成、音色创建与转写共用。
// 与下面 resolveMediaProvider 的关系：转写不需要 modelId（转写的模型由供应商内定，
// 因为同平台不同 ASR 模型对时间戳的支持并不一致），所以它只用这一层。
async function loadConfiguredProvider(providerId: string, signal?: AbortSignal, cwd?: string) {
  const providerInfo = await getMediaProvider(providerId);
  const configurations = record(conf.get("settings", {}).mediaProviderConfigs);
  const provider = await loadMediaProviderSource(providerInfo.source, record(configurations[providerInfo.id]), signal, undefined, cwd);
  const rules = Array.isArray(provider.rules) ? provider.rules : [];
  if (rules.some(rule => rule.field === "apiKey") && (typeof provider.config.apiKey !== "string" || !provider.config.apiKey.trim())) invalid("请先在媒体模型设置中配置供应商 API Key");
  return { provider, providerInfo };
}

// ACT: 把「解析供应商 + 校验模型 + 校验 API Key」抽出来，供生成与音色创建共用。
// 原先这段内联在 generateMedia 里，新增音色接口若复制一份就会有两处需要同步维护。
export async function resolveMediaProvider(
  providerId: string,
  modelId: string,
  modelType: "image" | "video" | "audio",
  signal?: AbortSignal,
  // 供应商源码在需要读工作区文件时用得上；音色创建不需要，故可选。
  cwd?: string,
) {
  const providerInfo = await getMediaProvider(providerId);
  const model = providerInfo.models.find(item => item.id === modelId && item.type === modelType);
  if (!model) invalid("所选媒体模型不存在或类型不匹配，请重新选择");
  const { provider } = await loadConfiguredProvider(providerId, signal, cwd);
  return { provider, model };
}

export async function generateMedia(
  cwd: string,
  mediaType: "image" | "video" | "audio",
  request: MediaGenerationRequest,
  signal?: AbortSignal,
): Promise<GeneratedMedia[]> {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) invalid("请输入生成提示词");
  const directory = await realpath(cwd);
  const outputDirectory = request.outputDirectory ?? "assets/generated";
  await resolveWorkspacePath(directory, outputDirectory, true);
  const { provider } = await resolveMediaProvider(request.providerId, request.modelId, mediaType, signal, directory);
  const generate = mediaType === "image" ? provider.generateImage : mediaType === "video" ? provider.generateVideo : provider.generateAudio;
  if (typeof generate !== "function") invalid(t`此供应商不支持${translateMessage({ image: "图片", video: "视频", audio: "音频" }[mediaType])}生成`);
  const references = async (items: MediaReference[] | undefined, type: string) => items ? Promise.all(items.map(item => readReference(directory, item, type, signal))) : undefined;
  const images = await references(request.images, "image");
  signal?.throwIfAborted();
  const assets = mediaType === "audio"
    ? await provider.generateAudio!({
      model: request.modelId, text: request.prompt, audios: await references(request.audios, "audio"),
      voice: request.voice, speed: request.speed, volume: request.volume, format: request.format, sampleRate: request.sampleRate,
    })
    : mediaType === "image"
    ? await provider.generateImage!({ model: request.modelId, prompt: request.prompt, images, ratio: request.ratio, size: request.size })
    : await provider.generateVideo!({
      model: request.modelId, prompt: request.prompt, images,
      videos: await references(request.videos, "video"), audios: await references(request.audios, "audio"),
      firstFrame: request.firstFrame ? await readReference(directory, request.firstFrame, "image", signal) : undefined,
      lastFrame: request.lastFrame ? await readReference(directory, request.lastFrame, "image", signal) : undefined,
      ratio: request.ratio, resolution: request.resolution, duration: request.duration,
      generateAudio: request.generateAudio, mode: request.mode,
    });
  if (!Array.isArray(assets) || !assets.length) invalid("供应商未返回生成结果");
  const written: string[] = [];
  const result: GeneratedMedia[] = [];
  try {
    for (const asset of assets) {
      signal?.throwIfAborted();
      const { bytes, mimeType } = await assetBytes(asset, mediaType, signal);
      signal?.throwIfAborted();
      const output = await resolveWorkspacePath(directory, outputDirectory, true);
      const release = lockWorkspaceFiles([output.path]);
      try {
        await mkdir(output.path, { recursive: true });
        const file = join(outputDirectory, `${mediaType}${crypto.randomUUID()}.${mediaExtensions[mimeType]}`);
        const { path } = await resolveWorkspacePath(directory, file);
        signal?.throwIfAborted();
        await writeWorkspaceFile(path, bytes, true);
        written.push(path);
        result.push({ path: relative(directory, path).replace(/\\/g, "/"), mimeType, mediaType });
      } finally { release(); }
    }
    signal?.throwIfAborted();
    return result;
  } catch (err) {
    // ACT: 只回滚本次创建的文件，保留目录中已有的节点资源。
    await Promise.all(written.map(path => unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; })));
    throw err;
  }
}

// 创建音色（声音复刻 / 声音设计）。
// ACT: 样本以 MediaInput 传入而不是工作区路径 —— ProviderTools 没有读取工作区文件的
// 能力（只有 fetch / errorMessage / hash / image / audio.convert / ffmpeg），
// 因此调用方需自行准备字节（本产品的做法是前端读素材后转 base64 提交）。
export async function createMediaVoice(request: {
  providerId: string;
  modelId: string;
  name: string;
  sample?: MediaInput;
  description?: string;
  targetModel?: string;
  signal?: AbortSignal;
}): Promise<VoiceResult> {
  const { provider } = await resolveMediaProvider(request.providerId, request.modelId, "audio", request.signal);
  if (typeof provider.createVoice !== "function") invalid("此供应商不支持创建音色");
  const result = await provider.createVoice({
    model: request.modelId,
    name: request.name,
    sample: request.sample,
    description: request.description,
    targetModel: request.targetModel,
  });
  if (!result?.voice) invalid("供应商未返回音色标识");
  return result;
}

/**
 * 音频转写：把工作区里的音频送去转写，拿回带词级时间戳的结果。
 *
 * 为什么由服务端读文件：转写要提交音频字节，而字节可能到几十 MB，
 * 不适合让前端读出再随请求上传（音色创建那样做是因为样本限 30 秒）。
 * 这里直接用工作区内路径，路径校验与 realpath 交给 resolveWorkspacePath。
 *
 * ACT: 不传 modelId —— 转写的模型由供应商内定。同一平台的不同 ASR 模型对时间戳的
 * 支持并不一致（实测 qwen3-asr-flash 只返回纯文本、qwen-audio-3.0-asr-flash 才返回
 * 词级时间戳），把选择交给调用方会很容易选错。见 docs/creativeUpgradePlan.md P1a。
 */
export async function transcribeAudio(request: {
  providerId: string;
  directory: string;
  path: string;
  languageHints?: string[];
  signal?: AbortSignal;
}): Promise<TranscriptResult> {
  const { provider } = await loadConfiguredProvider(request.providerId, request.signal, request.directory);
  if (typeof provider.transcribe !== "function") invalid("此供应商不支持语音转写");

  const root = await realpath(request.directory);
  const { path } = await resolveWorkspacePath(root, request.path);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) invalid("找不到要转写的文件");

  // ACT: 视频先抽出 16kHz 单声道音轨再送转写 —— ASR 供应商要的是音频字节，
  // 直接送视频容器多数会被拒（MIME 不对），而"先自己抽音轨"比要求用户先转一道省事。
  // 抽出的临时 wav 用完即删，不留在工作区里。
  const head = await readFile(path).then(buffer => buffer.subarray(0, 4096));
  const mimeType = detectMimeType(head, "");
  let audioBytes: Uint8Array;
  let audioMimeType: string;
  if (mimeType.startsWith("audio/")) {
    if (info.size > maxMediaSize) invalid("音频超过 100 MB，请先裁剪或压缩");
    audioBytes = await readFile(path);
    audioMimeType = detectMimeType(audioBytes, "audio/wav");
  } else if (mimeType.startsWith("video/") || mimeType === "application/octet-stream") {
    const scratch = join(root, `.transcribe-${crypto.randomUUID().slice(0, 8)}.wav`);
    try {
      const ffmpeg = await createWorkspaceFfmpeg(root, request.signal);
      await new Promise<void>((done, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          request.signal?.removeEventListener("abort", onAbort);
          if (error) reject(error); else done();
        };
        const onAbort = () => { command.kill("SIGKILL"); finish(new Error("已取消")); };
        request.signal?.addEventListener("abort", onAbort, { once: true });
        const command = ffmpeg(relative(root, path))
          .withNoVideo()
          .audioFrequency(16000)
          .audioChannels(1)
          .audioCodec("pcm_s16le")
          .on("error", error => finish(error instanceof Error ? error : new Error(String(error))))
          .on("end", () => finish());
        command.save(relative(root, scratch));
      });
      audioBytes = await readFile(scratch);
      audioMimeType = "audio/wav";
    } catch (error) {
      invalid(`从视频里抽音轨失败：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      await unlink(scratch).catch(() => undefined);
    }
    if (!audioBytes.length) invalid("这个视频里没有可用的音轨");
    // 16kHz 单声道 PCM 约 32 KB/秒，超过上限说明素材太长：转写在长音频上也会很慢且容易超时。
    if (audioBytes.byteLength > maxMediaSize) invalid("音轨过长（超过 100 MB），请先裁剪到需要转写的片段");
  } else {
    invalid("转写只接受音频或视频文件");
    throw new Error("unreachable");
  }

  const result = await provider.transcribe({
    audio: { type: "binary", data: audioBytes, mimeType: audioMimeType },
    languageHints: request.languageHints,
  });
  if (!result?.sentences?.length) invalid("供应商未返回可用的时间戳");
  return result;
}
