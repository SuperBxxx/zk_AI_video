<template>
  <div class="ytDlpPanel">
    <el-card class="downloadCard" shadow="never">
      <div class="componentHeader">
        <div class="componentTitle">
          <h3><icon-cloud-download :size="18" aria-hidden="true" />取流工具</h3>
          <el-tag :type="statusError ? 'danger' : loading || installing ? 'info' : ready ? 'success' : 'warning'">
            {{ statusError ? "检测失败" : installing ? "正在安装" : loading ? "检测中" : ready ? "已就绪" : "待配置" }}
          </el-tag>
        </div>
        <el-button :icon="IconRefresh" :loading="loading" :disabled="installing" @click="refresh">重新检测</el-button>
      </div>
      <p class="introduction">配方卡片库的链接取流需要 yt-dlp，按需安装即可。抖音走的是另一条通道，不依赖它。</p>
      <el-alert v-if="statusError" :title="statusError" type="error" :closable="false" showIcon />
      <div class="downloadHeader">
        <span>下载线路</span>
        <el-text v-if="status" type="info">{{ availableSourceCount }} 条可用线路</el-text>
      </div>
      <div class="downloadActions">
        <el-select
          :modelValue="source"
          :disabled="!status || loading || saving || installing"
          filterable
          placeholder="选择下载线路"
          aria-label="yt-dlp 下载线路"
          @change="value => updateSource(value)">
          <el-option
            v-for="item in status?.sources ?? []"
            :key="item.id"
            class="sourceOption"
            :label="item.label"
            :value="item.id"
            :disabled="!item.available">
            <span class="sourceLabel" :title="item.label">{{ item.label }}</span>
            <span class="sourceDescription" :title="item.description">{{ item.description }}</span>
          </el-option>
        </el-select>
        <el-button type="primary" :icon="IconDownload" :loading="installing" :disabled="!canInstall" @click="install">
          {{ installing ? "正在安装" : ready ? "重新安装" : "下载并安装" }}
        </el-button>
      </div>
      <div v-if="selectedSource" class="sourceHint">
        <span>下载较慢或失败时，可切换线路重试。</span>
        <el-link :href="selectedSource.homepage" target="_blank" rel="noopener noreferrer" :underline="false" type="primary">来源网站<icon-external-link :size="12" aria-hidden="true" /></el-link>
      </div>
      <p class="description">{{ ready ? "已检测到可用版本，无需重复安装。" : "下载后自动校验并安装，无需手动解压或配置。" }}</p>
      <el-alert v-if="operationError" :title="operationError" type="error" :closable="false" showIcon />
      <div v-if="lines.length" class="downloadProgress" aria-live="polite">
        <div class="progressHeader">
          <span>安装过程</span>
          <span>{{ lines[lines.length - 1] }}</span>
        </div>
        <pre class="installLog">{{ lines.join("\n") }}</pre>
      </div>
      <el-alert
        title="yt-dlp 官方 Windows 单文件是 PyInstaller 打包的，成品按 GPLv3+ 分发，因此本产品不内置它，改为按需下载。"
        type="warning"
        :closable="false"
        showIcon />
    </el-card>

    <el-collapse class="advancedSettings">
      <el-collapse-item title="高级设置" name="advanced">
        <el-form labelPosition="top">
          <el-form-item label="运行方式">
            <el-select :modelValue="mode" :disabled="loading || saving || installing" aria-label="yt-dlp 运行方式" @change="value => updateMode(value)">
              <el-option label="自动选择" value="auto" />
              <el-option label="使用下载版" value="download" />
              <el-option label="使用系统安装版" value="system" />
            </el-select>
            <p class="description">{{ modeDescriptions[mode] }}</p>
          </el-form-item>
        </el-form>
        <template v-if="status">
          <p class="description">运行环境：{{ status.platform }} / {{ status.arch }}</p>
          <p class="description">下载版本：{{ status.version || "—" }} · {{ status.executable }}</p>
          <p class="description">保存在本服务的数据目录，下载后自动复用。</p>
          <code class="toolPath">{{ status.directory }}</code>
          <div class="toolInfo">
            <strong>yt-dlp</strong>
            <el-tag :type="status.version ? 'success' : 'info'" effect="plain">
              {{ status.version ? (status.origin === "download" ? "下载版" : "系统安装版") : "不可用" }}
            </el-tag>
            <p v-if="status.version" class="description">{{ status.version }}</p>
            <code v-if="status.path" class="toolPath">{{ status.path }}</code>
            <p v-if="status.error" class="description">{{ status.error }}</p>
          </div>
        </template>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { IconCloudDownload, IconDownload, IconRefresh } from "@tabler/icons-vue";
import { saveSettings, settings } from "@/stores/settings";

type Source = { id: string; label: string; description: string; available: boolean; homepage: string };
type ToolStatus = {
  path: string | null; version: string | null; error: string | null;
  origin: "download" | "system" | null;
  sources: Source[]; source?: string; directory: string;
  platform: string; arch: string; executable: string;
};
type Mode = "auto" | "download" | "system";

const headers = { "x-toonflow-workspace": "1" };
const modeDescriptions: Record<Mode, string> = {
  auto: "优先使用已下载的版本；未下载时，从本机系统 PATH 查找。",
  download: "仅使用此页面下载的版本。",
  system: "仅从本机系统 PATH 查找。",
};
const status = ref<ToolStatus>();
const statusError = ref("");
const operationError = ref("");
const lines = ref<string[]>([]);
const loading = ref(false);
const saving = ref(false);
const installing = ref(false);

/** 与 FFmpeg 面板同形：模式与线路都从设置里读，缺省回退到服务端建议值。 */
const ytDlpConfig = computed(() => {
  const raw = settings.value.ytdlp;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { mode?: string; source?: string } : {};
  return {
    mode: (value.mode === "download" || value.mode === "system" ? value.mode : "auto") as Mode,
    source: [value.source, status.value?.source]
      .find(id => status.value?.sources.some(item => item.id === id && item.available)) ?? "",
  };
});
const mode = computed(() => ytDlpConfig.value.mode);
const source = computed(() => ytDlpConfig.value.source);
const selectedSource = computed(() => status.value?.sources.find(item => item.id === source.value));
const availableSourceCount = computed(() => status.value?.sources.filter(item => item.available).length ?? 0);
// ACT: 「就绪」不看 error —— error 只表示探测时跑不起来（可能是新落盘的文件正被扫描），
// 装没装看有没有路径与版本。
const ready = computed(() => !!status.value?.path && !!status.value?.version);
const canInstall = computed(() => !!source.value && !loading.value && !saving.value && !installing.value);

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

async function updateConfig(patch: { mode?: Mode; source?: string }) {
  saving.value = true;
  operationError.value = "";
  const current = settings.value.ytdlp;
  const previous = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  try {
    await saveSettings(() => ({ ytdlp: { ...previous, ...patch } }));
  } catch (error) {
    operationError.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

const updateSource = (value: string) => updateConfig({ source: value });
const updateMode = (value: Mode) => updateConfig({ mode: value });

async function install() {
  installing.value = true;
  operationError.value = "";
  lines.value = [];
  try {
    const { data } = await axios.post<{ code: number; data: { path: string; lines: string[] } }>(
      "/api/videoFetch/install",
      {},
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

<style lang="scss" scoped>
.ytDlpPanel {
  .downloadCard {
    :deep(.el-card__body) { padding: 12px; }

    .componentHeader, .downloadHeader, .progressHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .componentHeader {
      gap: 12px;

      .componentTitle {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;

        h3 {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }
      }
    }

    .introduction {
      margin: 10px 0 0;
      color: var(--el-text-color-regular);
      font-size: 13px;
      line-height: 1.6;
    }

    .downloadHeader {
      margin-top: 16px;
      color: var(--el-text-color-regular);
      font-size: 13px;
    }

    .downloadActions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;

      .el-select { flex: 1 1 200px; min-width: 0; }
      .el-button { margin-left: 0; }
    }

    .sourceHint {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin-top: 10px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.6;

      .el-link { font-size: inherit; }
    }

    .downloadProgress {
      margin-top: 16px;

      .progressHeader {
        margin-bottom: 8px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
        gap: 12px;

        span:last-child { text-align: right; }
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
    }
  }

  .advancedSettings {
    --el-collapse-border-color: transparent;
    margin-top: 10px;

    .el-form { margin-top: 8px; }

    .toolInfo {
      margin-top: 16px;
      font-size: 13px;

      strong { margin-right: 12px; }
    }

    .toolPath {
      display: block;
      margin-top: 8px;
      color: var(--el-text-color-regular);
      font-size: 12px;
      overflow-wrap: anywhere;
      user-select: text;
    }
  }

  .el-alert { margin: 12px 0; }
}
</style>
