<template>
  <!-- 语音模型面板：与「文本模型」「媒体模型」并列的第三个模型面板。
       按 D9，供应商是全局共享的，这里只是按模型 type 筛选出含音频模型的供应商，
       所以直接复用媒体模型面板的实现并传 kind="audio"，不再维护第二套逻辑。 -->
  <mediaModel kind="audio" />
</template>

<script setup lang="ts">
import mediaModel from "../mediaModel/index.vue";
</script>
