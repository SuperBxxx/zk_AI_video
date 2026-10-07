import { mkdir } from "@toonflow/file";
import { stat } from "node:fs/promises";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 目录已经在了？（不需要拿锁就能判断） */
async function alreadyDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 幂等建目录。
 *
 * ACT: 这个接口的语义是「保证目录存在」，**已经存在就是成功**，不该报错。
 * 实测踩到过：营销模式一次铺 6 个 textNode，每个节点挂载时都去建同一个 `assets`
 * 目录（textNode 的 loadText 里先 mkdir("assets") 再 mkdir(`assets/${nodeId}`)）——
 * 并发之下 1 个拿到锁、其余 5 个撞 `lockWorkspaceFiles` 的 409
 * （「文件正在使用，请等待操作完成」），控制台刷出一片红，而它们想做的事其实已经成功。
 *
 * 顺序很重要：
 *   1. **先无锁探测**「已经是目录」→ 直接成功。重入、重复进入项目时全部走这条，零冲突。
 *   2. 还没建好才去拿锁建；拿不到锁就短退避重试（别的请求正在建同一个目录）。
 *   3. 建的时候撞 EEXIST 也算成功。
 */
async function ensureDirectory(path: string): Promise<void> {
  if (await alreadyDirectory(path)) return;

  // ACT: 上限 10 次、总等待约 1.1s —— 只覆盖「另一个请求正在建同一个目录」这种瞬时冲突。
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let release: (() => void) | undefined;
    try {
      release = u.workspaceFile.lockWorkspaceFiles([path]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      if (await alreadyDirectory(path)) return;
      await wait(20 * (attempt + 1));
      continue;
    }
    try {
      await mkdir(path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY") return;
      throw error;
    } finally {
      release();
    }
  }
  // 走到这里说明一直在被别人占用。最后再确认一次「其实已经建好了」。
  if (await alreadyDirectory(path)) return;
  throw Object.assign(new Error("目录正在被其它操作使用，请稍后重试"), { status: 409, code: "EBUSY" });
}

export default router.post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096) }), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  await ensureDirectory(path);
  res.json(success());
});
