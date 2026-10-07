<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="downloadUrl"
    :downloadName="`${nodeProps.label || '画面卡'}.mp4`"
    :bottomWidth="680">
    <div class="cardContent nopan nowheel">
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        :mime-type="outputFile?.mimeType"
        @loadedmetadata="resizeVideo" />
      <div v-else class="placeholder">
        <span class="placeholderText">{{ selectedCard ? selectedCard.meta.title : "选一张画面卡" }}</span>
        <span class="placeholderHint">{{ shapeHint }}</span>
      </div>
      <el-progress
        v-if="rendering"
        class="progress"
        :percentage="progressPercent"
        :stroke-width="6"
        :show-text="false" />
    </div>

    <template #bottom>
      <el-card class="configCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <div class="configRow">
          <span class="configLabel">卡</span>
          <el-select v-model="slug" class="cardSelect" filterable placeholder="选一张卡">
            <el-option
              v-for="option in cardOptions"
              :key="option.slug"
              :label="`${option.title} · ${shapeLabel(option.shape)}`"
              :value="option.slug" />
          </el-select>
        </div>
        <div v-if="selectedCard" class="oneliner">{{ selectedCard.meta.oneliner }}</div>

        <div class="configRow">
          <span class="configLabel">画幅</span>
          <el-input-number v-model="width" :min="16" :max="8192" :step="16" controls-position="right" />
          <span class="times">×</span>
          <el-input-number v-model="height" :min="16" :max="8192" :step="16" controls-position="right" />
          <span class="configLabel seconds">帧率</span>
          <el-input-number v-model="fps" :min="1" :max="120" controls-position="right" />
        </div>

        <div v-if="parameterEntries.length" class="params">
          <div v-for="entry in parameterEntries" :key="entry.name" class="paramRow">
            <span class="paramName" :title="entry.spec.description">{{ entry.name }}</span>
            <el-input-number
              :model-value="parameters[entry.name] ?? entry.spec.value"
              :min="entry.spec.min"
              :max="entry.spec.max"
              :step="entry.step"
              controls-position="right"
              @update:model-value="value => setParameter(entry.name, value)" />
          </div>
        </div>

        <div class="configRow footer">
          <el-button
            type="primary"
            :loading="rendering"
            :disabled="!slug"
            @click="render">
            {{ rendering ? "渲染中" : "渲染" }}
          </el-button>
          <span v-if="statusText" class="statusText">{{ statusText }}</span>
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { IconPhoto } from "@tabler/icons-vue";
import { ElButton, ElCard, ElInputNumber, ElMessage, ElOption, ElProgress, ElSelect } from "element-plus";
import { nodeSkeleton, showNodeError, useNode, useNodeInputs, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import videoPlayer from "@toonflow/nodes-scaffold/videoPlayer";
import { htmlCards } from "@toonflow/card-runtime/cards";

defineOptions({
  inheritAttrs: false,
  icon: IconPhoto,
  handles: [
    // 叠加卡要垫在 AI 视频上，所以给一个视频入口；全屏卡不需要，留空即可
    { id: "video", type: "target", dataType: "VIDEO", label: "目标视频（叠加卡用）" },
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
  ] satisfies NodeHandle[],
});

const { node, nodeProps, outputs, nodeEvent, files } = useNode({
  label: "画面卡",
});
const { getTargetValues } = useNodeInputs();

/** 卡目录：直接读卡库，避免再开一个接口。 */
const cardOptions = htmlCards.map(card => ({
  slug: card.meta.slug,
  title: card.meta.title,
  shape: card.meta.shape,
}));

const data = computed(() => node.data as typeof node.data & {
  slug?: string;
  width?: number;
  height?: number;
  fps?: number;
  parameters?: Record<string, number>;
});

const slug = computed({
  get: () => data.value.slug ?? "",
  set: (value: string) => { data.value.slug = value; },
});
const width = computed({
  get: () => data.value.width ?? 1920,
  set: (value: number | undefined) => { if (typeof value === "number") data.value.width = value; },
});
const height = computed({
  get: () => data.value.height ?? 1080,
  set: (value: number | undefined) => { if (typeof value === "number") data.value.height = value; },
});
const fps = computed({
  get: () => data.value.fps ?? 30,
  set: (value: number | undefined) => { if (typeof value === "number") data.value.fps = value; },
});
const parameters = computed(() => data.value.parameters ?? {});
function setParameter(name: string, value: number | undefined) {
  if (typeof value !== "number") return;
  data.value.parameters = { ...parameters.value, [name]: value };
}

const selectedCard = computed(() => htmlCards.find(card => card.meta.slug === slug.value));

/** 可调参数。数值区间与默认值都来自卡本身的声明。 */
const parameterEntries = computed(() => {
  const card = selectedCard.value;
  if (!card) return [];
  return Object.entries(card.params ?? {}).map(([name, spec]) => {
    // 步长按区间推：小数值用 0.05，其余用 1
    const step = spec.max - spec.min <= 2 ? 0.05 : 1;
    return { name, spec, step };
  });
});

function shapeLabel(shape: string) {
  if (shape === "overlay") return "叠加";
  if (shape === "transition") return "转场";
  return "全屏";
}

const shapeHint = computed(() => {
  const shape = selectedCard.value?.meta.shape;
  if (shape === "overlay") return "透明层，叠在 AI 视频上 —— 把目标视频接到视频入口";
  if (shape === "transition") return "作用在两个镜头之间，不能直接叠在单段视频上";
  if (shape) return "替代这一段画面，不需要目标视频";
  return "全屏卡替代画面；叠加卡叠在视频上";
});

const rendering = ref(false);
const progressPercent = ref(0);
const statusText = ref("");
const controller = ref<AbortController>();

const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(outputFile, error => showNodeError(error, "成片读取失败"));
const player = ref<InstanceType<typeof videoPlayer>>();
const videoWidth = ref(0);
const downloadUrl = computed(() => previewUrl.value || "");

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (260 * video.videoWidth) / video.videoHeight);
  await nextTick();
}

/** 目标视频：从视频入口的上游取。 */
function targetVideoPath(): string | undefined {
  const values = getTargetValues(node.id, "video");
  for (const item of values) {
    if (item?.dataType === "VIDEO" && item.value && typeof item.value.url === "string") return item.value.url;
  }
  return undefined;
}

/**
 * 渲染。
 *
 * 进度走 SSE：服务端按 stage 推 `browser / render / encode / done`。
 * ACT: 用 fetch + 手动解析 SSE，不引 eventsource-parser —— 这里只读一种事件，
 * 为它多进一个依赖不划算（节点产物是要塞进用户安装包的）。
 */
async function render() {
  const card = selectedCard.value;
  if (!card) return;
  const shape = card.meta.shape;
  const target = targetVideoPath();
  if (shape === "overlay" && !target) {
    ElMessage.warning("叠加卡要垫在 AI 视频上：请把目标视频接到本节点的视频入口");
    return;
  }
  if (shape === "transition") {
    ElMessage.warning("转场卡作用在两个镜头之间，不能直接叠在单段视频上");
    return;
  }

  rendering.value = true;
  progressPercent.value = 0;
  statusText.value = "准备中";
  const abort = new AbortController();
  controller.value = abort;
  try {
    // 工作区目录由画布注入的文件能力提供（与其它节点一致）
    const { directory } = await files.getWorkspaceFiles().list();
    const output = `assets/${node.id}/card-${Date.now()}.mp4`;
    const response = await fetch("/api/card/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        directory,
        slug: card.meta.slug,
        width: width.value,
        height: height.value,
        fps: fps.value,
        parameters: parameters.value,
        output,
        ...(target && shape === "overlay" ? { targetVideo: target } : {}),
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`渲染请求失败（HTTP ${response.status}）`);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let finalOutput = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find(item => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as {
          stage: string; frame?: number; total?: number; message?: string;
        };
        if (event.stage === "browser") statusText.value = "启动渲染器";
        else if (event.stage === "render" && event.total) {
          progressPercent.value = Math.round(((event.frame ?? 0) / event.total) * 90);
          statusText.value = `渲染 ${event.frame ?? 0}/${event.total} 帧`;
        } else if (event.stage === "encode") { progressPercent.value = 94; statusText.value = "编码中"; }
        else if (event.stage === "done") {
          progressPercent.value = 100;
          statusText.value = "完成";
          if (event.message) finalOutput = (JSON.parse(event.message) as { outputPath?: string }).outputPath ?? "";
        }
      }
    }
    if (!finalOutput) throw new Error("渲染没有返回输出路径");
    outputs.value.video = { dataType: "VIDEO", value: { url: finalOutput, mimeType: "video/mp4" } };
    ElMessage.success("已渲染");
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    showNodeError(error, "卡渲染失败");
    statusText.value = "失败";
  } finally {
    rendering.value = false;
    controller.value = undefined;
  }
}

nodeEvent.on("delete", () => files.removeNodeFiles());
</script>

<style scoped>
.cardContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 260px;
  height: 146px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
}
.placeholderText {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.placeholderHint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  padding: 0 12px;
  text-align: center;
}
.progress {
  width: 260px;
}
.configCard {
  border: none;
}
.configRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.configRow + .configRow {
  margin-top: 10px;
}
.configLabel {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.seconds {
  margin-left: 8px;
}
.times {
  color: var(--el-text-color-secondary);
}
.cardSelect {
  flex: 1;
}
.oneliner {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.params {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
}
.paramRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.paramName {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.footer {
  margin-top: 12px;
  justify-content: space-between;
}
.statusText {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
