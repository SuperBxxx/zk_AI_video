<template>
  <el-container class="home">
    <minimalBackground class="pageBackground" />
    <el-header class="pageHeader">
      <el-space wrap :size="12">
        <el-button round size="large" :icon="IconFolders" aria-label="素材库" @click="assetsVisible = true">素材库</el-button>
        <el-button round size="large" :icon="IconLayoutGrid" aria-label="配方卡片库" @click="cardLibraryVisible = true">配方卡片库</el-button>
        <el-badge isDot :hidden="!hasDesktopUpdate">
          <el-button round size="large" :icon="IconSettings" :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" @click="settingsVisible = true">设置</el-button>
        </el-badge>
      </el-space>
    </el-header>
    <el-main class="pageContent">
      <section class="creationPanel" aria-label="创建项目">
        <div class="brand">
          <el-image class="brandLogo" :src="logoUrl" fit="contain" alt="住凯AI视频" />
          <h1>住凯AI视频</h1>
        </div>
        <div class="promptArea">
          <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '20px' }" :footerStyle="{ padding: '12px 16px' }">
            <attachmentList v-if="promptAttachments.length" class="promptAttachments" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" />
            <el-input ref="promptInput" v-model="prompt" type="textarea" :rows="4" resize="none" :disabled="creating || opening" aria-label="创作描述" :placeholder="promptPlaceholder" @paste.capture="pasteText" />
            <template #footer>
              <div class="composerFooter">
                <workspacePicker ref="promptWorkspacePicker" v-model="workspaceDirectory" :disabled="creating || opening" />
                <el-space class="sendActions" wrap :size="12">
                  <input ref="attachmentInput" class="attachmentInput" type="file" accept="image/*" multiple aria-label="选择参考图片" @change="addAttachments" />
                  <el-button :icon="IconPaperclip" :disabled="creating || opening" aria-label="添加参考图片" @click="attachmentInput?.click()">参考图片</el-button>
                  <modelPopover v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" class="modelSelect" :disabled="creating || opening" />
                  <el-button class="sendButton" type="primary" :circle="!!workspaceDirectory" :icon="workspaceDirectory ? IconArrowUp : IconFolder" :loading="creating" :disabled="creating || opening" :aria-label="workspaceDirectory ? '发送' : '选择工作目录'" @click="workspaceDirectory ? createProject() : promptWorkspacePicker?.chooseDirectory()">
                    <template v-if="!workspaceDirectory" #default>选择工作目录</template>
                  </el-button>
                </el-space>
              </div>
              <p v-if="!workspaceDirectory" class="workspaceHint" role="status">请先选择一个空文件夹作为工作目录，画布和素材会保存在这里。</p>
            </template>
          </el-card>
        </div>
      </section>
      <section class="projectList" aria-labelledby="projectListTitle">
        <div class="sectionHeader">
          <h2 id="projectListTitle">项目列表</h2>
          <el-space wrap>
            <el-button :icon="iconFolderOpen" :disabled="creating || opening" @click="openProject()">导入项目</el-button>
            <el-button :icon="IconFolderPlus" :disabled="creating || opening" @click="createProject(false)">添加项目</el-button>
            <el-button circle :icon="sortDescending ? IconSortDescending : IconSortAscending" :aria-label="sortDescending ? '按时间降序' : '按时间升序'" @click="sortDescending = !sortDescending" />
            <el-radio-group v-model="viewMode" aria-label="项目视图">
              <el-radio-button value="grid" aria-label="网格视图"><icon-layout-grid :size="16" /></el-radio-button>
              <el-radio-button value="list" aria-label="列表视图"><icon-list :size="16" /></el-radio-button>
            </el-radio-group>
          </el-space>
        </div>
        <div class="projectItems" :class="{ listView: viewMode === 'list' }">
          <el-card v-for="project in sortedProjects" :key="project.directory" class="projectCard" shadow="hover" :bodyStyle="{ padding: '0' }">
            <button class="projectEntry" type="button" :disabled="creating || opening" :aria-label="`打开项目 ${project.name}`" @click="openProject(project)">
              <icon-folder class="projectIcon" :size="28" aria-hidden="true" />
              <span class="projectInfo">
                <span class="projectName" :title="project.name">{{ project.name }}</span>
                <span class="projectPath" :title="project.directory">{{ project.directory }}</span>
                <span class="projectTime">最近打开 {{ new Date(project.lastOpenedAt).toLocaleString(locale, { hour12: false }) }}</span>
              </span>
            </button>
            <div class="projectActions">
              <el-button text :icon="IconEdit" :disabled="creating || opening" :aria-label="`重命名项目 ${project.name}`" title="重命名" @click="renameProject(project)" />
              <el-button text type="danger" :icon="IconTrash" :disabled="creating || opening" :aria-label="`移除项目 ${project.name}`" title="从列表移除，不删除文件" @click="workspaceStore.removeProject(project.directory)" />
            </div>
          </el-card>
        </div>
      </section>
    </el-main>
    <modelSetupDialog ref="modelSetupDialogRef" @openSettings="settingsVisible = true" />
    <settings v-model="settingsVisible" />
    <!-- 素材库数据是全局的（服务端以 {数据目录}/assets 为根），与是否打开项目无关，
         因此首页也能直接管理：新建文件夹、上传、生成内容都可用。
         canvas=false 关闭画布专属能力（拖拽到画布、保存节点输出）。 -->
    <el-dialog v-model="assetsVisible" title="素材库" width="min(860px, 94vw)" alignCenter appendToBody destroyOnClose>
      <!-- 必须绑定 v-model：assetLibrary 内部用 visible 控制根节点的 v-if，
           不绑定就一直是默认的 false，对话框里会是一片空白。
           fill 让卡片撑满对话框：默认样式是画布浮层的 320px 固定宽度，
           放进对话框会把内容区压成 0，同样是「什么都没有」。 -->
      <assetLibrary v-model="assetsVisible" :canvas="false" fill />
    </el-dialog>
    <cardLibrary v-model="cardLibraryVisible" />
    <workspacePicker ref="relocationPicker" hideTrigger />
  </el-container>
</template>

<script setup lang="ts">
import { locale } from "@toonflow/i18n/vue";
import axios from "axios";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import {
  IconSettings, IconFolders,
  IconArrowUp, IconLayoutGrid,
  IconList, IconSortDescending,
  IconSortAscending, IconFolder, IconEdit,
  IconTrash, IconFolderPlus, IconFolderOpen as iconFolderOpen, IconPaperclip,
} from "@tabler/icons-vue";
import modelPopover from "@/components/modelPopover.vue";
import attachmentList from "@/components/agent/attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "@/components/agent/textAttachments";
import type { AgentAttachment } from "@/components/agent/types";
import logoUrl from "@toonflow/assets/logo.svg";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { customProviders } from "@/stores/settings";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import settings from "@/components/settings/index.vue";
import modelSetupDialog from "@/components/modelSetupDialog.vue";
// 素材库组件位于画布目录下，但它操作的是全局 assets 目录，与画布无耦合。
// 跨目录引用此处是有意的：先复用同一份实现，避免维护两套素材库。
import assetLibrary from "@/pages/workspace/panels/canvas/components/assetLibrary.vue";
import cardLibrary from "@/components/cardLibrary.vue";
import minimalBackground from "@/components/minimalBackground.vue";
import workspacePicker from "./workspacePicker.vue";
const settingsVisible = ref(false);
// 首页的素材库：素材库是全局的，不需要先打开项目就能管理素材。
const assetsVisible = ref(false);
// 配方卡片库：浏览现有卡（内置分析手法 / HTML 卡 / FFmpeg 卡），不依赖当前项目。
const cardLibraryVisible = ref(false);
const router = useRouter();
const creating = ref(false);
const opening = ref(false);
const promptWorkspacePicker = ref<InstanceType<typeof workspacePicker>>();
const relocationPicker = ref<InstanceType<typeof workspacePicker>>();
const prompt = ref("");
const promptInput = ref<InputInstance>();
const promptAttachments = ref<AgentAttachment[]>([]);
const attachmentInput = ref<HTMLInputElement>();
const modelSetupDialogRef = ref<InstanceType<typeof modelSetupDialog>>();
// 与 AI 助手对话的附件上限保持一致，避免进工作区后才发现超出。
const maxAttachments = 20;
// ACT: 首页不再让用户选「创作模式」。
// 原先要选模式（自由创作 / 营销推广 / 数字人口播 / 故事短剧）才建项目，模式决定预置画布与开场提示词；
// 实测这套引导是**反的**：用户还不知道要做什么，就得先选一个模式，还容易被"必须输点东西"卡住。
// 现在统一建空画布，进去之后由对话引导 —— 想做什么、有什么素材，在能看见画布的地方说更自然。
// createModes.ts 仍然保留（模式定义与它的端口校验都还在），将来要恢复入口加回来即可。
const workspaceStore = useWorkspaceStore();
// ACT: 输入框改成「可留空」。用户还不知道要做什么时，逼他先写一段话是没必要的门槛 ——
// 空着进去，在能看见画布的地方由对话引导更自然。
const promptPlaceholder = "想做什么？（可以留空，进去后我们边聊边定）\n例如：给一款宠物用品做 15 秒竖版宣传片；或：我上传了三张实拍图，想让小狗开口说一句话。";
const { project, projectList } = storeToRefs(workspaceStore);
const workspaceDirectory = ref(project.value?.directory ?? "");

const selectedModel = ref("");
const reasoningEffort = ref("");
const sortDescending = ref(true);
const viewMode = ref("grid");
const sortedProjects = computed(() => [...projectList.value].sort((left, right) =>
  sortDescending.value ? right.lastOpenedAt - left.lastOpenedAt : left.lastOpenedAt - right.lastOpenedAt
));

function pasteText(event: ClipboardEvent) {
  if (creating.value || opening.value) return;
  try {
    const file = createPastedTextFile(event.clipboardData?.getData("text/plain") ?? "");
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (promptAttachments.value.length >= 20) return ElMessage.warning("每条消息最多添加 20 个附件");
    promptAttachments.value.push({ name: file.name, path: "", mimeType: file.type, file });
  } catch (error) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ElMessage.error(error instanceof Error ? error.message : "添加文本附件失败，请重试");
  }
}

async function restoreAttachment(index: number) {
  const attachment = promptAttachments.value[index];
  if (!attachment || creating.value || opening.value) return;
  try {
    const text = await readTextAttachment(attachment);
    const currentIndex = promptAttachments.value.indexOf(attachment);
    if (currentIndex < 0 || creating.value || opening.value) return;
    prompt.value += `${prompt.value ? "\n" : ""}${text}`;
    promptAttachments.value.splice(currentIndex, 1);
    await nextTick();
    promptInput.value?.focus();
    promptInput.value?.textarea?.setSelectionRange(prompt.value.length, prompt.value.length);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取回文本失败，请重试");
  }
}

// ACT: 首页只负责"选中图片"，不做上传 —— 此刻工作目录可能还没选。
// 附件先以 File 形式留在内存，进工作区后由 conversation 的 uploadAttachments
// 统一写入 assets/chat/ 并回填 path，与 AI 助手对话里的附件走同一条落地路径。
function addAttachments(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length || creating.value || opening.value) return;
  const room = maxAttachments - promptAttachments.value.length;
  if (room <= 0) return ElMessage.warning(`最多添加 ${maxAttachments} 个附件`);
  if (files.length > room) ElMessage.warning(`最多添加 ${maxAttachments} 个附件，已保留前 ${room} 个`);
  for (const file of files.slice(0, room)) {
    promptAttachments.value.push({ name: file.name, path: "", mimeType: file.type, file });
  }
}

async function openProject(project?: Project) {
  if (creating.value || opening.value) return;
  opening.value = true;
  try {
    const directory = project?.directory ?? await relocationPicker.value?.chooseDirectory();
    if (!directory) return;
    try { await workspaceStore.openProject(directory); }
    catch (err) {
      if (!project || !axios.isAxiosError(err) || err.response?.status !== 404) throw err;
      const reselect = await ElMessageBox.confirm(`项目“${project.name}”的文件夹不存在，是否重新选择文件夹？`, "工作目录不存在", {
        confirmButtonText: "重新选择", cancelButtonText: "取消", type: "warning",
      }).then(() => true, () => false);
      if (!reselect) return;
      const directory = await relocationPicker.value?.chooseDirectory();
      if (!directory) return;
      await workspaceStore.openProject(directory, project.directory);
    }
    await router.push("/workspace");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally { opening.value = false; }
}

async function renameProject(project: Project) {
  const result = await ElMessageBox.prompt("请输入项目名称", "重命名项目", {
    inputValue: project.name, confirmButtonText: "保存", cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "项目名称不能为空",
  }).catch(() => null);
  if (result) workspaceStore.renameProject(project.directory, result.value);
}

async function createProject(fromPrompt = true) {
  if (creating.value || opening.value || (fromPrompt && !workspaceDirectory.value)) return;
  creating.value = true;
  try {
    let path = workspaceDirectory.value;
    if (!fromPrompt) {
      const confirmed = await ElMessageBox.confirm("请选择一个空文件夹作为项目目录，画布和素材将保存在其中。", "添加项目", {
        confirmButtonText: "选择空文件夹", cancelButtonText: "取消", type: "info",
      }).then(() => true, () => false);
      if (!confirmed) return;
      path = await relocationPicker.value?.chooseDirectory() ?? "";
      if (!path) return;
    }
    const { directory, empty } = await useWorkspaceFiles(path).list();
    if (!empty) return ElMessage.warning("该文件夹不为空，请重新选择空文件夹；已有项目请使用“导入项目”或点击项目列表打开。");
    // ACT: 新项目一律是**空画布** —— 不再按模式预铺节点。
    // 进项目后由对话引导：先问清楚要做什么、有什么素材（参考图/视频），agent 再按需建画布。
    await useWorkspaceFiles(directory).writeJson("画布1.json", { toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
    await workspaceStore.openProject(directory);
    if (fromPrompt && (prompt.value.trim() || promptAttachments.value.length)) {
      workspaceStore.pendingAgentMessage = { directory: workspaceStore.project!.directory, prompt: prompt.value, attachments: [...promptAttachments.value], model: selectedModel.value, reasoningEffort: reasoningEffort.value };
    }
    await router.push("/workspace");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "创建项目失败，请重试"
      : err instanceof Error ? err.message : "创建项目失败，请重试");
  } finally {
    creating.value = false;
  }
}

// ACT: 没有可用语言模型时，每次进入首页都提醒一次。
// 原先这份提醒由独立的「快速开始」引导页承担，该页已移除，因此移到首页。
// 「可用」的定义与模型选择器一致：供应商既填了 API Key、又至少有一个模型。
// 不阻断浏览 —— 模态可关闭，发送侧的兜底（助手提示「请先选择模型」）仍在。
function hasUsableModel() {
  return customProviders.value.some(provider => provider.apiKey.trim() && provider.models.length);
}

onMounted(() => {
  if (!hasUsableModel()) modelSetupDialogRef.value?.open();
});

// 用户点「去添加」进设置、配好后再关闭设置时，重新判断一次：
// 配好了就不再打扰，没配好则继续提醒（onMounted 只跑一次，覆盖不到这个来回）。
watch(settingsVisible, (open, wasOpen) => {
  if (open || !wasOpen) return;
  if (!hasUsableModel()) modelSetupDialogRef.value?.open();
});
</script>

<style lang="scss" scoped>
.home {
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  color: var(--el-text-color-primary);

  .pageBackground {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  .pageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 72px;
    padding: 0 clamp(20px, 4vw, 56px);

    a {
      text-decoration: none;
    }
  }

  .pageContent {
    padding: 24px clamp(20px, 4vw, 56px) 56px;

    .creationPanel {
      max-width: 800px;
      margin: clamp(32px, 6vh, 64px) auto 56px;

      .brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        margin-bottom: 32px;

        .brandLogo {
          width: 40px;
          height: 40px;

          .dark & {
            filter: invert(1);
          }
        }

        h1 {
          margin: 0;
          font-size: clamp(26px, 3.2vw, 32px);
          font-weight: 650;
          letter-spacing: -0.02em;
        }
      }

      .promptArea {
        position: relative;

        .promptCard {
          /* ACT: 原为 radius × 2.5，是"软"观感最重的一处；收紧到单个倍率。 */
          border-radius: var(--ui-radius-large);
          border-color: var(--el-border-color-lighter);
          box-shadow: var(--el-box-shadow-lighter);
          transition: border-color 0.15s ease;

          &:focus-within {
            border-color: var(--el-color-primary);
          }

          .promptAttachments {
            margin-bottom: 12px;
          }

          :deep(.el-textarea__inner) {
            padding: 4px 0;
            box-shadow: none;
            background: transparent;
            font-size: 15px;
            line-height: 1.8;
          }

          :deep(.el-card__footer) {
            background: var(--el-fill-color-extra-light);
          }

          .attachmentInput { display: none; }

          .composerFooter {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;

            .sendActions {
              margin-left: auto;
              justify-content: flex-end;

              .modelSelect {
                width: 190px;
              }

              .sendButton {
                height: 36px;

                &.is-circle { width: 36px; }
              }
            }
          }

          .workspaceHint {
            margin: 12px 0 0;
            color: var(--el-text-color-regular);
            font-size: 13px;
            line-height: 1.6;
          }
        }
      }
    }

    .projectList {
      max-width: 1040px;
      margin: 0 auto;

      .projectItems {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
        gap: 16px;
        margin-top: 16px;

        &.listView { grid-template-columns: 1fr; }

        .projectCard {
          position: relative;
          border-radius: var(--ui-radius);
          border-color: var(--el-border-color-lighter);
          transition: border-color 0.15s ease, background-color 0.15s ease;

          /* ACT: 悬停只做"底色略抬 + 描边加深"，不做位移与投影 —— 位移会让网格视感发飘。 */
          &:hover {
            border-color: var(--el-color-primary-light-5);
            background: var(--el-fill-color-light);
          }

          .projectActions {
            position: absolute;
            top: 12px;
            right: 8px;
            display: flex;
            gap: 4px;

            .el-button { width: 32px; height: 32px; margin: 0; padding: 0; }
          }
        }

        .projectEntry {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          width: 100%;
          padding: 18px 84px 18px 18px;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;

          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
          &:disabled { cursor: wait; opacity: 0.6; }

          .projectIcon { flex-shrink: 0; color: var(--el-color-primary); }

          .projectInfo {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;

            .projectName, .projectPath {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .projectName { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }
            .projectPath { font-size: 12px; color: var(--el-text-color-secondary); }
            .projectTime { font-size: 12px; color: var(--el-text-color-placeholder); }
          }
        }
      }

      .sectionHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--el-border-color-lighter);

        h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0;
          color: var(--el-text-color-regular);
        }
      }
    }
  }
}
</style>
