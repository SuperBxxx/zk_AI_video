<template>
  <main class="hello" :class="{ configuring: view !== 'welcome' }">
    <div class="pageLanguage"><languageSelect popover /></div>
    <section class="welcomePanel" aria-labelledby="welcomeTitle">
      <div v-if="view !== 'welcome'" class="providerContent">
        <header class="providerHeader">
          <el-button text :icon="IconArrowLeft" :disabled="saving" @click="view = 'welcome'">返回</el-button>
          <h1 id="welcomeTitle">配置语言模型</h1>
        </header>
        <div class="providerBody">
          <languageModel />
        </div>
        <el-button
          v-if="view === 'custom'"
          type="primary"
          :loading="saving"
          :disabled="!customProviders.some((provider) => provider.models.length)"
          @click="completeSetup">
          开始使用
        </el-button>
      </div>
      <div v-else class="welcomeContent">
        <h1 id="welcomeTitle">快速开始</h1>
        <p class="description">添加你自己的模型供应商，配置完成后即可开始创作。所有密钥与请求都只留在本机。</p>

        <el-button class="loginButton" type="primary" @click="view = 'custom'">
          <icon-key class="buttonIcon" />
          添加模型供应商
        </el-button>
        <div class="secondaryActions">
          <el-button class="secondaryButton" round :loading="saving" @click="completeSetup">稍后配置</el-button>
        </div>
      </div>

      <footer class="pageFooter">
        <p>© {{ new Date().getFullYear() }} 住凯AI视频 · 保留所有权利。</p>
      </footer>
    </section>
    <div class="artPanel" aria-hidden="true">
      <minimalBackground class="artBg" />
      <div class="artBrand">
        <span class="artLogo" v-html="logoSvg" />
        <span class="artName">住凯AI视频</span>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { IconArrowLeft } from "@tabler/icons-vue";
import { customProviders } from "@/stores/settings";
import { useHelloStore } from "@/stores/hello";
import logoSvg from "@toonflow/assets/logo.svg?raw";
import minimalBackground from "@/components/minimalBackground.vue";
import languageSelect from "@/components/languageSelect.vue";

const languageModel = defineAsyncComponent(() => import("@/components/settings/panels/languageModel/index.vue"));
const view = ref<"welcome" | "custom">("welcome");
const saving = ref(false);
const router = useRouter();
const hello = useHelloStore();

async function completeSetup() {
  if (saving.value) return;
  saving.value = true;
  try {
    await hello.complete();
    await router.replace("/home");
  } catch {
    ElMessage.error("保存引导状态失败，请重试");
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.hello {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 100svh;
  padding: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;

  .pageLanguage {
    position: fixed;
    top: 16px;
    inset-inline-end: calc(50% + 8px);
    z-index: 2;
    max-width: calc(50% - 24px);
  }

  .welcomePanel {
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    gap: 32px;
    min-width: 0;
    min-height: 544px;
    padding: 48px clamp(24px, 4.4vw, 64px);

    .providerContent {
      grid-row: 1;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 24px;
      min-width: 0;
      min-height: 0;
      overflow: hidden;

      .providerHeader {
        h1 {
          margin: 16px 0 0;
          font-size: 28px;
          font-weight: 650;
        }
      }

      .providerBody {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 2px;
      }
    }

    .welcomeContent {
      grid-row: 2;
      width: 100%;
      max-width: 420px;
      text-align: center;

      h1 {
        margin: 0 0 12px;
        font-size: clamp(32px, 3.4vw, 40px);
        font-weight: 650;
        line-height: 1.35;
        letter-spacing: -0.8px;
      }

      .description {
        margin: 0 0 32px;
        color: var(--el-text-color-secondary);
        font-size: 14px;
        line-height: 1.8;
      }

      .buttonIcon {
        width: 18px;
        height: 18px;
        margin-inline-end: 8px;
      }

      .loginButton {
        width: 100%;
        height: auto;
        min-height: 50px;
        padding: 12px;
        white-space: normal;
        border-radius: calc(var(--ui-radius) * 1.625);
        font-size: 16px;
        font-weight: 600;
      }

      .secondaryActions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 20px;

        .separator {
          color: var(--el-text-color-secondary);
          font-size: 13px;
        }

        .secondaryButton {
          height: auto;
          min-height: 36px;
          margin: 0;
          padding: 8px 16px;
          white-space: normal;
          font-size: 13px;
        }
      }
    }

    .pageFooter {
      grid-row: 3;
      align-self: end;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      p {
        margin: 10px 0 0;
        line-height: 1.6;
      }
    }
  }

  &.configuring {
    height: 100dvh;
    min-height: 0;
    overflow: hidden;

    .welcomePanel {
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 24px;
      min-height: 0;

      .pageFooter {
        grid-row: 2;
      }
    }
  }

  .artPanel {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 28px;
    border-radius: calc(var(--ui-radius) * 1.125);
    overflow: hidden;
    /* ACT: 上游这里是四层彩色径向渐变（含 #f3dcb1/#667ab5/#369889 等），视觉语言很"上游"。
       极简化后只留品牌色实底，纹理交给 minimalBackground 的点阵与柔光。 */
    background: var(--brand-panel, #14543C);

    /* 纹理层在下，只提供质感；上面的柔光由 minimalBackground 负责 */
    .artBg {
      z-index: 0;
      opacity: 0.5;
      mix-blend-mode: soft-light;
    }

    .artBrand {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #fff;

      .artLogo {
        width: 44px;
        height: 44px;
        line-height: 0;

        :deep(svg) {
          display: block;
          width: 100%;
          height: 100%;
        }

        /* ACT: 原先只选 path —— 上游标志是 <path>，而现在的标志是 12 个 <rect>，
           只选 path 会让深绿面板上渲染出黑标、几乎看不见。
           改为同时覆盖 path 与 rect，两者都写，换图形时不会再踩同一个坑。 */
        :deep(path),
        :deep(rect) {
          fill: #fff;
        }
      }

      .artName {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: 0.4px;
      }
    }
  }

  @media (max-width: 700px) {
    grid-template-columns: 1fr;

    .pageLanguage {
      inset-inline-end: 16px;
      max-width: calc(100% - 32px);
    }

    .welcomePanel {
      padding: 32px 20px;

      .welcomeContent {
        justify-self: center;
      }
    }

    .artPanel {
      display: none;
    }
  }
}
</style>
