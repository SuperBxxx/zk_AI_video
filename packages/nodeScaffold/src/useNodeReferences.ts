import { computed, ref } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import type { NodeData } from "./connection";
import { useNodeEvent } from "./nodeEvent";
import type { NodeInputValue } from "./values";

export function useNodeReferences(handleId = "in") {
  const { id, node } = useNode<NodeData & { referenceOrder?: Record<string, string[]> }>();
  const { removeEdges } = useVueFlow();
  const inputValues = ref<NodeInputValue[]>([]);
  const previews = ref(new Map<string, string>());
  const refList = computed({
    get() {
      const order = new Map(node.data.referenceOrder?.[handleId]?.map((key, index) => [key, index]));
      return [...inputValues.value].sort((a, b) => (order.get(referenceKey(a)) ?? order.size) - (order.get(referenceKey(b)) ?? order.size));
    },
    set(values: NodeInputValue[]) {
      node.data.referenceOrder = { ...node.data.referenceOrder, [handleId]: values.map(referenceKey) };
    },
  });
  /**
   * 可被 `{{ref N}}` 引用的项，**只有真的有内容的才编号**。
   *
   * ACT: 编号原先直接用 refList 的下标，而 refList 包含**所有连着的输入** ——
   * 包括还没产出的空节点。实测踩过：营销模式的模板把 ⑤ 与 ②脚本 / ③主视觉 / ④音频
   * 都连上了，用户又把三张实拍图接到 ⑤，于是空着的 ②③④ 占掉了 1/2/3，
   * 三张图成了 4/5/6；提交时报「引用节点暂无内容」，
   * 而用户真正想引用的三张图编号根本不是 1/2/3。
   *
   * 现在按「有内容」过滤后再连续编号：节点还没产出时它不占号，
   * 补上内容后自动拿到下一个号（编号会跳，但**每个号都能引用到东西**）。
   * 空节点仍留在 refList 里可见（用户要能看到它、去补内容或断开），只是不给号。
   */
  const referenceMentions = computed(() => {
    const usable = refList.value.filter(item =>
      typeof item.dataType === "string"
      && ["IMAGE", "VIDEO", "AUDIO", "STRING"].includes(item.dataType)
      && hasContent(item)
    );
    return usable.map((item, index) => ({
      id: referenceKey(item),
      name: `参考 ${index + 1}`,
      value: `{{ref ${index + 1}}}`,
      avatar: previews.value.get(referenceKey(item)) || undefined,
    }));
  });

  useNodeEvent().on(`input:${handleId}`, (values) => {
    inputValues.value = values;
    const ids = new Set(values.filter(item => item.dataType === "IMAGE" || item.dataType === "VIDEO").map(referenceKey));
    for (const key of previews.value.keys()) {
      if (!ids.has(key)) previews.value.delete(key);
    }
  });

  function setReferencePreview(item: NodeInputValue, url: string) {
    previews.value.set(referenceKey(item), url);
  }

  function removeReference(item: NodeInputValue) {
    removeEdges(edges => edges.filter(edge =>
      edge.target === id && edge.targetHandle === handleId && edge.source === item.source && edge.sourceHandle === item.sourceHandle
    ));
  }

  return { refList, referenceMentions, setReferencePreview, removeReference };
}

function referenceKey(item: NodeInputValue) {
  return encodeURIComponent(JSON.stringify([item.source, item.sourceHandle]));
}

/** 这一项是否已经有内容 —— 决定它能不能被 `{{ref N}}` 引用。 */
function hasContent(item: NodeInputValue) {
  if (item.value === undefined || item.value === null) return false;
  // 文本节点要trim后非空才算有内容；媒体只要有值即可
  if (typeof item.value === "string") return item.value.trim().length > 0;
  return true;
}
