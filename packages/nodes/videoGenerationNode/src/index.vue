<template>
  <nodeSkeleton
    v-bind="nodeProps"
    v-model:bottomVisible="node.selected"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="player?.enterFullscreen()"
    :bottomWidth="660"
    :style="{ width: previewUrl && videoWidth ? `${videoWidth + 18}px` : undefined }">
    <template #topActions>
      <mediaHistory mediaType="video" :current="outputFile" :disabled="generating || deleting || uploading" @select="outputs.video = { dataType: 'VIDEO', value: $event }" />
      <el-button :icon="IconTransfer" :loading="uploading" :disabled="generating || deleting" text title="替换视频" aria-label="替换视频" @click.stop="fileInput?.click()" />
      <input ref="fileInput" type="file" accept="video/*" hidden aria-label="选择替换视频" :disabled="generating || deleting || uploading" @change="replaceOutput" />
    </template>
    <div v-loading="generating || uploading" class="videoContent nopan" :aria-busy="generating || uploading">
      <videoPlayer
        v-if="previewUrl"
        ref="player"
        :src="previewUrl"
        label="生成视频"
        @loadedmetadata="resizeVideo" />
      <div v-else class="videoEmpty" role="img" aria-label="暂无生成视频">
        <icon-camera-ai :size="48" stroke="1.25" aria-hidden="true" />
      </div>
    </div>
    <template #bottom>
      <el-card class="promptCard" shadow="never" :bodyStyle="{ padding: '14px 16px 12px' }">
        <referenceItem
          v-if="refList.length"
          v-model="refList"
          @preview="setReferencePreview"
          @remove="removeReference" />
        <div v-if="frameMode" class="referenceHint">
          {{ selectedMode === "startFrameOptional" ? "仅一张图片时作为尾帧；两张图片按顺序作为首帧、尾帧" : "图片引用按顺序作为首帧、尾帧" }}
        </div>
        <promptInput v-model="data.promptModel" v-model:text="data.prompt" :references="referenceMentions" expandable />
        <div class="promptFooter">
          <el-select
            v-model="data.model"
            class="modelSelect"
            filterable
            :loading="modelsLoading"
            :disabled="generating || deleting"
            placeholder="选择模型"
            aria-label="生成模型"
            noDataText="请先在设置中添加视频模型"
            placement="top-start"
            @visible-change="(visible) => visible && loadModels().catch((error) => showNodeError(error, '模型读取失败'))">
            <template #prefix><icon-sparkles :size="17" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option
                v-for="item in provider.models"
                :key="item.modelId"
                :label="item.label"
                :value="JSON.stringify([item.providerId, item.modelId])" />
            </el-option-group>
          </el-select>
          <generationSettings
            v-model:duration="data.duration"
            v-model:resolution="data.resolution"
            v-model:ratio="data.ratio"
            v-model:mode="data.mode"
            v-model:generateAudio="data.generateAudio"
            :ratios="ratioOptions"
            :model="selectedModel"
            :disabled="generating || deleting || !selectedModel" />
          <el-button
            class="sendButton"
            :icon="generating ? IconPlayerStop : IconArrowUp"
            :disabled="deleting || uploading || (!generating && (!generationPrompt || !selectedModel))"
            :title="generating ? '停止生成' : '生成视频'"
            :aria-label="generating ? '停止生成' : '生成视频'"
            @click="generating ? generationController?.abort() : startGeneration().catch((error) => showNodeError(error, '视频生成失败'))" />
        </div>
      </el-card>
    </template>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { ElButton, ElCard, ElSelect, ElOption, ElOptionGroup, ElLoading } from "element-plus";
import { IconCameraAi, IconSparkles, IconArrowUp, IconPlayerStop, IconTransfer } from "@tabler/icons-vue";
import { groupNodeModels, nodeSkeleton, nodeTools, showNodeError, useCanvasOutput, useNode, useNodeGeneration, useNodeReferences, z, type NodeMediaModel, type NodeVideoRequest, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import promptInput from "@toonflow/nodes-scaffold/promptInput";
import videoPlayer from "@toonflow/nodes-scaffold/videoPlayer";
import referenceItem from "@toonflow/nodes-scaffold/referenceItem";
import mediaHistory from "@toonflow/nodes-scaffold/mediaHistory";
import { compileTimeline, describeMoments, describeTimeline, resolveMomentTiming, type NodeSemanticValue } from "@toonflow/post-production";
import generationSettings from "./components/generationSettings.vue";

defineOptions({
  inheritAttrs: false,
  icon: IconCameraAi,
  handles: [
    { id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING", "SEMANTIC"], label: "图片、视频、音频、文本、叙事锚点输入" },
    { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" },
  ] satisfies NodeHandle[],
});
const vLoading = ElLoading.directive;
const { id, node, nodeProps, nodeEvent, outputs, files, ai, updateNodeInternals } = useNode({
  label: "视频生成",
});
type PromptModel = NonNullable<InstanceType<typeof promptInput>["$props"]["modelValue"]>;
const data = computed(() => node.data as { prompt: string; promptModel: PromptModel; model: string; duration?: number; resolution: string; ratio: string; mode: string; generateAudio: boolean });
data.value.prompt ??= "";
data.value.promptModel ??= [];
data.value.model ??= "";
data.value.resolution ??= "";
data.value.mode ??= "";
data.value.generateAudio ??= true;
data.value.ratio ??= "9:16";
const { refList, referenceMentions, setReferencePreview, removeReference } = useNodeReferences();

/**
 * 接住的叙事锚点（`SEMANTIC` 输入）。
 *
 * ACT: 单独接而不是走 `useNodeReferences` —— 那套的白名单是素材类型
 * （IMAGE/VIDEO/AUDIO/STRING），锚点进去会被当成"参考 1/2/3"占用编号，
 * 而锚点不是素材、不该出现在 `{{ref N}}` 里。所以这里自己订阅输入事件。
 */
const semanticValue = ref<NodeSemanticValue>();
nodeEvent.on("input:in", (values) => {
  const semantic = values.find(item => item.dataType === "SEMANTIC" && item.value);
  semanticValue.value = semantic?.dataType === "SEMANTIC" ? semantic.value : undefined;
});
const models = ref<NodeMediaModel[]>([]);
const modelsLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let disposed = false;
const deleting = ref(false);
const player = ref<InstanceType<typeof videoPlayer>>();
const videoWidth = ref(0);
let generationController: AbortController | undefined;
const generationState = useNodeGeneration(outputs, () => generationController?.abort());
const { generating } = generationState;
let generation: Promise<void> | undefined;
let modelsRequest: Promise<void> | undefined;
const placeCanvasOutput = useCanvasOutput();
// ACT: 生成完成后把成片放成画布上的视频节点，并通知 agent 汇报结果 ——
// 否则 agent 那一轮早已结束（generateVideo 立即返回 generating），
// 用户必须再发一条消息才能确认生成结果。
// 用 URL 去重：output:video 是 immediate 的 watch，初始会以 undefined 触发一次。
let placedVideoUrl = "";
nodeEvent.on("output:video", (output) => {
  const produced = output?.dataType === "VIDEO" ? output.value : undefined;
  const url = produced?.url;
  if (!url || url === placedVideoUrl) return;
  placedVideoUrl = url;
  const label = url.split(/[\\/]/).pop() || "成片";
  void placeCanvasOutput({ url, mimeType: produced!.mimeType }, label)
    .then(() => { updateNodeInternals(); })
    .catch(() => { placedVideoUrl = ""; });
});
// ACT: 供应商未声明视频比例范围，沿用界面的通用比例，具体支持范围由供应商校验。
const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const selectedModel = computed(() => models.value.find((item) => JSON.stringify([item.providerId, item.modelId]) === data.value.model));
const selectedMode = computed(() => selectedModel.value?.mode?.find((item) => JSON.stringify(item) === data.value.mode) as NodeVideoRequest["mode"]);
const frameMode = computed(() => ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(selectedMode.value)));
const mediaCounts = computed(() => ({
  image: refList.value.filter((item) => item.dataType === "IMAGE").length,
  video: refList.value.filter((item) => item.dataType === "VIDEO").length,
  audio: refList.value.filter((item) => item.dataType === "AUDIO").length,
}));
const matchingModes = computed(() => getMatchingModes(selectedModel.value));

function getMatchingModes(choice?: NodeMediaModel) {
  return (choice?.mode ?? []).filter((mode) => {
    const { image, video, audio } = mediaCounts.value;
    if (Array.isArray(mode)) return image + video + audio > 0 && Object.entries(mediaCounts.value).every(([type, count]) =>
      count <= Number(mode.find((item) => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0)
    );
    if (mode === "text") return image + video + audio === 0;
    if (video || audio) return false;
    if (mode === "singleImage") return image === 1;
    if (mode === "startEndRequired") return image === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && image >= 1 && image <= 2;
  });
}

function getDurations(choice: NodeMediaModel) {
  return [...new Set((choice.durationResolutionMap ?? []).flatMap((item) => item.duration))].sort((a, b) => a - b);
}

function getResolutions(choice: NodeMediaModel, duration?: number) {
  // ACT: 当前视频分辨率使用 p 单位；出现其他单位时再统一换算。
  return [...new Set((choice.durationResolutionMap ?? []).filter((item) => item.duration.includes(duration!)).flatMap((item) => item.resolution))]
    .sort((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));
}

/** 价格展示文案。**没有价格就如实说未提供** —— 仓库里没有价格数据，也不替平台推算。 */
function priceText(choice: NodeMediaModel) {
  const price = choice.price;
  if (!price) return "未提供";
  const unit = price.per === "second" ? "秒" : price.per === "video" ? "条" : "次";
  return `${price.amount} ${price.currency ?? ""}/${unit}`.replace(/\s+/g, " ").trim() + (price.note ? `（${price.note}）` : "");
}

/**
 * 给用户做选择用的模型对比表。
 *
 * ACT: 用户的诉求是「生成视频前列出可用模型、画幅与预计价钱，帮我选」。
 * · 模型与能力（时长/分辨率/音频）来自供应商适配文件，可靠；
 * · **价格是可选字段**：仓库里没有任何价格数据，也绝不替平台编价格 ——
 *   有就展示，没有就写「未提供」，并提示用户可以在供应商适配文件里自己填 `price`。
 * · 画幅：模型声明里没有"支持哪些比例"的信息，节点用的是通用列表，所以这里如实标注
 *   「通用候选，模型是否全部支持未在适配文件里声明」，不假装精确。
 */
function listModelChoices() {
  return {
    current: { providerId: selectedModel.value?.providerId ?? "", modelId: selectedModel.value?.modelId ?? "" },
    ratioCandidates: ratioOptions,
    ratioNote: "这些是通用候选；模型声明里没有「支持哪些比例」的字段，所以哪个模型支持哪几个比例未经验证 —— 拿不准时问用户想要什么画幅，生成后核对成片。",
    priceNote: "价格来自供应商适配文件的可选字段；没有就是「未提供」。仓库里没有内置价格，也不替平台推算。用户可以在自己的供应商适配文件里给模型加 price 字段。",
    models: models.value.map((choice) => {
      const durations = getDurations(choice);
      return {
        providerId: choice.providerId,
        providerLabel: choice.providerLabel,
        modelId: choice.modelId,
        label: choice.label,
        durations,
        // 每个时长对应的分辨率档位
        resolutionsByDuration: Object.fromEntries(durations.map((duration) => [duration, getResolutions(choice, duration)])),
        audio: choice.audio === true ? "必带" : choice.audio === "optional" ? "可选" : "无",
        modes: choice.mode ?? [],
        price: priceText(choice),
        ...(choice.price ? { priceRaw: choice.price } : {}),
        isCurrent: choice.providerId === selectedModel.value?.providerId && choice.modelId === selectedModel.value?.modelId,
      };
    }),
  };
}
// ACT: 引用改变时只替换不适用的模式；普通媒体优先作为参考，避免自动变成首尾帧。
watch([selectedModel, matchingModes, () => data.value.mode], ([choice, matches]) => {
  if (!choice || matches.some((item) => JSON.stringify(item) === data.value.mode)) return;
  const modes = choice.mode ?? [];
  const mode = matches.find(Array.isArray) ?? matches.find((item) => item === "singleImage")
    ?? matches.find((item) => item === "endFrameOptional") ?? matches[0]
    ?? modes.find((item) => JSON.stringify(item) === data.value.mode) ?? modes.find(Array.isArray) ?? modes[0];
  data.value.mode = mode === undefined ? "" : JSON.stringify(mode);
}, { flush: "sync" });
// ACT: 参数在节点内归一化，未选中、未挂载底部设置时也可由 Agent 直接生成。
watch([selectedModel, () => data.value.duration], ([choice]) => {
  if (!choice) return;
  const durations = getDurations(choice);
  if (!durations.includes(data.value.duration!)) data.value.duration = durations[0];
  const resolutions = getResolutions(choice, data.value.duration);
  if (!resolutions.includes(data.value.resolution)) data.value.resolution = resolutions[0] ?? "";
  if (!ratioOptions.includes(data.value.ratio)) data.value.ratio = "9:16";
  if (choice.audio !== "optional") data.value.generateAudio = choice.audio === true;
}, { flush: "sync" });
const modelGroups = computed(() => groupNodeModels(models.value));
const generationPrompt = computed(() =>
  [
    data.value.prompt.trim(),
    ...refList.value.flatMap((item, index) => (item.dataType === "STRING" && item.value?.trim() ? [`参考 ${index + 1}：\n${item.value.trim()}`] : [])),
  ]
    .filter(Boolean)
    .join("\n\n")
);
const outputFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showNodeError(error, "视频读取失败")
);

onMounted(() => loadModels().catch((error) => showNodeError(error, "模型读取失败")));
onScopeDispose(() => {
  disposed = true;
  generationController?.abort();
});

async function replaceOutput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || deleting.value || uploading.value || disposed) return;
  if (!file.type.startsWith("video/")) return void showNodeError("请选择视频文件", "视频替换失败");
  if (!file.size || file.size > 100 * 1024 * 1024) return void showNodeError("视频不能为空且不能超过 100 MB", "视频替换失败");
  uploading.value = true;
  try {
    const workspace = files.getWorkspaceFiles();
    const url = await files.uploadFile(file);
    if (disposed) {
      await workspace.remove(url);
      return;
    }
    // ACT: 保留历史输出文件，避免破坏撤销记录和复制节点的引用。
    outputs.value.video = { dataType: "VIDEO", value: { url, mimeType: file.type } };
  } catch (error) {
    showNodeError(error, "视频替换失败");
  } finally {
    uploading.value = false;
  }
}

function loadModels() {
  if (modelsRequest) return modelsRequest;
  modelsLoading.value = true;
  modelsRequest = ai.getMediaModels().then(async (items) => {
    if (generating.value || deleting.value) return;
    models.value = items.filter((item) => item.type === "video");
    // ACT: 只给空配置选默认模型，保留暂时不可用的旧选择及其参数。
    // 优先用用户在设置里指定的偏好（服务端按偏好顺序给出第一个当前可用的）；
    // 没有偏好或偏好全失效时，才退回原来的"第一个可用模型"。
    if (!data.value.model) {
      const preferred = await ai.getPreferredModel("video").catch(() => undefined);
      const first = (preferred && models.value.find((item) => item.providerId === preferred.providerId && item.modelId === preferred.modelId)) ?? models.value[0];
      if (generating.value || deleting.value) return;
      data.value.model = first ? JSON.stringify([first.providerId, first.modelId]) : "";
    }
  }).finally(() => {
    modelsLoading.value = false;
    modelsRequest = undefined;
  });
  return modelsRequest;
}

/**
 * 把参考视频转成通用可解码的 H.264 后再送给模型。
 *
 * ACT: 微信/苹果导出的 mp4 多是 HEVC，桌面端（WebView2）没有 HEVC 解码器 ——
 * 同一个坑既让素材库预览"有声音没画面"，也会让送进模型的参考视频不可用。
 * 节点里的素材都在素材库下（`assets/<nodeId>/…`），所以复用素材预览副本那条接口；
 * 它是按原文件缓存的，同一个视频只转一次。已是 h264/vp8/vp9/av1 时直接返回原路径、不转码。
 */
async function prepareReferenceVideos(workspace: ReturnType<typeof files.getWorkspaceFiles>) {
  const items = refList.value.flatMap((item) => item.dataType === "VIDEO" && item.value ? [item.value] : []);
  if (!items.length) return [];
  const prepared: { path: string; mimeType: string }[] = [];
  for (const item of items) {
    const copy = await workspace.prepareVideo(item.url);
    prepared.push({ path: copy, mimeType: "video/mp4" });
  }
  return prepared;
}

async function startGeneration() {
  const choice = selectedModel.value;
  if (generating.value) throw new Error("视频正在生成，请等待完成");
  if (uploading.value) throw new Error("视频正在替换，请等待完成");
  if (deleting.value) throw new Error("节点正在删除");
  if (!choice) throw new Error("请先选择视频模型");
  if (!generationPrompt.value) throw new Error("请输入生成提示词");
  if (refList.value.some(item => item.value === undefined)) throw new Error("引用节点暂无内容，请先补充引用内容");
  const images = refList.value.flatMap((item) => item.dataType === "IMAGE" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []);
  if (choice.mode?.length && !matchingModes.value.length) throw new Error("当前模型没有适合这些参考素材的生成模式，请更换模型或调整引用");
  const workspace = files.getWorkspaceFiles();
  // ACT: 参考视频先转成通用可解码的 H.264。
  // 踩过：微信/苹果导出的 mp4 多是 HEVC，桌面端（WebView2）没有 HEVC 解码器 ——
  // 同一个坑既让素材库预览"有声音没画面"，也会让送进模型的参考视频不可用。
  // 已是 h264/vp8/vp9/av1 时服务端直接返回原路径，不做无谓转码。
  const videos = await prepareReferenceVideos(workspace);
  const controller = new AbortController();
  const input: Omit<NodeVideoRequest, "directory"> = {
    providerId: choice.providerId,
    modelId: choice.modelId,
    prompt: generationPrompt.value,
    mode: selectedMode.value,
    duration: data.value.duration,
    resolution: data.value.resolution || undefined,
    ratio: data.value.ratio,
    generateAudio: choice.audio === "optional" ? data.value.generateAudio : choice.audio,
    outputDirectory: `assets/${id}`,
    images: frameMode.value ? undefined : images,
    firstFrame: frameMode.value && (selectedMode.value !== "startFrameOptional" || images.length > 1) ? images[0] : undefined,
    lastFrame: frameMode.value ? images[selectedMode.value === "startFrameOptional" && images.length === 1 ? 0 : 1] : undefined,
    videos,
    audios: refList.value.flatMap((item) => item.dataType === "AUDIO" && item.value ? [{ path: item.value.url, mimeType: item.value.mimeType }] : []),
  };
  generationController = controller;
  // ACT: 工具立即返回，任务由节点持有，停止或卸载时取消。
  generation = generationState.run(() => workspace
    .list()
    .then(({ directory }) => {
      controller.signal.throwIfAborted();
      return ai.generateVideo({ ...input, directory }, controller.signal);
    })
    .then(([result]) => {
      controller.signal.throwIfAborted();
      if (!result) throw new Error("供应商未返回视频");
      outputs.value.video = { dataType: "VIDEO", value: { url: result.path, mimeType: result.mimeType } };
    }))
    .catch((error) => showNodeError(error, "视频生成失败"))
    .finally(() => {
      generationController = undefined;
    });
  return { status: "generating" };
}

nodeEvent.on("save", (reason) => {
  if (reason === "reload" && (generating.value || uploading.value || deleting.value)) throw new Error("视频处理中，请完成后再刷新节点");
});
nodeEvent.on("delete", async () => {
  if (uploading.value) throw new Error("视频正在替换，请稍后删除节点");
  deleting.value = true;
  generationController?.abort();
  try {
    await generation;
    await files.removeNodeFiles();
  } finally {
    deleting.value = false;
  }
});

async function resizeVideo(event: Event) {
  const video = event.currentTarget as HTMLVideoElement;
  if (!video.videoWidth || !video.videoHeight) return;
  videoWidth.value = Math.max(180, (240 * video.videoWidth) / video.videoHeight);
  await nextTick();
  updateNodeInternals();
}

function getConfig() {
  return {
    config: {
      providerId: selectedModel.value?.providerId ?? "",
      modelId: selectedModel.value?.modelId ?? "",
      duration: data.value.duration,
      resolution: data.value.resolution,
      ratio: data.value.ratio,
      mode: selectedMode.value,
      generateAudio: data.value.generateAudio,
    },
    models: models.value,
    ratios: ratioOptions,
    matchingModes: matchingModes.value,
  };
}

nodeTools.register({
  name: "getShotPlan",
  description: "把接进来的叙事锚点编译成一份**镜头时间表**：按时间排出每一镜的起止、长度、它是什么锚点、替观众做什么，并核对总长与模型时长档位。**先看这张表再动手生成** —— 它会把总长对不上、档位不匹配、锚点没解析这些问题直接列出来",
  parameters: z.strictObject({
    targetSeconds: z.number().positive().max(3600).optional().describe("整片目标总长（秒）；给了就会核对时间表总长与它是否一致"),
    gapSeconds: z.number().min(0).max(10).optional().describe("相邻镜头之间的间隔（秒），默认 0（紧接）"),
    toleranceSeconds: z.number().min(0).max(5).optional().describe("允许的误差（秒），默认 0.5"),
  }),
  async execute({ targetSeconds, gapSeconds, toleranceSeconds }, { signal }) {
    signal?.throwIfAborted();
    const value = semanticValue.value;
    if (!value?.moments.length) {
      return { text: "这个节点没有接进叙事锚点，编译不出时间表。先用参考分析节点写入并解析锚点，再连过来。" };
    }
    const choice = selectedModel.value;
    const durations = choice ? getDurations(choice) : [];
    const timeline = compileTimeline(value, {
      ...(targetSeconds !== undefined ? { targetSeconds } : {}),
      ...(gapSeconds !== undefined ? { gapSeconds } : {}),
      ...(toleranceSeconds !== undefined ? { toleranceSeconds } : {}),
      ...(durations.length ? { durations } : {}),
    });
    return {
      text: [
        describeTimeline(timeline),
        "",
        "**按这张表给每个镜头节点设时长**（一个镜头一个视频生成节点，各设自己的 duration）。",
        "有问题的先解决再生成 —— 尤其别靠拉伸镜头把总长凑到目标上。",
      ].join("\n"),
      timeline,
    };
  },
});

nodeTools.register({
  name: "getAnchorTiming",
  description: "读取接进来的叙事锚点，以及它们在**当前脚本**下解析出的时间。用它决定这一镜多长，而不是自己估。锚点还没为新脚本解析时，这里会如实说「未知」，不要拿参考片的秒数顶上",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    const value = semanticValue.value;
    if (!value?.moments.length) {
      return { text: "这个节点没有接进叙事锚点。可以用参考分析节点的 setReferenceMoments 写锚点、再连过来。" };
    }
    const choice = selectedModel.value;
    const durations = choice ? getDurations(choice) : [];
    const moments = value.moments.map(moment => {
      const timing = resolveMomentTiming(value, moment.anchor);
      const length = timing ? Number((timing.endSeconds - timing.startSeconds).toFixed(3)) : null;
      // 建议时长：把解析出的长度**吸附到当前模型支持的档位**上，不足最小档就取最小档。
      const suggested = length === null || !durations.length
        ? null
        : durations.find(duration => duration >= length && length > 0)
          ?? durations[durations.length - 1]!;
      return {
        anchor: moment.anchor,
        label: moment.label,
        role: moment.role ?? null,
        /** 已解析出的时间窗；null 表示"还没为新脚本解析"。 */
        window: timing ? { startSeconds: timing.startSeconds, endSeconds: timing.endSeconds, scriptId: timing.scriptId } : null,
        lengthSeconds: length,
        /** 建议的镜头时长档位（当前模型支持的档位里最接近又够长的那个）。 */
        suggestedDuration: suggested,
        utterances: moment.utterances.map(utterance => utterance.text),
      };
    });
    const unknown = moments.filter(moment => !moment.window).map(moment => moment.label);
    return {
      text: [
        `脚本 ${value.scriptId} 下的叙事锚点：`,
        describeMoments(value),
        unknown.length
          ? `**这些还没解出时间**：${unknown.join("、")} —— 要么先让参考分析节点用新脚本的词解析（resolveMomentsFromScript），要么把对应的话写进脚本。**不要给它们编时间。**`
          : "",
        choice
          ? `当前模型支持的时长档位：${durations.join("、")} 秒；上表的 suggestedDuration 是按锚点长度吸附过来的建议值。`
          : "还没选模型，拿不到时长档位；先选模型再回来看建议时长。",
      ].filter(Boolean).join("\n"),
      moments,
    };
  },
});

nodeTools.register({
  name: "listModelChoices",
  description: "列出可用的视频模型及其能力（时长、每个时长可选的分辨率、是否带音频、支持的模式）与价格，供**给用户做选择**。价格是供应商适配文件里的可选字段，没有就是「未提供」，不要替平台推算。先用它把选项摆给用户，问清想要的模型与画幅，再改配置或生成",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return listModelChoices();
  },
});

nodeTools.register({
  name: "getConfig",
  description: "读取此视频生成节点的当前配置、可选视频模型能力、通用比例及适合当前引用的模式，不含密钥；时长与分辨率须符合 durationResolutionMap",
  parameters: z.strictObject({}),
  async execute(_args, { signal }) {
    signal?.throwIfAborted();
    await loadModels();
    signal?.throwIfAborted();
    return getConfig();
  },
});

nodeTools.register({
  name: "setConfig",
  description: "修改此视频生成节点的模型、时长、分辨率、比例、模式或声音；先用 getConfig 查询能力，providerId 与 modelId 必须同时提供；mode 使用返回的原始字符串或数组，须匹配当前引用；不修改提示词、不启动生成",
  parameters: z.strictObject({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    duration: z.number().positive().optional(),
    resolution: z.string().min(1).optional(),
    ratio: z.enum(ratioOptions).optional(),
    mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    generateAudio: z.boolean().optional(),
  }).refine((args) => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供"),
  async execute(args, { signal }) {
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    await loadModels();
    signal?.throwIfAborted();
    if (generating.value || deleting.value) throw new Error("节点正在生成或删除，请稍后修改配置");
    const choice = args.modelId === undefined ? selectedModel.value
      : models.value.find((item) => item.providerId === args.providerId && item.modelId === args.modelId);
    if (!choice) throw new Error("请选择 getConfig 返回的有效视频模型");
    const durations = getDurations(choice);
    if (args.duration !== undefined && !durations.includes(args.duration)) throw new Error(`当前模型不支持时长 ${args.duration}，可选：${durations.join("、")}`);
    const duration = args.duration ?? (durations.includes(data.value.duration!) ? data.value.duration : durations[0]);
    const resolutions = getResolutions(choice, duration);
    if (args.resolution !== undefined && !resolutions.includes(args.resolution)) throw new Error(`当前时长不支持分辨率 ${args.resolution}，可选：${resolutions.join("、")}`);
    const resolution = args.resolution ?? (resolutions.includes(data.value.resolution) ? data.value.resolution : resolutions[0] ?? "");
    if (args.mode !== undefined && !getMatchingModes(choice).some((item) => JSON.stringify(item) === JSON.stringify(args.mode))) throw new Error("所选模式不受当前模型支持或不适用于当前引用，请根据模型能力及已连接素材选择");
    if (args.generateAudio !== undefined && choice.audio !== "optional" && args.generateAudio !== (choice.audio === true)) throw new Error("当前模型不支持切换声音，请查看 getConfig 返回的 audio 能力");
    data.value.model = JSON.stringify([choice.providerId, choice.modelId]);
    data.value.duration = duration;
    data.value.resolution = resolution;
    if (args.ratio !== undefined) data.value.ratio = args.ratio;
    if (args.mode !== undefined) data.value.mode = JSON.stringify(args.mode);
    if (args.generateAudio !== undefined) data.value.generateAudio = args.generateAudio;
    return getConfig();
  },
});

nodeTools.register({
  name: "setPrompt",
  description: "修改此节点的视频生成提示词，支持 {{ref 1}} 等参考标记；只修改提示词，不启动生成",
  parameters: z.strictObject({ prompt: z.string() }),
  execute({ prompt: value }) {
    if (deleting.value) throw new Error("节点正在删除，请稍后修改");
    data.value.prompt = value;
    data.value.promptModel = value.split("\n").map((text) => [{ type: "Write", text }]);
    return { prompt: value };
  },
});

nodeTools.register({
  name: "generateVideo",
  description: "启动此节点的后台视频生成，使用当前提示词、模型、模式、时长、分辨率、比例和参考素材；立即返回已开始，用 getGenerationStatus 查询完成结果，cancelGeneration 停止生成",
  parameters: z.strictObject({}),
  execute(_args, { signal }) {
    signal?.throwIfAborted();
    return startGeneration();
  },
});
</script>

<style scoped lang="scss">
.videoContent {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 144px;
  overflow: hidden;
  border-radius: var(--el-border-radius-base);

  .videoEmpty {
    display: grid;
    place-items: center;
    min-height: 144px;
    color: var(--el-text-color-placeholder);
  }

  :deep(.el-loading-mask) {
    pointer-events: none;
  }

}

.promptCard {
  .referenceHint {
    margin: 8px 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .promptFooter {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;

    .modelSelect {
      width: 190px;
      min-width: 0;

      &:deep(.el-select__wrapper) {
        gap: 6px;
        padding: 0;
        box-shadow: none;
        background: transparent;
      }
    }

    .sendButton {
      width: 32px;
      height: 32px;
      margin-left: auto;
      padding: 0;
      --el-button-bg-color: var(--el-text-color-primary);
      --el-button-border-color: transparent;
      --el-button-text-color: var(--el-bg-color);
      --el-button-hover-bg-color: var(--el-text-color-regular);
      --el-button-hover-border-color: transparent;
      --el-button-hover-text-color: var(--el-bg-color);
    }
  }
}
</style>
