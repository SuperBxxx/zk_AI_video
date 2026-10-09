<template>
  <div class="voicePanel">
    <el-alert v-if="!audioModels.length" class="voiceHint" type="info" :closable="false" showIcon title="还没有可用的语音模型，请先在「设置 → 语音模型」添加供应商并填写 API Key。" />

    <template v-else>
      <!-- 两个并列流程，各占一个分页 —— 见 script 里 activeMode 的说明。 -->
      <el-radio-group v-model="activeMode" class="modeTabs" size="small" aria-label="音色创建方式">
        <el-radio-button value="clone">声音复刻</el-radio-button>
        <el-radio-button value="design">声音设计</el-radio-button>
      </el-radio-group>

      <el-form class="voiceForm" labelPosition="top" @submit.prevent>
        <el-form-item label="保存位置">
          <el-select v-model="activeFolder" class="voiceField" filterable allowCreate defaultFirstOption
            placeholder="素材库里的文件夹" aria-label="音色保存位置" @change="onFolderChange">
            <el-option v-for="name in folderOptions" :key="name" :label="`素材库 / ${name}`" :value="name" />
          </el-select>
          <el-text class="voiceNote" size="small" type="info">音色会存成该文件夹下的 json 素材；不存在时会自动新建。</el-text>
        </el-form-item>

        <el-form-item label="语音模型">
          <el-select v-model="selectedModel" class="voiceField" placeholder="选择用于创建音色的模型">
            <el-option v-for="item in audioModels" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>

        <el-form-item label="音色名称">
          <el-input v-model="voiceName" class="voiceField" maxlength="16" showWordLimit placeholder="例如 我的声音" />
          <!-- ACT: 说清"会被自动替换"而不是"只能用"—— 原先写「名称只能用字母、数字、下划线」
               会让人以为中文不能用，而 provider 实际是把非法字符替换成下划线（`我的声音` → `____`）。 -->
          <el-text class="voiceNote" size="small" type="info">最多 16 个字符；中文也可以用，提交时会自动转成字母、数字、下划线。</el-text>
        </el-form-item>

        <!-- 两个流程各自的"素材"输入：复刻要样本，设计要文字描述。 -->
        <template v-if="activeMode === 'clone'">
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
        </template>

        <template v-else>
          <el-input v-model="description" class="voiceField" type="textarea" :rows="3" maxlength="200" showWordLimit
            placeholder="例如：沉稳的中年男性，语速缓慢，音色低沉有磁性，适合朗读新闻或纪录片解说" />
          <el-button class="voiceAction" type="primary" :loading="creatingDesign" :disabled="!canDesign" @click="createVoice(true)">生成音色</el-button>
        </template>
      </el-form>

      <el-alert v-if="createError" class="voiceHint" type="error" :closable="false" showIcon :title="createError" />

      <template v-if="directory">
        <p class="voiceFieldLabel">试听（可选）</p>
        <el-input v-model="previewText" class="voiceField" type="textarea" :rows="2" maxlength="500" showWordLimit placeholder="输入一小段文字，用上面创建的音色读一遍" />
        <!-- ACT: 按钮按**可用性**禁用，并把依据写在旁边 —— 原先只校验文字非空，
             选了 vc/vd 又还没建音色时按钮可点，点下去才报一句写给"创建"场景的错。 -->
        <el-text v-if="!previewVoiceReady" class="voiceNote" size="small" type="warning">{{ previewBlockedReason }}</el-text>
        <el-button class="voiceAction" :loading="synthesizing" :disabled="!previewReady" @click="preview">合成试听</el-button>
        <audio v-if="previewUrl" class="voiceAudio" :src="previewUrl" controls preload="metadata" aria-label="试听结果" />
      </template>
      <el-text v-else class="voiceNote" size="small" type="info">打开一个项目后可以在此试听音色。</el-text>

      <p class="voiceFieldLabel">已保存的音色</p>
      <el-text v-if="!voices.length" class="voiceNote" size="small" type="info">素材库「{{ activeFolder }}」里还没有音色。</el-text>
      <div v-for="item in voices" :key="item.path" class="voiceItem" :class="{ playing: playingPath === item.path }">
        <div class="voiceItemMain">
          <el-text tag="strong" class="voiceItemName">{{ item.name }}</el-text>
          <!-- ACT: 显示**模型友好名**而不是原始 ID（`qwen3-tts-vc-2026-01-22` 对用户没有意义）。 -->
          <el-text class="voiceNote" size="small" type="info">{{ item.source === "design" ? "声音设计" : "声音复刻" }} · {{ modelLabel(item.model) }}</el-text>
        </div>
        <el-button text :icon="IconPlayerPlay" :loading="playingPath === item.path" :aria-label="'用 ' + item.name + ' 试听'" title="用这个音色试听" @click="previewVoice(item)" />
        <el-button text :icon="IconPencil" :disabled="busyPath === item.path" :aria-label="'重命名 ' + item.name" title="重命名" @click="renameVoice(item)" />
        <el-popconfirm :title="`确定删除“${item.name}”？`" confirmButtonText="删除" cancelButtonText="取消" @confirm="removeVoice(item)">
          <template #reference>
            <el-button text type="danger" :icon="IconTrash" :disabled="busyPath === item.path" :aria-label="'删除 ' + item.name" title="删除" />
          </template>
        </el-popconfirm>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconMicrophone, IconPencil, IconPlayerPlay, IconPlayerStop, IconTrash, IconUpload } from "@tabler/icons-vue";
import { needsWavConversion, toWavBlob } from "@/lib/audioWav";
import { settings } from "@/stores/settings";

type MediaProviderModel = { id: string; label: string; type: string };
type MediaProvider = { fileName: string; id: string; label: string; models: MediaProviderModel[]; loadError?: string };
// 音色以 json 素材存在素材库的声音文件夹里，字段即 D3 约定的内容。
type VoiceAsset = {
  name: string; path: string; voice: string; providerId: string; model: string;
  source: "clone" | "design";
  /** 原始 JSON —— 重命名时要在保留其它字段的前提下改写 name。 */
  json: Record<string, unknown>;
};

const props = defineProps<{ voiceFolder: string; directory?: string }>();
const emit = defineEmits<{ saved: [] }>();

/** 用户在列表上点播放、又没填试听文字时用的样本句。 */
const defaultPreviewText = "你好，这是一段试听音频。";

/**
 * 面板分两个流程：声音复刻（要样本）与声音设计（用文字描述）。
 *
 * ACT: 两者是**并列的独立流程**，不是同一条流水线的两步 —— 各自有模型、名称、保存位置，
 * 各自列出该位置下的音色。原先平铺在一个长表单里，320px 宽的侧栏要滚过另一半，
 * 而且"已保存的音色"混着两种来源、看不出属于哪个流程。
 */
type VoiceMode = "clone" | "design";
const activeMode = ref<VoiceMode>("clone");

/**
 * 保存位置：素材库里的文件夹名，复刻与设计各记一份。
 *
 * ACT: 存在设置里而不是组件内 —— 它是用户的组织习惯（复刻丢一个文件夹、设计丢另一个），
 * 每次打开面板都该还是上次选的那个。`settings.voiceFolders` 由 settings store 的 watch 自动保存。
 */
const folderOptions = ref<string[]>([]);
const defaultFolder = computed(() => props.voiceFolder || "声音");

/** 设置里存的每个流程的保存位置（缺省回落到默认文件夹）。 */
function savedFolder(mode: VoiceMode) {
  const value = settings.value.voiceFolders;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const name = record[mode];
  return typeof name === "string" && name.trim() ? name.trim() : defaultFolder.value;
}

/** 当前分页的保存位置。切换分页会跟着切到那一页记的文件夹，并重新读该文件夹下的音色。 */
const activeFolder = computed({
  get: () => savedFolder(activeMode.value),
  set: (name: string) => {
    const next = name.trim();
    if (!next) return;
    const value = settings.value.voiceFolders;
    const record = value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
    record[activeMode.value] = next;
    // 直接写 store：settings 的 watch 会持久化，不必再显式调保存接口。
    settings.value.voiceFolders = record;
  },
});

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

/** 与当前模型匹配的已保存音色（合成试听与"创建后自动试听"都用它）。 */
const matchedVoice = computed(() =>
  [...voices.value].reverse().find(item => item.providerId === selected.value?.providerId && item.model === selected.value?.modelId));
/**
 * 合成试听到底能不能用。
 *
 * ACT: 实测只有 `qwen3-tts-flash` 接受内置音色，vc / vd / qwen-audio 都是"专属音色"模型
 * （用 Cherry 一律 400）。所以必须"有匹配的音色"或"模型支持内置音色"才能合成 ——
 * 把这个判断前置到按钮的禁用态，用户不必点一下才知道不行。
 */
const previewVoiceReady = computed(() => !!matchedVoice.value || selected.value?.modelId === "qwen3-tts-flash");
const previewBlockedReason = computed(() => {
  if (!selected.value) return "请先选择语音模型。";
  if (previewVoiceReady.value) return "";
  return "这个模型只认它自己创建的音色：请先复刻或设计一个音色，再用该音色的播放按钮试听。";
});
const previewReady = computed(() => !!selected.value && !!previewText.value.trim() && previewVoiceReady.value);

/** 正被试听的音色路径（用于按钮 loading）与正在改名/删除的路径。 */
const playingPath = ref("");
const busyPath = ref("");

/** 模型友好名：优先用供应商给出的 label，查不到才退回原始 id。 */
function modelLabel(modelId: string) {
  for (const provider of providers.value) {
    const hit = provider.models.find(model => model.id === modelId);
    if (hit) return hit.label;
  }
  return modelId;
}

onMounted(() => {
  void loadProviders();
  void loadFolderOptions();
  void loadVoices();
});

// 切分页或换保存位置都要重读该文件夹下的音色 —— 两个流程各自列自己的。
watch([activeMode, activeFolder], () => { void loadVoices(); });

onBeforeUnmount(() => {
  timer !== undefined && window.clearInterval(timer);
  recorder?.state === "recording" && recorder.stop();
  recorder?.stream.getTracks().forEach(track => track.stop());
});

/** 保存位置的下拉项：素材库顶层的文件夹 + 默认的那个（可能还没建）。 */
async function loadFolderOptions() {
  try {
    const { data } = await axios.get<{ data: { entries: { name: string; type: string }[] } }>("/api/assets/list");
    const directories = (data.data.entries ?? []).filter(entry => entry.type === "directory").map(entry => entry.name);
    folderOptions.value = [...new Set([defaultFolder.value, ...directories])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    folderOptions.value = [defaultFolder.value];
  }
}

/** 用户换了保存位置：音色列表跟着切（watch 已负责重读），并把新文件夹补进下拉项。 */
function onFolderChange(name: string) {
  if (name && !folderOptions.value.includes(name)) {
    folderOptions.value = [...folderOptions.value, name].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
}

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
    const folder = data.data.entries.find(entry => entry.type === "directory" && entry.name === activeFolder.value);
    const files = (folder?.children ?? []) as { name: string; path: string; type: string }[];
    const loaded: VoiceAsset[] = [];
    for (const file of files.filter(entry => entry.type === "file" && entry.name.toLowerCase().endsWith(".json"))) {
      try {
        const { data: content } = await axios.get<Record<string, unknown>>("/api/assets/read", { params: { path: file.path } });
        const voice = typeof content.voice === "string" ? content.voice : "";
        if (!voice) continue;
        // ACT: 按音色 ID 的前缀**自愈模型字段**。
        // 百炼把模型编进了音色 ID（`qwen-tts-vc-…` / `qwen-tts-vd-…`），而早期版本把用户选中的
        // 模型名存进了 model 字段 —— 复刻与设计是两个不同模型，于是设计音色被存成 vc，
        // 直接回放会 400。这里以 ID 为准纠正，老音色不必重新创建。
        const storedModel = typeof content.model === "string" ? content.model : "";
        const model = voice.startsWith("qwen-tts-vd") ? "qwen3-tts-vd-2026-01-26"
          : voice.startsWith("qwen-tts-vc") ? "qwen3-tts-vc-2026-01-22"
            : storedModel;
        loaded.push({
          name: typeof content.name === "string" ? content.name : file.name,
          path: file.path,
          voice,
          providerId: typeof content.providerId === "string" ? content.providerId : "",
          model,
          source: content.source === "design" ? "design" : "clone",
          json: content,
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
    const { data } = await axios.post<{ data: { voice: string; label?: string; targetModel?: string } }>("/api/ai/voices/create", payload);
    // ACT: 存**供应商回传的实际合成模型**，不用 target.modelId ——
    // 百炼的复刻与设计是两个不同模型（vc / vd），而登记时内部只用其中一个，
    // 存错模型会导致回放 400（实测）。供应商没回传时才回退到用户选中的那个。
    const savedPath = await saveVoice(data.data.voice, name, target.providerId, data.data.targetModel?.trim() || target.modelId, byDesign ? "design" : "clone");
    ElMessage.success(byDesign ? "音色已生成并保存" : "音色复刻完成并保存");
    // ACT: 创建成功后**就地试听** —— 补上唯一缺失的反馈闭环。
    // 原先只有列表多一行，用户得自己发现那个 ▶；这里直接读出刚存的音色并合成一次。
    // 试听失败不影响创建结果（音色已经在素材库里了）。
    const created = voices.value.find(item => item.path === savedPath);
    if (created && props.directory) await previewVoice(created);
  } catch (error) {
    showError(error);
  } finally {
    creatingClone.value = false;
    creatingDesign.value = false;
  }
}

/** 保存音色，返回**实际写入的路径**（同名冲突时会带时间戳另存，调用方需要知道是哪个）。 */
async function saveVoice(voice: string, name: string, providerId: string, model: string, source: "clone" | "design") {
  const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
  // ACT: 存进**当前分页选的保存位置**（复刻与设计各记一份），不再是写死的「声音」。
  const folder = activeFolder.value;
  const path = `${folder}/${safeName}.json`;
  const content = JSON.stringify({ name, voice, providerId, model, source, createdAt: new Date().toISOString() }, null, 2);
  const put = (target: string) => axios.put("/api/assets/save", new Blob([content], { type: "application/json" }), { params: { path: target }, headers: { "Content-Type": "application/octet-stream" } });
  // assets/save 不会创建父目录，所选文件夹不存在时先建（已存在会报错，忽略即可）。
  await axios.post("/api/assets/mkdir", { path: folder }).catch(() => undefined);
  let written = path;
  try {
    await put(path);
  } catch (error) {
    // 同名音色已存在时（服务端 exclusive 不覆盖）改用带时间戳的名称。
    if (!axios.isAxiosError(error)) throw error;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    written = `${folder}/${safeName}-${stamp}.json`;
    await put(written);
  }
  await loadVoices();
  emit("saved");
  return written;
}

async function synthesize(text: string, voice: string, providerId: string, model: string) {
  // 合成需要工作目录：生成结果要落在工作区里再读回来播放。
  // ACT: **必须带 `x-toonflow-workspace: 1`** —— 服务端的 resolveWorkspace 用它判定
  // "这是本机客户端发来的请求"，不带就只能落在服务器工作区内，工作目录在别处时会失败。
  // 踩过：这里原先没带这个头，于是点「试听」报「服务器部署只能使用服务器工作区」——
  // 而素材库能正常读文件（assetLibrary 的请求带了头），所以症状看着很怪。
  const { data } = await axios.post<{ data: { path: string }[] }>("/api/ai/media/generate", {
    directory: props.directory, mediaType: "audio", providerId, modelId: model, prompt: text, voice,
  }, { headers: { "x-toonflow-workspace": "1" } });
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
    // ACT: 音色由 `previewVoiceReady` 保证可用（按钮在此之前是禁用的），这里只负责取用。
    const voice = matchedVoice.value?.voice ?? "Cherry";
    previewUrl.value = await synthesize(previewText.value.trim(), voice, target.providerId, target.modelId);
  } catch (error) {
    showError(error);
  } finally {
    synthesizing.value = false;
  }
}

async function previewVoice(item: VoiceAsset) {
  playingPath.value = item.path;
  createError.value = "";
  try {
    // ACT: 试听文字**可选** —— 用户在列表上点播放时通常只想确认音色，不该被迫先写字。
    // 空的时候用一句固定样本，保证点下去一定有声音（原先只校验文字非空，
    // 空文字会合成出一段没有内容的音频）。
    const text = previewText.value.trim() || defaultPreviewText;
    previewUrl.value = await synthesize(text, item.voice, item.providerId, item.model);
  } catch (error) {
    showError(error);
  } finally {
    playingPath.value = "";
  }
}

async function renameVoice(item: VoiceAsset) {
  try {
    const { value } = await ElMessageBox.prompt("新的音色名称", `重命名「${item.name}」`, {
      inputValue: item.name,
      inputPattern: /\S/,
      inputErrorMessage: "名称不能为空",
      confirmButtonText: "保存",
      cancelButtonText: "取消",
    });
    const name = String(value ?? "").trim();
    if (!name || name === item.name) return;
    busyPath.value = item.path;
    const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
    // ACT: 目标路径**沿用该音色自己的文件夹**，不用 activeFolder ——
    // 否则在 A 文件夹里改名会把音色搬到当前分页选的 B 文件夹。
    // 只改文件名，不改 JSON 里的内容结构（voice / model 等身份信息必须保持）。
    const folder = item.path.slice(0, item.path.lastIndexOf("/"));
    const target = `${folder}/${safeName}.json`;
    if (target !== item.path) await axios.post("/api/assets/rename", { path: item.path, target });
    const content = JSON.stringify({ ...item.json, name }, null, 2);
    await axios.put("/api/assets/save", new Blob([content], { type: "application/json" }),
      { params: { path: target }, headers: { "Content-Type": "application/octet-stream" } });
    await loadVoices();
    emit("saved");
  } catch (error) {
    // 用户取消 prompt 不是错误。
    if (error === "cancel" || error === "close") return;
    showError(error);
  } finally {
    busyPath.value = "";
  }
}

async function removeVoice(item: VoiceAsset) {
  busyPath.value = item.path;
  createError.value = "";
  try {
    await axios.delete("/api/assets/remove", { data: { path: item.path } });
    await loadVoices();
    emit("saved");
  } catch (error) {
    showError(error);
  } finally {
    busyPath.value = "";
  }
}
</script>

<style lang="scss" scoped>
.voicePanel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  // ACT: 这一栏是素材库里的窄分页（约 300px），内容却很长（表单 + 分隔线 + 音色列表 + 播放器）。
  // 这里自立收缩与宽度约束，避免与父容器互相压缩后挤在一起。
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 2px;

  .voiceHint { margin-bottom: 4px; }

  // 两个流程的分页：整宽两等分，与素材库顶部的分页同形。
  .modeTabs {
    display: flex;
    margin-bottom: 10px;

    :deep(.el-radio-button) { flex: 1 1 0; }
    :deep(.el-radio-button__inner) { width: 100%; }
  }

  .voiceForm {
    :deep(.el-form-item) { margin-bottom: 8px; }
    :deep(.el-form-item__label) { padding-bottom: 2px; font-size: 12px; line-height: 18px; }
  }

  .voiceField { width: 100%; }
  .voiceNote { display: block; margin-top: 2px; line-height: 16px; overflow-wrap: anywhere; }

  // ACT: 区块标题与上面的表单标签（`el-form-item__label` 在 labelPosition="top" 下的形态）
  // **逐条对齐**，不再用分隔线：同一栏里两套标题看着就是"不一样"。
  // 对齐依据是 Element Plus 的真实规则：
  //   height:auto; margin-bottom:8px; line-height:22px; display:block;
  //   color:var(--el-text-color-regular); font-size:var(--el-form-label-font-size)
  // 而本组件把表单标签的字号压到 12px，这里同样用 12px。
  .voiceFieldLabel {
    display: block;
    margin: 12px 0 8px;
    font-size: 12px;
    font-weight: normal;
    line-height: 22px;
    color: var(--el-text-color-regular);
  }

  .sampleRow { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
  .sampleInput { display: none; }
  .voiceAction { width: 100%; margin-top: 4px; }
  .voiceAudio { display: block; width: 100%; max-width: 100%; margin-top: 6px; }

  .voiceItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    &:last-child { border-bottom: none; }

    // 正在试听的那一行给个底色，用户能对上"哪一行在响"。
    &.playing {
      background: var(--el-fill-color-light);
      border-radius: var(--ui-radius-small);
    }

    .voiceItemMain {
      display: flex;
      flex-direction: column;
      // 必须允许收缩，否则长名字把右侧按钮挤出容器。
      min-width: 0;
      flex: 1 1 auto;
    }

    .voiceItemName { line-height: 18px; overflow-wrap: anywhere; }
    // 按钮不参与收缩，也不会被长名字挤走。
    .el-button { flex: 0 0 auto; }
  }
}
</style>
