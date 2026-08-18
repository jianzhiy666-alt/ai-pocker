/** LLM 智能体：把牌局渲染成文本给大模型，解析 JSON 决策，失败时重试并回退启发式 */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { buildSystemPrompt, renderState, parseDecision, sanitizeDecision } from './prompt.js';
import type { ChatMessage, ChatProvider } from '../providers/types.js';
import { HeuristicAgent } from './heuristic-agent.js';

export interface LLMAgentOptions {
  id: string;
  name: string;
  provider: ChatProvider;
  persona?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class LLMAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  readonly kind = 'llm' as const;
  readonly model: string;
  private provider: ChatProvider;
  private persona?: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fallback: HeuristicAgent;

  constructor(opts: LLMAgentOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.provider = opts.provider;
    this.persona = opts.persona;
    this.model = opts.provider.label;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fallback = new HeuristicAgent({ id: opts.id, name: opts.name });
  }

  async decide(ctx: DecisionRequest): Promise<Decision> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.name, this.persona) },
      { role: 'user', content: renderState(ctx) },
    ];
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const text = await this.provider.chat(messages, { temperature: 0.9, maxTokens: 600, signal: controller.signal });
          const parsed = parseDecision(text);
          if (parsed) return sanitizeDecision(ctx, parsed);
          if (attempt < this.maxRetries) {
            messages.push({ role: 'assistant', content: text });
            messages.push({ role: 'user', content: '你刚才的输出不是合法 JSON 决策对象。请只输出一个 JSON 对象：{"action": "...", "raiseTo": 数字或null, "reason": "..."}' });
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries) {
          messages.push({ role: 'user', content: `上一步出错（${msg}），请重新输出 JSON 决策。` });
        } else {
          // 超时/连续失败：回退启发式
          return this.fallback.decide(ctx);
        }
      }
    }
    return this.fallback.decide(ctx);
  }
}
