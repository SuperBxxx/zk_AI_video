// yt-dlp 的下载源与固定版本。
//
// ACT: 版本与 sha256 都写死 —— 下载后必须校验通过才安装。
// 这个 sha256 是我在 Windows x64 上用 gh-proxy 镜像下到官方 2026.08.19 的 yt-dlp.exe
// 后本地实算的（17,840,399 字节），并与官方 SHA2-256SUMS 的用途一致：防止镜像返回被替换的文件。
// 换版本时必须同时更新 version 与 sha256。
//
// 许可：yt-dlp 本体是 Unlicense，但官方 Windows 单文件 exe 是 PyInstaller 打包的，
// 成品按 GPLv3+ 分发。这是「引导安装」而不是随包内置的原因之一；
// 若改为随包内置，必须一并附上 GPLv3 许可文本与源码获取途径。
export const version = "2026.08.19";

export type SourceId =
  | "ghproxyCom" | "ghProxy" | "ghProxyFastly" | "ghProxyIpv4" | "ghProxyNet" | "ghps"
  | "github" | "ghFast" | "ghJasonZeng" | "ghLlkk" | "ghDpik" | "gitmirror";

type Source = {
  id: SourceId;
  label: string;
  description: string;
  available: boolean;
  homepage: string;
  urlPrefix?: string;
};

const upstream = (host: string) => `${host}/https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`;

// 源表结构与 packages/ffmpeg 的 catalog 一致（label / description / available / homepage）。
//
// ACT: 顺序即**默认重试顺序** —— 国内可达的放前面。`available: false` 的条目会在面板里
// 列出来但不可选、也不参与自动重试，作者是"我们确认过它没有这个文件或已不可用"，
// 而不是猜；宁可如实标注，也不要给用户一个必然失败的选项。
//
// 2026-10-08 在本机实测（Bun fetch，20 秒超时）：
//   ✓ gh-proxy.com / gh-proxy Fastly / gh-proxy v4 / ghproxy.net / ghps.cc / GitHub 直连
//   ✗ GHFast、gh.dpik.top、gh.llkk.cc、gh.jasonzeng.dev、hub.gitmirror.com（连不上或超时）
export const downloadSources: Source[] = [
  {
    id: "ghproxyCom",
    label: "GH-Proxy 主站（推荐）",
    description: "第三方 GitHub 加速渠道，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://gh-proxy.com/",
    urlPrefix: upstream("https://gh-proxy.com"),
  },
  {
    id: "ghProxy",
    label: "GH-Proxy 加速",
    description: "第三方 GitHub 加速渠道，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://gh-proxy.org/",
    urlPrefix: upstream("https://gh-proxy.org"),
  },
  {
    id: "ghProxyFastly",
    label: "GH-Proxy Fastly 线路",
    description: "GH-Proxy 的 Fastly CDN 线路，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://gh-proxy.com/",
    urlPrefix: upstream("https://cdn.gh-proxy.org"),
  },
  {
    id: "ghProxyIpv4",
    label: "GH-Proxy IPv4 优选",
    description: "GH-Proxy 的 IPv4 优选线路，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://gh-proxy.com/",
    urlPrefix: upstream("https://v4.gh-proxy.org"),
  },
  {
    id: "ghProxyNet",
    label: "GHProxy.net 加速",
    description: "第三方 GitHub 加速渠道，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://ghproxy.net/",
    urlPrefix: upstream("https://ghproxy.net"),
  },
  {
    id: "ghps",
    label: "GHPS 加速",
    description: "第三方 GitHub 加速渠道，国内实测可达；下载后校验文件完整性",
    available: true,
    homepage: "https://ghps.cc/",
    urlPrefix: upstream("https://ghps.cc"),
  },
  {
    id: "github",
    label: "GitHub 上游",
    description: "官方发布地址；国内网络可能无法直接访问",
    available: true,
    homepage: `https://github.com/yt-dlp/yt-dlp/releases/tag/${version}`,
    // ACT: 这一条**不能**用上面的 upstream() 辅助 —— 它是加速站的写法
    // （`<镜像>https://github.com/...`），套到 github.com 自身会拼成
    // `https://github.com/https://github.com/...`（实测返回 404）。
    urlPrefix: `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`,
  },
  {
    id: "ghFast",
    label: "GHFast 加速",
    description: "本机实测连不上（超时），保留供换网络环境时尝试",
    available: false,
    homepage: "https://ghfast.top/",
    urlPrefix: upstream("https://ghfast.top"),
  },
  {
    id: "ghJasonZeng",
    label: "JasonZeng 加速",
    description: "本机实测连不上，保留供换网络环境时尝试",
    available: false,
    homepage: "https://gh.jasonzeng.dev/",
    urlPrefix: upstream("https://gh.jasonzeng.dev"),
  },
  {
    id: "ghLlkk",
    label: "LLKK 加速",
    description: "本机实测连不上（超时），保留供换网络环境时尝试",
    available: false,
    homepage: "https://gh.llkk.cc/",
    urlPrefix: upstream("https://gh.llkk.cc"),
  },
  {
    id: "ghDpik",
    label: "Geekertao 加速",
    description: "本机实测连不上（超时），保留供换网络环境时尝试",
    available: false,
    homepage: "https://gh.dpik.top/",
    urlPrefix: upstream("https://gh.dpik.top"),
  },
  {
    id: "gitmirror",
    label: "GitMirror 加速",
    description: "本机实测连不上，保留供换网络环境时尝试",
    available: false,
    homepage: "https://hub.gitmirror.com/",
    urlPrefix: upstream("https://hub.gitmirror.com"),
  },
];

export const build = {
  fileName: "yt-dlp.exe",
  size: 17840399,
  sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
};

export const downloadSourcesById = Object.fromEntries(downloadSources.map(source => [source.id, source]));
