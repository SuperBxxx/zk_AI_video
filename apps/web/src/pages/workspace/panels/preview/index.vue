<template>
  <section class="previewPanel" aria-label="成片预览">
    <aside class="mediaList" aria-label="工作区媒体">
      <div class="listHeader">
        <span class="listTitle">媒体</span>
        <el-button
          class="refreshButton"
          text
          size="small"
          :loading="loading"
          aria-label="刷新媒体列表"
          title="刷新"
          @click="refresh">
          <icon-refresh :size="14" aria-hidden="true" />
        </el-button>
      </div>
      <p v-if="!directory" class="listHint">尚未选择工作目录。</p>
      <p v-else-if="loading && !files.length" class="listHint">正在读取…</p>
      <p v-else-if="!files.length" class="listHint">
        工作区里还没有视频或音频。生成片段或合成成片后会出现在这里。
      </p>
      <ul v-else class="fileList">
        <li v-for="file in files" :key="file.path">
          <button
            class="fileItem"
            :class="{ current: file.path === currentPath }"
            type="button"
            :aria-current="file.path === currentPath"
            :title="file.path"
            @click="select(file)">
            <icon-movie v-if="file.kind === 'video'" :size="14" aria-hidden="true" />
            <icon-music v-else :size="14" aria-hidden="true" />
            <span class="fileName">{{ file.name }}</span>
          </button>
        </li>
      </ul>
    </aside>

    <div class="playerSurface">
      <div v-if="!current" class="playerEmpty">
        <p>从左侧选一个文件播放。</p>
      </div>
      <template v-else>
        <header class="playerHeader">
          <span class="playerName" :title="current.path">{{ current.path }}</span>
          <el-button text size="small" @click="download(current)">下载</el-button>
        </header>
        <div v-if="error" class="playerError" role="alert">{{ error }}</div>
        <video
          v-else-if="url && current.kind === 'video'"
          class="playerMedia"
          :src="url"
          :aria-label="current.name"
          controls
          preload="metadata"></video>
        <audio
          v-else-if="url"
          class="playerAudio"
          :src="url"
          :aria-label="current.name"
          controls
          preload="metadata"></audio>
        <p v-else class="playerEmpty">正在载入…</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";

type MediaEntry = { name: string; path: string; kind: "video" | "audio" };

const props = defineProps<{ active?: boolean }>();

const workspaceStore = useWorkspaceStore();
const directory = computed(() => workspaceStore.project?.directory);

// ACT: 只列视频与音频 —— 预览面板的用途是看成片与听配音，
// 列图片会把它变成第二个素材库，与「文档」面板的分工也重复。
const videoExtensions = [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"];
const audioExtensions = [".mp3", ".wav", ".ogg", ".opus", ".flac", ".m4a", ".aac"];
const maxFiles = 200;

const files = ref<MediaEntry[]>([]);
const loading = ref(false);
const currentPath = ref("");
const url = ref("");
const error = ref("");
// acquireUrl 返回的对象带 release()，切换文件时必须释放，否则 blob 会一直占着内存
let currentUrl: { url: Promise<string>; release?: () => void } | undefined;

const current = computed(() => files.value.find(file => file.path === currentPath.value));

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function kindOf(name: string): MediaEntry["kind"] | undefined {
  const extension = extensionOf(name);
  if (videoExtensions.includes(extension)) return "video";
  if (audioExtensions.includes(extension)) return "audio";
  return undefined;
}

async function walk(files: ReturnType<typeof useWorkspaceFiles>, path: string, collected: MediaEntry[], depth = 0) {
  if (depth > 4 || collected.length >= maxFiles) return;
  const { entries } = await files.list(path);
  for (const entry of entries) {
    if (collected.length >= maxFiles) return;
    if (entry.type === "directory") {
      await walk(files, entry.path, collected, depth + 1).catch(() => undefined);
      continue;
    }
    const kind = kindOf(entry.name);
    if (kind) collected.push({ name: entry.name, path: entry.path, kind });
  }
}

async function refresh() {
  const target = directory.value;
  if (!target) { files.value = []; return; }
  loading.value = true;
  const collected: MediaEntry[] = [];
  try {
    await walk(useWorkspaceFiles(target), "", collected);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "读取工作区失败";
  } finally {
    loading.value = false;
  }
  // 成片通常最后生成，倒序让最新的排在最前
  files.value = collected.reverse();
  if (!files.value.some(file => file.path === currentPath.value)) currentPath.value = files.value[0]?.path ?? "";
}

function releaseUrl() {
  currentUrl?.release?.();
  currentUrl = undefined;
  url.value = "";
}

async function select(file: MediaEntry) {
  currentPath.value = file.path;
}

async function loadCurrent(file: MediaEntry) {
  const target = directory.value;
  if (!target) return;
  releaseUrl();
  error.value = "";
  try {
    currentUrl = useWorkspaceFiles(target).acquireUrl(file.path);
    url.value = await currentUrl.url;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "无法读取该文件";
  }
}

async function download(file: MediaEntry) {
  const target = directory.value;
  if (!target) return;
  try {
    const data = await useWorkspaceFiles(target).read(file.path);
    const blob = new Blob([data]);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    // 交给浏览器读完再释放
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "下载失败";
  }
}

watch(currentPath, () => {
  const file = current.value;
  if (file) void loadCurrent(file);
  else releaseUrl();
});

// 切回预览面板时刷新：生成或合成通常发生在画布面板
watch(() => props.active, value => { if (value) void refresh(); });
watch(directory, () => { currentPath.value = ""; void refresh(); });

onMounted(() => { if (props.active) void refresh(); });
onBeforeUnmount(releaseUrl);
</script>

<style scoped>
.previewPanel {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.mediaList {
  display: flex;
  flex-direction: column;
  flex: 0 0 260px;
  min-width: 0;
  border-right: 1px solid var(--el-border-color-light);
  overflow: hidden;
}

.listHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.listTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.listHint {
  margin: 0;
  padding: 14px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.fileList {
  flex: 1;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
}

.fileItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.fileItem:hover {
  background: var(--el-fill-color-light);
}

.fileItem.current {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}

.fileName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}


.playerSurface {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: #10151c;
}

.playerHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
}

.playerName {
  min-width: 0;
  overflow: hidden;
  color: #e6edf3;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.playerMedia {
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #000;
}

.playerAudio {
  width: 100%;
  margin: auto 16px;
}

.playerEmpty,
.playerError {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #9aa7b4;
  font-size: 13px;
  text-align: center;
}

.playerError {
  color: var(--el-color-danger);
}
</style>
