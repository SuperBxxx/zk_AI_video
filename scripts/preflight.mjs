// 开工断言：把已知坑做成开工前必跑的检查。
//
// 为什么存在：这些问题的答案都在文档或代码里，但**没人在正确的时刻去查**。
// 已经踩过三次同类坑（素材库路径越界、音频格式不匹配、插件同步被 marker 阻断），
// 其中「插件同步」那次构建成功、data/ 下却没有产物、且全程无报错。
// 所以不补文档，把禁则做成断言。
//
// 用法：bun run preflight（失败时退出码 1）
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];

function fail(check, detail) { failures.push({ check, detail }); }
function warn(check, detail) { warnings.push({ check, detail }); }
function rel(path) { return relative(root, path).split("\\").join("/"); }

// ── 1. 预置画布的端口表 ──────────────────────────────────────────────
// 交给 checkModes.mjs（唯一真相源），避免两份实现漂移。
function checkModes() {
  const script = join(root, "scripts", "checkModes.mjs");
  const result = Bun.spawnSync({ cmd: [process.execPath, script], cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = result.stdout.toString() + result.stderr.toString();
  if (result.exitCode !== 0 || /个模式有问题/.test(output)) {
    const lines = output.split("\n").filter(l => l.includes("✗") || l.trim().startsWith("连线") || l.trim().startsWith("未知") || l.includes("重复"));
    fail("预置画布端口", lines.slice(0, 12).join("\n      ") || output.slice(0, 600));
    return;
  }
  const summary = output.split("\n").filter(l => l.trim().startsWith("✓")).length;
  console.log(`  ✓ 预置画布端口        ${summary} 个模式通过`);
}

// ── 2. 插件同步：build/** 的产物必须都在 data/** ──────────────────────
// 踩过的坑：新增工具包后 build/tools 有产物、data/tools 没有、接口也列不出来，
// 原因是 initializePlugins 的 marker 判定让同步被永久跳过。这里直接对账文件。
function checkPluginSync() {
  const pairs = [
    ["build/tools", "data/tools", /^[a-z][a-zA-Z0-9]*\.tool\.js$/],
    ["build/nodes", "data/nodes", /\.(js|mjs)$/],
  ];
  for (const [sourcePart, targetPart, pattern] of pairs) {
    const source = join(root, sourcePart);
    const target = join(root, targetPart);
    if (!existsSync(source)) continue; // 没构建过就跳过，不是错误
    if (!existsSync(target)) { warn("插件同步", `${targetPart} 不存在，跳过对账`); continue; }
    const sourceFiles = readdirSync(source).filter(name => pattern.test(name));
    const targetFiles = new Set(readdirSync(target));
    const missing = sourceFiles.filter(name => !targetFiles.has(name));
    if (missing.length) {
      fail("插件同步", `${targetPart} 缺少 ${missing.length} 个由 ${sourcePart} 构建出的文件：\n      ${missing.slice(0, 8).join("\n      ")}\n      处置：删掉 ${targetPart}/initialized 后重启服务端重新同步`);
    } else {
      console.log(`  ✓ 插件同步            ${targetPart} 与 ${sourcePart} 一致（${sourceFiles.length} 个文件）`);
    }
  }
}

// ── 3. 技能版本：源码与已安装副本必须同版本 ──────────────────────────
// 踩过的坑：技能只在首次安装时铺一次（设计如此，保护用户改动），
// 于是源码升级了、用户那份还是旧的，且没人会发现。
function checkSkillVersions() {
  const source = join(root, "packages", "skills");
  const installed = process.env.ZK_INSTALLED_DATA
    ? join(process.env.ZK_INSTALLED_DATA, "skills")
    : "E:\\zk_video\\data\\skills";
  if (!existsSync(source)) return;
  const names = readdirSync(source).filter(name => statSync(join(source, name)).isDirectory());
  const readVersion = path => {
    if (!existsSync(path)) return undefined;
    return /version:\s*"([^"]+)"/.exec(readFileSync(path, "utf8"))?.[1];
  };
  const stale = [];
  for (const name of names) {
    const fromSource = readVersion(join(source, name, "SKILL.md"));
    if (!fromSource) continue;
    const fromInstalled = readVersion(join(installed, name, "SKILL.md"));
    if (fromInstalled === undefined) continue; // 未安装该技能，不算错
    if (fromInstalled !== fromSource) stale.push(`${name}: 源码 v${fromSource} / 已安装 v${fromInstalled}`);
  }
  if (!existsSync(installed)) { warn("技能版本", `未找到已安装目录 ${installed}，跳过`); return; }
  if (stale.length) {
    warn("技能版本", `已安装副本落后于源码（技能只首次铺一次，属已知机制）：\n      ${stale.join("\n      ")}\n      处置：覆盖已安装目录，或删掉其 initialized 让它重铺（会覆盖用户改动）`);
  } else {
    console.log(`  ✓ 技能版本            ${names.length} 个技能与已安装副本一致`);
  }
}

// ── 4. i18n：各语言 key 集必须一致 ───────────────────────────────────
function checkLocales() {
  const dir = join(root, "packages", "i18n", "src", "locales");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter(name => name.endsWith(".json"));
  if (files.length < 2) return;
  const keySets = new Map();
  for (const file of files) {
    try {
      const keys = Object.keys(JSON.parse(readFileSync(join(dir, file), "utf8"))).sort();
      keySets.set(file, keys);
    } catch (error) {
      fail("i18n key", `${file} 解析失败：${error.message}`);
    }
  }
  const reference = keySets.get(files[0]);
  if (!reference) return;
  const problems = [];
  for (const [file, keys] of keySets) {
    if (file === files[0]) continue;
    const missing = reference.filter(key => !keys.includes(key));
    const extra = keys.filter(key => !reference.includes(key));
    if (missing.length || extra.length) {
      problems.push(`${file}: 缺 ${missing.length} 个、多 ${extra.length} 个${missing.length ? `（如 ${missing.slice(0, 3).join("、")}）` : ""}`);
    }
  }
  if (problems.length) fail("i18n key", problems.slice(0, 6).join("\n      "));
  else console.log(`  ✓ i18n key            ${files.length} 个语言 key 集一致（${reference.length} 个 key）`);
}

// ── 5. 音频格式白名单一致性 ──────────────────────────────────────────
// 踩过的坑：浏览器录出 webm/opus 直接提交百炼被拒；服务端 audioProcessor
// 又只吃 WAV 输入，前端得先转码。三方声明的格式必须互相覆盖。
function checkAudioFormats() {
  const generation = join(root, "apps", "server", "src", "utils", "media", "generation.ts");
  const voicePanel = join(root, "apps", "web", "src", "pages", "workspace", "panels", "canvas", "components", "voicePanel.vue");
  if (!existsSync(generation) || !existsSync(voicePanel)) return;
  const serverMimes = new Set(
    [...readFileSync(generation, "utf8").matchAll(/"(audio\/[a-zA-Z0-9.+-]+)":/g)].map(m => m[1]),
  );
  const declared = [...readFileSync(voicePanel, "utf8").matchAll(/"(audio\/[a-zA-Z0-9.+-]+)"/g)].map(m => m[1]);
  const unknown = declared.filter(mime => !serverMimes.has(mime));
  if (unknown.length) {
    fail("音频格式", `voicePanel 声明了服务端不支持的 MIME：${unknown.join("、")}\n      服务端白名单：${[...serverMimes].sort().join("、")}`);
  } else {
    console.log(`  ✓ 音频格式            voicePanel 的 ${declared.length} 个格式都在服务端白名单内`);
  }
}

// ── 6. 文档内部链接 ─────────────────────────────────────────────────
// 踩过的坑：canvas 技能引用了不存在的 ../script/references/assetGuide.md，
// agent 读到这里会找不到文件。
function checkDocLinks() {
  const root0 = join(root, "packages", "skills");
  if (!existsSync(root0)) return;
  const broken = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!name.endsWith(".md")) continue;
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("/")) continue;
        const resolved = resolve(dirname(path), target);
        if (!existsSync(resolved)) broken.push(`${rel(path)} → ${target}`);
      }
    }
  };
  walk(root0);
  if (broken.length) {
    warn("文档链接", `技能文档里有 ${broken.length} 个失效引用（agent 读到会找不到文件）：\n      ${broken.slice(0, 8).join("\n      ")}`);
  } else {
    console.log("  ✓ 文档链接            技能文档内的 .md 引用全部存在");
  }
}

// ── 执行 ───────────────────────────────────────────────────────────
console.log("开工断言 preflight\n");
checkModes();
checkPluginSync();
checkSkillVersions();
checkLocales();
checkAudioFormats();
checkDocLinks();

console.log("");
if (warnings.length) {
  console.log(`警告 ${warnings.length} 项：`);
  for (const { check, detail } of warnings) console.log(`  ⚠ ${check}\n      ${detail}`);
  console.log("");
}
if (failures.length) {
  console.log(`失败 ${failures.length} 项：`);
  for (const { check, detail } of failures) console.log(`  ✗ ${check}\n      ${detail}`);
  console.log("");
  process.exit(1);
}
console.log(warnings.length ? "全部必需项通过（有警告）" : "全部通过");
