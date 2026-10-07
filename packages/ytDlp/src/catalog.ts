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

export type SourceId = "github" | "ghProxy" | "ghProxyNet" | "ghJasonZeng";

const asset = "yt-dlp.exe";

export const downloadSources = [
  {
    id: "ghProxy" as const,
    label: "GH-Proxy 加速（推荐）",
    description: "第三方 GitHub 加速渠道，下载后校验文件完整性",
    available: true,
    homepage: "https://gh-proxy.org/",
    urlPrefix: `https://gh-proxy.org/https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`,
  },
  {
    id: "ghProxyNet" as const,
    label: "GHProxy.net 加速",
    description: "第三方 GitHub 加速渠道，下载后校验文件完整性",
    available: true,
    homepage: "https://ghproxy.net/",
    urlPrefix: `https://ghproxy.net/https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`,
  },
  {
    id: "ghJasonZeng" as const,
    label: "JasonZeng 加速",
    description: "第三方 GitHub 加速渠道，下载后校验文件完整性",
    available: true,
    homepage: "https://gh.jasonzeng.dev/",
    urlPrefix: `https://gh.jasonzeng.dev/https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`,
  },
  {
    id: "github" as const,
    label: "GitHub 上游",
    description: "官方发布地址；国内网络可能无法直接访问",
    available: true,
    homepage: `https://github.com/yt-dlp/yt-dlp/releases/tag/${version}`,
    urlPrefix: `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`,
  },
];

export const build = {
  fileName: asset,
  size: 17840399,
  sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
};

export const downloadSourcesById = Object.fromEntries(downloadSources.map(source => [source.id, source]));
