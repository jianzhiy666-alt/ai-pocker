/** LLM 对话接口抽象 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatProvider {
  /** 展示名，如 "OpenRouter / qwen3-coder" */
  readonly label: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}
