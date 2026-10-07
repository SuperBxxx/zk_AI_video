import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "mediaAnalysis",
  displayName: "分析素材",
  description: "读一条视频/音频并产出可核对的证据：媒体信息、定点帧图、时段帧网格。不产出画面、不成片。",
  prompt: `这是**取证**工具，不是成片工具。做参考片复刻、逐帧拆解、或需要"看清现有素材里发生了什么"时用它。

为什么必须先取证：技能文档要求"参考素材先逐帧拆解成手法清单"，但只凭印象说"这里有个动效"
无法核对、也无法复现。probe 给出的编码与时长是一切时间换算的基准；frames / grid 给出能反复看的画面。

三条纪律：
· **先 probe 再取样**。编码要在这里看清 —— H.265（微信、苹果导出常见）在桌面端没有解码器，
  会"有声音没画面"，必须在预览或送模型之前先转 H.264。
· **一帧看不出运动**。判断运动手法要连续取若干帧或用 grid；只看首尾两帧一定会漏掉中间的变化。
· **采样间隔跟着内容节奏选**。快速运动要用更密的间隔，否则会跳过错峰；格子的时间以返回清单为准
  （图上没有烧时间码），最后一页不足时会补黑格。

这个工具**不判定"镜头"**，也不对画面做解释。它只把素材摊开成证据；"这是什么手法、为什么有效"
由你自己结合证据写出来，并引用证据路径。`,
  author: "住凯AI视频",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [
    { type: "inputNumber", field: "maxFrames", title: "一次最多取帧数", value: 48, props: { min: 1, max: 200, step: 1 } },
  ],
}, import.meta.url);
