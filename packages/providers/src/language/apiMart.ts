const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

export default {
  // ACT: id 故意与媒体版（./media/apiMart.ts 的 "apiMart"）不同。
  // 文本供应商添加时会写入 settings.customProviders 并按 id 去重
  // （languageModel/addProviderDialog.vue 的 existing.some(item => item.id === provider.id)），
  // 而媒体供应商只写磁盘上的供应商文件、不进这个数组。两者同名会导致
  // 「先加了媒体版，就再也加不了文本版」——被误判为已添加。
  // id 仅作内部标识，界面展示用的是 label，因此不影响观感。
  id: "apiMartLanguage" as const,
  label: "APIMart",
  version: "2.0.0",
  // ACT: 网关地址固定为官方文档给出的 Base URL（OpenAI 完全兼容，SDK 只改 base_url）。
  // 不加 isOverseas 一类的地区字段：添加供应商对话框直接用 provider.apiUrl
  // （addProviderDialog.vue 的 fetchModels 与保存逻辑都取它），rules 里的字段
  // 影响不到实际请求地址，加了会误导。国内接入域名 api.apib.ai/v1 可在添加后
  // 用「编辑」改 API 地址。
  apiUrl: "https://api.apimart.ai/v1",
  protocol: "openai-completions",
  readme: `## APIMart

OpenAI 兼容网关，一个 Base URL 即可调用多家模型：GPT-5、GPT-4o、Claude Sonnet / Haiku、Gemini，以及图像与视频模型。

填好 API Key 后会自动获取模型列表。

官网：<https://apimart.ai/>

> 国内接入域名：\`https://api.apib.ai/v1\`（添加后可在「编辑」里改 API 地址）`,
  rules,
  models: [],
} satisfies ProviderDefinition<typeof rules>;
