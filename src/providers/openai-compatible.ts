/** OpenAI 兼容 Chat Completions 适配器（OpenRouter / DashScope / DeepSeek / Gemini / xAI 全兼容） */

import OpenAI from 'openai';
import { ChatProvider, ChatMessage, ChatOptions } from './types.js';

export interface OpenAICompatibleConfig {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly label: string;
  private client: OpenAI;
  private model: string;

  constructor(cfg: OpenAICompatibleConfig) {
    this.label = cfg.label;
    this.model = cfg.model;
    this.client = new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      defaultHeaders: cfg.extraHeaders,
      maxRetries: 1,
      timeout: 60_000,
    });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const resp = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.9,
        max_tokens: opts.maxTokens ?? 700,
        stream: false,
      },
      { signal: opts.signal },
    );
    const text = resp.choices[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('模型返回空内容');
    return text;
  }
}
