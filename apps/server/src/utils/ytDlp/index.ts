// 从链接取流：yt-dlp 引导安装 + 下载到工作区 + 用 ffprobe 报告产物。
//
// ACT: 不随包内置 yt-dlp（官方 Windows exe 是 PyInstaller 产物，成品按 GPLv3+ 分发），
// 改为首次使用时按需下载并校验 sha256 后安装。安装位置与 ffmpeg 同级：数据目录下的 ytdlp/。
import { lstat, mkdir, rm } from "@toonflow/file";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installYtDlp, getToolStatus, isVideoUrl, runYtDlp, executableName, downloadSources, version as toolVersion, type YtDlpMode } from "@toonflow/ytDlp";
import conf from "@/utils/conf";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { fetchDouyin, parseDouyinId } from "@/utils/douyin";

/** 抖音取流用的调试端口。避开卡渲染与其它功能常用的端口。 */
const douyinPort = 9334;

/** 是不是抖音链接（含 v.douyin.com 短链与分享文本）。 */
function isDouyinUrl(value: string) {
  return /(^|\.)douyin\.com\//i.test(value) || /(^|\.)iesdouyin\.com\//i.test(value);
}

export function ytDlpDirectory() {
  return join(dirname(conf.path), "ytdlp");
}

function mode(): YtDlpMode {
  const raw = conf.get("settings", {}).ytdlp;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return value.mode === "download" || value.mode === "system" ? value.mode : "auto";
}

/** 用户选定的下载源 id（未设置则 undefined，交由 ensureTool 依次尝试）。 */
function preferredSource(): string | undefined {
  const raw = conf.get("settings", {}).ytdlp;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return typeof value.source === "string" && value.source ? value.source : undefined;
}

export async function getStatus() {
  const directory = ytDlpDirectory();
  const status = await getToolStatus(directory, mode());
  // 面板要展示可选线路；available:false 的也会返回，由界面标注为不可选。
  return {
    ...status,
    directory, platform: process.platform, arch: process.arch, executable: executableName,
    sources: downloadSources,
    source: preferredSource() ?? downloadSources.find(source => source.available)?.id,
    version: toolVersion,
  };
}

/**
 * 确保有可用的 yt-dlp；缺失时按需安装（这就是「引导安装」）。
 */
export async function ensureTool(signal?: AbortSignal, report?: (line: string) => void) {
  const directory = ytDlpDirectory();
  const current = await getToolStatus(directory, mode());
  // ACT: 只要**程序在**就直接用 —— 不看 `error`。
  // `error` 现在表示"探测时跑不起来"（多为新落盘的 exe 正被杀软扫描这类环境抖动），
  // 不再是"没装"。若在这里因 error 触发重装，一个环境抖动就会变成
  // "重下 17 MB → 再探测 → 再重装"的循环。装没装看 path，能不能跑由使用者去暴露。
  if (current.path) {
    if (current.error) report?.(`yt-dlp 已安装，但探测时报错（仍将继续使用）：${current.error}`);
    return current.path;
  }
  await mkdir(directory, { recursive: true });
  report?.("未检测到 yt-dlp，正在下载并校验…");

  // ACT: **依次尝试多条线路**，而不是只打第一个。
  // 踩过：原先硬编码只用 ghProxy 一个源，那一条不通就把 Bun fetch 的原始错误
  // （"Unable to connect. Is the computer able to access the url?"）直接抛给用户 ——
  // 既看不出是哪一步失败，也不知道换个源就能成。
  // 顺序：用户选定的源优先，然后是源表里 available 的（国内可达的排在前面）。
  const chosen = preferredSource();
  const ordered = [
    ...downloadSources.filter(source => source.available && source.id === chosen),
    ...downloadSources.filter(source => source.available && source.id !== chosen),
  ];
  if (!ordered.length) throw new Error("没有可用的 yt-dlp 下载线路，请检查源表配置");

  const failures: string[] = [];
  // ACT: 每条线路单独限时 + 总体预算。
  // 踩过：不设限时的时候，一条连不上的线路会白等 ~83 秒（Windows 的文件占用超时），
  // 7 条就是 585 秒 —— 用户盯着一个必然失败的下载等十分钟，这比直接失败更糟。
  const perSourceMs = 90_000;
  const totalBudgetMs = 5 * 60_000;
  const startedAt = Date.now();
  for (const [index, source] of ordered.entries()) {
    signal?.throwIfAborted();
    if (Date.now() - startedAt > totalBudgetMs) {
      failures.push(`（已用满 ${Math.round(totalBudgetMs / 60_000)} 分钟总预算，剩下 ${ordered.length - index} 条线路未尝试）`);
      break;
    }
    report?.(`正在从「${source.label}」下载 yt-dlp（第 ${index + 1}/${ordered.length} 条线路）…`);
    try {
      return await installYtDlp(directory, source.id, signal ?? new AbortController().signal, state => {
        if (state.phase === "downloading" && state.total) {
          const percent = Math.floor((state.received / state.total) * 100);
          if (percent % 10 === 0) report?.(`正在下载 yt-dlp ${percent}%（${source.label}）`);
        }
      }, perSourceMs);
    } catch (error) {
      // 用户主动取消要立刻停下，不要当成"这个源不行"继续换源。
      signal?.throwIfAborted();
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${source.label}：${reason}`);
      report?.(`「${source.label}」失败（${reason}），换下一条线路…`);
    }
  }

  throw Object.assign(new Error(
    `所有 yt-dlp 下载线路都失败了。逐条结果：\n${failures.map(item => `  · ${item}`).join("\n")}\n` +
    "可以在「设置 → 取流工具」里换一条线路重试；仍不行时说明当前网络到这些镜像都不通。",
  ), { status: 502, code: "YTDLP_SOURCES_FAILED" });
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

  const stem = options.name ? sanitizeName(options.name).replace(/\.[^.]+$/, "") : undefined;

  // 抖音：yt-dlp 走不通（它的详情接口要签名，实测登录态也 403），所以走**尽力而为**的专用通道。
  // 它失败时**明确失败**，让用户退回"手动另存为再上传"，而不是把一个笼统报错丢给他。
  if (isDouyinUrl(url)) {
    const target = join(directory, `${stem ?? "%(title).80B [%(id)s]"}.mp4`.replace(/[<>:"|?*]/g, ""));
    // ACT: 临时浏览器的 profile 放在**系统临时目录**，不放数据目录。
    //
    // 为什么改：用户的机器上报 `Chrome 起不来（退出码 21）`，而 21 的含义正是
    // **"创建 profile 目录失败"**。原先这个目录在**安装目录**下
    // （`<安装目录>/data/ytdlp/douyin`）—— 那里恰恰是安全软件与目录 ACL 最常拦的地方，
    // 而 Chrome 建 profile 会大量创建子目录/文件，比我们自己 mkdir 一个目录的权限要求高得多。
    //
    // 这是一次性的游客会话（用完即删、不承载用户数据），放系统临时目录既更稳，也更符合它的性质。
    const profile = join(tmpdir(), `zhukai-douyin-${crypto.randomUUID().slice(0, 8)}`);
    try {
      const result = await fetchDouyin({ url, target, port: douyinPort, profileDirectory: profile, signal: options.signal, onLine });
      const info = await probe(result.path);
      return { path: result.path, ...info } satisfies FetchResult;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(
        `抖音这条没能自动下载（${reason}）。这条通道是"尽力而为"，请你改用：在抖音里打开该视频 → 分享 → 复制链接后用浏览器打开 → 另存为文件 → 上传到素材库。`,
      ), { status: 502, code: "DOUYIN_FALLBACK" });
    } finally {
      // ACT: 会话用完即弃 —— 里面是抖音下发的游客 cookie，没有留在磁盘上的必要。
      await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
    }
  }

  const tool = await ensureTool(options.signal, onLine);
  const ytDlpStem = stem ?? "%(title).80B [%(id)s]";
  // ACT: 输出模板固定为 .mp4 —— yt-dlp 需要合并音视频时用 ffmpeg 输出 mp4；
  // 单一格式其实也可能是 webm，但 mp4 是最通用、也是客户端能直接预览的目标。
  const target = join(directory, `${ytDlpStem}.mp4`);

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

  const saved = await findOutput(directory, ytDlpStem);
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
