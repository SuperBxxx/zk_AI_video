<template>
  <!--
    未配置模型时进入首页的提醒模态。

    为什么需要它：原先有一个独立的「快速开始」引导页负责配置供应商，该页已移除，
    所有用户直接进首页。于是首页必须自己承担「还没配模型」的提醒，否则用户会在
    填完创作描述、点了发送之后才发现无法生成。

    行为约定（按产品要求）：
      · 每次进入首页都会提醒 —— 组件在首页挂载时判断一次
      · 可以关闭 —— 「先随便看看」不阻断浏览与项目管理
      · 发送侧的兜底仍在：AI 助手会在 model 为空时提示「请先选择模型」，
        因此关闭本模态不会造成静默失败
  -->
  <el-dialog
    v-model="visible"
    title="先添加一个模型供应商"
    width="min(460px, 92vw)"
    alignCenter
    appendToBody
    :closeOnClickModal="false">
    <p class="hint">需要一个语言模型才能开始创作。添加你自己的供应商后即可使用；所有密钥与请求都只留在本机。</p>
    <ul class="steps">
      <li>点「去添加」打开设置的「文本模型」面板</li>
      <li>选择厂商或添加自定义供应商，填入 API Key 并获取模型列表</li>
      <li>返回首页即可选择模型并开始创作</li>
    </ul>
    <template #footer>
      <el-button size="small" @click="visible = false">先随便看看</el-button>
      <el-button size="small" type="primary" @click="openSettings">去添加</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{ openSettings: [] }>();
const visible = ref(false);

// 由首页在判断出「没有可用模型」后调用，展示提醒。
function open() {
  visible.value = true;
}

function openSettings() {
  visible.value = false;
  emit("openSettings");
}

defineExpose({ open });
</script>

<style lang="scss" scoped>
.hint {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
  line-height: 1.75;
}

.steps {
  margin: 14px 0 0;
  padding-left: 20px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.9;
}
</style>
