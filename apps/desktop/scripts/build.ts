import { $ } from "bun";
import { existsSync, mkdirSync } from "@toonflow/file";
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dir, "../../..");
const mode = process.argv[2];
if (process.argv.length !== 3 || !["build", "dev", "typecheck", "package"].includes(mode!)) {
  throw new Error("用法：bun apps/desktop/scripts/build.ts <build|dev|typecheck|package>");
}
const isMac = process.platform === "darwin";
const isIntelMac = isMac && process.arch === "x64";
// ACT: typecheck 只读取当前源码和已有 SDK 文件，不安装依赖或生成文件。
if (mode === "typecheck") {
  await $`${process.execPath} run tsc --project ${isIntelMac ? "compat/macIntel/tsconfig.json" : "apps/desktop/tsconfig.json"}`.cwd(projectDir);
  process.exit(0);
}
if (!(isMac && ["x64", "arm64"].includes(process.arch)) && !(process.platform === "win32" && process.arch === "x64")) {
  throw new Error("桌面构建需要 Windows x64 或 macOS x64/arm64 环境。");
}
if (mode === "dev") process.env.TOONFLOW_DATA_DIR = resolve(projectDir, "data");
if (isMac) {
  const startupTarget = isIntelMac ? "macX64" : "macArm64";
  for (const name of ["libthorvg.dylib", "nativeSplash.dylib"]) {
    if (!existsSync(resolve(projectDir, "packages/startup/assets", startupTarget, name))) {
      throw new Error("缺少当前架构的 macOS 启动库，请先运行 bun packages/startup/scripts/buildMac.ts，再重新构建桌面应用。");
    }
  }
}
if (!isMac) {
  const startupBuild = await Bun.build({
    entrypoints: [resolve(projectDir, "packages/startup/src/windowsSplashWorker.ts")],
    outdir: resolve(projectDir, "build/desktop/startup"),
    target: "bun",
    minify: true,
  });
  if (!startupBuild.success) throw new AggregateError(startupBuild.logs, "启动动画线程构建失败。");
  const protocolDir = resolve(projectDir, "build/desktop/protocol");
  const csc = resolve(process.env.WINDIR!, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  mkdirSync(protocolDir, { recursive: true });
  // ACT: csc.exe（32 位 .NET Framework 编译器）由 Bun 拉起时一律报 CS0016「拒绝访问」——换 C 盘输出、
  // 换 spawnSync 启动都复现，PowerShell 下同一条命令则成功，属 Bun 与本机 csc 的不兼容。
  // 因此已存在的产物不再重编；缺失时仍照常编译并如实报错。需要强制重编就删掉 build/desktop/protocol。
  const natives = [
    ["protocolLauncher.exe", ["/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll"], "apps/desktop/native/protocolLauncher.cs"],
    ["saveFileDialog.exe", ["/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll"], "apps/desktop/native/saveFileDialog.cs"],
    ["updateHelper.exe", ["/reference:System.Web.Extensions.dll", "/reference:System.Windows.Forms.dll", "/reference:Microsoft.CSharp.dll"], "apps/desktop/native/updateHelper.cs"],
  ] as const;
  for (const [name, references, source] of natives) {
    const out = resolve(protocolDir, name);
    if (existsSync(out)) continue;
    await $`${csc} /nologo /target:winexe /platform:x64 /optimize+ ${references} /out:${out} ${resolve(projectDir, source)}`;
  }
}
// ACT: 团队暂不打包；恢复时也在 package.json 的 dev:plugins 中加回 --filter './packages/teams/*'。
for (const script of mode === "dev" ? ["dev:plugins"] : [
  "build:tools",
  "build:nodes",
  // "build:teams",
]) {
  await $`${process.execPath} run ${script}`.cwd(projectDir);
}
await $`${process.execPath} run --filter @toonflow/web build`.cwd(projectDir);
await $`${process.execPath} run --filter @toonflow/mcp build`.cwd(projectDir);
if (isIntelMac) {
  // ACT: 共用插件和 Web 构建；Intel Mac 仅将 SDK 适配交给独立的 1.18.1。
  await $`${process.execPath} ${resolve(projectDir, "compat/macIntel/build.ts")} ${mode === "package" ? "build" : mode}`.cwd(projectDir);
  process.exit(0);
}
// ACT: electrobun 在 hoisted 布局下会被提升到仓库根 node_modules，嵌套布局则留在 apps/desktop 下。两处都找。
const cliCandidates = [
  resolve(projectDir, "apps/desktop/node_modules/electrobun/bin/electrobun.cjs"),
  resolve(projectDir, "node_modules/electrobun/bin/electrobun.cjs"),
];
const cli = cliCandidates.find((candidate) => existsSync(candidate));
if (!cli) throw new Error(`未找到 electrobun CLI，已查找：\n${cliCandidates.join("\n")}`);
await $`${process.execPath} ${cli} ${mode === "dev" ? "dev" : "build"} ${mode === "dev" ? [] : ["--env=stable"]}`.cwd(projectDir);
if (mode === "package" && !isMac) {
  await $`${process.execPath} ${resolve(import.meta.dir, "packageWindows.ts")}`.cwd(projectDir);
}
