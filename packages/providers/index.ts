/// <reference path="./types.d.ts" />

import deepSeek from "./src/language/deepSeek";
import meta from "./src/media/meta";

export type Provider = ProviderDefinition;
export type ProviderTools = ProviderContext["tool"];
export type AudioConvertOptions = Parameters<ProviderTools["audio"]["convert"]>[1];
export type { FfmpegFactory, FfmpegCommand } from "@toonflow/ffmpeg/types";

// ACT: 只保留厂商直连的供应商。原先这里注册了三个第三方中转服务
// （tfRouter / apiMart / meta），它们会把请求发往外部托管平台，属于上游的商业依赖，
// 本产品不接任何中转：用户自己填 API Key，请求直接到厂商。
export const languageProviders = [deepSeek] as const;
export const mediaProviders = [meta] as const;
