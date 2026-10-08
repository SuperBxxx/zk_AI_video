<template>
  <el-dialog v-model="visible" title="设置" width="min(1080px, calc(100vw - 32px))" alignCenter appendToBody>
    <div class="settings">
      <aside class="sidebar" aria-label="设置分类">
        <template v-for="(item, index) in settingsPanels" :key="item.id">
          <!-- ACT: 分组标题只在**分组变化时**渲染一次。
               原先写的是 `v-if="item.groupLabel"` —— 同组的每个条目都会各渲染一遍标题，
               「其他」有三项就重复出现三次。 -->
          <h3 v-if="startsNewGroup(index)" class="settingsGroupLabel">{{ item.groupLabel }}</h3>
          <button class="settingsItem" type="button" :aria-label="item.label" :aria-pressed="activePanel.id === item.id" @click="activePanel = item">
            <component :is="item.icon" :size="18" class="panelIcon" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </aside>
      <section class="content" :aria-label="activePanel.label" tabindex="0">
        <h2 class="panelTitle">{{ activePanel.label }}</h2>
        <div class="panelContent">
          <transition name="el-fade-in" mode="out-in">
            <component
              :is="activePanel.component"
              v-bind="['languageModel', 'mediaModel', 'ffmpeg'].includes(activePanel.id) ? { visible } : {}" />
          </transition>
        </div>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { defineAsyncComponent, shallowRef } from "vue";
import { IconAdjustments, IconCloudDownload, IconPhotoVideo, IconInfoCircle, IconMicrophone2, IconSubtitlesAi, IconTransform } from "@tabler/icons-vue";

// ACT: 只保留模型配置、工具配置、FFmpeg 与开源许可。界面设置、常规配置、MCP、隐私、开发者选项
// 已按产品要求隐藏（对应面板文件仍在，需要时把条目加回来即可）。
//
// 「工具配置」是补上的入口：在此之前 pluginConfigDialog 只有 agent 工具栏那一处引用、
// 且写死只开 mediaGeneration —— 于是联网搜索等服务型工具的配置在界面上**根本没有入口**
// （实测确认：全仓库 /api/tools/get 只有那一个调用方）。
const settingsPanels = [
  {
    id: "languageModel",
    label: "文本模型",
    icon: IconSubtitlesAi,
    groupLabel: "模型",
    component: defineAsyncComponent(() => import("./panels/languageModel/index.vue")),
  },
  { id: "mediaModel", label: "媒体模型", icon: IconPhotoVideo, component: defineAsyncComponent(() => import("./panels/mediaModel/index.vue")) },
  { id: "voiceModel", label: "语音模型", icon: IconMicrophone2, component: defineAsyncComponent(() => import("./panels/voiceModel/index.vue")) },
  { id: "tools", label: "工具配置", icon: IconAdjustments, groupLabel: "其他", component: defineAsyncComponent(() => import("./panels/tools.vue")) },
  { id: "ffmpeg", label: "FFmpeg", icon: IconTransform, groupLabel: "其他", component: defineAsyncComponent(() => import("./panels/ffmpeg/index.vue")) },
  { id: "ytDlp", label: "取流工具", icon: IconCloudDownload, groupLabel: "其他", component: defineAsyncComponent(() => import("./panels/ytDlp/index.vue")) },
  { id: "about", label: "关于", icon: IconInfoCircle, component: defineAsyncComponent(() => import("./panels/about.vue")) },
];
const activePanel = shallowRef(settingsPanels[0]!);
const visible = defineModel<boolean>({ default: false });

/** 当前位置是否该渲染分组标题：只有第一项、或分组与上一项不同时才算新分组。 */
function startsNewGroup(index: number) {
  const current = settingsPanels[index];
  if (!current?.groupLabel) return false;
  return index === 0 || settingsPanels[index - 1]?.groupLabel !== current.groupLabel;
}
</script>

<style lang="scss" scoped>
.settings {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  height: min(72vh, calc(100dvh - 140px));
  overflow: hidden;

  .sidebar {
    min-height: 0;
    overflow-y: auto;
    padding: 2px 10px 2px 2px;
    /* ACT: 侧栏用一条细分割线界定，替代默认的留白分隔，信息层级更清楚。 */
    border-right: 1px solid var(--el-border-color-lighter);

    .settingsGroupLabel {
      margin: 14px 10px 6px;
      color: var(--el-text-color-placeholder);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.04em;
      line-height: 1.5;
    }

    .settingsItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 9px 10px;
      margin-bottom: 2px;
      border: 0;
      border-radius: var(--ui-radius-small);
      background: transparent;
      color: var(--el-text-color-regular);
      font: inherit;
      font-size: 13px;
      text-align: start;
      cursor: pointer;

      .panelIcon { display: inline-flex; flex-shrink: 0; }

      > span {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      &:hover {
        background: var(--el-fill-color-light);
      }

      /* ACT: 选中态改为左侧色条 + 加粗，替代整块浅色背景（浅色块在浅色主题下几乎看不见）。 */
      &[aria-pressed="true"] {
        background: var(--el-fill-color-light);
        color: var(--el-color-primary);
        font-weight: 500;
        box-shadow: inset 2px 0 0 var(--el-color-primary);
      }

      &:focus-visible {
        outline: 2px solid var(--el-color-primary);
      }
    }
  }

  .content {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0 20px;
    overflow: hidden;

    .panelTitle {
      flex-shrink: 0;
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 600;
    }

    .panelContent {
      flex: 1;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-left: 5px;
      padding-right: 5px;
      padding-bottom: 50px;

      > :deep(.el-fade-in-enter-active),
      > :deep(.el-fade-in-leave-active) {
        transition-duration: 100ms;
      }
    }
  }

  @media (max-width: 700px) {
    grid-template-columns: 44px minmax(0, 1fr);

    .sidebar {
      .settingsGroupLabel {
        margin: 12px 0 6px;
        text-align: center;
      }

      .settingsItem {
        justify-content: center;
        padding: 12px;
        span {
          display: none;
        }
      }
    }

    .content {
      padding: 0 8px 0 16px;
    }
  }
}
</style>
