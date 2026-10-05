import { t } from "@/lib/i18n";
import { listMediaModels, generateMedia } from "@/utils/media/generation";
import { createWorkspaceFfmpeg } from "@/utils/ffmpeg";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { access, constants, copyFile, lstat, mkdir, readFile, readdir, rm, rmdir, stat, withFileAccess } from "@toonflow/file";
import {
  defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { CanvasContext, QuestionContext, ToolContext, ToolFiles } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { isWithin, resolveWorkspacePath, writeWorkspaceFile, renameWorkspaceFile, lockWorkspaceFiles, protectWorkspaceRoot } from "@/utils/workspace/files";
import { listTools, loadTool, validateToolConfig } from "@/utils/plugins/tools";
import { createSkillContext } from "@/agent/skills";
import { getAssetsDirectory } from "@/utils/assets";

export function createAgentToolContext(cwd: string, config: Record<string, unknown> = {}, canvas?: CanvasContext, question?: QuestionContext): ToolContext {
  const skillsDirectory = join(dirname(conf.path), "skills");
  const assetsDirectory = join(dirname(conf.path), "assets");
  const resolvePath = async (path: string, readOnly = false) => {
    const absolute = resolve(cwd, path);
    // ACT: 只读时额外放行两个工作区之外的根 —— 技能目录与全局素材库。
    // 两者都是宿主自己的目录，不是任意路径；写操作仍然只能落在工作区内。
    const root = readOnly && isWithin(skillsDirectory, absolute) ? skillsDirectory
      : readOnly && isWithin(assetsDirectory, absolute) ? assetsDirectory
      : cwd;
    return (await resolveWorkspacePath(root, relative(root, absolute), true)).path;
  };
  const withWritePaths = async (paths: string[], operation: (targets: string[]) => Promise<void>) => {
    const targets = await Promise.all(paths.map(path => resolvePath(path)));
    const release = lockWorkspaceFiles(targets);
    try { await operation(targets); }
    finally { release(); }
  };
  const files: ToolFiles = {
    readFile: async (path, readOnly = false) => readFile(await resolvePath(path, readOnly)),
    access: async (path, readOnly = false) => access(await resolvePath(path, readOnly)),
    stat: async (path, readOnly = false) => stat(await resolvePath(path, readOnly)),
    readdir: async (path, readOnly = false) => readdir(await resolvePath(path, readOnly)),
    detectImageMimeType: async (path, readOnly = false) => {
      const target = await resolvePath(path, readOnly);
      return withFileAccess([target], "read", () => detectSupportedImageMimeTypeFromFile(target));
    },
    writeFile: (path, content, exclusive = false) => withWritePaths([path], async ([target]) => {
      await writeWorkspaceFile(target, content, exclusive);
    }),
    mkdir: (path, recursive = false) => withWritePaths([path], async ([target]) => {
      await mkdir(target, { recursive });
    }),
    rename: (path, target) => withWritePaths([path, target], async ([source, destination]) => {
      protectWorkspaceRoot(cwd, source);
      protectWorkspaceRoot(cwd, destination);
      await renameWorkspaceFile(source, resolve(dirname(destination), basename(resolve(cwd, target))));
    }),
    remove: (path, recursive = false) => withWritePaths([path], async ([target]) => {
      protectWorkspaceRoot(cwd, target);
      if ((await lstat(target)).isDirectory() && !recursive) await rmdir(target);
      else await rm(target, { recursive });
    }),
    copyFile: (path, target, exclusive = false) => withWritePaths([path, target], async ([source, destination]) => {
      await copyFile(source, destination, exclusive ? constants.COPYFILE_EXCL : 0);
    }),
  };
  return {
    cwd, config, files, resolvePath, writeFile: files.writeFile, canvas, question, skills: createSkillContext(cwd),
    // 素材库在工作区之外且是全局的。这里只暴露「列出」与「导入到工作区」两个动作：
    // 画布节点的 set* 只接受工作区相对路径，所以导入必须先复制进工作区。
    assets: {
      readdir: async path => {
        const root = await getAssetsDirectory();
        const directory = path ? (await resolveWorkspacePath(root, path, true)).path : root;
        const entries = await readdir(directory, { withFileTypes: true });
        return Promise.all(entries
          .filter(entry => entry.isFile() || entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
          .map(async entry => {
            const target = join(directory, entry.name);
            const info = entry.isFile() ? await stat(target) : undefined;
            return {
              name: entry.name,
              path: relative(root, target).split(sep).join("/"),
              type: entry.isDirectory() ? "directory" as const : "file" as const,
              ...(info ? { size: info.size } : {}),
            };
          }));
      },
      importToWorkspace: async (path, targetDirectory = "assets/imported") => {
        const root = await getAssetsDirectory();
        const source = (await resolveWorkspacePath(root, path, true)).path;
        // 素材库内部允许同名文件夹，这里按 basename 落进工作区，重名时加序号避让。
        const name = basename(source);
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : "";
        const output = await resolveWorkspacePath(cwd, targetDirectory, true);
        await mkdir(output.path, { recursive: true });
        for (let index = 0; index < 100; index++) {
          const candidate = index === 0 ? name : `${stem}(${index})${extension}`;
          const target = (await resolveWorkspacePath(cwd, join(targetDirectory, candidate), true)).path;
          try {
            await copyFile(source, target, constants.COPYFILE_EXCL);
            return join(targetDirectory, candidate).split(sep).join("/");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
        throw new Error("同名素材过多，请先整理素材库或指定其他目标文件夹");
      },
    },
    ffmpeg: signal => createWorkspaceFfmpeg(cwd, signal),
    media: {
      listModels: listMediaModels,
      generateImage: (request, signal) => generateMedia(cwd, "image", request, signal),
      generateVideo: (request, signal) => generateMedia(cwd, "video", request, signal),
      generateAudio: (request, signal) => generateMedia(cwd, "audio", request, signal),
    },
    sdk: {
      defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
      detectSupportedImageMimeTypeFromFile: path => files.detectImageMimeType(path, true),
    },
  };
}

export async function createAgentTools(cwd: string, canvas?: CanvasContext, question?: QuestionContext): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const names = new Set<string>();
  const context = createAgentToolContext(cwd, {}, canvas, question);
  for (const item of await listTools()) {
    if (!item.enabled) continue;
    if (item.loadError) throw new Error(`${item.displayName}：${item.loadError}`);
    const { plugin, metadata } = await loadTool(item.name);
    const config = validateToolConfig(plugin, item.config);
    const definitions = await plugin.createTools({ ...context, config });
    for (const tool of definitions) {
      if (!tool.name || typeof tool.execute !== "function") throw new Error(t`${item.displayName} 返回了无效的工具`);
      if (names.has(tool.name)) throw new Error(t`工具名称重复：${tool.name}`);
      names.add(tool.name);
      tools.push({
        ...tool,
        promptGuidelines: [
          ...(metadata.prompt ? [metadata.prompt] : []),
          ...(tool.promptGuidelines ?? []),
        ],
      });
    }
  }
  return tools;
}
