// yt-dlp 的定位、版本核验、引导安装与取流。
//
// 与 `@toonflow/ffmpeg` 同一套规格：不硬编码可执行文件路径，
// 先看数据目录里下载好的，再回退到系统 PATH（`Bun.which`）；
// 安装必须经过 sha256 校验与版本核验，再原子替换。
import { createHash } from "node:crypto";
import { createWriteStream, chmod, lstat, mkdir, mkdtemp, realpath, rename, rm, unlink, withFileAccess } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { basename, dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { build, downloadSources, downloadSourcesById, version } from "./catalog";

export { downloadSources, version };
export type { SourceId } from "./catalog";

export type YtDlpMode = "auto" | "download" | "system";

export type YtDlpStatus = {
  path: string | null;
  origin: "download" | "system" | null;
  version: string | null;
  error: string | null;
};

export type DownloadState = {
  phase: "idle" | "downloading" | "verifying" | "installing" | "completed" | "error" | "cancelled";
  received: number;
  total?: number;
  error?: string;
};

export const executableName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

async function readVersion(path: string, signal?: AbortSignal) {
  const child = Bun.spawn([path, "--version"], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true, timeout: 60000, signal,
  });
  const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error("yt-dlp 无法运行，请检查平台兼容性或重新下载");
  // `--version` 输出形如 2026.08.19
  return output.trim().split(/\r?\n/, 1)[0] ?? "";
}

/**
 * 定位可用的 yt-dlp。
 *
 * @param directory 下载目录（数据目录下的 ytdlp/）
 * @param mode `auto` 先看下载目录再回退系统；`download` 只用下载目录；`system` 只用系统
 */
export async function getToolStatus(directory: string, mode: YtDlpMode = "auto"): Promise<YtDlpStatus> {
  const downloaded = join(directory, executableName);
  const hasDownload = mode !== "system" && await file(downloaded).exists();
  const path = hasDownload ? downloaded : mode === "download" ? null : Bun.which(executableName) ?? null;
  const origin = path ? (hasDownload ? "download" as const : "system" as const) : null;
  if (!path) return { path: null, origin: null, version: null, error: "未找到可用程序" };
  try {
    return { path, origin, version: await readVersion(path), error: null };
  } catch (error) {
    return { path, origin, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkDirectory(path: string) {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`安装目录必须是普通文件夹：${path}`);
  return stat !== null;
}

/**
 * 引导安装：按给定源下载、校验 sha256、核验版本，再原子替换。
 *
 * ACT: 与 ffmpeg 的分阶段替换不同 —— yt-dlp 只有一个文件，
 * 先下到临时目录校验，通过后 `rename` 覆盖即可，不需要备份旧版本目录。
 */
export async function installYtDlp(
  directory: string,
  sourceId: string,
  signal: AbortSignal,
  report: (state: DownloadState) => void,
  /** 单条线路的超时（毫秒）。ACT: 必须有 —— 见 ensureTool 里对 83 秒白等的说明。 */
  timeoutMs = 90_000,
) {
  const source = downloadSourcesById[sourceId as keyof typeof downloadSourcesById];
  if (!source?.available) throw new Error("此下载源暂不可用，请选择其他下载源");
  signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  const parent = dirname(resolve(directory));
  await checkDirectory(parent);
  await mkdir(parent, { recursive: true });
  const root = await realpath(parent);
  const destination = join(root, basename(directory));
  await checkDirectory(destination);
  await mkdir(destination, { recursive: true });
  const temporary = await mkdtemp(join(root, ".ytdlp-install-"));
  try {
    report({ phase: "downloading", received: 0 });
    const response = await fetch(`${source.urlPrefix}${build.fileName}`, { signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`yt-dlp 下载失败（HTTP ${response.status}）`);
    const total = Number(response.headers.get("content-length")) || build.size;
    let received = 0;
    const hash = createHash("sha256");
    const staged = join(temporary, executableName);
    await pipeline(Readable.from(response.body), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > 128 * 1024 * 1024) return callback(new Error("下载文件超过允许大小"));
        hash.update(chunk);
        report({ phase: "downloading", received, total });
        callback(null, chunk);
      },
    }), createWriteStream(staged, { flags: "wx", signal }), { signal });

    report({ phase: "verifying", received, total });
    if (hash.digest("hex") !== build.sha256) throw new Error("yt-dlp 文件校验失败，请换源重试");
    if (process.platform !== "win32") await chmod(staged, 0o755);
    // ACT: 校验通过后再核验它能运行；PyInstaller 单文件在某些目录下解包会失败，
    // 所以这里必须真的执行一次，而不是只看文件在不在。
    const actual = await readVersion(staged, signal);
    if (actual !== version) throw new Error(`yt-dlp 版本不符（期望 ${version}，实际 ${actual}）`);

    report({ phase: "installing", received: 0 });
    const target = join(destination, executableName);
    await withFileAccess([target], "write", async () => {
      // Windows 上 rename 不能覆盖已存在文件，先删目标再改名
      await unlink(target).catch(() => {});
      await rename(staged, target);
    });
    report({ phase: "completed", received, total });
    return target;
  } finally {
    if (dirname(temporary) === root) {
      await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(error => {
        console.warn(`yt-dlp 临时目录清理失败：${temporary}`, error);
      });
    }
  }
}

/** 是否是需要交给 yt-dlp 的网络链接（Windows 盘符路径会被解析成单字母 scheme，必须排除）。 */
export function isVideoUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export type YtDlpRun = {
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
};

/**
 * 跑一次 yt-dlp，收集 stdout/stderr。
 *
 * ACT: 统一加 `--no-config`（忽略用户全局配置，保证行为可复现）与 `--no-warnings`；
 * 不传 `--no-update` 之外的自更新参数，更新由安装流程负责。
 */
export async function runYtDlp(path: string, run: YtDlpRun) {
  const child = Bun.spawn([path, "--no-config", "--no-warnings", ...run.args], {
    cwd: run.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 30 * 60 * 1000, signal: run.signal,
  });
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const text = await new Response(stream).text();
    for (const line of text.split(/\r?\n/)) if (line) run.onLine?.(line);
    return text;
  };
  const [stdout, stderr, code] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
  return { stdout, stderr, code };
}
