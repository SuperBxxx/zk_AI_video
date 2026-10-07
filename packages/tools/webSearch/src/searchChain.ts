// 联网搜索的 provider 编排。
//
// ## 为什么要这一层
//
// 实测（国内网络）：DuckDuckGo 两个域名都超时（6s），而 DeepSeek 官网 180ms、
// Tavily 996ms、百度 111ms 都通。所以 DuckDuckGo 在**默认免密钥**的位置上，
// 恰恰是国内最不可用的那个 —— 一失败整条口播链路就断在这里。
//
// ## 这里做的三件事
//
// 1. **auto（默认）**：按「能用的先试」排一条候选链，逐个尝试，并且**如实报出用了哪个**。
//    没有任何可用 provider 时，报错里把三种配置方式一次说清，而不是只说一句「搜索失败」。
// 2. **代理**：Bun 的 fetch 会读 HTTPS_PROXY。但**死代理比没有代理更糟** ——
//    实测注册表里留着 127.0.0.1:7892 但那个端口 ECONNREFUSED，
//    一旦这个变量被判为可用，所有请求会 1ms 内失败而不是走直连。
//    所以：把代理配置做成显式选项，并且**先探测端口是否真的在监听**再用。
// 3. 失败时给出**可执行**的下一步，而不是让用户猜。

import { createConnection } from "node:net";

/** 一次搜索的来源。 */
export interface SearchSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

/** 编排层对外只暴露这一个函数。 */
export interface SearchOutcome {
  sources: readonly SearchSource[];
  truncated: boolean;
  /** 实际生效的 provider。auto 模式下必须告诉调用方用了哪个。 */
  usedProvider: string;
  /** 试过但失败的 provider 及原因（用于诊断，不用于展示给最终用户）。 */
  attempts: { provider: string; error: string }[];
}

/** 单个 provider 的执行函数。 */
export type SearchRunner = (query: string, signal: AbortSignal) => Promise<{ sources: readonly SearchSource[]; truncated: boolean }>;

/** 端口上有没有服务在监听。 */
export function isPortListening(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * 判断某个代理地址是否真的可用。
 *
 * ACT: 只支持 `http://host:port` 这种形态（本机常见的是 Clash/V2Ray 的 http 入口）。
 * 不做 PAC / socks 解析 —— 那些需要额外依赖，而且工具产物要自包含。
 * 探测不通就**返回 false 并且不设置环境变量**，让请求走直连：
 * 死代理会让所有请求立刻失败，比不设代理更糟。
 */
export async function resolveUsableProxy(proxy: string): Promise<string | undefined> {
  const trimmed = proxy.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!Number.isFinite(port) || port <= 0) return undefined;
  const listening = await isPortListening(parsed.hostname, port);
  return listening ? trimmed : undefined;
}

/** auto 模式的候选顺序与理由。 */
export const autoChain = ["deepseek", "tavily", "duckduckgo"] as const;

/**
 * 按候选顺序逐个尝试，返回第一个成功的结果。
 *
 * 每个 provider 失败都会被记下来（attempts），全部失败时把这些原因一起抛出去 ——
 * 只报「搜索失败」会让用户无从下手，而真实原因往往是「没配 Key」或「网络到不了」。
 */
export async function runChain(
  candidates: readonly string[],
  runners: Record<string, SearchRunner | undefined>,
  query: string,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const attempts: { provider: string; error: string }[] = [];
  const skipped: string[] = [];
  for (const provider of candidates) {
    const runner = runners[provider];
    if (!runner) {
      skipped.push(provider);
      continue;
    }
    signal.throwIfAborted();
    try {
      const result = await runner(query, signal);
      return { ...result, usedProvider: provider, attempts };
    } catch (error) {
      signal.throwIfAborted();
      attempts.push({ provider, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new SearchFailure(attempts, skipped);
}

/** 全部候选都失败。把「试过的」与「没配的」分开说，并给出可执行的下一步。 */
export class SearchFailure extends Error {
  constructor(
    attempts: { provider: string; error: string }[],
    /** 明确因为没配置而被跳过的候选。 */
    readonly skipped: string[] = [],
  ) {
    const detail = attempts.map(item => `  · ${item.provider}：${item.error}`).join("\n");
    // ACT: 必须把「没配」和「试了但失败」分开说。踩过：早期版本把三个候选名拼在一起报
    // 「所有候选服务都没成功」，而 deepseek / tavily 根本没被尝试（缺 Key）——
    // 用户会以为那两家也挂了，从而去查网络，方向完全错。
    const skippedLine = skipped.length
      ? `\n其中 ${skipped.join("、")} 没有配置，未被尝试。`
      : "";
    super(
      `联网搜索失败：\n${detail}${skippedLine}\n\n`
      + "可执行的下一步（任选一种）：\n"
      + "  1. 在「联网搜索」工具配置里把「搜索服务」设为 DeepSeek 并填官方 DeepSeek API Key（国内最稳，实测其接口 113ms 可达）\n"
      + "  2. 换成 Tavily 并填 Tavily API Key（实测可达）\n"
      + "  3. 要用 DuckDuckGo，需先在工具配置里填本机代理地址（如 http://127.0.0.1:7892）并确认代理真的在运行\n"
      + "     —— 注意：实测国内 DuckDuckGo 两个域名都超时，没代理时它是不可用的",
    );
    this.name = "SearchFailure";
  }
}
