<template>
  <div class="ytDlpPanel">
    <el-alert
      title="yt-dlp 用于「配方卡片库」的链接取流：给一条视频链接，把它下载到工作区再分析。"
      type="info"
      :closable="false"
      show-icon />
    <div class="panelRow">
      <el-tag :type="statusError ? 'danger' : loading ? 'info' : ready ? 'success' : 'warning'" effect="plain" disable-transitions>
        {{ statusError ? "检测失败" : loading ? "检测中" : ready ? "已就绪" : "未安装" }}
      </el-tag>
      <el-button :icon="IconRefresh" :loading="loading || installing" @click="refresh">重新检测</el-button>
      <el-text v-if="status" size="small" type="info">{{ availableSourceCount }} 条可用线路</el-text>
    </div>

    <el-alert v-if="statusError" :title="statusError" type="error" :closable="false" show-icon />
    <el-alert v-if="operationError" :title="operationError" type="error" :closable="false" show-icon />

    <el-descriptions v-if="status" :column="1" border size="small">
      <el-descriptions-item label="版本">{{ status.version || "—" }}</el-descriptions-item>
      <el-descriptions-item label="安装位置">{{ status.path || "尚未安装" }}</el-descriptions-item>
      <el-descriptions-item label="来源">{{ originLabel }}</el-descriptions-item>
      <el-descriptions-item v-if="status.error" label="检测错误">{{ status.error }}</el-descriptions-item>
    </el-descriptions>

    <div class="fieldRow">
      <el-text class="fieldLabel">下载线路</el-text>
      <el-select
        :modelValue="source"
        :disabled="!status || loading || saving || installing"
        aria-label="yt-dlp 下载线路"
        @change="value => updateSource(value)">
        <el-option
          v-for="item in status?.sources ?? []"
          :key="item.id"
          :label="item.label"
          :value="item.id"
          :disabled="!item.available">
          <span class="sourceLabel">{{ item.label }}</span>
          <span class="sourceDescription">{{ item.description }}</span>
        </el-option>
      </el-select>
      <el-text v-if="selectedSource" class="sourceHint" size="small" type="info">
        {{ selectedSource.description }}
        <el-link :href="selectedSource.homepage" target="_blank" rel="noopener noreferrer" :underline="false">{{ selectedSource.homepage }}</el-link>
      </el-text>
    </div>

    <div class="panelRow">
      <el-button
        type="primary"
        :icon="IconDownload"
        :loading="installing"
        :disabled="!status || loading || saving || !canInstall"
        @click="install">
        {{ ready ? "重新下载并安装" : "下载并安装" }}
      </el-button>
      <el-text v-if="installing" size="small" type="info">{{ lastLine }}</el-text>
    </div>

    <!-- 安装过程日志：失败时逐条列出每个线路的结果，便于判断是网络还是镜像问题。 -->
    <pre v-if="lines.length" class="installLog">{{ lines.join("\n") }}</pre>

    <el-alert
      title="注意：yt-dlp 官方 Windows 单文件是 PyInstaller 打包的，成品按 GPLv3+ 分发，因此本产品不内置它，改为按需下载。"
      type="warning"
      :closable="false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { IconDownload, IconRefresh } from "@tabler/icons-vue";
import { settings, saveSettings } from "@/stores/settings";

type Source = { id: string; label: string; description: string; available: boolean; homepage: string };
type ToolStatus = {
  path: string | null; version: string | null; error: string | null;
  origin: "download" | "system" | null;
  sources: Source[]; source?: string; directory: string;
};

const headers = { "x-toonflow-workspace": "1" };
const status = ref<ToolStatus>();
const statusError = ref("");
const operationError = ref("");
const lines = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const installing = ref(false);

const ready = computed(() => !!status.value?.version && !status.value?.error);
const availableSourceCount = computed(() => status.value?.sources.filter(item => item.available).length ?? 0);
const source = computed(() => {
  const raw = settings.value.ytdlp;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { source?: string } : {};
  return [value.source, status.value?.source]
    .find(id => status.value?.sources.some(item => item.id === id && item.available)) ?? "";
});
const selectedSource = computed(() => status.value?.sources.find(item => item.id === source.value));
const canInstall = computed(() => !!source.value);
const originLabel = computed(() => {
  const origin = status.value?.origin;
  return origin === "download" ? "本页下载的版本" : origin === "system" ? "系统 PATH" : "—";
});
const lastLine = computed(() => lines.value[lines.value.length - 1] ?? "");

function errorMessage(error: unknown) {
  return axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "操作失败";
}

async function refresh() {
  loading.value = true;
  statusError.value = "";
  try {
    const { data } = await axios.get<{ code: number; data: ToolStatus; message?: string }>("/api/videoFetch/status", { headers });
    status.value = data.data;
  } catch (error) {
    statusError.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function updateSource(value: string) {
  saving.value = true;
  operationError.value = "";
  const current = settings.value.ytdlp;
  const previous = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  try {
    await saveSettings(() => ({ ytdlp: { ...previous, source: value } }));
  } catch (error) {
    operationError.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function install() {
  installing.value = true;
  operationError.value = "";
  lines.value = [];
  try {
    const { data } = await axios.post<{ code: number; data: { path: string; lines: string[] }; message?: string }>(
      "/api/videoFetch/install",
      // ACT: 重装时强制重下 —— 已安装的情况下 ensureTool 会直接返回现有路径，
      // 用户点「重新下载」的本意就是绕过它。
      { force: ready.value },
      { headers, timeout: 20 * 60 * 1000 },
    );
    lines.value = data.data.lines;
    await refresh();
  } catch (error) {
    operationError.value = errorMessage(error);
  } finally {
    installing.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped lang="scss">
  .ytDlpPanel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .panelRow {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .fieldRow {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .fieldLabel {
      font-size: 13px;
    }
  }

  .sourceLabel {
    margin-right: 8px;
  }

  .sourceDescription {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .sourceHint {
    line-height: 1.6;
  }

  .installLog {
    margin: 0;
    padding: 10px;
    max-height: 200px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    background: var(--el-fill-color-light);
    border-radius: var(--ui-radius-small);
  }
</style>
