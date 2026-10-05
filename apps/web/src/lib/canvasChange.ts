import { shallowRef } from "vue";

// 节点层与 AI 助手之间的桥接。
//
// 为什么需要：节点里的后台任务（视频生成等）完成时，agent 那一轮早已结束，
// 必须有东西主动叫醒它，否则用户得再发一条消息才能看到结果。
//
// 为什么用独立模块而不是 prop 或 provide：画布面板与 AI 助手面板在工作区里是
// 兄弟组件，谁都不是谁的祖先，prop 与组件层级的 provide 都传不过去。
// 这里放一个进程内单例回调，助手挂载时注册、卸载时清空，画布面板读取后
// 再 provide 给节点（见 canvasHost.vue）。
//
// 用 shallowRef 而不是 ref：存的是函数，不需要（也不应该）被深层响应式包装。
export type canvasChangeNotifier = (label: string, kind: string, nodeId?: string) => void;

const notifier = shallowRef<canvasChangeNotifier>();

export function setCanvasChangeNotifier(next?: canvasChangeNotifier) {
  notifier.value = next;
}

export function getCanvasChangeNotifier() {
  return notifier.value;
}
