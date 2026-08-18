/** OpenAI 兼容 Chat Completions 适配器（OpenRouter / DashScope / DeepSeek / Gemini / xAI 全兼容） */

import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ChatProvider, ChatMessage, ChatOptions } from './types.js';

export interface OpenAICompatibleConfig {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 本地代理地址，如 http://127.0.0.1:7890 */
  proxy?: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly label: string;
  private client: OpenAI;
  private model: string;

  constructor(cfg: OpenAICompatibleConfig) {
    this.label = cfg.label;
    this.model = cfg.model;
    const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      defaultHeaders: cfg.extraHeaders,
      maxRetries: 1,
      timeout: 90_000,
    };
    if (cfg.proxy) {
      // 统一走本地代理（VPN/ClashX），绕开网络区域限制（Gemini 需美国节点）
      const agent = new HttpsProxyAgent(cfg.proxy);
      clientOpts.httpAgent = agent;
    }
    this.client = new OpenAI(clientOpts);
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
