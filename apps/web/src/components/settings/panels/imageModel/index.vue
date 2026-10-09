<template>
  <!-- 图片模型面板：与「文本模型」「媒体模型」「语音模型」并列的第四个模型面板。
       按 D9，供应商是全局共享的，这里只是按模型 type 筛选出含图片模型的供应商，
       所以直接复用媒体模型面板的实现并传 kind="image"，不再维护第二套逻辑。 -->
  <mediaModel kind="image" />
</template>

<script setup lang="ts">
import mediaModel from "../mediaModel/index.vue";
</script>
