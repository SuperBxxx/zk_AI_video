<template>
  <div v-if="loaded" class="providerList">
    <!-- 偏好模型：媒体 / 语音 / 图片三个页面共用此实现，各自传 scope。
         见 script 里 kind → scope 的映射。 -->
    <preferredModels :scope="preferenceScope" :available="preferredChoices" />
    <div class="itemList">
      <el-card v-for="item in visibleProviders" :key="item.fileName" class="providerItem" shadow="never">
        <div class="providerHeader">
          <div class="providerInfo">
            <div class="providerHeading">
              <el-text class="providerName" tag="strong">{{ item.label }}</el-text>
            </div>
            <el-text class="providerId" size="small" type="info" :title="item.fileName">{{ item.fileName }}</el-text>
          </div>
        </div>
        <el-alert v-if="item.loadError" :title="item.loadError" type="error" :closable="false" showIcon />
        <div class="providerFooter">
          <div class="providerMeta">
            <el-tag v-if="item.version" size="small" type="info" effect="plain">v{{ item.version }}</el-tag>
            <el-text size="small" type="info">{{ item.models.length }} 个模型</el-text>
          </div>
          <el-space class="itemActions" wrap>
            <el-button v-if="item.modelsUrl" text :icon="IconDownload" :loading="fetchingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError || !item.revision" @click="fetchModels(item)">获取模型</el-button>
            <el-button text :icon="IconEdit" :disabled="!!fetchingFile || !!deletingFile || !!item.loadError" @click="editProvider(item)">编辑模型</el-button>
            <el-popconfirm title="确定删除此供应商及其模型？" confirmButtonText="删除" cancelButtonText="取消" @confirm="deleteProvider(item)">
              <template #reference><el-button text type="danger" :icon="IconTrash" :loading="deletingFile === item.fileName" :disabled="!!fetchingFile || !!deletingFile || !item.revision">删除</el-button></template>
            </el-popconfirm>
          </el-space>
        </div>
      </el-card>
    </div>
    <el-text v-if="!visibleProviders.length" class="emptyHint" size="small" type="info">
      {{ emptyHint }}
    </el-text>
    <div class="providerActions">
      <el-button class="addButton" :icon="IconPlus" @click="openAdd('builtin')">添加供应商</el-button>
      <el-button class="addButton" :icon="IconSettings" @click="openAdd('custom')">添加自定义供应商</el-button>
    </div>
    <component :is="mediaProviderDialog" v-model="providerDialogVisible" :mode="addMode" @added="saveProviderItem" />
    <component :is="editProviderDialog" v-model="editorVisible" :provider="editingProvider" @saved="saveProviderItem" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, shallowRef, type Component } from "vue";
import { ElMessage } from "element-plus";
import { IconPlus, IconSettings, IconEdit, IconTrash, IconDownload } from "@tabler/icons-vue";
import type { MediaProvider } from "./types";
import { settings, saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import preferredModels from "../preferredModels.vue";

// ACT: 三处模型面板（媒体 / 语音 / 图片）共用这一份实现，只是 kind 不同 ——
// 与 voiceModel 复用本文件的既有做法一致，不再维护第二套逻辑。
type ModelKind = "media" | "audio" | "image";
const { visible = true, kind = "media" } = defineProps<{ visible?: boolean; kind?: ModelKind }>();
/** 该页面关心的模型类型：媒体页要图片+视频，语音页要音频，图片页只要图片。 */
const wantedTypes = computed<string[]>(() =>
  kind === "audio" ? ["audio"] : kind === "image" ? ["image"] : ["image", "video"]);
/** 偏好模型的 scope：图片页单独一个 scope，其余与 kind 同名。 */
const preferenceScope = computed<"text" | "video" | "audio" | "image">(() =>
  kind === "audio" ? "audio" : kind === "image" ? "image" : "video");
const emptyHint = computed(() => kind === "audio"
  ? "还没有可用的语音供应商。点下方「添加供应商」选择阿里云百炼或 APIMart，填入 API Key 后即可合成配音。"
  : kind === "image"
    ? "还没有可用的图片供应商。点下方「添加供应商」选择厂商，填入 API Key 后即可生成图片。"
    : "还没有可用的媒体供应商。点下方「添加供应商」选择厂商，填入 API Key 后即可生成图片与视频。");
// ACT: 偏好模型的选择项直接复用 /api/ai/media/models（与视频生成节点同一数据源），
// 只按当前页面的 kind 过滤：媒体页给图片/视频，语音页给音频。
// 这样"可选项"与"节点真正能用的模型"必然一致，不会出现选了却用不上的项。
const preferredChoices = ref<{ providerId: string; providerLabel: string; modelId: string; modelLabel: string }[]>([]);
const mediaProviderDialog = shallowRef<Component>();
const editProviderDialog = shallowRef<Component>();
const providers = ref<MediaProvider[]>([]);
// ACT: 原先把上游自家的 tfRouter 强制排在最前。中转已移除，按加载顺序展示。
const sortedProviders = computed(() => [...providers.value]);
// 按 D9：供应商全局共享，两个面板各自按模型 type 筛选展示。
// kind="media"（媒体模型）只显示含图片/视频模型的供应商；
// kind="audio"（语音模型）只显示含音频模型的供应商。
// 同一供应商（如 APIMart、百炼）同时具备两类能力时会在两个面板都出现，
// 因为供应商文件本身是共享的、配置也是同一份，这里的筛选只影响展示，
// 编辑模型时仍会看到该供应商的全部模型。
const visibleProviders = computed(() =>
  sortedProviders.value.filter(item => item.models.some(model => wantedTypes.value.includes(model.type))));
const loaded = ref(false);
const providerDialogVisible = ref(false);
const editorVisible = ref(false);
const addMode = ref<"builtin" | "custom">("builtin");
const editingProvider = ref<MediaProvider>();
const deletingFile = ref("");
const fetchingFile = ref("");
let loadRequest = 0;

// ACT: 原先这里为 TF-Router 账户面板提供 getProviderApiKey/saveProviderApiKey。
// 该面板已随中转服务移除，这两个函数没有调用方，一并删除。

function refreshInstalled(event: WindowEventMap["toonflow:plugin-installed"]) {
  if (event.detail.type === "provider") void loadProviders();
}
onMounted(() => {
  void loadProviders();
  void loadPreferredChoices();
  window.addEventListener("toonflow:plugin-installed", refreshInstalled);
});
onBeforeUnmount(() => {
  loadRequest++;
  window.removeEventListener("toonflow:plugin-installed", refreshInstalled);
});

async function loadProviders() {
  const request = ++loadRequest;
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    if (request === loadRequest) providers.value = data.data;
  } catch (error) {
    if (request === loadRequest) ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : "读取媒体供应商失败");
  } finally {
    if (request === loadRequest) loaded.value = true;
  }
}

/** 偏好模型的可选项：与生成节点同一数据源，只按本页面的 kind 过滤类型。 */
async function loadPreferredChoices() {
  try {
    const { data } = await axios.get<{ data: { providerId: string; providerLabel: string; modelId: string; label: string; type: string }[] }>("/api/ai/media/models");
    preferredChoices.value = (data.data ?? [])
      .filter(item => wantedTypes.value.includes(item.type))
      .map(item => ({ providerId: item.providerId, providerLabel: item.providerLabel, modelId: item.modelId, modelLabel: item.label }));
  } catch { /* 取不到就只显示已保存的偏好项，不影响供应商列表 */ }
}

function openAdd(mode: "builtin" | "custom") {
  mediaProviderDialog.value ??= defineAsyncComponent(() => import("./addCustomProviderDialog.vue"));
  addMode.value = mode;
  providerDialogVisible.value = true;
}

function editProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || provider.loadError) return;
  editProviderDialog.value ??= defineAsyncComponent(() => import("./editProviderDialog.vue"));
  editingProvider.value = provider;
  editorVisible.value = true;
}

async function fetchModels(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.modelsUrl || !provider.revision || provider.loadError) return;
  fetchingFile.value = provider.fileName;
  try {
    const { data } = await axios.post<{ code: number; data: MediaProvider; message: string }>("/api/providers/media/models", {
      fileName: provider.fileName, revision: provider.revision,
    }, { timeout: 35000 });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "获取模型失败");
    saveProviderItem(data.data);
    invalidateNodeModels("media");
    ElMessage.success("模型列表已更新");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "获取模型失败，请重试");
  } finally { fetchingFile.value = ""; }
}

async function deleteProvider(provider: MediaProvider) {
  if (fetchingFile.value || deletingFile.value || !provider.revision) return;
  deletingFile.value = provider.fileName;
  let deleted = false;
  try {
    await axios.delete("/api/providers/media/delete", { data: { fileName: provider.fileName, revision: provider.revision } });
    deleted = true;
    loadRequest++;
    invalidateNodeModels("media");
    providers.value = providers.value.filter(item => item.fileName !== provider.fileName);
    await saveSettings(settings => {
      const configs = settings.mediaProviderConfigs;
      if (!configs || typeof configs !== "object" || Array.isArray(configs) || !Object.hasOwn(configs, provider.id)) return;
      const current = { ...configs } as Record<string, unknown>;
      delete current[provider.id];
      return { mediaProviderConfigs: current };
    });
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "删除失败，请重试";
    ElMessage.error(deleted ? `供应商已删除，连接配置未清理：${message}` : message);
  } finally { deletingFile.value = ""; }
}

function saveProviderItem(provider: MediaProvider) {
  loadRequest++;
  const index = providers.value.findIndex(item => item.fileName === provider.fileName);
  if (index < 0) providers.value.push(provider);
  else providers.value.splice(index, 1, provider);
}
</script>

<style lang="scss" scoped src="../../providerList.scss"></style>
