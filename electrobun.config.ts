import type { ElectrobunConfig } from "./.hutch/devkit/api/config/ElectrobunConfig";

export default {
  app: {
    name: "zhukai",
    identifier: "local.zhukai.desktop",
    version: process.env.appVersion ?? "2.0.0",
    urlSchemes: ["zhukai"],
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "apps/desktop/src/index.ts", minify: true },
    copy: {
      ...(process.platform === "win32" ? {
        "build/desktop/protocol/protocolLauncher.exe": "protocolLauncher.exe",
        "build/desktop/protocol/saveFileDialog.exe": "saveFileDialog.exe",
        "build/desktop/protocol/updateHelper.exe": "updateHelper.exe",
      } : {}),
      "build/web": "views/mainview",
      "build/mcp": "mcp",
      "build/tools": "tools",
      // ACT: 团队暂不打包，恢复时取消注释。
      // "build/agents": "agents",
      "build/nodes": "nodes",
      "packages/providers/src": "providers",
      "packages/skills": "skills",
    },
    buildFolder: "build/desktop/app",
    artifactFolder: process.platform === "darwin" ? `build/desktop/artifacts/${process.arch === "x64" ? "macX64" : "macArm64"}` : "build/desktop/artifacts",
    win: {
      icon: "packages/assets/logo.ico",
    },
    mac: {
      icons: "packages/assets/logo.iconset",
      // ACT: CI 为 ARM 同时开启签名与公证；本地未配置凭据时仍可构建测试包。
      codesign: process.env.macCodesign === "1",
      notarize: process.env.macCodesign === "1",
    },
  },
  release: {
    // ACT: 上游把这里默认指回 HBAI-Ltd/Toonflow-app。对住凯AI视频是错的——用户点更新会装成上游版本。
    // 发布前必须用 UPDATE_BASE_URL 指向自己的发布地址；未设置时用占位域名，宁可让更新失败也不要装错。
    // 例：UPDATE_BASE_URL=https://dl.example.com/zhukai
    baseUrl: process.env.UPDATE_BASE_URL
      ?? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY || "zhukai-video/zhukai-video"}/releases/latest/download`,
    // ACT: 常规构建不访问更新服务器；release:desktop 显式开启增量构建。
    generatePatch: process.env.generateUpdatePatch === "1",
  },
  ...(process.platform === "darwin" ? {
    scripts: {
      postBuild: "apps/desktop/scripts/localizeMac.ts",
      postWrap: "apps/desktop/scripts/localizeMac.ts",
    },
  } : {}),
} satisfies ElectrobunConfig;
