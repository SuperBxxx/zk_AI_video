<template>
  <div class="privacy">
    <section class="settingSection" aria-labelledby="localTitle">
      <div class="settingHeader">
        <h3 id="localTitle">数据只在本机</h3>
        <el-tag type="success" size="small" round>无遥测</el-tag>
      </div>
      <p class="description">
        本软件不收集、不上报任何使用数据，也没有匿名统计。没有需要你关闭的开关，因为它从来就不发送。
      </p>
    </section>

    <section class="settingSection" aria-labelledby="whereTitle">
      <h3 id="whereTitle">数据存在哪里</h3>
      <dl class="metricList">
        <div v-for="item in locations" :key="item.label" class="metricItem">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.description }}</dd>
        </div>
      </dl>
    </section>

    <section class="settingSection" aria-labelledby="networkTitle">
      <h3 id="networkTitle">什么时候会联网</h3>
      <p class="description">
        只有这些情况会发出网络请求：你在设置里配置的模型供应商（生成文本／图片／视频／语音时）、
        FFmpeg 下载（由你手动触发）、以及你主动装载的插件与 MCP 服务。
        除此之外，本软件不主动连接任何服务器。
      </p>
    </section>

    <section class="settingSection" aria-labelledby="eraseTitle">
      <h3 id="eraseTitle">怎么彻底清掉</h3>
      <p class="description">
        删除数据目录即可移除全部本机数据（项目、素材、设置、对话历史都在其中）。
        卸载时可勾选“同时删除用户数据”。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";

const locations = [
  { get label() { return translate("设置与偏好"); }, get description() { return translate("数据目录下的 settings.json"); } },
  { get label() { return translate("项目与素材"); }, get description() { return translate("你为项目选择的工作目录，以及数据目录下的内容"); } },
  { get label() { return translate("对话历史"); }, get description() { return translate("工作目录内的会话文件，仅本机可读"); } },
  { get label() { return translate("模型密钥"); }, get description() { return translate("保存在本机设置中，只在你调用对应供应商时使用"); } },
];
</script>

<style lang="scss" scoped>
.privacy {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .settingSection {
    min-width: 0;

    h3 {
      margin: 0 0 12px;
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 600;
    }

    .settingHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      h3 { margin: 0; }
    }

    .description {
      margin: 8px 0 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      line-height: 1.6;
    }

    .metricList {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;

      .metricItem {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 12px;
        font-size: 13px;
        line-height: 1.6;

        dt { color: var(--el-text-color-regular); }
        dd { margin: 0; color: var(--el-text-color-secondary); }
      }
    }
  }
}
</style>
