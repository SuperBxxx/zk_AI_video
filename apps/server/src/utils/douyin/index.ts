// 抖音取流：**尽力而为**的实现，不是稳定 API。
//
// 为什么值得单独做一条：抖音的详情接口对非浏览器请求返回 403（实测登录态也无效），
// 所以 yt-dlp 走不通。但它有一个**旧版直链播放接口**不需要任何签名：
//
//   aweme.snssdk.com/aweme/v1/play/?video_id=<uri>&ratio=1080p&line=0
//
// 这个域名是 App 端旧域名，该接口的职责是给播放器喂流，不承担反爬。
// 实测：三档清晰度都返回 302 → CDN 直链，整链下载 1 秒拿到 1080p 的 9MB 文件。
//
// **卡点只在第一步**：拿 `<uri>` 必须经过要签名的详情接口，我们只能借浏览器去取。
// 而借浏览器这件事本身不稳定（抖音的 sdk-glue.js 会替换 window.fetch 拦掉页面内的调用，
// 实测四种绕过方式都会失败，但也见过成功）—— 所以整条路定位为"尽力而为"：
// 任何一步失败都要**明确失败**，让上层退回"手动另存为"。
import { mkdir, writeFile } from "@toonflow/file";
import { dirname } from "node:path";

/** 抖音链接 / 分享文本 → 数字视频 id。取不到返回 undefined。 */
export function parseDouyinId(input: string) {
  const text = input.trim();
  // 分享文本里常见：https://v.douyin.com/xxx/  或  https://www.douyin.com/video/7123...
  const numeric = text.match(/\/video\/(\d{6,})/) ?? text.match(/^\s*(\d{6,})\s*$/);
  if (numeric) return numeric[1];
  return undefined;
}

/** 短链（v.douyin.com/xxx）需要先跟一次跳转才知道数字 id。 */
async function resolveShortLink(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { redirect: "follow", signal, headers: { "user-agent": userAgent } }).catch(() => undefined);
  if (!response) return undefined;
  await response.body?.cancel().catch(() => undefined);
  return response.url?.match(/\/video\/(\d{6,})/)?.[1];
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

/** 浏览器取 uri 时要执行的脚本。 */
function uriScript(videoId: string) {
  return `(async () => {
    const response = await fetch("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&device_platform=webapp&aid=6383", { credentials: "include" });
    const detail = await response.json();
    const d = detail.aweme_detail || {};
    if (!d.video) return { __error: "详情里没有视频（可能需要登录，或这条视频不可公开访问）" };
    const uri = (d.video.bit_rate || []).map(b => b.play_addr && b.play_addr.uri).find(Boolean) || (d.video.play_addr && d.video.play_addr.uri) || "";
    if (!uri) return { __error: "详情里没有播放标识（uri）" };
    return { uri, title: d.desc || "", durationMs: d.video.duration || 0 };
  })()`;
}

export type DouyinExtractResult = { uri: string; title: string; durationMs: number };

/**
 * 借一个**临时浏览器**（游客态，不碰用户自己的浏览器）从详情接口取 uri。
 *
 * ACT: 复用 cardRenderer 的浏览器定位逻辑（Windows 上 Chrome/Edge 不写进 PATH）。
 * 浏览器用完即收（按 pid 杀整棵树，绝不按进程名）。
 */
export async function extractDouyinUri(videoId: string, options: { port: number; profileDirectory: string; signal?: AbortSignal }): Promise<DouyinExtractResult> {
  const { ensureBrowser } = await import("@toonflow/card-renderer/browser");
  const session = await ensureBrowser({ port: options.port, profileDirectory: options.profileDirectory });
  try {
    const targets = await fetch(`http://127.0.0.1:${options.port}/json/list`).then(r => r.json()).catch(() => []) as { type: string; webSocketDebuggerUrl?: string; url?: string }[];
    const page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error("拿不到浏览器页面");

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((done, fail) => {
      socket.onopen = () => done();
      socket.onerror = () => fail(new Error("连不上浏览器调试端口"));
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
      if (message.id === undefined) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
    const send = (method: string, params: Record<string, unknown> = {}) => {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise<never>((resolve, reject) => pending.set(id, { resolve: resolve as never, reject }));
    };

    try {
      await send("Page.enable", {});
      await send("Runtime.enable", {});
      // 先导航到视频页，让抖音把 JS 挑战跑完（它会下发 ttwid 等会话 cookie）
      await send("Page.navigate", { url: `https://www.douyin.com/video/${videoId}` });
      // ACT: 没有进度事件能判断"挑战跑完了"，所以是固定等待。
      // 等太短拿不到会话，等太长拖慢；实测 12 秒是能稳定拿到会话的量级。
      await new Promise(done => setTimeout(done, 12000));
      options.signal?.throwIfAborted();

      // 站点 SDK 的拦截是**间歇性**的，多试几次比一次放弃更接近它的真实成功率。
      let lastError = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await send("Runtime.evaluate", {
          expression: uriScript(videoId), awaitPromise: true, returnByValue: true, timeout: 60000,
        }).catch(error => ({ exceptionDetails: { text: String(error) } }));
        const detail = response as { exceptionDetails?: { exception?: { description?: string }; text?: string }; result?: { value?: unknown } };
        if (detail.exceptionDetails) {
          // 页面脚本抛错（多半是 SDK 拦了 fetch）—— 换一轮再试
          lastError = detail.exceptionDetails.exception?.description ?? detail.exceptionDetails.text ?? "页面脚本抛错";
          await new Promise(done => setTimeout(done, 2500));
          continue;
        }
        const value = detail.result?.value as DouyinExtractResult & { __error?: string } | undefined;
        if (value?.uri) return { uri: value.uri, title: value.title ?? "", durationMs: value.durationMs ?? 0 };
        lastError = value?.__error ?? "详情里没有 uri";
        // 明确的"没有视频"不是重试能解决的
        if (lastError.includes("没有视频")) break;
        await new Promise(done => setTimeout(done, 2500));
      }
      throw new Error(lastError || "取不到抖音视频标识");
    } finally {
      socket.close();
    }
  } finally {
    session.dispose();
  }
}

/**
 * 用 uri 换直链并下载。
 *
 * ACT: 让 fetch **自己跟随 302**（默认行为）。实测手动分两步也能成，
 * 但跟随跳转更省事，而且**不要加 Range 头** —— 实测带 Range 会被签名 URL 拒成 403。
 */
export async function downloadDouyinVideo(options: {
  uri: string;
  target: string;
  ratio?: "540p" | "720p" | "1080p";
  signal?: AbortSignal;
}) {
  const ratio = options.ratio ?? "1080p";
  const endpoint = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(options.uri)}&ratio=${ratio}&line=0`;
  const response = await fetch(endpoint, {
    signal: options.signal,
    headers: { "user-agent": userAgent, referer: "https://www.douyin.com/" },
  });
  if (!response.ok || !response.body) throw new Error(`抖音直链下载失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1024) throw new Error("抖音返回的内容太小，可能不是视频");
  // 粗看容器标识，避免把风控页当视频存下来
  const signature = String.fromCharCode(...bytes.slice(4, 12));
  if (!/ftyp|moov|mdat|webm/.test(signature)) throw new Error(`抖音返回的不是视频（容器标识 ${signature || "空"}）`);
  await mkdir(dirname(options.target), { recursive: true });
  await writeFile(options.target, bytes);
  return { path: options.target, bytes: bytes.length };
}

/** 抖音链接的整条尽力而为流程。 */
export async function fetchDouyin(options: {
  url: string;
  target: string;
  port: number;
  profileDirectory: string;
  ratio?: "540p" | "720p" | "1080p";
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}) {
  const { url } = options;
  let id = parseDouyinId(url);
  if (!id && /^https?:\/\/v\.douyin\.com\//i.test(url)) {
    options.onLine?.("正在解析抖音短链…");
    id = await resolveShortLink(url, options.signal);
  }
  if (!id) throw new Error("从这个链接里读不出抖音视频 id");
  options.onLine?.(`抖音视频 id：${id}`);

  options.onLine?.("正在用临时浏览器取播放标识（这一步不稳定，失败会自动退回手动方式）…");
  const extracted = await extractDouyinUri(id, { port: options.port, profileDirectory: options.profileDirectory, signal: options.signal });
  options.onLine?.(`拿到播放标识${extracted.title ? `：${extracted.title}` : ""}`);

  options.onLine?.(`正在下载（${options.ratio ?? "1080p"}）…`);
  const result = await downloadDouyinVideo({ uri: extracted.uri, target: options.target, ratio: options.ratio, signal: options.signal });
  return { ...result, title: extracted.title, durationMs: extracted.durationMs, videoId: id, uri: extracted.uri };
}
