<template>
  <el-card v-if="visible" class="assetLibrary" :class="{ filled }" shadow="never" :bodyStyle="{ padding: '8px' }" role="region" aria-label="素材库" @dblclick.stop>
    <el-radio-group v-model="activeTab" class="libraryTabs" size="small" aria-label="素材库分页">
      <el-radio-button value="asset">素材</el-radio-button>
      <el-radio-button value="voice">声音</el-radio-button>
    </el-radio-group>
    <template v-if="activeTab === 'asset'">
      <div class="libraryToolbar">
      <el-input v-model="searchQuery" class="searchInput" :prefixIcon="IconSearch" placeholder="搜索素材" aria-label="搜索素材" clearable @keydown.esc.stop="searchQuery = ''" />
      <el-button class="toolbarButton" text :icon="IconFolderPlus" title="新建文件夹" aria-label="新建文件夹" :disabled="newFolderParent !== undefined" @click="startFolder" />
      <el-button class="toolbarButton" text :icon="IconUpload" :loading="uploading" title="上传素材到当前文件夹" aria-label="上传素材" @click="uploadInput?.click()" />
      <input ref="uploadInput" class="uploadInput" type="file" multiple aria-label="选择要上传的素材" @change="uploadFiles" />
      <el-button class="toolbarButton" text :icon="IconX" title="关闭素材库" aria-label="关闭素材库" @click="visible = false" />
    </div>
    <!-- 上传目标必须一直看得见：原先只有上传按钮的 tooltip 提了一句，
         提示消失后就无法判断文件会落到哪里。 -->
    <div class="uploadTarget">
      上传到：<el-text tag="strong" size="small">{{ folderLabel }}</el-text>
    </div>
    <el-scrollbar class="libraryScroll" :maxHeight="scrollMaxHeight">
      <el-tree ref="assetTree" class="assetTree" :data="displayEntries" nodeKey="path" :props="{ label: 'name' }" :currentNodeKey="folder === '.' ? undefined : folder" :filterNodeMethod="filterEntry" defaultExpandAll highlightCurrent emptyText="" @nodeClick="selectFolder">
        <template #default="{ data }">
          <div class="assetEntry" :title="data.name" :draggable="canUseInCanvas && data.type === 'file'" @dragstart.stop="canUseInCanvas && startAssetDrag($event, data)" @dblclick.stop="openPreview(data)" @contextmenu="openItemMenu($event, data)">
            <icon-folder-filled v-if="data.type === 'directory'" class="folderIcon" :size="30" />
            <el-image v-else-if="mediaKind(data) === 'image'" class="assetThumbnail" :src="assetUrl(data.path)" fit="cover" loading="lazy" draggable="false" @click.stop="openPreview(data)">
              <template #error><icon-photo :size="22" /></template>
            </el-image>
            <span v-else class="fileIcon">
              <icon-music v-if="mediaKind(data) === 'audio'" :size="24" />
              <icon-video v-else-if="mediaKind(data) === 'video'" :size="24" />
              <icon-file v-else :size="24" />
            </span>
            <el-input v-if="data.draft" ref="folderInput" v-model="newFolderName" class="folderNameInput" size="small" aria-label="文件夹名称" :disabled="folderSaving" @click.stop @keydown.stop @keydown.enter.prevent="saveFolder" @keydown.esc.prevent="cancelFolder" @blur="saveFolder" />
            <span v-else class="assetName">{{ data.name }}</span>
            <el-button v-if="mediaKind(data)" class="moreButton" text :icon="IconEye" :aria-label="'预览 ' + data.name" title="预览（也可双击素材）" @click.stop="openPreview(data)" />
            <el-button v-if="!data.draft" class="moreButton" text :icon="IconDots" :aria-label="'更多 ' + data.name" title="更多" @click.stop="openItemMenu($event, data)" />
          </div>
        </template>
      </el-tree>
      <!-- 空目录提示：el-tree 的 emptyText 被设为空串，没有这段的话空素材库
           与「组件坏掉」看起来完全一样。 -->
      <el-text v-if="!displayEntries.length" class="emptyHint" size="small" type="info">
        素材库还是空的。用上方工具栏的上传按钮添加素材，或到「声音」分页创建音色。
      </el-text>
    </el-scrollbar>
    <div v-if="previewAsset?.kind === 'audio'" class="audioPreview">
      <div class="audioHeader">
        <span :title="previewAsset.name">{{ previewAsset.name }}</span>
        <el-button text :icon="IconX" aria-label="关闭音频预览" @click="previewAsset = undefined" />
      </div>
      <el-alert v-if="previewError" :title="previewError" type="error" :closable="false" showIcon />
      <audio v-else :key="previewAsset.url" :src="previewAsset.url" :aria-label="previewAsset.name" controls preload="metadata" @error="previewError = '音频无法播放，文件可能已损坏或当前浏览器不支持其编码。'" />
    </div>
    </template>
    <!-- 声音面板：克隆与设计出的音色以 json 素材存在素材库的声音文件夹里，
         因此与素材浏览同属一个素材库界面，用分页而不是另开浮层。 -->
    <el-scrollbar v-else class="libraryScroll" :maxHeight="scrollMaxHeight">
      <voicePanel :voiceFolder="voiceFolder" :directory="directory" @saved="refreshAssets()" />
    </el-scrollbar>
  </el-card>

  <assetMenu v-if="visible" ref="assetMenuRef" :entries="entries" @changed="refreshAssets" />

  <el-image-viewer v-if="previewAsset?.kind === 'image'" :urlList="[previewAsset.url]" teleported @close="previewAsset = undefined" />

  <el-dialog :modelValue="previewAsset?.kind === 'video'" :title="previewAsset?.name" width="min(800px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose @update:modelValue="previewAsset = undefined">
    <div v-if="previewAsset?.kind === 'video'" class="assetPreview">
      <!-- ACT: 放不了时**自动转一份 H.264 预览副本**再播，而不是只报错。
           为什么是转码不是内置解码器：HEVC 是专利收费编码，随包分发解码器要商业许可
           （微软的 HEVC 扩展卖 $0.99 就是替用户付这笔钱）；转码属于"我处理素材"，
           用户端无感（实测 12.9s 素材 0.7 秒转完）。原始素材不动。
           「有元数据但 videoWidth 为 0」正是 HEVC 在 WebView2 下的表现：有声音没画面。 -->
      <template v-if="transcoding">
        <el-alert :title="`这个视频的编码浏览器放不了，正在转成可播放的预览副本…`" type="info" :closable="false" show-icon />
        <div class="previewActions"><el-text size="small" type="info">首次打开需要转码，之后同一文件会直接复用副本。也可以先 <el-link :href="downloadUrl(previewAsset.path)" :download="previewAsset.name">下载原文件</el-link>。</el-text></div>
      </template>
      <template v-else-if="previewError">
        <el-alert :title="previewError" type="error" :closable="false" show-icon />
        <div class="previewActions">
          <el-button :icon="IconRefresh" @click="retryPreview()">重试</el-button>
          <el-button :icon="IconDownload" tag="a" :href="downloadUrl(previewAsset.path)" :download="previewAsset.name">下载原文件</el-button>
        </div>
      </template>
      <video v-else :key="previewAsset.url" class="previewVideo" :src="previewAsset.url" :aria-label="previewAsset.name" controls playsinline preload="metadata" @loadeddata="onPreviewLoaded" @error="onPreviewError" />
    </div>
  </el-dialog>

  <el-dialog v-model="saveVisible" title="保存到素材库" width="460px" alignCenter appendToBody :closeOnClickModal="false" @opened="assetNameInput?.select()">
    <el-form class="saveForm" labelPosition="top" @submit.prevent="saveAsset">
      <el-form-item label="素材名称">
        <el-input ref="assetNameInput" v-model="assetName" aria-label="素材名称" placeholder="输入完整文件名" :disabled="saving" @keydown.enter.prevent="saveAsset" />
      </el-form-item>
      <el-form-item v-if="outputs.length > 1" label="节点输出">
        <el-select v-model="selectedOutput" aria-label="节点输出" :disabled="saving">
          <el-option v-for="(item, index) in outputs" :key="index" :label="item.label" :value="index" />
        </el-select>
      </el-form-item>
      <div class="saveLocation">
        <div class="locationHeader">
          <span>保存位置</span>
          <el-button text :icon="IconFolderPlus" :disabled="saving || saveFolderName !== undefined" @click="startSaveFolder">新建文件夹</el-button>
        </div>
        <div class="locationPath" :title="saveLocationLabel">{{ saveLocationLabel }}</div>
        <el-scrollbar class="saveFolderScroll" maxHeight="220px">
          <el-tree class="saveFolderTree" :data="folders" nodeKey="path" :props="{ label: 'name' }" :currentNodeKey="saveDirectory" :expandOnClickNode="false" defaultExpandAll highlightCurrent @nodeClick="(entry: AssetEntry) => { if (!saving && saveFolderName === undefined) saveDirectory = entry.path; }">
            <template #default="{ data }">
              <span class="saveFolderEntry"><icon-folder-filled :size="20" /><span>{{ data.name }}</span></span>
            </template>
          </el-tree>
        </el-scrollbar>
        <div v-if="saveFolderName !== undefined" class="createFolderRow">
          <el-input ref="saveFolderInput" v-model="saveFolderName" aria-label="新文件夹名称" :disabled="folderSaving" @keydown.enter.prevent="createFolder" @keydown.esc.stop="saveFolderName = undefined" />
          <el-button :loading="folderSaving" :disabled="!saveFolderName.trim()" @click="createFolder">创建</el-button>
          <el-button text :disabled="folderSaving" @click="saveFolderName = undefined">取消</el-button>
        </div>
      </div>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="saveVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!assetName.trim() || /[\\/]/.test(assetName) || saveFolderName !== undefined" @click="saveAsset">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import axios from "axios";
import { ElMessage, ElTree, type InputInstance, type TreeNodeData } from "element-plus";
import { IconDots, IconDownload, IconEye, IconFile, IconFolderFilled, IconFolderPlus, IconMusic, IconPhoto, IconRefresh, IconSearch, IconUpload, IconVideo, IconX } from "@tabler/icons-vue";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import { startAssetDrag } from "../canvasDrop";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import assetMenu from "./assetMenu.vue";
import voicePanel from "./voicePanel.vue";

type AssetEntry = { name: string; path: string; type: "file" | "directory"; children?: AssetEntry[]; draft?: boolean };
type AssetOutput = { label: string; output: NodeOutput };

const props = defineProps<{ directory?: string; canvas?: boolean; fill?: boolean }>();
// ACT: 画布里的素材库是浮层，宽度固定 320px；放进对话框（fill）时需要撑满并给内容区足够高度，
// 否则 320px 宽度与 max-height 会把内容区压成 0，表现为「对话框打开了但里面什么都没有」。
const filled = computed(() => props.fill === true);
// 浮层里限高避免超出画布；对话框里不限高，改由 .filled 的 min-height 撑开内容区。
const scrollMaxHeight = computed(() => filled.value ? "none" : "min(440px, calc(100dvh - 198px))");
const directory = computed(() => props.directory);
// 音色按 D3 以 json 素材存在素材库的这个文件夹里，方便与素材一起浏览与备份。
const voiceFolder = "声音";
const activeTab = ref<"asset" | "voice">("asset");
// ACT: 画布专属能力（拖拽到画布、保存节点输出）只在画布内启用。
// 素材库本身的数据是全局的（服务端 6 个接口都以 {数据目录}/assets 为根），
// 因此首页等画布之外的场景传入 canvas=false 复用同一个组件，不必抽两份实现。
// ACT: 原先是 `props.canvas !== false`。实测画布里的实例读出来竟是 canvas=false（见 openSave 的注释），
// 那个开关不可靠；能不能用画布专属能力，真实依据是**有没有项目目录**
// —— 画布与对话框两种用法都会传 directory，首页的素材库不传。
const canUseInCanvas = computed(() => Boolean(props.directory));
const visible = defineModel<boolean>({ default: false });
const saveVisible = ref(false);
const saving = ref(false);
const entries = ref<AssetEntry[]>([]);
const folder = ref(".");
const assetName = ref("");
const assetNameInput = ref<InputInstance>();
const saveDirectory = ref(".");
const saveFolderName = ref<string>();
const saveFolderInput = ref<InputInstance>();
const saveLocationLabel = computed(() => saveDirectory.value === "." ? "素材库" : `素材库 / ${saveDirectory.value.split("/").join(" / ")}`);
const searchQuery = ref("");
const assetTree = ref<InstanceType<typeof ElTree>>();
const folderInput = ref<InputInstance>();
const newFolderParent = ref<string>();
const newFolderName = ref("");
const folderSaving = ref(false);
const uploading = ref(false);
const uploadInput = ref<HTMLInputElement>();
const assetMenuRef = ref<InstanceType<typeof assetMenu>>();
const previewAsset = ref<{ name: string; url: string; kind: "image" | "audio" | "video"; path: string }>();
const previewError = ref("");
/** 正在为这个视频生成 H.264 预览副本（HEVC 等浏览器放不了的编码）。 */
const transcoding = ref(false);
let loadRequest = 0;
onBeforeUnmount(() => { loadRequest++; clearPreviewProbeTimer(); });

function assetUrl(path: string) {
  return `/api/assets/read?path=${encodeURIComponent(path)}`;
}

/** 下载原文件（放不了时的兜底：至少能拿到文件）。 */
function downloadUrl(path: string) {
  return `/api/assets/read?path=${encodeURIComponent(path)}&download=true`;
}

/**
 * 浏览器放不了的**常见编码/封装**。
 *
 * ACT: 这些不是「文件损坏」，是浏览器没有对应解码器。实测（Chrome，与本机 WebView2 同源）：
 *   · mpeg4（MPEG-4 Part 2）→ readyState 一直 0、**有声音没画面**、play() 也不报错
 *     —— 这正是 **ffmpeg 不带 -c:v 时的默认编码**，所以「随手导出的 mp4 打不开」多半是它
 *   · prores(.mov)、mpeg2、mxf 等 → 直接 `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`
 *   · h264 / h265(部分环境) / vp9 正常
 * 分开说清楚，用户才知道该转码，而不是以为素材坏了。
 */
const unplayableByExtension: Record<string, string> = {
  mov: "ProRes / DNxHD 等剪辑编码",
  mxf: "MXF（广播/相机封装）",
  mts: "AVCHD",
  m2ts: "AVCHD",
  vob: "DVD (MPEG-2)",
  mpg: "MPEG-2",
  mpeg: "MPEG-2",
  wmv: "Windows Media",
  flv: "Flash Video",
};

/** 探测超时阈值：mpeg4 这种会让 video 既不 loadedmetadata 也不 error。 */
const previewProbeTimeout = 6000;
let previewProbeTimer: ReturnType<typeof setTimeout> | undefined;

function clearPreviewProbeTimer() {
  if (previewProbeTimer !== undefined) {
    clearTimeout(previewProbeTimer);
    previewProbeTimer = undefined;
  }
}

/**
 * 自动生成 H.264 预览副本并改播副本。
 *
 * ACT: 这是 `videoWidth === 0`（有声音没画面）与解码报错的**主路径**，
 * 不是"给用户一个按钮" —— 用户不该知道 HEVC 是什么。
 */
async function transcodePreview() {
  const asset = previewAsset.value;
  if (!asset || transcoding.value) return;
  transcoding.value = true;
  previewError.value = "";
  clearPreviewProbeTimer();
  try {
    const { data } = await axios.post<{ code: number; data: { key: string; original: boolean }; message?: string }>(
      "/api/assetPreviewCreate",
      { path: asset.path },
      { headers: { "x-toonflow-workspace": "1" }, timeout: 120000 },
    );
    if (data.code !== 200 || !data.data?.key) throw new Error(data.message || "生成预览副本失败");
    if (previewAsset.value !== asset) return; // 用户已经切走了
    previewAsset.value = { ...asset, url: `/api/assetPreviewRead?key=${encodeURIComponent(data.data.key)}` };
    armPreviewProbe();
  } catch (error) {
    if (previewAsset.value !== asset) return;
    const detail = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message : undefined;
    previewError.value = `${detail || (error instanceof Error ? error.message : "生成预览副本失败")}。可以「重试」，或先下载原文件用其他播放器打开。`;
  } finally {
    transcoding.value = false;
  }
}

function onPreviewError() {
  clearPreviewProbeTimer();
  const code = document.querySelector<HTMLVideoElement>(".previewVideo")?.error?.code;
  if (code === MediaError.MEDIA_ERR_NETWORK) {
    previewError.value = "读取视频时网络中断，请重试。";
    return;
  }
  void transcodePreview();
}

/** video 既没 loadedmetadata 也没 error 时（HEVC 就是这种）兜住，别让它一直黑着。 */
function onPreviewLoaded() {
  clearPreviewProbeTimer();
}

function armPreviewProbe() {
  clearPreviewProbeTimer();
  previewProbeTimer = setTimeout(() => {
    // 已经能读出画面尺寸就说明解出来了，不动
    const video = document.querySelector<HTMLVideoElement>(".previewVideo");
    if (!video || video.videoWidth > 0) return;
    void transcodePreview();
  }, previewProbeTimeout);
}

function retryPreview() {
  if (!previewAsset.value) return;
  const { name, path, kind } = previewAsset.value;
  previewError.value = "";
  // 换一个 url 让 video 重新加载（同 url 会被浏览器沿用失败状态）
  previewAsset.value = { name, path, kind, url: `${assetUrl(path)}&retry=${Date.now()}` };
  armPreviewProbe();
}

function mediaKind(entry: AssetEntry) {
  if (entry.type !== "file" || entry.draft) return;
  if (/\.(avif|apng|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(entry.name)) return "image";
  if (/\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(entry.name)) return "audio";
  if (/\.(mp4|m4v|webm|mov|mkv|avi|ogv|mxf|mts|m2ts|vob|mpg|mpeg|ts|wmv|flv)$/i.test(entry.name)) return "video";
}

function openPreview(entry: AssetEntry) {
  const kind = mediaKind(entry);
  if (!kind) return;
  previewError.value = "";
  transcoding.value = false;
  previewAsset.value = { name: entry.name, path: entry.path, url: assetUrl(entry.path), kind };
  if (kind === "video") armPreviewProbe();
}

function openItemMenu(event: MouseEvent, entry: AssetEntry) {
  if (entry.draft) return;
  event.preventDefault();
  event.stopPropagation();
  assetMenuRef.value?.openMenu(event, entry);
}

async function refreshAssets(path?: string, target?: string) {
  if (path && (folder.value === path || folder.value.startsWith(path + "/"))) {
    folder.value = target ? target + folder.value.slice(path.length) : ".";
  }
  try { await loadEntries(); } catch (error) { showError(error); }
}
const displayEntries = computed(() => {
  function withDraft(items: AssetEntry[], parent: string): AssetEntry[] {
    const children = items.map(item => item.children ? { ...item, children: withDraft(item.children, item.path) } : item);
    if (newFolderParent.value === parent) children.push({ name: "新建文件夹", path: `${parent}/:newFolder`, type: "directory", draft: true });
    return children;
  }
  return newFolderParent.value === undefined ? entries.value : withDraft(entries.value, ".");
});

function filterEntry(query: string, entry: TreeNodeData) {
  return !!entry.draft || entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

watch(searchQuery, query => assetTree.value?.filter(query));

async function startFolder() {
  searchQuery.value = "";
  newFolderParent.value = folder.value;
  newFolderName.value = "新建文件夹";
  await nextTick();
  assetTree.value?.getNode(folder.value)?.expand();
  await nextTick();
  folderInput.value?.select();
}

function cancelFolder() {
  newFolderParent.value = undefined;
}

async function saveFolder() {
  if (newFolderParent.value === undefined || folderSaving.value) return;
  const name = newFolderName.value.trim();
  if (!name) return cancelFolder();
  const parent = newFolderParent.value;
  folderSaving.value = true;
  try {
    await createAssetFolder(parent, name);
    cancelFolder();
    await loadEntries();
    folder.value = parent;
  } catch (error) {
    showError(error);
    await nextTick();
    folderInput.value?.focus();
  } finally {
    folderSaving.value = false;
  }
}

const outputs = ref<AssetOutput[]>([]);
const selectedOutput = ref(0);
let sourceDirectory: string | undefined;
const folders = computed(() => directoryEntries(entries.value));
const extension = computed(() => {
  const output = outputs.value[selectedOutput.value]?.output;
  if (!output) return "";
  if (typeof output.value !== "object") return output.dataType === "STRING" ? ".txt" : ".json";
  return output.value.url.match(/\.[^./\\]+$/)?.[0] ?? "";
});

function directoryEntries(items: AssetEntry[]): AssetEntry[] {
  return items.filter(item => item.type === "directory").map(item => ({ ...item, children: directoryEntries(item.children ?? []) }));
}

async function loadEntries() {
  const request = ++loadRequest;
  try {
    const { data } = await axios.get<{ data: { entries: AssetEntry[] } }>("/api/assets/list");
    if (request !== loadRequest) return;
    entries.value = data.data.entries;
    await nextTick();
    if (request === loadRequest) assetTree.value?.filter(searchQuery.value);
  } catch (error) {
    if (request === loadRequest) throw error;
  }
}

function showError(error: unknown) {
  ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : (error as Error).message);
}

watch(visible, opened => {
  if (opened) loadEntries().catch(showError);
  else {
    cancelFolder();
    previewAsset.value = undefined;
  }
});
// ACT: 组件在对话框里是「打开时才挂载」，此时 visible 从一开始就是 true，
// watch 因没有变化而不触发，素材列表就永远不会加载（表现为树是空的）。
// 画布里面板常驻 DOM，visible 会 false → true，所以一直没暴露这个问题。
onMounted(() => {
  if (visible.value) loadEntries().catch(showError);
});

function selectFolder(entry: AssetEntry) {
  if (entry.draft) return;
  const path = entry.type === "directory" ? entry.path : entry.path.split("/").slice(0, -1).join("/") || ".";
  folder.value = folder.value === path ? "." : path;
}

// 上传目标的展示文本；"." 表示素材库根目录。
const folderLabel = computed(() => folder.value === "." ? "素材库（根目录）" : `素材库 / ${folder.value.split("/").join(" / ")}`);

// ACT: 上传素材。服务端 assets/save 以 exclusive 方式写入（不覆盖），
// 因此重名时必须自己避让：在扩展名前依次尝试 (1)(2)…，最多 99 次。
function assetPath(directory: string, name: string) {
  return directory === "." ? name : `${directory}/${name}`;
}

async function existsInAssets(path: string) {
  try {
    await axios.get("/api/assets/read", { params: { path }, responseType: "blob" });
    return true;
  } catch {
    return false;
  }
}

async function availableAssetPath(name: string) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 0;
  let candidate = assetPath(folder.value, name);
  while (await existsInAssets(candidate)) {
    if (++index > 99) throw new Error("同名素材过多，请先重命名或换一个文件夹");
    candidate = assetPath(folder.value, `${base}(${index})${ext}`);
  }
  return candidate;
}

async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length || uploading.value) return;
  uploading.value = true;
  let done = 0;
  const failures: string[] = [];
  try {
    for (const file of files) {
      try {
        const path = await availableAssetPath(file.name);
        const content = await file.arrayBuffer();
        await axios.put("/api/assets/save", content, { params: { path }, headers: { "Content-Type": "application/octet-stream" } });
        done++;
      } catch (error) {
        failures.push(`${file.name}：${error instanceof Error ? error.message : "上传失败"}`);
      }
    }
    await refreshAssets();
    if (failures.length) showError(new Error(failures.join("；")));
    else if (done) ElMessage.success(`已上传 ${done} 个素材`);
  } finally {
    uploading.value = false;
  }
}

async function startSaveFolder() {
  saveFolderName.value = "新建文件夹";
  await nextTick();
  saveFolderInput.value?.select();
}

async function createFolder() {
  const name = saveFolderName.value?.trim();
  if (!name || folderSaving.value) return;
  folderSaving.value = true;
  try {
    const path = await createAssetFolder(saveDirectory.value, name);
    await loadEntries();
    saveDirectory.value = path;
    saveFolderName.value = undefined;
  } catch (error) {
    showError(error);
  } finally {
    folderSaving.value = false;
  }
}

async function createAssetFolder(parent: string, name: string) {
  if (/[\\/]/.test(name)) throw new Error("文件夹名称不能包含斜杠");
  const path = parent === "." ? name : `${parent}/${name}`;
  await axios.post("/api/assets/mkdir", { path });
  return path;
}

async function openSave(label: string, items: AssetOutput[]) {
  // ACT: 这两个早退原先都是**静默** return，上层又是 `saveNodeToAssets?.(...)` 没 await 没 catch，
  // 于是用户看到的现象就是「点『添加到素材库』完全没反应」且控制台无报错 —— 极难查。
  // 哪怕真是「不该在这里用」，也要把原因说出来。
  // 保存节点输出需要一个项目目录来读节点文件，画布之外没有这个上下文。
  // ACT: 判断依据是**有没有项目目录**，不是那个 canvas 布尔开关。
  // 实测：画布里的节点工具条点「添加到素材库」时，props.canvas 竟然是 false
  // （诊断输出 canvas=false、fill=false、directory 是有效的项目目录），
  // 于是这里抛错、对话框永远不开 —— 正是用户看到的「点了没反应」。
  // 能不能保存，取决于上下文是否具备（有项目目录、能读到节点文件），
  // 而 props.directory 在画布与对话框两种用法里都是真实依据；
  // 首页那个实例本来就不具备目录，会由下一道判断如实挡住。
  if (!props.directory) throw new Error("还没有打开项目目录，无法保存到素材库");
  if (!items.length) throw new Error("节点还没有内容，先生成或上传后再保存");
  outputs.value = items;
  selectedOutput.value = 0;
  assetName.value = label.endsWith(extension.value) ? label : `${label}${extension.value}`;
  saveDirectory.value = folder.value;
  saveFolderName.value = undefined;
  sourceDirectory = props.directory;
  saveVisible.value = true;
  try {
    await loadEntries();
  } catch (error) {
    showError(error);
  }
}

async function saveAsset() {
  const output = outputs.value[selectedOutput.value]?.output;
  const name = assetName.value.trim();
  if (!output || !name || /[\\/]/.test(name) || saving.value || saveFolderName.value !== undefined) return;
  const path = saveDirectory.value === "." ? name : `${saveDirectory.value}/${name}`;
  saving.value = true;
  try {
    const content = typeof output.value === "object"
      ? await useWorkspaceFiles(() => sourceDirectory).read(output.value.url)
      : new Blob([String(output.value)]);
    await axios.put("/api/assets/save", content, { params: { path }, headers: { "Content-Type": "application/octet-stream" } });
    saveVisible.value = false;
    ElMessage.success("已保存到素材库");
    await loadEntries();
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

defineExpose({ openSave });
</script>

<style lang="scss" scoped>
.assetLibrary {
  width: min(320px, calc(100vw - 30px));
  max-height: calc(100dvh - 140px);

  /* 对话框里撑满可用宽度，并给内容区一个下限高度，避免被压成 0。 */
  &.filled {
    width: 100%;
    max-height: calc(100dvh - 220px);

    /* 覆盖浮层的 440px 限高与 min-height:0，否则对话框里内容区仍会被压扁。 */
    .libraryScroll {
      min-height: 280px;
      max-height: none;
    }
  }

  :deep(.el-card__body) {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    box-sizing: border-box;
  }

  .libraryTabs {
    display: flex;
    margin-bottom: 8px;

    :deep(.el-radio-button) { flex: 1; }
    :deep(.el-radio-button__inner) { width: 100%; }
  }

  .libraryToolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: 8px;
    height: 32px;
    margin-bottom: 8px;

    .toolbarButton {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
    }

    .searchInput {
      flex: 1;
      min-width: 0;
    }

    .uploadInput { display: none; }
  }

  /* 固定一行高度，切换目标时不会让下面的列表跳动。 */
  .uploadTarget {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 22px;
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 18px;
    color: var(--el-text-color-secondary);

    :deep(.el-text) { color: var(--el-color-primary); }
  }

  .libraryScroll {
    min-height: 0;
    max-height: 440px;
  }

  .emptyHint {
    display: block;
    padding: 12px 4px;
    line-height: 18px;
  }

  .audioPreview {
    flex-shrink: 0;
    margin-top: 8px;

    .audioHeader {
      display: flex;
      align-items: center;
      gap: 8px;

      span {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--el-font-size-small);
      }
    }

    audio { display: block; width: 100%; }
  }

  .assetTree {
    :deep(.el-tree-node__content) {
      height: 44px;
      padding-right: 6px;
    }

    /* ACT: 选中态用左侧色条 + 品牌色底强调，不再用 Element Plus 的
       .is-current 方角背景（它是整行直角高亮，与圆角行不搭）。
       圆角交给行的 border-radius，色条用内阴影叠在最左侧。 */
    :deep(.el-tree-node.is-current > .el-tree-node__content) {
      background: var(--el-color-primary-light-9);
      box-shadow: inset 3px 0 0 var(--el-color-primary);
      border-top-left-radius: var(--el-border-radius-base);
      border-bottom-left-radius: var(--el-border-radius-base);
    }

    :deep(.el-tree-node.is-current > .el-tree-node__content .folderIcon) {
      color: var(--el-color-primary);
    }

    .assetEntry {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;

      &[draggable="true"] {
        cursor: grab;
      }

      .folderIcon {
        flex-shrink: 0;
        color: var(--el-text-color-secondary);
      }

      .assetThumbnail,
      .fileIcon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: var(--el-border-radius-base);
        color: var(--el-text-color-secondary);
        background: var(--el-fill-color-light);
      }

      .moreButton {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        margin: 0;
        padding: 0;
        color: var(--el-text-color-secondary);
      }

      .assetName {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--el-font-size-base);
      }

      .folderNameInput {
        flex: 1;
        min-width: 0;
      }
    }
  }
}

.assetPreview {
  .previewVideo {
    display: block;
    width: 100%;
    max-height: 65dvh;
    background: #000;
  }

  /* 放不了时的操作入口：至少能拿到原文件、或重试一次 */
  .previewActions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
}

.saveForm {
  .saveLocation {
    .locationHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: var(--el-font-size-base);
      color: var(--el-text-color-regular);
    }

    .locationPath {
      margin: 4px 0 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--el-font-size-small);
      color: var(--el-text-color-secondary);
    }

    .saveFolderScroll {
      height: auto;
      max-height: 220px;
    }

    .saveFolderTree {
      :deep(.el-tree-node__content) {
        height: 34px;
        border-radius: var(--el-border-radius-base);
      }

      .saveFolderEntry {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;

        svg { flex-shrink: 0; color: var(--el-text-color-secondary); }
        span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      }
    }

    .createFolderRow {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;

      .el-input { flex: 1; min-width: 0; }
      .el-button { margin: 0; }
    }
  }
}
</style>
