/** provider 注册表：按名字创建 OpenAI 兼容适配器（key 缺失时返回 null） */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ChatProvider } from './types.js';

export type ProviderName = 'openrouter' | 'dashscope' | 'deepseek' | 'gemini' | 'xai';

interface ProviderDef {
  name: ProviderName;
  label: string;
  baseURL: string;
  envKey: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

export const PROVIDER_DEFS: Record<ProviderName, ProviderDef> = {
  openrouter: {
    name: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'qwen/qwen3-coder:free',
  },
  dashscope: {
    name: 'dashscope',
    label: 'DashScope (通义千问)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    envKey: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
  },
  deepseek: {
    name: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  gemini: {
    name: 'gemini',
    label: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
  },
  xai: {
    name: 'xai',
    label: 'xAI (Grok)',
    baseURL: 'https://api.x.ai/v1',
    envKey: 'XAI_API_KEY',
    defaultModel: 'grok-3-mini',
  },
};

/**
 * 创建 provider。model 可覆盖默认值（来自 players.json 配置）。
 * 若对应 API key 未配置，返回 null（上层应回退到启发式机器人）。
 */
export function createProvider(name: string, model?: string): ChatProvider | null {
  const def = PROVIDER_DEFS[name as ProviderName];
  if (!def) return null;
  const apiKey = process.env[def.envKey];
  if (!apiKey) return null;
  return new OpenAICompatibleProvider({
    label: `${def.label} / ${model ?? def.defaultModel}`,
    baseURL: def.baseURL,
    apiKey,
    model: model ?? def.defaultModel,
    extraHeaders: def.extraHeaders,
  });
}

export const providerDisplayName = (name: string): string => PROVIDER_DEFS[name as ProviderName]?.label ?? name;
