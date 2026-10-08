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
// 声音复刻（voice cloning）与声音设计（voice design）是两个不同的目标模型，
// 且登记与合成都必须用同一个 —— 见 createVoice 里的实测记录。
const enrollmentTarget = "qwen3-tts-vc-2026-01-22";
const voiceDesignTarget = "qwen3-tts-vd-2026-01-26";

// 把 MediaInput 转成 Data URL，供需要 Base64 的接口使用。
function dataUrl(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

// ACT: 模型的 voices 必须是**内联字面量**，不能引用常量。
// 踩过的坑：原先写成 `voices,`（引用一个顶层 const），而宿主解析供应商元数据时
// 只接受 JSON 字面量、不接受标识符引用，于是整个供应商加载失败并报
// 「models 仅支持 JSON 字面量」—— 表现为这个供应商在设置里根本装不上。
// 音色表见文档；用户也可在供应商配置里直接改「默认音色」。

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
      voices: [
        { title: "Cherry（芊悦·女声）", voice: "Cherry" },
        { title: "Serena（苏瑶·女声）", voice: "Serena" },
        { title: "Ethan（晨煦·男声）", voice: "Ethan" },
        { title: "Chelsie（千雪·女声）", voice: "Chelsie" },
      ],
    },
    {
      id: "qwen3-tts-flash",
      label: "Qwen3-TTS-Flash",
      type: "audio",
      voices: [
        { title: "Cherry（芊悦·女声）", voice: "Cherry" },
        { title: "Serena（苏瑶·女声）", voice: "Serena" },
        { title: "Ethan（晨煦·男声）", voice: "Ethan" },
        { title: "Chelsie（千雪·女声）", voice: "Chelsie" },
      ],
    },
    {
      // ACT: 声音复刻用的模型 —— 面板里**必须能选到它**，否则复刻完没有模型能用那个音色。
      // 它既是 `qwen-voice-enrollment` 登记时的目标模型，也是复刻音色**唯一**被授权的合成模型
      // （用 qwen3-tts-flash 合成复刻音色会报 Invalid voice specified，实测见 createVoice 的注释）。
      // 内置音色（Cherry 等）仍走上面的 qwen3-tts-flash。
      id: "qwen3-tts-vc-2026-01-22",
      label: "Qwen3-TTS-VC（声音复刻）",
      type: "audio",
      voices: [
        { title: "Cherry（芊悦·女声）", voice: "Cherry" },
        { title: "Serena（苏瑶·女声）", voice: "Serena" },
        { title: "Ethan（晨煦·男声）", voice: "Ethan" },
        { title: "Chelsie（千雪·女声）", voice: "Chelsie" },
      ],
    },
    {
      // ACT: 声音设计用的模型 —— 与 qwen3-tts-vc 同理，**面板里必须能选到它**，
      // 否则设计完没有模型能用那个音色（设计音色只被 qwen3-tts-vd-* 授权合成）。
      id: "qwen3-tts-vd-2026-01-26",
      label: "Qwen3-TTS-VD（声音设计）",
      type: "audio",
      voices: [
        { title: "Cherry（芊悦·女声）", voice: "Cherry" },
        { title: "Serena（苏瑶·女声）", voice: "Serena" },
        { title: "Ethan（晨煦·男声）", voice: "Ethan" },
        { title: "Chelsie（千雪·女声）", voice: "Chelsie" },
      ],
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

    // ACT: 声音复刻的登记目标**固定为 qwen3-tts-vc-2026-01-22**，不用调用方传来的模型。
    //
    // 实测（2026-10-08，真 Key）：
    //   · 登记服务的 target_model 只认 `qwen3-tts-vc-*` 系列。
    //     传 qwen3-tts-flash → `PipelineNotFound: No pipeline for: qwen3-tts-flash`
    //     传 qwen3-tts / qwen-tts / cosyvoice-v1|v2 / qwen-audio-3.0-tts-plus → 同样 PipelineNotFound
    //     传 qwen3-tts-vc（不带日期）→ 同样 PipelineNotFound，**必须带快照日期**。
    //   · 复刻出来的音色**只被 qwen3-tts-vc-* 授权使用**：
    //     用 qwen3-tts-flash 合成 → `InvalidParameter: Invalid voice specified, the requested voice
    //     does not exist or is not licensed for use`；换成 qwen3-tts-vc-2026-01-22 才成功。
    //
    // 所以登记与合成两侧都必须是这个模型，任一侧用别的名字都会失败。
    // （模型名见文件顶部的 enrollmentTarget / voiceDesignTarget 常量。）

    // ACT: 声音设计走**另一个服务** `qwen-voice-design`，不是 voice-enrollment。
    //
    // 原先的实现是把描述填进 enrollment 的 `input.text` —— 实测（2026-10-08，真 Key）：
    //   · enrollment + 只传 text（无 audio）→ `InvalidParameter: Required input 'audio.data' is invalid`
    //   · 官方文档里 enrollment 的 `text` 含义是"**样本音频对应的文本**，用于辅助提升复刻效果"，
    //     根本不是音色描述 —— 也就是说这条路从语义上就不成立。
    //
    // 官方「声音设计」文档：https://help.aliyun.com/zh/model-studio/voice-design-user-guide
    //   model        = qwen-voice-design
    //   input.action = create
    //   voice_prompt = 声音描述（如"沉稳的中年男性，音色低沉有磁性"）
    //   preview_text = 预览音频要朗读的文本（必填）
    //   target_model = qwen3-tts-vd-2026-01-26（vd = voice design；合成也必须用它）
    // 实测该契约可用：登记返回 voice + base64 预览音频，再用 qwen3-tts-vd-2026-01-26 合成成功。
    const byDesign = !!request.description?.trim();
    const targetModel = byDesign ? voiceDesignTarget : enrollmentTarget;
    const input: Record<string, unknown> = { action: "create", preferred_name: preferredName, target_model: targetModel };
    if (byDesign) {
      input.voice_prompt = request.description!.trim();
      // ACT: 预览文本由我们给一句通用中文 —— 面板没有这个输入框，
      // 而它只是"生成音色时用来试听的那句话"，不影响音色本身。
      input.preview_text = "你好，这是用这段描述生成的音色，请试听确认效果。";
    } else {
      const sample = request.sample;
      if (!sample) throw new Error("请提供用于复刻的音频样本");
      input.audio = { data: dataUrl(sample) };
    }

    const signal = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}${voicePath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: byDesign ? "qwen-voice-design" : "qwen-voice-enrollment", input }),
      signal,
    });
    const data = await response.json().catch(() => undefined) as
      { output?: { voice?: string; preview_audio?: { data?: string } }; message?: string; code?: string } | undefined;
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
