const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
  {
    type: "input",
    field: "baseUrl" as const,
    title: "请求地址",
    value: "https://dashscope.aliyuncs.com/api/v1",
    props: { placeholder: "https://dashscope.aliyuncs.com/api/v1" },
  },
  {
    type: "input",
    field: "voice" as const,
    title: "默认音色",
    value: "Cherry",
    props: { placeholder: "例如 Cherry" },
  },
];

const version = "2.1.0";

// 非实时语音合成（HTTP）。文档：https://help.aliyun.com/zh/model-studio/qwen-tts-api
// 请求 POST {baseUrl}/services/aigc/multimodal-generation/generation
// 响应 output.audio.url 指向完整音频文件（有效期 24 小时），宿主会下载到工作区。
const generatePath = "/services/aigc/multimodal-generation/generation";
// 音色创建（声音复刻 / 声音设计）端点，与合成分开。
const voicePath = "/services/audio/tts/customization";

// 把 MediaInput 转成 Data URL，供需要 Base64 的接口使用。
function dataUrl(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

// ACT: 系统音色只列文档可查的几个常用项；供应商模型上的 voices 会透传给前端
// （apps/server/src/utils/media/generation.ts 仅对 type === "audio" 的模型带上 voices）。
// 完整音色表见文档，用户也可在供应商配置里直接改「默认音色」。
const voices = [
  { title: "Cherry（芊悦·女声）", voice: "Cherry" },
  { title: "Serena（苏瑶·女声）", voice: "Serena" },
  { title: "Ethan（晨煦·男声）", voice: "Ethan" },
  { title: "Chelsie（千雪·女声）", voice: "Chelsie" },
];

export default {
  id: "bailian",
  label: "阿里云百炼",
  version,
  readme: `## 阿里云百炼（语音）

提供语音合成、声音复刻、声音设计与**语音转写（带词级时间戳）**。

- 合成模型：\`qwen-audio-3.0-tts-plus\`（标准合成 / 声音复刻 / 声音设计 / 指令控制）、
  \`qwen3-tts-flash\`（标准合成，速度快、成本低）
- 转写：用 \`qwen-audio-3.0-asr-flash\`，返回每个词的起止时间（毫秒），
  用于生成与配音对齐的字幕。**注意该平台另一批 ASR 模型不返回时间戳**，
  所以模型由适配内定、不暴露给上层。
- API Key 与请求地址在下方配置；**默认音色**用于未显式指定 voice 时的合成

> 声音复刻与声音设计需要先创建音色（\`voice-enrollment\`）拿到音色 ID，
> 相关流程由素材库的「声音」面板承载。

文档：<https://help.aliyun.com/zh/model-studio/tts-model/>`,
  rules,
  models: [
    {
      id: "qwen-audio-3.0-tts-plus",
      label: "Qwen-Audio-TTS-Plus",
      type: "audio",
      voices,
    },
    {
      id: "qwen3-tts-flash",
      label: "Qwen3-TTS-Flash",
      type: "audio",
      voices,
    },
  ] satisfies ProviderModel[],
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/, "");
    const voice = request.voice?.trim() || this.config.voice?.trim();
    if (!voice) throw new Error("请指定音色");

    const text = request.text?.trim();
    if (!text) throw new Error("请提供要合成的文本");

    const input: Record<string, unknown> = { text, voice };
    // ACT: 不暴露 language_type 给上层（请求结构里没有对应字段），交给服务端自动识别，
    // 多语种混排时也不至于猜错语种。
    const signal = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}${generatePath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: request.model, input }),
      signal,
    });
    const data = await response.json().catch(() => undefined) as
      { output?: { audio?: { url?: string } }; message?: string; code?: string } | undefined;
    if (!response.ok) throw new Error(this.tool.errorMessage(data) || `语音合成失败：HTTP ${response.status}`);
    const url = data?.output?.audio?.url;
    if (!url) throw new Error(this.tool.errorMessage(data) || "供应商未返回音频地址");
    return [{ mediaType: "audio", type: "url", url }];
  },
  async createVoice(request: CreateVoiceRequest): Promise<VoiceResult> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/, "");
    const name = request.name?.trim();
    if (!name) throw new Error("请填写音色名称");

    // ACT: 只实现 Qwen-TTS 的声音复刻（qwen-voice-enrollment）。
    // 原因：Qwen-Audio-TTS / CosyVoice 的 voice-enrollment 要求样本是「公网可访问的 URL」，
    // 而本产品的样本来自本地上传与现场录音，没有公网托管；Qwen-TTS 这条路支持
    // Base64 Data URL，本地样本可直接提交。文档见
    // https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api
    // 名字规则：preferred_name 最多 16 位，只允许字母数字下划线。
    const preferredName = name.replace(/[^0-9A-Za-z_]/g, "_").slice(0, 16);
    if (!preferredName) throw new Error("音色名称需包含字母、数字或下划线");

    const input: Record<string, unknown> = { action: "create", preferred_name: preferredName };
    if (request.description?.trim()) {
      // 声音设计：用文字描述生成音色，不需要样本。
      input.text = request.description.trim();
    } else {
      const sample = request.sample;
      if (!sample) throw new Error("请提供用于复刻的音频样本");
      input.audio = { data: dataUrl(sample) };
    }
    const targetModel = request.targetModel?.trim();
    if (targetModel) input.target_model = targetModel;

    const signal = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}${voicePath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen-voice-enrollment", input }),
      signal,
    });
    const data = await response.json().catch(() => undefined) as
      { output?: { voice?: string }; message?: string; code?: string } | undefined;
    if (!response.ok) throw new Error(this.tool.errorMessage(data) || `音色创建失败：HTTP ${response.status}`);
    const voice = data?.output?.voice;
    if (!voice) throw new Error(this.tool.errorMessage(data) || "供应商未返回音色标识");
    return { voice, label: preferredName };
  },
  async transcribe(request: TranscribeRequest): Promise<TranscriptResult> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://dashscope.aliyuncs.com/api/v1").replace(/\/$/, "");

    // ACT: 模型内定为 qwen-audio-3.0-asr-flash，不允许上层随便换。
    // 实测（2026-10-06）：同一平台下 qwen3-asr-flash 只返回纯文本、不返回时间戳，
    // 而 qwen-audio-3.0-asr-flash 返回词级 begin_time/end_time（毫秒）。
    // content 也必须写成 { type: "input_audio", input_audio: { data } }，
    // 写成 { audio } 会 400 —— 两种写法看着都合理，但只有前者被接受。
    const model = request.model?.trim() || "qwen-audio-3.0-asr-flash";
    const audio = dataUrl(request.audio);
    const parameters: Record<string, unknown> = { format: "wav", sample_rate: "24000" };
    if (request.languageHints?.length) parameters.language_hints = request.languageHints;

    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}${generatePath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // 关掉 SSE，否则响应是多个 JSON 事件拼接，无法直接 parse。
        "X-DashScope-SSE": "disable",
      },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: audio } }] }] },
        parameters,
      }),
      signal,
    });
    const data = await response.json().catch(() => undefined) as {
      sentence?: { text?: string; begin_time?: number; end_time?: number; words?: { text?: string; begin_time?: number; end_time?: number; punctuation?: string }[] };
      text?: string;
      output?: { sentence?: { text?: string; begin_time?: number; end_time?: number; words?: { text?: string; begin_time?: number; end_time?: number; punctuation?: string }[] } };
      message?: string;
      code?: string;
    } | undefined;
    if (!response.ok) throw new Error(this.tool.errorMessage(data) || `语音转写失败：HTTP ${response.status}`);

    const sentence = data?.sentence ?? data?.output?.sentence;
    if (!sentence) throw new Error(this.tool.errorMessage(data) || "供应商未返回转写结果");
    const words = (sentence.words ?? [])
      .filter(word => typeof word.text === "string" && Number.isFinite(word.begin_time) && Number.isFinite(word.end_time))
      .map(word => ({
        text: word.text!,
        beginMs: word.begin_time!,
        endMs: word.end_time!,
        punctuation: word.punctuation ?? "",
      }));
    if (!words.length) throw new Error("供应商返回了转写文本但没有时间戳");

    const beginMs = Number.isFinite(sentence.begin_time) ? sentence.begin_time! : words[0]!.beginMs;
    const endMs = Number.isFinite(sentence.end_time) ? sentence.end_time! : words[words.length - 1]!.endMs;
    return {
      // ACT: 供应商返回的是**单个 sentence 对象**（不按标点分句），
      // 所以这里只做一层包装，切句交给调用方按 punctuation 与词间空隙处理。
      sentences: [{ text: sentence.text ?? data?.text ?? "", beginMs, endMs, words, totalMs: endMs }],
      text: sentence.text ?? data?.text ?? "",
    };
  },
} satisfies ProviderDefinition<typeof rules>;
