// 把构建产物与技能源码同步到运行时目录（data/）。
//
// 为什么需要这个命令：插件与技能**只在首次铺入时写入** data/，之后重建不会覆盖
// （这是有意的 —— data/ 允许用户改）。但代价是：改了工具或技能后，运行时永远跑旧实现，
// 而没有任何命令能修。踩过两回：剪映导出接进工具后接口一直列不出来；
// workflow 技能停在 v2.7.0 而源码已到 v3.4.0，agent 用着落后 7 个版本的说明。
//
// 本命令**只覆盖「内容与来源不同」的文件**，并在覆盖前打印清单 ——
// 你改过的文件会出现在清单里，可以据此决定是否先备份。
//
// 用法：bun scripts/syncPlugins.mjs [--dry]
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");
const copied = [];
const unchanged = [];

/**
 * 逐文件把 source 下匹配 pattern 的文件同步到 target。
 * 只比内容：内容相同就跳过（避免无谓地改 mtime，也不动权限）。
 */
function syncFiles(source, target, pattern) {
  if (!existsSync(source) || !existsSync(target)) return;
  for (const name of readdirSync(source).filter(item => pattern.test(item))) {
    const from = join(source, name);
    if (!statSync(from).isFile()) continue;
    const to = join(target, name);
    if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) {
      unchanged.push(to);
      continue;
    }
    if (!dry) copyFileSync(from, to);
    copied.push(to);
  }
}

// 工具与节点的来源是 build/（构建产物）
syncFiles(join(root, "build", "tools"), join(root, "data", "tools"), /^[a-z][a-zA-Z0-9]*\.tool\.js$/);
syncFiles(join(root, "build", "nodes"), join(root, "data", "nodes"), /\.(js|mjs)$/);

// 技能的来源是 packages/skills/，且目录里还有 references/ 等子目录，要递归
function syncTree(source, target) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      if (!dry) mkdirSync(to, { recursive: true });
      syncTree(from, to);
      continue;
    }
    if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) {
      unchanged.push(to);
      continue;
    }
    if (!dry) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    copied.push(to);
  }
}

const skillsSource = join(root, "packages", "skills");
if (existsSync(skillsSource)) {
  for (const skill of readdirSync(skillsSource, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    // 目标不存在时不同步：新技能不该由本命令引入，
    // 「首次铺入」仍走服务端自己的机制（否则会绕过 initialized 标记的语义）。
    const target = join(root, "data", "skills", skill.name);
    if (existsSync(target)) syncTree(join(skillsSource, skill.name), target);
  }
}

const pretty = path => relative(root, path).replace(/\\/g, "/");
console.log(dry ? "将同步以下文件（--dry，未写入）：" : "已同步以下文件：");
if (!copied.length) console.log("  （无差异）");
for (const path of copied) console.log("  " + pretty(path));
console.log(`\n同步 ${copied.length} 个文件，${unchanged.length} 个已是最新。`);
console.log("覆盖会丢掉你在 data/ 里对这些文件的手工改动（本命令不做备份）。");
