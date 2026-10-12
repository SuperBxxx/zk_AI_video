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
    // 现在默认为本项目的仓库；发布到别处时用 UPDATE_BASE_URL 覆盖。
    //
    // ACT: 注意更新通道**不是**建了仓库就能用 —— 客户端会去取
    // `<baseUrl>/stable-win-x64-update.json`，那个清单与配套产物（tar.zst、增量 patch）
    // 必须由 `bun run release:desktop <版本号> --initial` 生成，并作为 **GitHub Release**
    // 上传（`/releases/latest/download/` 只服务最新 Release 的资产，普通文件提交不生效）。
    // 仓库里没有 Release 时，检查更新会 404 —— 这是预期行为，不是缺陷。
    // GitHub Actions 构建时 GITHUB_REPOSITORY 会被自动设置，从而指向实际运行构建的仓库。
    baseUrl: process.env.UPDATE_BASE_URL
      ?? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY || "SuperBxxx/zk_AI_video"}/releases/latest/download`,
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
