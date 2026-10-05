import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "assetLibrary",
  displayName: "素材库",
  description: "浏览全局素材库，并把其中的图片、视频或音频导入工作区与画布。",
  prompt: `素材库是跨项目共用的素材仓库（与当前工作目录无关），用户上传的素材、生成的内容和声音音色都在里面。
用户说「把素材库某个文件夹的内容放到画布」「用素材库里的图片/音频」时，先用 listAssets 看清实际有哪些文件，再按需要 importAssets；不要凭猜测填写路径。
importAssets 会把素材复制进工作区并放到画布上：图片进图片节点、视频进视频节点、音频进音频节点，返回值里给出落地后的工作区路径，后续节点引用要用这个路径而不是素材库路径。
只导入用户点到或明确需要的那部分，不要整库导入。`,
  author: "住凯AI视频",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [
    { type: "inputNumber", field: "maxEntries", title: "单次最多列出条目", value: 200, props: { min: 10, max: 1000, step: 10 } },
    { type: "inputNumber", field: "maxImport", title: "单次最多导入素材", value: 20, props: { min: 1, max: 100, step: 1 } },
  ],
}, import.meta.url);
