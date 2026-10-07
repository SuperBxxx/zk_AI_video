import type { NodeSemanticValue } from "@toonflow/post-production";

export type NodeMediaValue = { url: string; mimeType: string };

/**
 * 语义时刻的载荷：一组**带身份的时间段**。
 *
 * ACT: 与那 8 种值类型**并列**，不是它们的一员 —— 它不是素材、没有 url。
 * 为什么要让它能在画布上流动：复刻时下游需要的不是「参考片第 4 秒」，
 * 而是「哪一下、由哪些词构成、在当前脚本里解出多长」。
 * 参考片的秒数换个脚本就没有意义（这正是阶段 2 要解决的问题）。
 */
export type NodeSemanticPayload = NodeSemanticValue;

export type NodeValueMap = {
  STRING: string;
  INT: number;
  FLOAT: number;
  BOOLEAN: boolean;
  IMAGE: NodeMediaValue;
  MASK: NodeMediaValue;
  VIDEO: NodeMediaValue;
  AUDIO: NodeMediaValue;
  SEMANTIC: NodeSemanticPayload;
};

export type NodeOutput = {
  [type in keyof NodeValueMap]: { dataType: type; value: NodeValueMap[type] }
}[keyof NodeValueMap];

export type NodeOutputs = Record<string, NodeOutput | undefined>;
export type NodeInputValue = (NodeOutput | { dataType: string | string[]; value: undefined }) & { source: string; sourceHandle: string };

export function isNodeOutput(output: unknown): output is NodeOutput {
  if (!output || typeof output !== "object" || !("dataType" in output) || !("value" in output)) return false;
  const { dataType, value } = output;
  switch (dataType) {
    case "STRING": return typeof value === "string";
    case "BOOLEAN": return typeof value === "boolean";
    case "INT": return typeof value === "number" && Number.isSafeInteger(value);
    case "FLOAT": return typeof value === "number" && Number.isFinite(value);
    case "IMAGE":
    case "MASK":
    case "VIDEO":
    case "AUDIO": {
      const mediaType = dataType === "MASK" ? "image" : dataType.toLowerCase();
      return !!value && typeof value === "object" && "url" in value && typeof value.url === "string" && !!value.url.trim()
        && "mimeType" in value && typeof value.mimeType === "string" && value.mimeType.startsWith(`${mediaType}/`)
        && value.mimeType.length > mediaType.length + 1;
    }
    case "SEMANTIC": {
      // ACT: 这里只校验**形状**（有 scriptId、moments 是数组、每项有 anchor）——
      // 不校验锚点在不在词表里：那会让"词表升级前存下的画布"直接打不开，
      // 而锚点是否合法由产生它的工具负责（见 checkSemanticMoment）。
      if (!value || typeof value !== "object") return false;
      const candidate = value as { scriptId?: unknown; moments?: unknown };
      if (typeof candidate.scriptId !== "string" || !Array.isArray(candidate.moments)) return false;
      return candidate.moments.every(moment =>
        !!moment && typeof moment === "object" && typeof (moment as { anchor?: unknown }).anchor === "string");
    }
    default: return false;
  }
}
