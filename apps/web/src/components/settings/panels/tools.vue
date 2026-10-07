<template>
  <div class="toolsPanel">
    <p class="description">
      这里配置各个工具的运行参数。联网搜索的「搜索服务」「API Key」「代理」也在这里。
    </p>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" showIcon />

    <div v-loading="loading" class="toolList">
      <div v-for="tool in configurableTools" :key="tool.key" class="toolItem">
        <div class="toolInfo">
          <div class="toolHeader">
            <span class="toolName">{{ tool.displayName }}</span>
            <el-tag v-if="!tool.enabled" size="small" type="info">已停用</el-tag>
            <el-tag v-if="tool.loadError" size="small" type="danger">加载失败</el-tag>
          </div>
          <p class="toolDescription">{{ tool.description }}</p>
          <p v-if="tool.loadError" class="toolError">{{ tool.loadError }}</p>
        </div>
        <el-button
          :disabled="!canManage || Boolean(tool.loadError)"
          :icon="IconSettings"
          @click="openConfig(tool)">
          配置
        </el-button>
      </div>
      <el-empty v-if="!loading && !configurableTools.length" description="没有可配置的工具" />
    </div>

    <p v-if="!canManage" class="description">浏览器访问时不显示当前配置值，请在桌面端或服务器本机管理工具配置。</p>

    <pluginConfigDialog
      v-if="activeTool"
      v-model="configVisible"
      :plugin="activeTool"
      :canManage="canManage" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, shallowRef } from "vue";
import { ElAlert, ElButton, ElEmpty, ElTag, vLoading } from "element-plus";
import { IconSettings } from "@tabler/icons-vue";
import pluginConfigDialog from "./pluginConfigDialog.vue";
import type { Plugin } from "../plugins";

const loading = ref(false);
const loadError = ref("");
const canManage = ref(false);
const tools = ref<Plugin[]>([]);
const activeTool = shallowRef<Plugin>();
const configVisible = ref(false);

// ACT: 只列「有配置项」的工具。没有 configRules 的工具点「配置」会开出一个空表单，
// 让人以为坏了 —— 那种工具本来就不需要配置。
const configurableTools = computed(() => tools.value.filter(tool => (tool.configRules?.length ?? 0) > 0));

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const { data } = await axios.get<{ code: number; data: { tools: Plugin[]; canManage: boolean }; message?: string }>("/api/tools/get", {
      headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" },
    });
    if (data.code !== 200) throw new Error(data.message || "读取工具列表失败");
    canManage.value = data.data.canManage;
    tools.value = data.data.tools.map(tool => ({ ...tool, key: `tool:${tool.name}`, type: "tool" as const }));
  } catch (error) {
    loadError.value = axios.isAxiosError(error)
      ? error.response?.data?.message || "读取工具列表失败"
      : error instanceof Error ? error.message : "读取工具列表失败";
  } finally {
    loading.value = false;
  }
}

function openConfig(tool: Plugin) {
  activeTool.value = tool;
  configVisible.value = true;
}

onMounted(load);
</script>

<style lang="scss" scoped>
.toolsPanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.description {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
.toolList {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}
.toolItem {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.toolInfo {
  min-width: 0;
}
.toolHeader {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolName {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.toolDescription {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
.toolError {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
