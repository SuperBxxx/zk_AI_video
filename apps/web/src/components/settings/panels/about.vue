<template>
  <div class="about">
    <div class="brand">
      <div class="brandMark"><img class="brandLogo" :src="logoUrl" alt="住凯AI视频" /></div>
      <div class="brandInfo">
        <h3>住凯AI视频</h3>
      </div>
    </div>

    <el-card class="infoCard" shadow="never">
      <div class="cardHeader">
        <div class="cardLabel">
          <icon-license :size="20" aria-hidden="true" />
          <span>开源许可</span>
        </div>
      </div>
      <p class="licenseText">
        本软件基于 Toonflow 改造，遵循 MIT 许可证分发。
        Copyright (c) 2026 HBAI-Ltd。完整许可证文本见安装目录下的 LICENSE 文件。
      </p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { IconLicense } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandMark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 60px;
      height: 60px;
      border-radius: calc(var(--ui-radius) * 1.5);
      background: var(--el-fill-color-light);

      .brandLogo {
        width: 42px;
        height: 42px;
        object-fit: contain;

        .dark & {
          filter: invert(1);
        }
      }
    }

    .brandInfo {
      min-width: 0;

      h3 {
        margin: 0;
        color: var(--el-text-color-primary);
        font-size: 20px;
        font-weight: 600;
      }
    }
  }

  .infoCard {
    min-width: 0;
    border-radius: var(--ui-radius);

    :deep(.el-card__body) {
      padding: 14px;
    }

    .cardHeader {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;

      .cardLabel {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--el-text-color-primary);
        font-size: 14px;
        font-weight: 600;
      }
    }
  }

  .licenseText {
    margin: 8px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
}
</style>
