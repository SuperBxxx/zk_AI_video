import { inject, nextTick, onScopeDispose, watch } from "vue";
import { useNodeId, useVueFlow } from "@vue-flow/core";
import type { ValidConnectionFunc } from "@vue-flow/core";
import { useNodeInputs } from "./nodeInputs";
import type { NodeInputValue, NodeOutput } from "./values";

export type NodeEventCallbacks = {
  delete: () => void | Promise<void>;
  save: (reason?: "reload") => void | Promise<void>;
  copy: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  canConnect: ValidConnectionFunc;
  [name: `input:${string}`]: (values: NodeInputValue[]) => void;
  [name: `output:${string}`]: (output: NodeOutput | undefined) => void;
};
type NodeEventListeners = {
  [name in "delete" | "save" | "copy" | "canConnect"]: Set<NodeEventCallbacks[name]>;
};

// 挂在共享画布实例上，让独立 UMD 共用注册表；不会进入画布 JSON。
const nodeEventsKey = Symbol.for("toonflow.nodeEvents");

export function useNodeEvent(nodeId = useNodeId(), canvas = useVueFlow()) {
  if (!nodeId) throw new Error("请在节点组件中使用 useNodeEvent()，或传入节点 ID");
  const { getSourceValue, getTargetValues } = useNodeInputs(canvas);
  const flow = canvas as ReturnType<typeof useVueFlow> & {
    [nodeEventsKey]?: Map<string, NodeEventListeners>;
  };
  const registry = flow[nodeEventsKey] ?? new Map<string, NodeEventListeners>();
  if (!flow[nodeEventsKey]) Object.defineProperty(flow, nodeEventsKey, { value: registry });

  function on<name extends keyof NodeEventCallbacks>(name: name, callback: NodeEventCallbacks[name]) {
    if (name.startsWith("input:")) {
      return watch(
        () => getTargetValues(nodeId, name.slice(6)),
        values => (callback as NodeEventCallbacks[`input:${string}`])(values),
        { deep: true, immediate: true },
      );
    }
    if (name.startsWith("output:")) {
      return watch(
        () => getSourceValue(nodeId, name.slice(7)),
        output => (callback as NodeEventCallbacks[`output:${string}`])(output),
        { deep: true, immediate: true },
      );
    }
    if (name !== "delete" && name !== "save" && name !== "copy" && name !== "canConnect") throw new Error(`未知节点事件：${name}`);
    let events = registry.get(nodeId);
    if (!events) {
      events = { delete: new Set(), save: new Set(), copy: new Set(), canConnect: new Set() };
      registry.set(nodeId, events);
    }
    const listeners = events[name as "delete" | "save" | "copy" | "canConnect"] as Set<NodeEventCallbacks[name]>;
    listeners.add(callback);
    const off = () => {
      if (listeners.delete(callback) && !events.delete.size && !events.save.size && !events.copy.size && !events.canConnect.size) registry.delete(nodeId);
    };
    onScopeDispose(off);
    return off;
  }

  function emit(name: "delete"): Promise<void>;
  function emit(name: "save", reason?: "reload"): Promise<void>;
  function emit(name: "copy"): Promise<Record<string, unknown>>;
  function emit(name: "canConnect", ...args: Parameters<ValidConnectionFunc>): boolean;
  function emit(...args: ["delete"] | ["save", "reload"?] | ["copy"] | ["canConnect", ...Parameters<ValidConnectionFunc>]) {
    const events = registry.get(nodeId);
    if (args[0] === "canConnect") {
      return [...events?.canConnect ?? []].every(callback => callback(args[1], args[2]) === true);
    }
    if (args[0] === "copy") {
      return (async () => {
        const node = canvas.findNode(nodeId);
        const data: Record<string, unknown> = {};
        for (const callback of [...events?.copy ?? []]) Object.assign(data, await callback());
        if (canvas.findNode(nodeId) !== node || registry.get(nodeId) !== events) throw new Error("节点已切换，请重新复制");
        return data;
      })();
    }
    return (async () => {
      if (args[0] === "delete") {
        const node = canvas.findNode(nodeId);
        // 删除前完成已有文件写入，保证立即撤销时能读回最新内容。
        for (const callback of [...events?.save ?? []]) await callback();
        if (canvas.findNode(nodeId) !== node || registry.get(nodeId) !== events) throw new Error("节点已切换，请重新操作");
      }
      for (const callback of [...events?.[args[0]] ?? []]) {
        if (args[0] === "save" && args[1]) await callback(args[1]);
        else await callback();
      }
    })();
  }

  return { on, emit };
}

// 后台任务（视频生成等）产出结果后：把它放成画布上的一个节点，并通知 agent。
//
// 为什么放在这里：节点包不引用 apps/web，只能靠注入拿宿主能力；
// 画布上下文已在 useNodeEvent 里注入过，这里沿用同一套注入键。
// 宿主侧来源：canvas/index.vue 与 canvasHost.vue 的 provide。
export function useCanvasOutput() {
  const flow = useVueFlow();
  const notify = inject<((label: string, kind: string, nodeId?: string) => void) | undefined>("notifyCanvasChange", undefined);
  // 宿主侧来源：canvas/index.vue 的 provide("callNodeTool")。
  const callNodeTool = inject<((nodeId: string, name: `node:${string}`, args: Record<string, unknown>) => Promise<unknown>) | undefined>("callNodeTool", undefined);
  const id = useNodeId();

  // 节点是否已经挂了输出；videoNode 把素材持久化在 node.data.outputs.video。
  function hasOutput(nodeId: string) {
    return !!flow.findNode(nodeId)?.data?.outputs?.video;
  }

  // ACT: 优先复用半径内的空素材节点，而不是无脑新建。
  // 为什么限定半径：多镜头工作流里同画布可能有多个空的 videoNode，
  // 取全局第一个会把 A 段的产出挂到 B 段的节点上；取最近的一般正是它对应的那个。
  // 半径 800 是经验值（节点间距通常 400 上下），超出就认为不在同一区域。
  function findReusableVideoNode(position: { x: number; y: number }) {
    const candidates = flow.getNodes.value.filter(node => node.type === "remote-videoNode" && !hasOutput(node.id));
    if (!candidates.length) return undefined;
    const nearest = candidates
      .map(node => ({ node, distance: Math.hypot(node.position.x - position.x, node.position.y - position.y) }))
      .sort((left, right) => left.distance - right.distance)[0]!;
    return nearest.distance <= 800 ? nearest.node : undefined;
  }

  return async function placeOutput(output: { url: string; mimeType: string }, label: string) {
    const node = id ? flow.findNode(id) : undefined;
    // 放在源节点右侧，尽量不与已有节点重叠。
    const position = { x: node ? node.position.x + 420 : 0, y: node ? node.position.y : 0 };
    // 复用前必须能调用节点函数，否则挂不上文件，不如照旧新建。
    const reused = callNodeTool ? findReusableVideoNode(position) : undefined;
    if (reused) {
      // 空节点只有 source 端口、没有输入，只能通过它自己注册的 setVideo 把文件挂上去。
      await callNodeTool!(reused.id, "node:setVideo", { path: output.url, mimeType: output.mimeType });
      await nextTick();
      if (node) flow.addEdges({ id: crypto.randomUUID(), source: id!, sourceHandle: "video", target: reused.id, targetHandle: "video" });
      await nextTick();
      notify?.(label, "视频", reused.id);
      return reused.id;
    }

    const newId = crypto.randomUUID();
    flow.addNodes({
      id: newId,
      type: "remote-videoNode",
      position,
      data: { label },
    });
    await nextTick();
    if (node) flow.addEdges({ id: crypto.randomUUID(), source: id!, sourceHandle: "video", target: newId, targetHandle: "video" });
    await nextTick();
    notify?.(label, "视频", newId);
    return newId;
  };
}
