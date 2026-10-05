// 校验 createModes 生成的预置画布结构。
// 重点：连线的 sourceHandle / targetHandle 必须真的存在于对应节点类型的端口表里 ——
// 写错端口 id 的画布在打开时会连不上或报"连接无效"，而构建不会报错。
// 用 Bun 直接导入 TS，避免手工复制数据造成校验的是另一份东西。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createModes } from "../apps/web/src/pages/home/createModes";

const nodesRoot = "E:/ai_video/zk-video/packages/nodes";

const handles = {};
for (const dir of readdirSync(nodesRoot)) {
  const ui = `${nodesRoot}/${dir}/src/index.vue`;
  const cfg = `${nodesRoot}/${dir}/vite.config.ts`;
  if (!existsSync(ui) || !existsSync(cfg)) continue;
  const name = /name:\s*"([^"]+)"/.exec(readFileSync(cfg, "utf8"))?.[1];
  if (!name) continue;
  const src = readFileSync(ui, "utf8");
  const list = [];
  for (const m of src.matchAll(/\{\s*id:\s*"([^"]+)",\s*type:\s*"(source|target)"/g)) list.push({ id: m[1], type: m[2] });
  handles[`remote-${name}`] = list;
}

console.log("=== 从节点定义解析出的端口 ===");
for (const [type, list] of Object.entries(handles)) {
  console.log(`  ${type.padEnd(22)} ${list.map(h => `${h.id}(${h.type})`).join("  ") || "（无）"}`);
}

console.log("\n=== 校验各模式的预置画布 ===");
let fail = 0;
for (const mode of createModes) {
  const { nodes, edges } = mode.build();
  const ids = new Set(nodes.map(n => n.id));
  const problems = [];
  if (ids.size !== nodes.length) problems.push("节点 id 重复");
  for (const n of nodes) {
    if (!handles[n.type]) problems.push(`未知节点类型 ${n.type}`);
    if (typeof n.position?.x !== "number" || typeof n.position?.y !== "number") problems.push(`${n.id} 坐标非法`);
    const label = n.data?.label;
    if (typeof label !== "string" || !label.trim()) problems.push(`${n.id} 缺 label`);
  }
  const edgeIds = new Set();
  for (const e of edges) {
    if (edgeIds.has(e.id)) problems.push(`连线 id 重复: ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.source)) problems.push(`连线 ${e.id} source 不存在: ${e.source}`);
    if (!ids.has(e.target)) problems.push(`连线 ${e.id} target 不存在: ${e.target}`);
    const s = nodes.find(n => n.id === e.source);
    const t = nodes.find(n => n.id === e.target);
    if (s && !handles[s.type].some(h => h.id === e.sourceHandle && h.type === "source")) {
      problems.push(`连线 ${e.id}: ${s.type} 无 source 端口 "${e.sourceHandle}"`);
    }
    if (t && !handles[t.type].some(h => h.id === e.targetHandle && h.type === "target")) {
      problems.push(`连线 ${e.id}: ${t.type} 无 target 端口 "${e.targetHandle}"`);
    }
  }
  if (problems.length) { fail++; console.log(`  ✗ ${mode.id}`); problems.forEach(p => console.log(`      ${p}`)); }
  else console.log(`  ✓ ${mode.id.padEnd(12)} ${mode.label.padEnd(12)} ${nodes.length} 节点 / ${edges.length} 连线`);
}
console.log(fail ? `\n${fail} 个模式有问题` : "\n全部通过");
