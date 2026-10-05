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

const version = "2.0.0";

// 非实时语音合成（HTTP）。文档：https://help.aliyun.com/zh/model-studio/qwen-tts-api
// 请求 POST {baseUrl}/services/aigc/multimodal-generation/generation
// 响应 output.audio.url 指向完整音频文件（有效期 24 小时），宿主会下载到工作区。
const generatePath = "/services/aigc/multimodal-generation/generation";

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
  readme: `## 阿里云百炼（语音合成）

提供语音合成、声音复刻与声音设计。本适配当前实现**非实时语音合成**：把文本合成为音频，
生成结果会自动落到工作区。

- 支持模型：\`qwen-audio-3.0-tts-plus\`（标准合成 / 声音复刻 / 声音设计 / 指令控制）、
  \`qwen3-tts-flash\`（标准合成，速度快、成本低）
- API Key 与请求地址在下方配置；**默认音色**用于未显式指定 voice 时的合成

> 声音复刻与声音设计需要先创建音色（\`voice-enrollment\`）拿到音色 ID，
> 相关流程由素材库的「声音」面板承载，尚未实现。

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
} satisfies ProviderDefinition<typeof rules>;
