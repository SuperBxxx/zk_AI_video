<template>
  <div class="voicePanel">
    <el-alert v-if="!audioModels.length" class="voiceHint" type="info" :closable="false" showIcon title="还没有可用的语音模型，请先在「设置 → 语音模型」添加供应商并填写 API Key。" />

    <template v-else>
      <el-form class="voiceForm" labelPosition="top" @submit.prevent>
        <el-form-item label="语音模型">
          <el-select v-model="selectedModel" class="voiceField" placeholder="选择用于创建音色的模型">
            <el-option v-for="item in audioModels" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>

        <el-form-item label="音色名称">
          <el-input v-model="voiceName" class="voiceField" maxlength="16" showWordLimit placeholder="例如 我的声音" />
          <el-text class="voiceNote" size="small" type="info">名称只能用字母、数字、下划线，最多 16 位，其余字符会被替换为下划线。</el-text>
        </el-form-item>

        <el-divider class="voiceDivider" contentPosition="left">声音复刻（需要样本）</el-divider>
        <div class="sampleRow">
          <el-button :icon="IconUpload" :loading="reading" @click="sampleInput?.click()">上传样本</el-button>
          <el-button v-if="!recording" :icon="IconMicrophone" :disabled="reading" @click="startRecording">录制样本</el-button>
          <el-button v-else type="danger" :icon="IconPlayerStop" @click="stopRecording">停止（{{ recordSeconds }}s / 30s）</el-button>
          <input ref="sampleInput" class="sampleInput" type="file" accept="audio/*" aria-label="选择音频样本" @change="pickSample" />
        </div>
        <el-text v-if="sample" class="voiceNote" size="small" type="success">已选样本：{{ sample.name }}（{{ sampleSizeLabel }}）</el-text>
        <el-alert v-else-if="recording" class="voiceHint" type="warning" :closable="false" showIcon title="正在录音，最长 30 秒，到时会自动停止。" />
        <el-alert v-if="recordError" class="voiceHint" type="error" :closable="false" showIcon :title="recordError" />
        <el-button class="voiceAction" type="primary" :loading="creatingClone" :disabled="!canClone" @click="createVoice(false)">开始复刻</el-button>

        <el-divider class="voiceDivider" contentPosition="left">声音设计（用文字描述）</el-divider>
        <el-input v-model="description" class="voiceField" type="textarea" :rows="2" maxlength="200" showWordLimit placeholder="例如：温暖的低音女声，语速偏慢" />
        <el-button class="voiceAction" type="primary" :loading="creatingDesign" :disabled="!canDesign" @click="createVoice(true)">生成音色</el-button>
      </el-form>

      <el-alert v-if="createError" class="voiceHint" type="error" :closable="false" showIcon :title="createError" />

      <template v-if="directory">
        <el-divider class="voiceDivider" contentPosition="left">试听（可选）</el-divider>
        <el-input v-model="previewText" class="voiceField" type="textarea" :rows="2" maxlength="500" showWordLimit placeholder="输入一小段文字，用上面创建的音色读一遍" />
        <el-button class="voiceAction" :loading="synthesizing" :disabled="!previewReady" @click="preview">合成试听</el-button>
        <audio v-if="previewUrl" class="voiceAudio" :src="previewUrl" controls preload="metadata" aria-label="试听结果" />
      </template>
      <el-text v-else class="voiceNote" size="small" type="info">打开一个项目后可以在此试听音色。</el-text>

      <el-divider class="voiceDivider" contentPosition="left">已保存的音色</el-divider>
      <el-text v-if="!voices.length" class="voiceNote" size="small" type="info">素材库「{{ voiceFolder }}」里还没有音色。</el-text>
      <div v-for="item in voices" :key="item.path" class="voiceItem">
        <div class="voiceItemMain">
          <el-text tag="strong" class="voiceItemName">{{ item.name }}</el-text>
          <el-text class="voiceNote" size="small" type="info">{{ item.source === "design" ? "声音设计" : "声音复刻" }} · {{ item.model }}</el-text>
        </div>
        <el-button text :icon="IconPlayerPlay" :aria-label="'用 ' + item.name + ' 试听'" title="用这个音色试听" @click="previewVoice(item)" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { IconMicrophone, IconPlayerPlay, IconPlayerStop, IconUpload } from "@tabler/icons-vue";
import { needsWavConversion, toWavBlob } from "@/lib/audioWav";

type MediaProviderModel = { id: string; label: string; type: string };
type MediaProvider = { fileName: string; id: string; label: string; models: MediaProviderModel[]; loadError?: string };
// 音色以 json 素材存在素材库的声音文件夹里，字段即 D3 约定的内容。
type VoiceAsset = { name: string; path: string; voice: string; providerId: string; model: string; source: "clone" | "design" };

const props = defineProps<{ voiceFolder: string; directory?: string }>();
const emit = defineEmits<{ saved: [] }>();

// 单一样本上限：录音 30 秒的 16 位单声道 WAV 约 2.6 MB，这里宽松留到 20 MB。
const maxSampleBytes = 20 * 1024 * 1024;
const recordLimitSeconds = 30;
const voiceMimeTypes = ["audio/wav", "audio/mpeg", "audio/mp4", "audio/x-wav"];

const providers = ref<MediaProvider[]>([]);
const voices = ref<VoiceAsset[]>([]);
const selectedModel = ref("");
const voiceName = ref("");
const description = ref("");
const previewText = ref("这是一段试听文字。");
const sample = ref<{ name: string; blob: Blob; mimeType: string }>();
const sampleInput = ref<HTMLInputElement>();
const reading = ref(false);
const recording = ref(false);
const recordSeconds = ref(0);
const recordError = ref("");
const createError = ref("");
const creatingClone = ref(false);
const creatingDesign = ref(false);
const synthesizing = ref(false);
const previewUrl = ref("");
let recorder: MediaRecorder | undefined;
let chunks: Blob[] = [];
let timer: number | undefined;

const audioModels = computed(() => providers.value.flatMap(provider =>
  provider.models.filter(model => model.type === "audio" && !provider.loadError)
    .map(model => ({ value: `${provider.id}\u0000${model.id}`, label: `${provider.label} · ${model.label}`, providerId: provider.id, modelId: model.id }))));
const selected = computed(() => audioModels.value.find(item => item.value === selectedModel.value));
const sampleSizeLabel = computed(() => sample.value ? `${(sample.value.blob.size / 1024 / 1024).toFixed(2)} MB` : "");
const canClone = computed(() => !!selected.value && !!voiceName.value.trim() && !!sample.value && !reading.value && !recording.value);
const canDesign = computed(() => !!selected.value && !!voiceName.value.trim() && !!description.value.trim());
const previewReady = computed(() => !!selected.value && !!previewText.value.trim());

onMounted(() => {
  void loadProviders();
  void loadVoices();
});
onBeforeUnmount(() => {
  timer !== undefined && window.clearInterval(timer);
  recorder?.state === "recording" && recorder.stop();
  recorder?.stream.getTracks().forEach(track => track.stop());
});

function showError(error: unknown) {
  const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "操作失败";
  createError.value = message;
}

async function loadProviders() {
  try {
    const { data } = await axios.get<{ data: MediaProvider[] }>("/api/providers/media/list");
    providers.value = data.data;
    if (!selectedModel.value && audioModels.value.length) selectedModel.value = audioModels.value[0]!.value;
  } catch (error) {
    showError(error);
  }
}

// 声音文件夹里的 json 就是音色清单；按 D3 存 {名称, 音色 ID, 来源, ...}。
async function loadVoices() {
  try {
    const { data } = await axios.get<{ data: { entries: { name: string; path: string; type: string; children?: unknown[] }[] } }>("/api/assets/list");
    const folder = data.data.entries.find(entry => entry.type === "directory" && entry.name === props.voiceFolder);
    const files = (folder?.children ?? []) as { name: string; path: string; type: string }[];
    const loaded: VoiceAsset[] = [];
    for (const file of files.filter(entry => entry.type === "file" && entry.name.toLowerCase().endsWith(".json"))) {
      try {
        const { data: content } = await axios.get<Record<string, unknown>>("/api/assets/read", { params: { path: file.path } });
        const voice = typeof content.voice === "string" ? content.voice : "";
        if (!voice) continue;
        loaded.push({
          name: typeof content.name === "string" ? content.name : file.name,
          path: file.path,
          voice,
          providerId: typeof content.providerId === "string" ? content.providerId : "",
          model: typeof content.model === "string" ? content.model : "",
          source: content.source === "design" ? "design" : "clone",
        });
      } catch {
        // 单个文件读不出来不影响其余，跳过即可。
      }
    }
    voices.value = loaded;
  } catch (error) {
    showError(error);
  }
}

async function pickSample(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  reading.value = true;
  createError.value = "";
  try {
    if (file.size > maxSampleBytes) throw new Error(`样本不能超过 ${maxSampleBytes / 1024 / 1024} MB`);
    // 百炼只接受 wav/mpeg/mp4，非这些格式先在浏览器端转成 WAV。
    const blob = needsWavConversion(file, file.name) ? await toWavBlob(file) : file;
    if (blob.size > maxSampleBytes) throw new Error("转换后的样本过大，请缩短时长");
    sample.value = { name: needsWavConversion(file, file.name) ? file.name.replace(/\.[^.]+$/, "") + ".wav" : file.name, blob, mimeType: blob.type || "audio/wav" };
  } catch (error) {
    sample.value = undefined;
    showError(error);
  } finally {
    reading.value = false;
  }
}

async function startRecording() {
  recordError.value = "";
  createError.value = "";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    recordError.value = "当前环境不支持录音，请改用上传样本。";
    return;
  }
  try {
    // 按 D11：不提供设备选择，使用系统默认麦克风。
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      void finishRecording();
    };
    recorder.start();
    recording.value = true;
    recordSeconds.value = 0;
    timer = window.setInterval(() => {
      recordSeconds.value += 1;
      if (recordSeconds.value >= recordLimitSeconds) stopRecording();
    }, 1000);
  } catch {
    recordError.value = "无法访问麦克风，请检查系统权限后重试，或改用上传样本。";
  }
}

function stopRecording() {
  if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  recording.value = false;
  if (recorder?.state === "recording") recorder.stop();
}

async function finishRecording() {
  const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
  chunks = [];
  if (!blob.size) {
    recordError.value = "没有录到声音，请重试。";
    return;
  }
  reading.value = true;
  try {
    // MediaRecorder 在 Chrome/Edge 上多为 webm/opus，必须转成 WAV 才能提交。
    const wav = await toWavBlob(blob);
    if (wav.size > maxSampleBytes) throw new Error("录音过长，请控制在 30 秒内");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    sample.value = { name: `录音-${stamp}.wav`, blob: wav, mimeType: "audio/wav" };
  } catch (error) {
    sample.value = undefined;
    showError(error);
  } finally {
    reading.value = false;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取样本失败"));
    reader.readAsDataURL(blob);
  });
}

async function assetBlob(path: string) {
  const { data } = await axios.get<Blob>("/api/assets/read", { params: { path }, responseType: "blob" });
  return data;
}

async function createVoice(byDesign: boolean) {
  const target = selected.value;
  if (!target) return showError(new Error("请先选择语音模型"));
  const name = voiceName.value.trim();
  if (!name) return showError(new Error("请填写音色名称"));
  createError.value = "";
  if (byDesign) creatingDesign.value = true;
  else creatingClone.value = true;
  try {
    // 样本需要转成 base64 提交：供应商工具没有读取工作区文件的能力。
    const payload = byDesign
      ? { providerId: target.providerId, modelId: target.modelId, name, description: description.value.trim(), targetModel: target.modelId }
      : { providerId: target.providerId, modelId: target.modelId, name, targetModel: target.modelId, sample: { type: "base64", data: await blobToDataUrl(sample.value!.blob), mimeType: voiceMimeTypes.includes(sample.value!.mimeType) ? sample.value!.mimeType : "audio/wav" } };
    const { data } = await axios.post<{ data: { voice: string; label?: string } }>("/api/ai/voices/create", payload);
    await saveVoice(data.data.voice, name, target.providerId, target.modelId, byDesign ? "design" : "clone");
    ElMessage.success(byDesign ? "音色已生成并保存" : "音色复刻完成并保存");
  } catch (error) {
    showError(error);
  } finally {
    creatingClone.value = false;
    creatingDesign.value = false;
  }
}

async function saveVoice(voice: string, name: string, providerId: string, model: string, source: "clone" | "design") {
  const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
  const path = `${props.voiceFolder}/${safeName}.json`;
  const content = JSON.stringify({ name, voice, providerId, model, source, createdAt: new Date().toISOString() }, null, 2);
  const put = (target: string) => axios.put("/api/assets/save", new Blob([content], { type: "application/json" }), { params: { path: target }, headers: { "Content-Type": "application/octet-stream" } });
  // assets/save 不会创建父目录，声音文件夹不存在时先建（已存在会报错，忽略即可）。
  await axios.post("/api/assets/mkdir", { path: props.voiceFolder }).catch(() => undefined);
  try {
    await put(path);
  } catch (error) {
    // 同名音色已存在时（服务端 exclusive 不覆盖）改用带时间戳的名称。
    if (!axios.isAxiosError(error)) throw error;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    await put(`${props.voiceFolder}/${safeName}-${stamp}.json`);
  }
  await loadVoices();
  emit("saved");
}

async function synthesize(text: string, voice: string, providerId: string, model: string) {
  // 合成需要工作目录：生成结果要落在工作区里再读回来播放。
  const { data } = await axios.post<{ data: { path: string }[] }>("/api/ai/media/generate", {
    directory: props.directory, mediaType: "audio", providerId, modelId: model, prompt: text, voice,
  });
  const path = data.data[0]?.path;
  if (!path) throw new Error("未返回音频");
  return URL.createObjectURL(await assetBlob(path));
}

async function preview() {
  const target = selected.value;
  if (!target) return;
  synthesizing.value = true;
  createError.value = "";
  try {
    previewUrl.value = await synthesize(previewText.value.trim(), "", target.providerId, target.modelId);
  } catch (error) {
    showError(error);
  } finally {
    synthesizing.value = false;
  }
}

async function previewVoice(item: VoiceAsset) {
  synthesizing.value = true;
  createError.value = "";
  try {
    previewUrl.value = await synthesize(previewText.value.trim(), item.voice, item.providerId, item.model);
  } catch (error) {
    showError(error);
  } finally {
    synthesizing.value = false;
  }
}
</script>

<style lang="scss" scoped>
.voicePanel {
  display: flex;
  flex-direction: column;
  gap: 4px;

  .voiceHint { margin-bottom: 4px; }

  .voiceForm {
    :deep(.el-form-item) { margin-bottom: 8px; }
    :deep(.el-form-item__label) { padding-bottom: 2px; font-size: 12px; line-height: 18px; }
  }

  .voiceField { width: 100%; }
  .voiceNote { display: block; margin-top: 2px; line-height: 16px; }
  .voiceDivider { margin: 6px 0; }
  .sampleRow { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
  .sampleInput { display: none; }
  .voiceAction { width: 100%; margin-top: 4px; }
  .voiceAudio { width: 100%; margin-top: 6px; }

  .voiceItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child { border-bottom: none; }

    .voiceItemMain {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .voiceItemName { line-height: 18px; }
  }
}
</style>
