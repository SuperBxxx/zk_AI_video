// 本地静态服务：把镜像下载来的 Electrobun devkit 产物喂给 hutch。
// 为什么需要它：hutch 内置的下载器走 https.get，在这台机器上到 GitHub 不通；
// 而它支持 DASH_ARTIFACTS_BASE_URL，且内部允许 http://127.0.0.1 —— 于是挂个本地服务即可，
// 无需改动 hutch 自身或绕过它的 sha256 校验。
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { resolve, normalize, join } from "node:path";

const root = "E:/ai_video/.tools/hutch/srv";
const port = 8899;

createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const target = normalize(join(root, urlPath));
  if (!target.startsWith(normalize(root))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  let stat;
  try {
    stat = statSync(target);
  } catch {
    console.log(`404 ${urlPath}`);
    res.writeHead(404).end("not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404).end("not a file");
    return;
  }
  console.log(`200 ${urlPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  res.writeHead(200, { "content-length": stat.size, "content-type": "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`静态产物服务已启动: http://127.0.0.1:${port}  ->  ${resolve(root)}`);
});
