// 从链接取流：yt-dlp 引导安装 + 下载到工作区 + 用 ffprobe 报告产物。
//
// ACT: 不随包内置 yt-dlp（官方 Windows exe 是 PyInstaller 产物，成品按 GPLv3+ 分发），
// 改为首次使用时按需下载并校验 sha256 后安装。安装位置与 ffmpeg 同级：数据目录下的 ytdlp/。
import { lstat, mkdir } from "@toonflow/file";
import { dirname, join, resolve } from "node:path";
import { installYtDlp, getToolStatus, isVideoUrl, runYtDlp, executableName, type YtDlpMode } from "@toonflow/ytDlp";
import conf from "@/utils/conf";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";

export function ytDlpDirectory() {
  return join(dirname(conf.path), "ytdlp");
}

function mode(): YtDlpMode {
  const raw = conf.get("settings", {}).ytdlp;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return value.mode === "download" || value.mode === "system" ? value.mode : "auto";
}

export async function getStatus() {
  const directory = ytDlpDirectory();
  const status = await getToolStatus(directory, mode());
  return { ...status, directory, platform: process.platform, arch: process.arch, executable: executableName };
}

/**
 * 确保有可用的 yt-dlp；缺失时按需安装（这就是「引导安装」）。
 */
export async function ensureTool(signal?: AbortSignal, report?: (line: string) => void) {
  const directory = ytDlpDirectory();
  const current = await getToolStatus(directory, mode());
  if (current.path && !current.error) return current.path;
  await mkdir(directory, { recursive: true });
  report?.("未检测到 yt-dlp，正在下载并校验…");
  const installed = await installYtDlp(directory, "ghProxy", signal ?? new AbortController().signal, state => {
    if (state.phase === "downloading" && state.total) {
      const percent = Math.floor((state.received / state.total) * 100);
      if (percent % 10 === 0) report?.(`正在下载 yt-dlp ${percent}%`);
    }
  });
  return installed;
}

export type FetchResult = { path: string; duration: number | null; width: number | null; height: number | null; hasAudio: boolean };

function sanitizeName(value: string) {
  const name = value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/^\.+/, "").slice(0, 120);
  if (!name) throw Object.assign(new Error("文件名不能为空"), { status: 400 });
  return name;
}

/**
 * 下载一个链接到工作区。
 *
 * @param directory 工作区绝对路径
 * @param url       视频页面链接
 * @param name      输出文件名（可带扩展名；默认按标题命名）
 * @param onLine    进度回调（yt-dlp 原始输出行）
 */
export async function fetchVideo(options: { directory: string; url: string; name?: string; signal?: AbortSignal; onLine?: (line: string) => void }) {
  const { directory, url, onLine } = options;
  if (!isVideoUrl(url)) throw Object.assign(new Error("请填写 http/https 开头的视频链接；本地文件请直接上传"), { status: 400 });

  const tool = await ensureTool(options.signal, onLine);
  const stem = options.name ? sanitizeName(options.name).replace(/\.[^.]+$/, "") : "%(title).80B [%(id)s]";
  // ACT: 输出模板固定为 .mp4 —— yt-dlp 需要合并音视频时用 ffmpeg 输出 mp4；
  // 单一格式其实也可能是 webm，但 mp4 是最通用、也是客户端能直接预览的目标。
  const target = join(directory, `${stem}.mp4`);

  const result = await runYtDlp(tool, {
    cwd: directory,
    signal: options.signal,
    onLine,
    args: [
      "--no-playlist",
      "--no-overwrites",
      // ACT: 偏好 1080p 附近的 h264（H.265 在桌面端 WebView2 里没有解码器，会「有声音没画面」）
      "-f", "bv*+ba/b",
      "-S", "res:1080,vcodec:h264",
      "--merge-output-format", "mp4",
      "-o", target,
      "--", url,
    ],
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).split(/\r?\n/).filter(Boolean).slice(-3).join("；");
    // ACT: 站点拒绝 yt-dlp 时（抖音的 detail 接口对 yt-dlp 直接 403，而同一接口在真实浏览器里
    // 是 200），错误信息要能让用户知道该换什么办法，而不是只看到一句英文报错。
    // 注意匹配词要宽：抖音**非 verbose** 输出里只有 "Fresh cookies (not necessarily logged in) are needed"，
    // "HTTP Error 403" 只在 --verbose 下才出现。
    if (/403|Forbidden|Fresh cookies/i.test(detail)) {
      throw Object.assign(new Error(
        "这个站点拒绝了自动下载（需要它的登录态或签名）。可以：① 在浏览器里打开该视频并用下载工具另存为文件，再上传到素材库；② 换其他站点的链接。",
      ), { status: 502, code: "SITE_BLOCKED" });
    }
    throw Object.assign(new Error(detail || "下载失败"), { status: 502, code: "YTDLP_FAILED" });
  }

  const saved = await findOutput(directory, stem);
  if (!saved) throw Object.assign(new Error("下载完成但找不到输出文件"), { status: 502 });

  const info = await probe(saved);
  return { path: saved, ...info } satisfies FetchResult;
}

/** yt-dlp 可能因标题清洗改变文件名，所以扫描同前缀的最新文件。 */
async function findOutput(directory: string, stem: string) {
  const literal = join(directory, `${stem}.mp4`);
  if (await lstat(literal).then(item => item.isFile()).catch(() => false)) return literal;
  const glob = new Bun.Glob(`${stem.replace(/[\\/]/g, "")}*.mp4`);
  const matches: string[] = [];
  for await (const item of glob.scan({ cwd: directory, onlyFiles: true })) matches.push(item);
  if (!matches.length) return null;
  matches.sort();
  return resolve(directory, matches.at(-1)!);
}

/** 用工作区里已有的 ffmpeg 报告产物属性（调用方负责展示给用户）。 */
async function probe(path: string) {
  const ffmpeg = await createWorkspaceFfmpeg(dirname(path));
  const data = await new Promise<{ streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } }>((done, reject) => {
    ffmpeg.ffprobe(path, (error, metadata) => error ? reject(error) : done(metadata as never));
  }).catch(() => undefined);
  const video = data?.streams?.find(stream => stream.codec_type === "video");
  return {
    duration: data?.format?.duration ? Number(data.format.duration) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(data?.streams?.some(stream => stream.codec_type === "audio")),
  };
}
