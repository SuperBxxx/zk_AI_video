import type { Edge, Node } from "@vue-flow/core";

// 创作模式：为首页提供几个起点。每个模式 = 一段开场提示词 + 一张预置画布。
//
// 重要：画布里的 node.type 必须带 `remote-` 前缀 ——
// 画布把节点文件名映射为 `remote-<name>`（canvas/index.vue、canvasDrop.ts），
// 没有前缀的类型不会被注册，节点会渲染不出来。
//
// 端口（来自各节点定义，改动节点时需同步）：
//   remote-textNode             in(VIDEO|IMAGE|STRING) → text(STRING)
//   remote-imageNode            —                       → image(IMAGE)
//   remote-videoNode            —                       → video(VIDEO)
//   remote-audioNode            —                       → audio(AUDIO)   ← 只有输出，没有输入
//   remote-imageGenerationNode  in(IMAGE|STRING)        → image(IMAGE)
//   remote-videoGenerationNode  in(IMAGE|VIDEO|AUDIO|STRING) → video(VIDEO)
//   remote-director3dNode       in(STRING|IMAGE|VIDEO)  → （无输出，仅预演）
//
// 画布坐标以原点为中心，横向向右推进、纵向向下分行，与左侧流入方向一致。
// 节点 id 在每个模式内唯一即可，打开画布时不会与其它文件冲突。

export type CreateMode = {
  id: string;
  label: string;
  // 选中模式时填入输入框的开场提示词；自由创作保持为空。
  prompt: string;
  // 预置画布节点。空数组表示不铺节点。
  build: () => { nodes: Node[]; edges: Edge[] };
};

const node = (id: string, name: string, label: string, x: number, y: number, data: Record<string, unknown> = {}): Node =>
  ({ id, type: `remote-${name}`, position: { x, y }, data: { label, ...data } });

const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge =>
  ({ id, source, sourceHandle, target, targetHandle });

export const createModes: CreateMode[] = [
  {
    id: "free",
    label: "自由创作",
    prompt: "",
    build: () => ({ nodes: [], edges: [] }),
  },
  {
    id: "marketing",
    label: "营销 / 推广",
    prompt: "我要做一支产品宣传片。先和我确认产品、目标人群、投放平台和时长，再给出分镜与画面方向。",
    build: () => ({
      nodes: [
        node("m-text", "textNode", "卖点与脚本", -420, -40, { prompt: "" }),
        node("m-image", "imageGenerationNode", "主视觉", 20, -160, { prompt: "" }),
        node("m-video", "videoGenerationNode", "成片", 460, -40, { prompt: "" }),
        node("m-audio", "audioNode", "配乐 / 旁白", 460, 200),
      ],
      edges: [
        edge("m-e1", "m-text", "text", "m-image", "in"),
        edge("m-e2", "m-text", "text", "m-video", "in"),
        edge("m-e3", "m-image", "image", "m-video", "in"),
        edge("m-e4", "m-audio", "audio", "m-video", "in"),
      ],
    }),
  },
  {
    id: "talkingHead",
    label: "数字人 / 口播",
    prompt: "我要做一条口播视频。先和我确认主题、口播人设和时长，再写文稿。文稿确认后请生成配音，并接入口播成片。",
    build: () => ({
      nodes: [
        node("t-text", "textNode", "口播文稿", -420, -40, { prompt: "" }),
        node("t-audio", "audioNode", "配音", 20, -160),
        node("t-image", "imageNode", "形象参考图", 20, 140),
        node("t-video", "videoGenerationNode", "口播成片", 460, -40, { prompt: "" }),
      ],
      edges: [
        // ACT: audioNode 只有 audio 输出、没有 target 端口，因此文稿接不进配音节点 ——
        // 配音需单独生成后再连到成片。这里只连实际成立的端口，避免画布出现无效连线。
        edge("t-e1", "t-audio", "audio", "t-video", "in"),
        edge("t-e2", "t-image", "image", "t-video", "in"),
      ],
    }),
  },
  {
    id: "storyboard",
    label: "故事短剧",
    prompt: "我要把一个故事做成短剧。先和我确认故事内容、时长和画面风格，再拆成分镜。",
    build: () => ({
      nodes: [
        node("s-text", "textNode", "剧本与分镜", -420, -120, { prompt: "" }),
        node("s-3d", "director3dNode", "镜头预演", 20, 160),
        node("s-image", "imageGenerationNode", "分镜画面", 20, -160, { prompt: "" }),
        node("s-video", "videoGenerationNode", "分镜视频", 460, -160, { prompt: "" }),
        node("s-audio", "audioNode", "旁白 / 对白", 460, 120),
      ],
      edges: [
        edge("s-e1", "s-text", "text", "s-3d", "in"),
        edge("s-e2", "s-text", "text", "s-image", "in"),
        edge("s-e3", "s-image", "image", "s-video", "in"),
        edge("s-e4", "s-text", "text", "s-video", "in"),
        edge("s-e5", "s-audio", "audio", "s-video", "in"),
      ],
    }),
  },
];
