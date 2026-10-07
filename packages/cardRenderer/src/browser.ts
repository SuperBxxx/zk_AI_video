// 浏览器实例管理：找它、起它、连它、收掉它。
//
// 这个文件集中了几个**踩过且代价不小**的判断，逐条写在对应位置：
//   · 浏览器可执行文件必须用绝对路径找（Windows 上不写进 PATH）
//   · 默认带沙箱启动，起不来才降级 --no-sandbox（用户机器上不该关沙箱）
//   · 收尾必须按 **pid** 杀整棵进程树，绝不按进程名（按名杀会打掉用户正在用的界面）
//   · 「启动器已退出」不是跳过清理的理由，恰恰是最该清理的时刻

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

/** 启动浏览器与连 CDP 的参数。 */
export interface BrowserOptions {
  /** CDP 端口。 */
  port: number;
  /** 浏览器 profile 目录（会被创建）。 */
  profileDirectory: string;
  /**
   * 浏览器可执行文件。不给就按常见位置找。
   * 交付环境里如果想固定用某个内核，从这里传。
   */
  executablePath?: string;
  /** 等 CDP 就绪的上限（毫秒）。 */
  timeoutMs?: number;
}

/** 一个已就绪的浏览器实例。 */
export interface BrowserSession {
  /** 收掉这个实例（按 pid 杀整棵树）。可安全重复调用。 */
  dispose: () => void;
  /** 是否由本次调用启动（连上已有实例时为 false，此时 dispose 只关连接不杀进程）。 */
  owned: boolean;
}

const defaultTimeoutMs = 12000;

/**
 * 找本机的浏览器可执行文件。顺序：显式指定 → Chrome → **Edge**。
 *
 * ACT: 必须绝对路径。踩过：用 `spawn("chrome")` 报「起不了浏览器」，
 * 实际是命令名解析失败（Windows 上 Chrome 默认不写进 PATH），不是浏览器起不来。
 *
 * Edge 排在 Chrome 之后但**必须在内**：Windows 上 Electrobun 桌面端靠系统 WebView2
 * 渲染界面，而 WebView2 的内核就是 Edge —— 所以**装了本应用的机器一定有 Edge**，
 * 但不一定有 Chrome。这是「交付后用户没装 Chrome 怎么办」的答案：兜底是稳的，
 * 不需要随包分发 Chromium（那要多 150MB+）。
 */
export function resolveBrowserPath(explicit?: string): string | undefined {
  return [
    explicit,
    process.env.ZK_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean).find(candidate => existsSync(candidate as string)) as string | undefined;
}

/** 按 pid 结束整棵进程树。 */
function killTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    // 递归结束启动器及其全部子进程。启动器本身可能已退出，不影响 /T 按 pid 找树。
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try { child.kill("SIGKILL"); } catch { /* 已经退了 */ }
}

/** 起一个浏览器进程并等它的 CDP 就绪；失败返回 null。 */
async function launchOnce(executable: string, options: BrowserOptions, extraArgs: string[]): Promise<ChildProcess | null> {
  const child = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    ...extraArgs,
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.profileDirectory}`,
    "about:blank",
  ], { stdio: "ignore" });

  const deadline = Date.now() + (options.timeoutMs ?? defaultTimeoutMs);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      await (await fetch(`http://127.0.0.1:${options.port}/json/version`)).json();
      return child;
    } catch { /* 还没起来 */ }
  }
  killTree(child);
  return null;
}

/** CDP 目标信息。 */
export interface CdpTarget {
  type: string;
  webSocketDebuggerUrl: string;
}

/** 拉取调试端口上的目标列表。 */
export async function listCdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return await response.json() as CdpTarget[];
}

/**
 * 确保有一个可用的浏览器实例。
 *
 * 策略：**先复用**（调试端口上已经有就绪实例就直接连），**否则自己起**。
 * 自己起时**先试带沙箱**（用户机器上就该走这条），失败才降级 `--no-sandbox`。
 * 降级只在受限环境（含本任务的沙箱）发生，而且会通过 onFallback 报出来 ——
 * 不要让它悄悄把沙箱关掉。
 */
export async function ensureBrowser(
  options: BrowserOptions,
  onFallback?: (reason: string) => void,
): Promise<BrowserSession> {
  // 已经有人起好了（外层工具链、或上一次渲染留下的实例）
  try {
    const targets = await listCdpTargets(options.port);
    if (targets.some(target => target.type === "page")) {
      return { dispose: () => {}, owned: false };
    }
  } catch { /* 没有就绪实例，往下自己起 */ }

  const executable = resolveBrowserPath(options.executablePath);
  if (!executable) {
    throw new Error("找不到 Chrome/Edge。设 ZK_CHROME_PATH 指向可执行文件。");
  }
  mkdirSync(options.profileDirectory, { recursive: true });

  const sandboxed = await launchOnce(executable, options, []);
  const child = sandboxed ?? await (async () => {
    onFallback?.(`带沙箱起不来（${executable}），降级为 --no-sandbox 重试`);
    return await launchOnce(executable, options, ["--no-sandbox"]);
  })();

  if (!child) {
    throw new Error(`起不了浏览器：${executable}（端口 ${options.port}）`);
  }

  return {
    // ACT: 只按 pid 杀**自己起的**这棵树。绝不按进程名杀 —— 踩过一次很贵的坑：
    // 按名杀 msedge.exe 会把用户正在用的界面一起打掉（Electrobun 的界面就是 WebView2 = Edge）。
    //
    // 另一个坑：不能因为「启动器已退出」就跳过清理。Windows 上 chrome.exe / msedge.exe
    // 是启动器，起完真正的浏览器进程就自己退了，所以 `exitCode !== null` 恰恰是
    // 最需要清理的时刻。（早先在这里加过「已退出就 return」，结果一次都没清掉，
    // 每次渲染泄漏 8~10 个浏览器进程。）
    dispose: () => killTree(child),
    owned: true,
  };
}
