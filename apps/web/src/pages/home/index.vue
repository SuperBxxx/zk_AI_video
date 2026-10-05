<template>
  <el-container class="home">
    <minimalBackground class="pageBackground" />
    <el-header class="pageHeader">
      <el-badge isDot :hidden="!hasDesktopUpdate">
        <el-button round size="large" :icon="IconSettings" :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" @click="settingsVisible = true">设置</el-button>
      </el-badge>
    </el-header>
    <el-main class="pageContent">
      <section class="creationPanel" aria-label="创建项目">
        <div class="brand">
          <el-image class="brandLogo" :src="logoUrl" fit="contain" alt="住凯AI视频" />
          <h1>住凯AI视频</h1>
        </div>
        <div class="promptArea">
          <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '20px' }" :footerStyle="{ padding: '12px 16px' }">
            <div class="modePicker">
              <span class="modeLabel">创作模式</span>
              <el-segmented v-model="selectedMode" :options="modeOptions" :disabled="creating || opening" aria-label="创作模式" />
            </div>
            <attachmentList v-if="promptAttachments.length" class="promptAttachments" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" />
            <el-input ref="promptInput" v-model="prompt" type="textarea" :rows="4" resize="none" :disabled="creating || opening" aria-label="创作描述" @paste.capture="pasteText" />
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
  IconSettings,
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
import minimalBackground from "@/components/minimalBackground.vue";
import workspacePicker from "./workspacePicker.vue";
import { createModes } from "./createModes";

const settingsVisible = ref(false);
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
// 创作模式：决定预置的提示词与画布节点。
const modeOptions = createModes.map(({ id, label }) => ({ label, value: id }));
const selectedMode = ref(createModes[0]!.id);
const activeMode = computed(() => createModes.find(mode => mode.id === selectedMode.value) ?? createModes[0]!);
// 记录上一次由模式填入的文本。切换模式时只替换这段文本，
// 用户自己写过或改过的内容一律保留。
let appliedModePrompt = activeMode.value.prompt;
watch(selectedMode, () => {
  const next = activeMode.value.prompt;
  if (prompt.value === appliedModePrompt) prompt.value = next;
  appliedModePrompt = next;
});
const workspaceStore = useWorkspaceStore();
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
    // 按所选模式铺好画布。自由创作是空画布，与原先行为一致。
    const { nodes, edges } = activeMode.value.build();
    await useWorkspaceFiles(directory).writeJson("画布1.json", { toonflowCanvas: true, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }, true);
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

          /* ACT: 模式决定画布内容，所以放在卡片内、输入框之上，
             与"描述"同属"要创作什么"；工作目录与模型属于环境设置，留在底部。 */
          .modePicker {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;

            .modeLabel {
              flex-shrink: 0;
              color: var(--el-text-color-secondary);
              font-size: 13px;
            }

            .el-segmented {
              --el-segmented-item-selected-bg-color: var(--el-color-primary);
              --el-segmented-item-selected-color: #fff;
            }
          }

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
