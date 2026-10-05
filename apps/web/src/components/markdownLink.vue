<template>
  <!-- 工作区文件：解析成 blob 地址后按扩展名播放或下载，不走浏览器默认导航。
       外部链接保持普通链接行为。 -->
  <span v-if="workspaceLink" class="workspaceLink">
    <el-button
      class="linkButton"
      text
      type="primary"
      :icon="downloadable ? IconDownload : IconPlayerPlay"
      :loading="loading"
      :disabled="failed"
      @click="open">
      <slot />
    </el-button>
    <span v-if="failed" class="linkFailed">（文件无法读取，可能已被移动或删除）</span>
    <video v-if="url && !downloadable" class="linkVideo" :src="url" :aria-label="fileName" controls preload="metadata" />
  </span>
  <a v-else :href="node.url" target="_blank" rel="noreferrer noopener"><slot /></a>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { IconDownload, IconPlayerPlay } from "@tabler/icons-vue";
import type { LinkNodeRendererProps } from "vue-stream-markdown";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";

const props = defineProps<{ link: LinkNodeRendererProps; directory: string }>();
const node = computed(() => props.link.node);
// 链接文字由库通过默认插槽传入，这里只需要文件名用于下载与无障碍标签。
const fileName = computed(() => {
  const path = decodeURIComponent((node.value.url ?? "").split(/[?#]/, 1)[0]!);
  return path.split("/").pop() || "download";
});
// 与 markdownImage 同一套判定：带协议、以 / 或 \ 开头、或以 # 开头的都不是工作区相对路径。
const workspaceLink = computed(() => !!node.value.url && !/^(?:[a-z][a-z\d+.-]*:|[\\/]|#)/i.test(node.value.url));
// 视频与音频直接在页面里播放，其余类型（成片导出等）交给下载。
const downloadable = computed(() => !/\.(?:mp4|m4v|webm|mov|mkv|ogv|mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(node.value.url ?? ""));
const url = ref("");
const loading = ref(false);
const failed = ref(false);
let release = () => {};

watch(() => [props.directory, node.value.url] as const, async ([directory, targetUrl], _previous, onCleanupFn) => {
  release();
  release = () => {};
  url.value = "";
  failed.value = false;
  if (!workspaceLink.value || !targetUrl || !directory) return;
  loading.value = true;
  let cancelled = false;
  onCleanupFn(() => { cancelled = true; });
  try {
    const path = decodeURIComponent(targetUrl.split(/[?#]/, 1)[0]!);
    const preview = useWorkspaceFiles(directory).acquireUrl(path);
    release = preview.release;
    const resolved = await preview.url;
    if (!cancelled) url.value = resolved;
  } catch {
    if (!cancelled) failed.value = true;
  } finally {
    if (!cancelled) loading.value = false;
  }
}, { immediate: true });

onBeforeUnmount(() => release());

async function open() {
  if (!url.value || failed.value) return;
  // 下载走宿主既有入口，桌面端与网页端的行为由它统一处理。
  await saveFile(async () => (await fetch(url.value)).blob(), fileName.value).catch(() => { failed.value = true; });
}
</script>

<style scoped lang="scss">
.workspaceLink {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;

  .linkButton {
    align-self: flex-start;
    height: auto;
    padding: 2px 6px;
  }

  .linkFailed {
    font-size: 12px;
    color: var(--el-color-danger);
  }

  .linkVideo {
    width: 100%;
    max-width: 420px;
    max-height: 320px;
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-darker);
  }
}
</style>
