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
  handles: [{ id: "grid", type: "source", dataType: "IMAGE", label: "证据网格" }] satisfies NodeHandle[],
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
