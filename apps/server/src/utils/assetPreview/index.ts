// 素材预览副本：把浏览器放不了的视频（典型是 HEVC）转成 H.264，供**预览**用。
//
// 为什么走"转码"而不是内置解码器：HEVC 是专利收费编码，随包分发解码器需要商业许可
// （微软的 HEVC 视频扩展在商店卖 $0.99，就是替用户付这笔钱）。
// 而我们自己的 ffmpeg 带 hevc 解码器，转码属于"我处理素材"，不是"我分发 HEVC 播放能力"。
//
// 实测：微信导出的 12.9s / 544×960 HEVC，转码 0.7 秒。
// 原始素材**不动**，副本单独放在数据目录的 assetPreviews/ 下，按"路径 + 修改时间"缓存。
import { createHash } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Response } from "express";
import conf from "@/utils/conf";
import { getAssetsDirectory } from "@/utils/assets";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";

/**
 * 预览副本目录：**素材库内部的隐藏目录**。
 *
 * ACT: 必须放在素材库里面 —— `createFfmpeg(cwd)` 把工作区钉在传入目录上，
 * 输入输出都必须是它的子孙；写到外面会被 `assertWithin` 拦成 403「只能操作当前工作区内的文件」（踩过）。
 * 用点号开头：前端素材库列表本就过滤隐藏项，用户看不到这个目录。
 */
export async function previewRoot() {
  return resolve(await getAssetsDirectory(), ".previews");
}

/**
 * 把绝对路径转成前端用的 **key**（相对数据目录，正斜杠）。
 * ACT: 不把服务器绝对路径给前端；读取接口再据此还原。
 */
export function previewKey(path: string) {
  const root = dirname(conf.path);
  return relative(root, path).split(sep).join("/");
}

/**
 * 还原 key → 绝对路径，并**限定只允许**落在素材库或预览副本目录内。
 * ACT: key 来自前端，必须当不可信输入校验 —— 否则就是任意文件读取。
 */
export function resolvePreviewKey(key: string) {
  const root = resolve(dirname(conf.path));
  const target = resolve(root, key);
  const allowed = resolve(root, "assets");
  if (!(target === allowed || target.startsWith(allowed + sep))) {
    throw Object.assign(new Error("预览路径不在允许的目录内"), { status: 403 });
  }
  return target;
}

/**
 * 副本文件名：路径 + mtimeMs + size。
 * 原文件变了（或换了同名文件）哈希就变，不会读到旧副本；旧副本不影响正确性，只是占空间。
 */
function previewName(path: string, info: { mtimeMs: number; size: number }) {
  const hash = createHash("sha1").update(`${path}\0${info.mtimeMs}\0${info.size}`).digest("hex").slice(0, 16);
  const base = path.split(/[\\/]/).pop() ?? "video";
  return `${hash}-${base.replace(/\.[^.]+$/, "")}.mp4`;
}

export type AssetPreviewResult = {
  /** 适配浏览器播放的副本路径。已经是浏览器友好格式时就是原文件。 */
  path: string;
  /** 是否为原文件（= 不需要转码）。 */
  original: boolean;
  /** 转码耗时（毫秒）；未转码时为 0。 */
  elapsedMs: number;
};

/**
 * 供**生成流程**用的一次性转码：把一个工作区视频转成 H.264，返回**工作区相对路径**。
 *
 * ACT: 与预览副本分开 —— 预览副本按原文件缓存、只放素材库；这里的目标是
 * "喂给模型/后续环节的素材必须能被通用解码"，而且素材通常在工作区里（不在素材库）。
 * ffmpeg 的工作区必须是**包含该文件的目录**（输出也要在同一工作区内，否则 assertWithin 会 403）。
 * 已经是 h264/vp8/vp9/av1 时**不转**，直接返回原相对路径（零成本）。
 */
export async function ensurePlayableWorkspaceVideo(workspaceDirectory: string, relativePath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const absolute = resolve(workspaceDirectory, relativePath);
  const info = await stat(absolute);
  if (!info.isFile()) throw Object.assign(new Error("只能处理文件"), { status: 400 });

  const root = dirname(absolute);
  const ffmpeg = await createWorkspaceFfmpeg(root, signal);
  const codec = await probeVideoCodec(ffmpeg, absolute);
  if (codec && !needsTranscode(codec)) return { path: relativePath, original: true, elapsedMs: 0 };

  // ACT: 返回的路径必须相对**工作区根**（调用方拿它当素材路径用）。
  // ffmpeg 的工作区是"文件所在目录"（见上），所以这里单独按 workspaceDirectory 折算。
  const toWorkspacePath = (absoluteCopy: string) => relative(resolve(workspaceDirectory), absoluteCopy).split(sep).join("/");

  const outputDirectory = join(root, ".previews");
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, previewName(absolute, info));
  const existing = await stat(output).catch(() => undefined);
  if (existing?.isFile() && existing.mtimeMs >= info.mtimeMs) {
    return { path: toWorkspacePath(output), original: false, elapsedMs: 0 };
  }

  const started = Date.now();
  await new Promise<void>((done, reject) => {
    const onAbort = () => reject(signal?.reason ?? new Error("已取消"));
    signal?.addEventListener("abort", onAbort, { once: true });
    ffmpeg(relative(root, absolute))
      .videoCodec("libx264")
      .outputOptions(["-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1"])
      .audioCodec("aac")
      .outputOptions(["-b:a", "160k"])
      .on("error", error => { signal?.removeEventListener("abort", onAbort); reject(error); })
      .on("end", () => { signal?.removeEventListener("abort", onAbort); done(); })
      .save(output);
  }).catch(async error => {
    await unlink(output).catch(() => {});
    throw error;
  });

  return { path: toWorkspacePath(output), original: false, elapsedMs: Date.now() - started };
}

/** 这个视频需不需要为预览转码：给 ffprobe 的编码名判断。 */
function needsTranscode(codecName: string) {
  // h264 / vp8 / vp9 / av1 浏览器都能解；其余（hevc / mpeg4 / prores / mpeg2 …）需要转。
  return !["h264", "vp8", "vp9", "av1"].includes(codecName);
}

/**
 * 探测视频编码。ffprobe 拿不到流信息时返回 undefined（交给转码路径兜底）。
 */
async function probeVideoCodec(ffmpeg: Awaited<ReturnType<typeof createWorkspaceFfmpeg>>, path: string) {
  const data = await new Promise<{ streams?: { codec_name?: string; codec_type?: string }[] }>((done, reject) => {
    ffmpeg.ffprobe(path, (error, metadata) => error ? reject(error) : done(metadata as never));
  }).catch(() => undefined);
  return data?.streams?.find(stream => stream.codec_type === "video")?.codec_name;
}

/**
 * 生成（或复用）一份浏览器可播放的预览副本。
 *
 * @param path 素材库里那个文件的**绝对路径**（调用方已经过工作区边界校验）
 */
export async function ensureAssetPreview(path: string, signal?: AbortSignal): Promise<AssetPreviewResult> {
  signal?.throwIfAborted();
  const info = await stat(path);
  if (!info.isFile()) throw Object.assign(new Error("只能预览文件"), { status: 400 });

  // ACT: ffmpeg 的工作目录必须是**素材库根**，输入输出都相对它。
  // 踩过两处：① 原先传 dirname(path)（素材库下的子目录），素材路径被判成"外面"→ 403；
  //          ② 副本原先写到素材库**外面**，同样被 `assertWithin` 拦成 403（见 previewRoot 注释）。
  const assetsRoot = await getAssetsDirectory();
  const ffmpeg = await createWorkspaceFfmpeg(assetsRoot, signal);
  const codec = await probeVideoCodec(ffmpeg, path);
  // 探测不到编码时不冒险：交给转码（转完仍能播就是对的，播不了还有前端的兜底提示）
  if (codec && !needsTranscode(codec)) return { path, original: true, elapsedMs: 0 };

  const directory = await previewRoot();
  await mkdir(directory, { recursive: true });
  const output = join(directory, previewName(path, info));
  // 副本已存在且比原文件新 → 直接用
  const existing = await stat(output).catch(() => undefined);
  if (existing?.isFile() && existing.mtimeMs >= info.mtimeMs) return { path: output, original: false, elapsedMs: 0 };

  const started = Date.now();
  // ACT: 输入用**相对名**（cwd 已是素材库根）—— 绝对 Windows 路径里的 `E:` 里的冒号
  // 有被 ffmpeg 当成流/滤镜分隔符的风险，相对名最省事。输出是绝对路径（在副本目录里）。
  const inputName = relative(assetsRoot, path);
  await new Promise<void>((done, reject) => {
    const onAbort = () => reject(signal?.reason ?? new Error("已取消"));
    signal?.addEventListener("abort", onAbort, { once: true });
    ffmpeg(inputName)
      // ACT: 只求"能看"：veryfast + crf 28，长边限到 1280（预览不需要原始分辨率）。
      // 不放大（`min(1280,iw)`），也不动帧率，避免长视频转码过久。
      .videoCodec("libx264")
      .outputOptions([
        "-preset", "veryfast",
        "-crf", "28",
        "-pix_fmt", "yuv420p",
        "-vf", "scale='min(1280,iw)':-2",
        "-movflags", "+faststart",
        "-map_metadata", "-1",
      ])
      .audioCodec("aac")
      .outputOptions(["-b:a", "128k"])
      .on("error", error => { signal?.removeEventListener("abort", onAbort); reject(error); })
      .on("end", () => { signal?.removeEventListener("abort", onAbort); done(); })
      .save(output);
  }).catch(async error => {
    // 失败时清掉半成品，免得下次被"已存在且更新"误用
    await unlink(output).catch(() => {});
    throw error;
  });

  return { path: output, original: false, elapsedMs: Date.now() - started };
}

/**
 * 把预览副本（或原文件）作为响应体发出去，供 <video> 播放。
 * 复用资产读取那套头部与 Range 支持 —— 视频没有 Range 就没法拖进度。
 */
export async function sendPreview(res: Response, path: string, options: { download?: boolean; name?: string } = {}) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw Object.assign(new Error("预览副本不存在"), { status: 404 });
  if (options.download && options.name) res.attachment(options.name);
  // ACT: 与 assets/read 一致：nosniff 要求 Content-Type 正确（sendFile 按扩展名给），
  // sandbox 避免浏览器把它当页面执行。
  res.set({ "Cache-Control": "no-store", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" });
  await new Promise<void>((done, reject) => {
    res.sendFile(path, { dotfiles: "allow" }, error => error ? reject(error) : done());
  });
}
