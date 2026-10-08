// yt-dlp 的定位、版本核验、引导安装与取流。
//
// 与 `@toonflow/ffmpeg` 同一套规格：不硬编码可执行文件路径，
// 先看数据目录里下载好的，再回退到系统 PATH（`Bun.which`）；
// 安装必须经过 sha256 校验与版本核验，再原子替换。
import { createHash } from "node:crypto";
import { promises as nativeFs } from "node:fs";
import { createWriteStream, chmod, lstat, mkdir, mkdtemp, realpath, rm, withFileAccess } from "@toonflow/file";
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

/**
 * 在写租约内把临时文件改名到目标。
 *
 * ACT: 自己实现重试而不是复用 `@toonflow/file` 的 `rename` —— 那个包装会再取一次租约，
 * 与外层已持有的同一个租约形成自锁（详见调用点的说明）。这里照它的口径重试
 * Windows 上常见的瞬时失败（文件刚被写、或正被扫描）。
 */
async function renameWithRetry(source: string, target: string, attempt = 1): Promise<void> {
  try {
    await nativeFs.rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (attempt >= 10 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw error;
    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    return renameWithRetry(source, target, attempt + 1);
  }
}

async function readVersion(path: string, signal?: AbortSignal) {  const child = Bun.spawn([path, "--version"], {
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
    // ACT: 程序在、但跑不起来时**仍然返回 path**。
    // 为什么：安装的门槛是 sha256（字节正确），"能不能跑"受当时环境影响
    // （新落盘的 exe 被扫描时 PyInstaller 解包会失败）。若这里返回 path:null，
    // 调用方会以为"没装"而反复重装 —— 一个环境抖动就会变成重装循环。
    // 所以把 path 交出去，让真正去取流的人拿到那条运行错误。
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
    // sha256 一致就证明**文件是对的**（字节级），这是安装的门槛。
    if (hash.digest("hex") !== build.sha256) throw new Error("yt-dlp 文件校验失败，请换源重试");
    if (process.platform !== "win32") await chmod(staged, 0o755);

    // ACT: 版本核验**不再是硬性门槛**，降级为"尽力而为"。
    //
    // 原先这里 `readVersion` 一失败就抛错 → 整次安装失败 → 换源重试。
    // 实测教训：sha256 完全正确、字节与官方一致的文件，也可能因为**当时的环境状态**
    // （典型是新落盘的 exe 正被杀软扫描，PyInstaller 解包拿不到句柄）跑不起来，
    // 报 `Could not create temporary directory!`。为这种事把正确的文件丢掉、
    // 再花几分钟换源重下，是拿环境问题惩罚下载结果。
    //
    // 所以：能跑就记下版本；跑不起来只**记一条提示**，照常安装。
    // 真正跑不动时，第一次取流会如实报出运行错误 —— 那才是它该暴露的地方。
    let actual: string | null = null;
    try {
      actual = await readVersion(staged, signal);
    } catch (error) {
      signal.throwIfAborted();
      console.warn("yt-dlp 版本核验失败（不影响安装，文件校验已通过）：", error instanceof Error ? error.message : error);
    }
    if (actual && actual !== version) {
      // ACT: 版本不符是**另一回事** —— 说明这个镜像给的不是我们要的那一版，
      // 不能当成环境抖动放过去（否则等于放弃固定版本这条约束）。
      throw new Error(`yt-dlp 版本不符（期望 ${version}，实际 ${actual}），请换源重试`);
    }

    report({ phase: "installing", received: 0 });
    const target = join(destination, executableName);
    // ACT: 这里**必须用原生 fs**，不能用 `@toonflow/file` 的 `unlink` / `rename`。
    //
    // 踩过的死锁：那两个包装内部各自会再取一次 `[target]` 的写租约
    // （见 packages/file/src/index.ts 的 `withFileAccess([path], "write", ...)`），
    // 而外层这里**已经持有**同一个 `[target]` 的写租约 —— 写租约占满信号量的全部许可，
    // 嵌套那次只能排队等外层释放，外层却在等嵌套返回 → 永久自锁，
    // 直到 30 秒超时才报出「文件正在使用，等待操作超时」。
    // 现象很像"文件被别的进程占用"，实际是我们自己在等自己。
    //
    // 所以：租约由外层负责，块内只做纯粹的文件操作（原子的 `rename` 依旧，重试自己补）。
    await withFileAccess([target], "write", async () => {
      // Windows 上 rename 不能覆盖已存在文件，先删目标再改名。
      await nativeFs.unlink(target).catch(() => {});
      await renameWithRetry(staged, target);
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
