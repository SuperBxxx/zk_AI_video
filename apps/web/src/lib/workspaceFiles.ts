import axios from "axios";
import { toValue, type MaybeRefOrGetter } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerApiLanguage } from "@/lib/i18n";

type WorkspaceEntry = { name: string; path: string; type: "file" | "directory" };
const client = axios.create({ baseURL: "/api/workspaces/files", headers: { "x-toonflow-workspace": "1" } });
registerApiLanguage(client);
const fileUrls = new Map<string, { directory: string; path: string; url: Promise<string>; users: number }>();

function cachePath(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(part => part && part !== ".").join("/").toLowerCase();
}

function invalidateUrls(directory: string, path: string) {
  // ACT: 仅失效时保守合并路径写法；实际读取仍交服务端校验，区分大小写的文件最多多读一次。
  directory = cachePath(directory);
  path = cachePath(path);
  for (const [key, entry] of fileUrls) {
    const entryPath = cachePath(entry.path);
    if (cachePath(entry.directory) === directory && (entryPath === path || entryPath.startsWith(`${path}/`))) fileUrls.delete(key);
  }
}

export default function useWorkspaceFiles(directory?: MaybeRefOrGetter<string | undefined>) {
  const workspace = directory === undefined ? useWorkspaceStore() : undefined;
  function getDirectory() {
    const path = directory === undefined ? workspace?.project?.directory : toValue(directory);
    if (!path) throw new Error("请先选择工作目录");
    return path;
  }

  async function list(path = "") {
    const { data } = await client.get<{ data: { directory: string; empty: boolean; entries: WorkspaceEntry[] } }>("/list", { params: { directory: getDirectory(), path } });
    return data.data;
  }

  async function read(path: string) {
    const { data } = await client.get<ArrayBuffer>("/read", { params: { directory: getDirectory(), path }, responseType: "arraybuffer" });
    return data;
  }

  function acquireUrl(path: string, mimeType?: string) {
    const directory = getDirectory();
    const key = JSON.stringify([directory, path, mimeType]);
    let entry = fileUrls.get(key);
    if (!entry) {
      const url = client.get<Blob>("/read", { params: { directory, path }, responseType: "blob" })
        .then(({ data }) => URL.createObjectURL(mimeType ? new Blob([data], { type: mimeType }) : data));
      entry = { directory, path, url, users: 0 };
      fileUrls.set(key, entry);
      const current = entry;
      void url.catch(() => { if (fileUrls.get(key) === current) fileUrls.delete(key); });
    }
    const current = entry;
    current.users++;
    let released = false;
    return {
      url: current.url,
      release() {
        if (released) return;
        released = true;
        if (--current.users) return;
        if (fileUrls.get(key) === current) fileUrls.delete(key);
        // 等待中的读取也要在最后一个使用者离开后释放，不撤销其他节点仍使用的 URL。
        void current.url.then(url => URL.revokeObjectURL(url), () => {});
      },
    };
  }

  async function readText(path: string, maxBytes?: number) {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("读取字节数必须为正整数");
    try {
      const { data } = await client.get<string>("/read", {
        params: { directory: getDirectory(), path }, responseType: "text", transformResponse: [],
        headers: maxBytes === undefined ? undefined : { Range: `bytes=0-${maxBytes - 1}` },
      });
      return data;
    } catch (error) {
      if (maxBytes !== undefined && axios.isAxiosError(error) && error.response?.status === 416 && error.response.headers["content-range"] === "bytes */0") return "";
      throw error;
    }
  }

  async function readJson<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await readText(path));
  }

  async function write(path: string, content: string | Blob | ArrayBuffer, exclusive = false, signal?: AbortSignal) {
    const directory = getDirectory();
    await client.put("/write", content, { params: { directory, path, exclusive }, signal, headers: { "Content-Type": "application/octet-stream" } });
    invalidateUrls(directory, path);
  }

  function writeJson(path: string, data: unknown, exclusive = false) {
    return write(path, `${JSON.stringify(data, null, 2)}\n`, exclusive);
  }

  async function rename(path: string, target: string) {
    const directory = getDirectory();
    await client.post("/rename", { directory, path, target });
    invalidateUrls(directory, path);
    invalidateUrls(directory, target);
  }

  async function remove(path: string, recursive = false) {
    const directory = getDirectory();
    await client.delete("/remove", { data: { directory, path, recursive } });
    invalidateUrls(directory, path);
  }

  async function mkdir(path: string) {
    await client.post("/mkdir", { directory: getDirectory(), path });
  }

  /**
   * 把工作区里的视频转成通用可解码的 H.264，返回**工作区相对路径**。
   *
   * ACT: 微信/苹果导出的 mp4 多是 HEVC，桌面端（WebView2）没有 HEVC 解码器 ——
   * 素材库预览会「有声音没画面」，把参考视频送进模型同样不可用。
   * 服务端探到通用编码（h264/vp8/vp9/av1）时直接返回原路径，不做无谓转码。
   * 副本按原文件缓存，同一素材只转一次。
   */
  async function prepareVideo(path: string) {
    const { data } = await client.post<{ code: number; data: { path: string; original: boolean; elapsedMs: number }; message?: string }>(
      "/prepareVideo",
      { directory: getDirectory(), path },
      { timeout: 300000 },
    );
    if (data.code !== 200 || !data.data?.path) throw new Error(data.message || `参考视频处理失败：${path}`);
    return data.data.path;
  }

  /**
   * 从链接取流：把一个视频页面链接下载成工作区里的本地文件。
   *
   * ACT: 服务端在 yt-dlp 缺失时会**按需下载并校验**，所以这里不需要前端先引导安装。
   * 站点要求登录态（如部分抖音视频）时下载会失败，错误信息由服务端透出 ——
   * 那时应引导用户手动导出成本地文件，而不是反复重试。
   */
  async function fetchVideo(url: string, name?: string) {
    const { data } = await client.post<{ code: number; data: { path: string; duration: number | null; width: number | null; height: number | null; hasAudio: boolean }; message?: string }>(
      "/videoFetch",
      { directory: getDirectory(), url, name },
      { timeout: 1800000 },
    );
    if (data.code !== 200 || !data.data?.path) throw new Error(data.message || "下载失败");
    return data.data;
  }

  // ACT: 当前目录逐次读取；跨 await 或防抖的操作传入目录字符串，固定本次目标。
  return { list, read, acquireUrl, readText, readJson, write, writeJson, rename, remove, mkdir, prepareVideo, fetchVideo };
}
