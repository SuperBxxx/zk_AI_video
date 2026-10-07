<template>
  <nodeSkeleton v-bind="nodeProps" :topVisible="node.selected" topWidth="max-content">
    <div class="analysisContent nopan">
      <template v-if="evidence">
        <el-text size="small" type="info">
          {{ evidence.frames.length }} 帧 · {{ evidence.pages.length }} 页网格 · {{ evidence.boundaries.length }} 个变化候选
        </el-text>
        <el-text v-for="(note, index) in evidence.notes" :key="index" class="noteLine" size="small" :type="index === evidence.notes.length - 1 ? 'warning' : 'info'">{{ note }}</el-text>
      </template>
      <el-text v-else-if="running" size="small" type="info">正在生成证据（取帧、拼网格、找变化）…</el-text>
      <el-text v-else size="small" type="info">还没有参考素材。让 Agent 分析一条参考视频，或用 analyzeReference 指定素材。</el-text>
      <el-text v-if="failure" size="small" type="danger">{{ failure }}</el-text>
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { IconMicroscope } from "@tabler/icons-vue";
import { ElText } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import { generateEvidence, probeMedia, type EvidenceFfmpeg, type EvidenceFiles, type EvidenceResult } from "@toonflow/tool-media-analysis/evidence";
import {
  checkSemanticMoment,
  describeMoments,
  resolveMomentFromScript,
  storyAnchorKeys,
  type NodeSemanticMoment,
  type NodeSemanticValue,
} from "@toonflow/post-production";

/**
 * 参考分析节点：把一条参考视频摊成**证据**。
 *
 * ACT: 输出口给的是**证据网格图**（IMAGE），不是"分析结论" ——
 * 结论是 Agent 根据证据写出来的，属于解读层，不能由节点伪造。
 * 证据本体（帧清单、格内时刻、变化候选、词级时间）留在节点数据里，
 * 由 Agent 通过 analyzeReference 的返回读到，再加到它的产出里。
 */
defineOptions({
  inheritAttrs: false,
  icon: IconMicroscope,
  handles: [
    { id: "grid", type: "source", dataType: "IMAGE", label: "证据网格" },
    { id: "moments", type: "source", dataType: "SEMANTIC", label: "叙事锚点" },
  ] satisfies NodeHandle[],
});

const { node, nodeProps, outputs, files, ffmpeg } = useNode({ label: "参考分析" });

const running = ref(false);
const failure = ref("");
const evidence = ref<EvidenceResult>();

/**
 * 生成证据。与 Agent 工具 `media_analyze` 共用同一份 `generateEvidence`，
 * 保证节点与工具看到的证据完全一致（写两份必然漂移）。
 */
nodeTools.register({
  name: "analyzeReference",
  description: "对一条参考视频生成可核对的证据：媒体信息、按时刻的帧图、分页帧网格、画面变化候选。产出的是证据，不是解读 —— 解读由你根据证据写出来并引用证据路径",
  parameters: z.strictObject({
    source: z.string().min(1).max(4096).describe("参考视频的工作区相对路径"),
    output: z.string().min(1).max(4096).optional().describe("输出目录，默认 analysis/<素材名>/evidence"),
    start: z.number().min(0).optional().describe("只分析这一段起点（秒）"),
    end: z.number().min(0).optional().describe("只分析到这一刻（秒）"),
    every: z.number().min(0.02).optional().describe("采样间隔（秒），默认区间内均匀取 12 点"),
    columns: z.number().int().min(1).max(12).optional(),
    rows: z.number().int().min(1).max(12).optional(),
    cell: z.number().int().min(64).max(1920).optional().describe("每格画面宽度，默认 480"),
  }),
  async execute(args, { signal }) {
    if (running.value) throw new Error("正在生成证据，请稍后");
    running.value = true;
    failure.value = "";
    try {
      const factory = await ffmpeg(signal) as unknown as EvidenceFfmpeg;
      const workspace = files.getWorkspaceFiles() as unknown as EvidenceFiles;
      const stem = args.source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "reference";
      const output = args.output ?? `analysis/${stem}/evidence`;
      const result = await generateEvidence(factory, workspace, {
        source: args.source,
        output,
        start: args.start,
        end: args.end,
        every: args.every,
        columns: args.columns,
        rows: args.rows,
        cell: args.cell,
        signal,
      });
      evidence.value = result;
      // 第一页网格作为可按线传递的证据图；其余证据在返回里给 Agent。
      const first = result.pages[0];
      if (first) outputs.value.grid = { dataType: "IMAGE", value: { url: first.path, mimeType: "image/jpeg" } };
      return {
        media: result.media,
        output,
        frames: result.frames,
        pages: result.pages,
        boundaries: result.boundaries,
        notes: result.notes,
      };
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      running.value = false;
    }
  },
});

nodeTools.register({
  name: "setReferenceMoments",
  description: "把分析出的叙事锚点写进这个节点的输出口，供下游按锚点排时间。每个锚点要给出：它在回应什么（anchor，用词表里的 key）、人看的名字、以及**它由哪些词构成**（utterances，这是以后为新脚本解析时间的唯一依据）。参考片的秒数只填 atSeconds 作为观察记录，不要拿它当新片的时间",
  parameters: z.strictObject({
    moments: z.array(z.strictObject({
      anchor: z.string().min(1).max(64).describe(`锚点标识，可选值：${storyAnchorKeys.join("、")}`),
      label: z.string().min(1).max(120).describe("人看的名字，例如「价格锚点」"),
      utterances: z.array(z.strictObject({
        text: z.string().min(1).max(2000).describe("这句话的原话（它构成这个锚点的时间依据）"),
        durationSeconds: z.number().positive().max(600).describe("这句话说出来占多久"),
      })).min(1).max(24),
      role: z.string().max(2000).optional().describe("它替观众做什么 —— 这是复刻要保留的东西"),
      atSeconds: z.number().min(0).optional().describe("参考片里的时点，仅作观察记录"),
    })).min(1).max(40),
  }),
  async execute({ moments }, { signal }) {
    signal?.throwIfAborted();
    const scriptId = (node.data as { referenceScriptId?: string }).referenceScriptId ?? "reference";
    const built: NodeSemanticMoment[] = moments.map(item => ({
      anchor: item.anchor,
      label: item.label,
      utterances: item.utterances.map(utterance => ({ text: utterance.text, durationSeconds: utterance.durationSeconds })),
      ...(item.role ? { role: item.role } : {}),
    }));
    // ACT: 逐个校验锚点 —— 写错的锚点会让下游按锚点找不到它，而且**没有任何报错**。
    // 这里直接拒绝并列出合法值，比让它静默流到下游强。
    const problems = built.flatMap(moment => checkSemanticMoment(moment).map(problem => `${moment.label || moment.anchor}：${problem}`));
    if (problems.length) throw new Error(`锚点有问题：\n${problems.join("\n")}\n合法锚点：${storyAnchorKeys.join("、")}`);

    const value: NodeSemanticValue = { scriptId, moments: built };
    outputs.value.moments = { dataType: "SEMANTIC", value };
    // 参考片的观察时点单独列出来 —— 提醒 Agent 这些**不是**新片的时间。
    const observed = moments.filter(moment => moment.atSeconds !== undefined);
    return {
      text: [
        `已写入 ${built.length} 个叙事锚点（脚本 ${scriptId}）：`,
        describeMoments(value),
        "时间还没解析：下游要用**新脚本自己的词**去解（resolveMomentsFromScript），不要拿参考片的秒数。",
        observed.length
          ? `参考片观察时点（仅供理解参考片）：${observed.map(moment => `${moment.label} ${moment.atSeconds}s`).join("、")}`
          : "",
      ].filter(Boolean).join("\n"),
      moments: built,
    };
  },
});

/**
 * 逐词时间从哪来：转写**参考片本身**，存进节点，供锚点解析用。
 *
 * ACT: 转写走服务端的 `/api/ai/media/transcript`（与 Agent 工具**同一套**），
 * 因为识别供应商与 ffmpeg 抽取音轨都在服务端，节点这边不该再实现一遍。
 * 转写结果按脚本存一份（`referenceWords`），`resolveMomentsFromScript` 默认就用它 ——
 * 这样"参考片 → 词级时间 → 锚点解析"是一条自动路径，不需要 Agent 手工搬词表。
 */
nodeTools.register({
  name: "transcribeReference",
  description: "转写这条参考视频，取回**逐词时间戳**并存在节点上。之后 resolveMomentsFromScript 不传 words 也会自动用它。没有配置语音识别供应商时会如实失败，并说明失去了什么",
  parameters: z.strictObject({
    source: z.string().min(1).max(4096).describe("参考视频或音频的工作区相对路径"),
    scriptId: z.string().min(1).max(64).optional().describe("这份词级时间属于哪个脚本，默认 reference"),
    languageHints: z.array(z.string().min(1).max(16)).max(4).optional().describe("语言提示，例如 [\"zh\"]"),
  }),
  async execute({ source, scriptId, languageHints }, { signal }) {
    signal?.throwIfAborted();
    const { directory } = await files.getWorkspaceFiles().list();
    const models = await fetch("/api/ai/media/models", { cache: "no-store", signal })
      .then(async response => (await response.json()).data as { providerId: string; providerLabel: string; type: string }[]);
    const provider = models.find(model => model.type === "audio" || model.type === "video");
    if (!provider) {
      throw new Error("还没有配置语音识别（ASR）供应商 —— 在「设置 → 语音模型」里添加一个支持词级时间戳的供应商后重试。没有词级时间就没法判断钩子落在哪个词上，锚点只能停在画面结构层面");
    }
    const response = await fetch("/api/ai/media/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      signal,
      body: JSON.stringify({ providerId: provider.providerId, directory, path: source, languageHints }),
    });
    const payload = await response.json() as { code: number; message?: string; data?: { sentences?: { words?: { text: string; beginMs: number; endMs: number }[] }[] } };
    if (!response.ok || payload.code !== 200) throw new Error(payload.message || `转写失败（HTTP ${response.status}）`);

    // 展平成一条词序列 —— 解析锚点只需要"词 + 起止"，句子的分组在这里没有用。
    const words = (payload.data?.sentences ?? []).flatMap(sentence => sentence.words ?? []);
    if (!words.length) throw new Error("转写没有返回任何词级时间（可能这条素材没有说话声）");

    const id = scriptId ?? "reference";
    (node.data as { referenceWords?: Record<string, unknown> }).referenceWords = {
      ...((node.data as { referenceWords?: Record<string, unknown> }).referenceWords ?? {}),
      [id]: words,
    };
    const span = Number(((words[words.length - 1]!.endMs - words[0]!.beginMs) / 1000).toFixed(2));
    return {
      text: `已转写（脚本 ${id}）：${words.length} 个词，覆盖 ${span} 秒（供应商 ${provider.providerLabel}）。\n现在可以调 resolveMomentsFromScript 解析锚点，不传 words 也会用这份时间。`,
      wordCount: words.length,
      spanSeconds: span,
    };
  },
});

nodeTools.register({
  name: "resolveMomentsFromScript",
  description: "用**指定脚本自己的逐词时间**给已写入的锚点解出时间。不传 words 时自动用 transcribeReference 存下的那份。匹配不到的锚点会如实报出来（不猜）",
  parameters: z.strictObject({
    scriptId: z.string().min(1).max(64).describe("这个脚本的标识（同一份分析可以配多个脚本）"),
    words: z.array(z.strictObject({
      text: z.string().min(1).max(200),
      beginMs: z.number().min(0),
      endMs: z.number().min(0),
    })).min(1).max(20000).optional().describe("新脚本的逐词时间戳；不传就用 transcribeReference 存下的"),
  }),
  async execute({ scriptId, words }, { signal }) {
    signal?.throwIfAborted();
    const current = outputs.value.moments?.dataType === "SEMANTIC" ? outputs.value.moments.value : undefined;
    if (!current) throw new Error("这个节点还没有锚点；先用 setReferenceMoments 写入");

    const stored = (node.data as { referenceWords?: Record<string, { text: string; beginMs: number; endMs: number }[]> }).referenceWords?.[scriptId];
    const timing = words ?? stored;
    if (!timing) {
      throw new Error(`没有可用的逐词时间（脚本 ${scriptId}）。先用 transcribeReference 转写，或把 words 传进来 —— **不要给锚点编一个时间**`);
    }

    const resolved = current.moments.map(moment => resolveMomentFromScript(moment, scriptId, timing));
    const value: NodeSemanticValue = { scriptId, moments: resolved };
    outputs.value.moments = { dataType: "SEMANTIC", value };

    const failed = resolved.filter(moment => !moment.resolved?.[scriptId]).map(moment => moment.label || moment.anchor);
    return {
      text: [
        describeMoments(value),
        failed.length
          ? `**这些锚点在新脚本里没匹配到**，时间仍是未知：${failed.join("、")}。\n不要给它们编一个时间 —— 要么让用户确认原句，要么先把脚本改成含这句话的版本。`
          : "全部锚点都解出了时间。",
      ].join("\n"),
      resolved: resolved.map(moment => ({ anchor: moment.anchor, window: moment.resolved?.[scriptId] ?? null })),
    };
  },
});

nodeTools.register({
  name: "probeReference",
  description: "只读取一条参考视频的媒体信息（时长、分辨率、帧率、编码），用来判断要不要先转码再分析",
  parameters: z.strictObject({ source: z.string().min(1).max(4096) }),
  async execute({ source }, { signal }) {
    signal?.throwIfAborted();
    const factory = await ffmpeg(signal) as unknown as EvidenceFfmpeg;
    const info = await probeMedia(factory, source);
    const lines = [
      `素材：${source}`,
      `时长：${info.duration ?? "未知"} 秒`,
      `画面：${info.width ?? "?"}x${info.height ?? "?"} @ ${info.fps ?? "?"} fps，编码 ${info.videoCodec ?? "无"}`,
      `声音：${info.hasAudio ? info.audioCodec ?? "有" : "无音轨"}`,
    ];
    if (info.videoCodec === "hevc") lines.push("提示：这是 HEVC(H.265)。桌面端预览会「有声音没画面」，预览或送模型前先转 H.264。");
    return { text: lines.join("\n"), ...info };
  },
});
</script>

<style scoped lang="scss">
.analysisContent {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 96px;
  max-height: 220px;
  padding: 4px;
  overflow-y: auto;

  .noteLine {
    line-height: 1.5;
    word-break: break-all;
  }
}
</style>
