/// <reference path="./types.d.ts" />

import deepSeek from "./src/language/deepSeek";
import apiMartLanguage from "./src/language/apiMart";
import apiMart from "./src/media/apiMart";
import meta from "./src/media/meta";

export type Provider = ProviderDefinition;
export type ProviderTools = ProviderContext["tool"];
export type AudioConvertOptions = Parameters<ProviderTools["audio"]["convert"]>[1];
export type { FfmpegFactory, FfmpegCommand } from "@toonflow/ffmpeg/types";

// ACT: 上游注册了三个媒体中转（tfRouter / apiMart / meta），其中 tfRouter 是
// Toonflow 自家的中转平台（api.toonflow.net），属于上游商业依赖，已移除。
// apiMart 是按需恢复的第三方供应商：媒体侧一家提供多个厂商的图片与视频模型
// （Seedance / Wan / MiniMax / Seedream / gpt-image / Nano banana），
// 文本侧是 OpenAI 兼容网关（GPT-5 / Claude / Gemini），便于不逐个直连厂商时选到不同模型。
// 其上游自带的返利注册链接与 toonflow 前缀痕迹已去除，readme 只保留官网地址。
// 若不再需要，删掉相应 import 与注册项、以及文件即可。
// 语言版与媒体版同名，这里用别名区分（名称冲突是唯一理由）。
export const languageProviders = [deepSeek, apiMartLanguage] as const;
export const mediaProviders = [apiMart, meta] as const;
