/** LLM 智能体：取名 + 扑克决策 + 每手一句嘴炮（各自独立调用） */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { buildSystemPrompt, renderState, parseDecision, sanitizeDecision } from './prompt.js';
import type { ChatMessage, ChatProvider } from '../providers/types.js';
import { HeuristicAgent } from './heuristic-agent.js';
import { nameWithProvider } from './identity.js';
import { TalkContext, buildTalkSystemPrompt, buildTalkUserPrompt, parseTalk, talkFromPool } from './talk.js';

export interface LLMAgentOptions {
  id: string;
  name: string;
  provider: ChatProvider;
  timeoutMs?: number;
  maxRetries?: number;
}

export class LLMAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  currentName: string;
  readonly kind = 'llm' as const;
  readonly model: string;
  private provider: ChatProvider;
  private timeoutMs: number;
  private maxRetries: number;
  private fallback: HeuristicAgent;

  constructor(opts: LLMAgentOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.currentName = opts.name;
    this.provider = opts.provider;
    this.model = opts.provider.label;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fallback = new HeuristicAgent({ id: opts.id, name: opts.name });
  }

  /** 取名 Phase：模型自己取 Poker Name（只问一次） */
  async createIdentity(): Promise<string> {
    const name = await nameWithProvider(this.provider, this.timeoutMs, Math.random);
    this.currentName = name;
    return name;
  }

  async decide(ctx: DecisionRequest): Promise<Decision> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.currentName) },
      { role: 'user', content: renderState(ctx) },
    ];
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const text = await this.provider.chat(messages, { temperature: 0.2, maxTokens: 200, signal: controller.signal });
          const parsed = parseDecision(text);
          if (parsed) return sanitizeDecision(ctx, parsed);
          if (attempt < this.maxRetries) {
            messages.push({ role: 'assistant', content: text });
            messages.push({ role: 'user', content: '你刚才的输出不是合法 JSON。请只输出：{"action": "...", "amount_bb": 数字, "reason": "可选"}' });
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries) {
          messages.push({ role: 'user', content: `上一步出错（${msg}），请重新输出 JSON 决策。` });
        } else {
          return this.fallback.decide(ctx);
        }
      }
    }
    return this.fallback.decide(ctx);
  }

  /** 每手结束说一句话（纯给观众看） */
  async talk(ctx: TalkContext): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildTalkSystemPrompt(this.currentName) },
      { role: 'user', content: buildTalkUserPrompt(ctx) },
    ];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const text = await this.provider.chat(messages, { temperature: 1.0, maxTokens: 60, signal: controller.signal });
        const msg = parseTalk(text);
        if (msg) return msg;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 失败走词库
    }
    return talkFromPool(Math.random);
  }
}
