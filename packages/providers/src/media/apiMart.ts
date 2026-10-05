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
    field: "isOverseas" as const,
    title: "请求地区",
    value: "1",
    props: { placeholder: "1 为国内，2 为海外" },
  },
] as const;

const version = "2.0.0";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("APIMart 响应格式错误");
  return value as Record<string, unknown>;
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

function getBaseUrl(isOverseas: string | undefined) {
  return isOverseas === "2" ? "https://api.apimart.ai/v1" : "https://api.apib.ai/v1";
}

function wait(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** 上传图片素材换取平台可访问的 URL；已是 URL 的输入直接透传，无需重新上传。 */
async function uploadImage(context: ProviderContext, apiKey: string, baseUrl: string, input: MediaInput, signal: AbortSignal): Promise<string> {
  if (input.type === "url") return input.url;
  const bytes = input.type === "binary" ? input.data : Buffer.from(input.data, "base64");
  const ext = input.mimeType.split("/")[1] || "png";
  const boundary = `----apimart${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.${ext}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    new Uint8Array(bytes),
    `\r\n--${boundary}--\r\n`,
  ]);
  const response = await context.tool.fetch(`${baseUrl}/uploads/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`图片上传失败：HTTP ${response.status}`);
  const result = object(await response.json());
  if (typeof result.url !== "string" || !result.url) throw new Error("图片上传未返回地址");
  return result.url;
}

/** Seedance 私有素材需先提交审核，通过后才能作为参考素材使用。 */
async function reviewSeedanceAssets(context: ProviderContext, apiKey: string, baseUrl: string, urls: string[], signal: AbortSignal): Promise<string[]> {
  if (urls.length > 20) throw new Error(`单次最多提交20个素材，当前提交了${urls.length}个`);
  const assets = urls.map((url) => ({ url, name: `image_${Date.now()}` }));
  const submitResponse = await context.tool.fetch(`${baseUrl}/seedance2/private-avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      group: { name: `zhukai-seedance-group-${Date.now()}`, description: "住凯AI视频自动创建的Seedance素材组" },
      project_name: "default",
      asset_type: "Image",
      assets,
    }),
    signal,
  });
  if (!submitResponse.ok) throw new Error(`Seedance资产提交失败：HTTP ${submitResponse.status}`);
  const submitResult = object(await submitResponse.json());
  const taskId = object(submitResult.data).id;
  if (!taskId) throw new Error("Seedance资产提交未返回任务ID");

  while (true) {
    const queryResponse = await context.tool.fetch(`${baseUrl}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal,
    });
    if (!queryResponse.ok) throw new Error(`审核状态查询失败：HTTP ${queryResponse.status}`);
    const queryData = object(await queryResponse.json());
    const taskData = object(queryData.data);
    const status = taskData.status;
    if (status === "completed" || status === "failed") {
      const result = object(taskData.result ?? {});
      const usableAssets = Array.isArray(result.usable_assets) ? result.usable_assets : [];
      const assetUrls = usableAssets.map((asset: any) => asset?.asset_url).filter(Boolean);
      if (!assetUrls.length) {
        const error = (taskData.error as { message?: unknown } | undefined)?.message;
        throw new Error(context.tool.errorMessage?.(taskData) || (typeof error === "string" ? error : "素材审核失败"));
      }
      return assetUrls;
    }
    await wait(signal, 3000);
  }
}

async function pollTaskResult<T>(context: ProviderContext, baseUrl: string, apiKey: string, taskId: string, signal: AbortSignal, extract: (data: Record<string, unknown>) => T): Promise<T> {
  while (true) {
    const response = await context.tool.fetch(`${baseUrl}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`轮询失败：HTTP ${response.status}`);
    const result = object(await response.json());
    const data = object(result.data ?? {});
    const status = String(result.status ?? data.status ?? "").toLowerCase();
    if (status === "completed" || status === "success") return extract(data);
    if (status === "failed" || status === "failure") {
      const error = (data.error as { message?: unknown } | undefined)?.message;
      throw new Error(context.tool.errorMessage?.(result) || (typeof error === "string" ? error : "生成失败"));
    }
    await wait(signal, 3000);
  }
}

export default {
  id: "apiMart",
  label: "APIMart",
  version,
  readme: `## APIMart
<svg aria-label="APIMart" role="img" viewBox="480 470 1100 1100" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0; color: currentColor; width: 1.2rem; height: 1.2rem; display: inline-block; vertical-align: middle; margin-right: 6px;"><path d="M 508 528 L 509 1514 L 586 1514 L 588 1512 L 587 610 L 589 607 L 670 607 L 1022 1009 L 1027 1007 L 1388 607 L 1467 607 L 1469 609 L 1470 738 L 1469 1513 L 1551 1513 L 1551 528 L 1350 528 L 1026 901 L 841 687 L 707 528 Z" fill="currentColor"></path><path d="M 627 646 L 626 1513 L 699 1513 L 700 785 L 1008 1131 L 1025 1147 L 1359 781 L 1360 1513 L 1434 1514 L 1435 646 L 1394 647 L 1240 821 L 1024 1059 L 1009 1045 L 789 795 L 661 646 Z" fill="currentColor"></path><path d="M 732 872 L 732 1513 L 802 1514 L 805 1512 L 805 1052 L 808 1053 L 888 1145 L 1024 1293 L 1250 1047 L 1250 1513 L 1322 1514 L 1324 1512 L 1323 872 L 1304 890 L 1026 1196 L 1021 1195 Z" fill="currentColor"></path></svg>APIMart 是 AI 图片、视频与语音生成 API 平台：共用一套接口，图片与视频为异步任务（提交任务拿 ID 再查询结果），语音合成为同步返回。填入 API Key 后点「获取模型列表」即可看到可用模型。

官网：<https://apimart.ai/>`,
  rules,
  models: [
    {
      id: "seedance-2.5",
      label: "Seedance-2.5 (支持真人)",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], resolution: ["480p", "720p"] },
      ],
    },
    {
      id: "seedance-2.0",
      label: "Seedance-2.0 (支持真人)",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p"] }],
    },
    {
      id: "seedance-2.0-fast",
      label: "Seedance 2.0 fast (支持真人)",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      id: "seedance-2.0-mini",
      label: "Seedance 2.0 mini (支持真人)",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      id: "wan3.0-video",
      label: "Wan3.0",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:10", "videoReference:5", "audioReference:5"]],
      audio: true,
      durationResolutionMap: [
        { duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], resolution: ["480P", "720P", "1080p"] },
      ],
    },
    {
      id: "MiniMax-H3",
      label: "MiniMax-H3",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["768P", "2K"] }],
    },
    { id: "seedream-5-0-lite", label: "Doubao Seedream 5.0 Lite", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { id: "seedream-5-0-pro", label: "Doubao Seedream 5.0 Pro", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { id: "gpt-image-2", label: "gpt-image-2", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { id: "gemini-3-pro-image-preview", label: "Nano banana Pro", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { id: "gemini-3.1-flash-image-preview", label: "Nano banana2", type: "image", mode: ["text", "singleImage", "multiReference"] },
    {
      id: "gpt-4o-mini-tts",
      label: "GPT-4o mini TTS",
      type: "audio",
      // 音色与格式取自官方 TTS 文档（/v1/audio/speech）：
      // 6 个音色固定；输出格式支持 wav/opus/aac/flac/pcm，默认 wav。
      voices: [
        { title: "alloy（中性·均衡）", voice: "alloy" },
        { title: "echo（男声·沉稳）", voice: "echo" },
        { title: "fable（英式·叙述）", voice: "fable" },
        { title: "onyx（男声·低沉）", voice: "onyx" },
        { title: "nova（女声·有活力）", voice: "nova" },
        { title: "shimmer（女声·温柔）", voice: "shimmer" },
      ],
    },
  ] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = getBaseUrl(this.config.isOverseas);
    const lowerName = request.model.toLowerCase();
    // ACT: 单次生成最多等待 10 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);

    const imageUrls: string[] = [];
    for (const image of request.images ?? []) imageUrls.push(await uploadImage(this, apiKey, baseUrl, image, signal));

    let size = (request.size ?? "2K").toUpperCase();
    if (lowerName.includes("seedream-5-0-lite") && size === "1K") size = "2K";
    else if (lowerName.includes("seedream-5-0-pro")) {
      if (size === "4K") size = "2K";
      else if (size === "2K") size = "1.5K";
    }

    const response = await this.tool.fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        resolution: size,
        size: request.ratio,
        n: 1,
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      }),
      signal,
    });
    if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`);
    const data = object(await response.json());
    const taskId = Array.isArray(data.data) ? object(data.data[0]).task_id : undefined;
    if (!taskId) throw new Error("未返回任务ID");

    const url = await pollTaskResult(this, baseUrl, apiKey, String(taskId), signal, (taskData) => {
      const result = object(taskData.result ?? {});
      const image = Array.isArray(result.images) ? object(result.images[0]) : undefined;
      const url = image && Array.isArray(image.url) ? image.url[0] : undefined;
      if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
      return url;
    });
    return [{ mediaType: "image", type: "url", url }];
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = getBaseUrl(this.config.isOverseas);
    const lowerName = request.model.toLowerCase();
    // ACT: 单次生成最多等待 30 分钟。
    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);

    const imageUrls: string[] = [];
    for (const image of request.images ?? []) imageUrls.push(await uploadImage(this, apiKey, baseUrl, image, signal));
    const videoUrls = (request.videos ?? []).map(mediaUrl);
    const audioUrls = (request.audios ?? []).map(mediaUrl);
    const frames = [
      ...(request.firstFrame ? [{ url: await uploadImage(this, apiKey, baseUrl, request.firstFrame, signal), role: "first_frame" }] : []),
      ...(request.lastFrame ? [{ url: await uploadImage(this, apiKey, baseUrl, request.lastFrame, signal), role: "last_frame" }] : []),
    ];
    const mode =
      request.mode ?? (frames.length ? "startFrameOptional" : videoUrls.length || audioUrls.length ? [] : imageUrls.length ? "singleImage" : "text");
    const isFrames = mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional";
    const frameImages = frames.length ? frames : imageUrls.map((url, index) => ({ url, role: index === 0 ? "first_frame" : "last_frame" }));

    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      duration: request.duration,
      resolution: request.resolution,
      size: request.ratio,
    };

    if (lowerName.includes("wan")) {
      if (isFrames && frameImages.length >= 2) {
        body.image_with_roles = frameImages.map(({ url, role }) => ({ role, url }));
      } else if (Array.isArray(mode)) {
        body.generation_type = "reference";
        if (imageUrls.length) body.image_urls = imageUrls;
        if (videoUrls.length) body.video_urls = videoUrls;
        if (audioUrls.length) body.audio_urls = audioUrls;
      }
    } else if (lowerName.includes("doubao") || lowerName.includes("seedance")) {
      if (typeof request.generateAudio === "boolean") body.generate_audio = request.generateAudio;
      if (Array.isArray(mode)) {
        if (imageUrls.length) {
          const reviewedUrls = await reviewSeedanceAssets(this, apiKey, baseUrl, imageUrls, signal);
          body.image_with_roles = reviewedUrls.map((url) => ({ role: "reference_image", url }));
        }
        if (videoUrls.length) body.video_urls = videoUrls;
        if (audioUrls.length) body.audio_urls = audioUrls;
      } else if (isFrames) {
        body.image_with_roles = frameImages.map(({ url, role }) => ({ role, url }));
      } else if (mode === "singleImage") {
        body.image_with_roles = imageUrls.map((url) => ({ role: "reference_image", url }));
      }
    } else if (lowerName.includes("minimax")) {
      if (Array.isArray(mode)) {
        if (imageUrls.length) body.image_with_roles = imageUrls.map((url) => ({ role: "reference_image", url }));
        if (videoUrls.length) body.video_urls = videoUrls;
        if (audioUrls.length) body.audio_urls = audioUrls;
      } else if (isFrames) {
        body.image_with_roles = frameImages.map(({ url, role }) => ({ role, url }));
      } else if (mode === "singleImage") {
        body.image_with_roles = imageUrls.map((url) => ({ role: "reference_image", url }));
      }
    }

    const response = await this.tool.fetch(`${baseUrl}/videos/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`);
    const data = object(await response.json());
    const taskId = Array.isArray(data.data) ? object(data.data[0]).task_id : undefined;
    if (!taskId) throw new Error("未返回任务ID");

    const url = await pollTaskResult(this, baseUrl, apiKey, String(taskId), signal, (taskData) => {
      const result = object(taskData.result ?? {});
      const video = Array.isArray(result.videos) ? object(result.videos[0]) : undefined;
      const url = video && Array.isArray(video.url) ? video.url[0] : undefined;
      if (typeof url !== "string" || !url) throw new Error("未返回生成结果");
      return url;
    });
    return [{ mediaType: "video", type: "url", url }];
  },
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = getBaseUrl(this.config.isOverseas);
    const text = request.text?.trim();
    if (!text) throw new Error("请提供要合成的文本");

    // ACT: 该端点返回的是音频二进制流（不是 URL），因此转成 base64 交给宿主。
    // 宿主的 assetBytes 会识别 base64 并落盘（apps/server/src/utils/media/generation.ts）。
    // 格式固定 wav：既是官方默认值，也能被宿主的 detectMimeType 按 RIFF 头识别。
    const response = await this.tool.fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        input: text,
        voice: request.voice?.trim() || "alloy",
        response_format: "wav",
        speed: request.speed ?? 1,
      }),
      signal: AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(this.signal ? [this.signal] : [])]),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => undefined);
      throw new Error(this.tool.errorMessage(failure) || `语音合成失败：HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error("供应商未返回音频内容");
    return [{ mediaType: "audio", type: "base64", data: buffer.toString("base64"), mimeType: "audio/wav" }];
  },
  async updateVendor(): Promise<string> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = getBaseUrl(this.config.isOverseas);
    const response = await this.tool.fetch(`${baseUrl}/vendor/downloadVendor`, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: this.signal,
    });
    if (!response.ok) throw new Error(`请求失败：HTTP ${response.status}`);
    const { data } = object(await response.json());
    if (typeof data !== "string") throw new Error("未返回更新内容");
    return data;
  },
} satisfies ProviderDefinition<typeof rules>;
