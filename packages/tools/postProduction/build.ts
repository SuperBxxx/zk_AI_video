import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "postProduction",
  displayName: "后期制作",
  description: "成片质量闸（帧率/音画时长/静止段/镜头落点）、口播稿与配音对齐出字幕、音效钉帧校验。",
  prompt: `这是成片交付前的质检与字幕工具，不负责生成画面。

checkVideo 是**交付前必跑**的质量闸，判据来自已交付项目的返工教训：
· 帧率不一致（变帧率/丢帧）会让音画逐渐漂移、混剪时每 N 帧出现一次重复帧；
· 音画时长差超过 1 帧即算失败；
· 任意 0.8s 全静止即算失败 —— 素材本身要求静止的段落（标志落定、定格）
  处置不是豁免，而是让画面里还有极缓的持续运动；
· 给了 shots 时还会核每个镜头是否短于落点保护带（太短会让动效落点被转场吞掉）。
失败项要真的去修，不要只报告。

makeSubtitle 把**配音的实际念法**对齐到**我们的稿子**，产出可直接烧录的 ASS 字幕。
要点：
· 稿子是句子的权威，不是语音识别的停顿；
· 语音识别会把「三千」写成「3000」、「十九万」写成「19万」，工具内部会归一化，
  所以稿子用哪种写法都可以；
· 返回的每句带 match 覆盖率，**match < 0.90 的句子要人工听核**（通常是 ASR 听错了）；
· 逐字高亮用 ASS 的卡拉 OK 标签，与词级时间戳一一对应。
烧录字幕交给 ffmpeg 工具：把 ASS 放在视频同目录，用
{"steps":[{"method":"input","args":["视频.mp4"]},{"method":"videoFilters","args":["subtitles=字幕.ass"]}],"operation":{"method":"save","args":["输出.mp4"]}}。

resolveCues 校验音效 cue 表并把它换算成音频轨上的绝对时刻。
两条纪律：钉帧**一律相对镜头起点**（写绝对时间会在时间线平移时全表失效）；
音量是**乘法系数**不是目标音量，素材本身录得轻时优先换素材或预归一化。
输出音轨有编码器 priming 偏移（内置 aac 约 21ms），
这个常数必须按自己的管线实测后通过 offsetMs 传入，不要照抄别家的值。`,
  author: "住凯AI视频",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [
    { type: "inputNumber", field: "targetFps", title: "目标帧率", value: 30, props: { min: 1, max: 240, step: 1 } },
    { type: "inputNumber", field: "freezeDuration", title: "静止判定时长（秒）", value: 0.8, props: { min: 0.1, max: 10, step: 0.1 } },
    { type: "inputNumber", field: "shotTail", title: "镜头落点保护带（秒）", value: 0.5, props: { min: 0, max: 5, step: 0.1 } },
    { type: "inputNumber", field: "audioOffsetMs", title: "输出音轨偏移（毫秒）", value: 0, props: { min: 0, max: 500, step: 0.1 } },
  ],
}, import.meta.url);
