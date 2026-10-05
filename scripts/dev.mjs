// 并行启动 Web（Vite）与服务端，替代 `bun run dev`。
//
// 为什么需要这个脚本：根 package.json 的 dev 是
//   bun run --filter '@toonflow/web' --filter '@toonflow/server' dev
// 实测该写法**只会启动第一个 filter**（服务端），Vite 不会启动，
// 于是 3000 端口由 Express 提供 build/web 的**上一次构建产物** ——
// 表现就是"改了代码但界面没变"，且没有任何报错。
//
// 本脚本显式并行启动两个子进程，stdio 继承（便于在终端看到两个前缀的输出），
// 任一退出即结束另一个，Ctrl+C 也会一起停。
import { spawn } from "node:child_process";

const bun = process.execPath;
const jobs = [
  { name: "web", color: "\x1b[36m", args: ["run", "--filter", "@toonflow/web", "dev"] },
  { name: "server", color: "\x1b[35m", args: ["run", "--filter", "@toonflow/server", "dev"] },
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.exitCode = code;
}

for (const job of jobs) {
  const child = spawn(bun, job.args, { cwd: process.cwd(), stdio: "inherit", env: process.env });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`\n[${job.name}] 退出（code=${code} signal=${signal}），停止其余进程`);
    stopAll(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(`[${job.name}] 启动失败：${error.message}`);
    stopAll(1);
  });
  console.log(`${job.color}[${job.name}]\x1b[0m 已启动：bun ${job.args.join(" ")}`);
}

console.log("\n  Web     http://localhost:5173   ← 页面看这个");
console.log("  服务端   http://localhost:3000   ← API，Vite 会把 /api 代理过去\n");
console.log("  提示：改 packages/** 后需重启（工作区包不在 Vite 监听范围内）\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(0));
}
