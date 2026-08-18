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

  /** 健康检查：模型是否可用（启动时探测；给推理型模型留足时间） */
  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        await this.provider.chat([{ role: 'user', content: 'ping' }], { maxTokens: 5, signal: controller.signal });
        return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
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
          // 推理型模型（minimax/longcat 等）的 reasoning 会占用大量 token，给足预算
          // 温度 1.0：决策更富变化、更有进攻性
          const text = await this.provider.chat(messages, { temperature: 1.0, maxTokens: 2500, signal: controller.signal });
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
          console.warn(`[${this.name}] 模型调用失败(${msg})，本轮由启发式机器人接管`);
          return this.markFallback(await this.fallback.decide(ctx));
        }
      }
    }
    console.warn(`[${this.name}] 连续多次未输出合法 JSON，由启发式机器人接管`);
    return this.markFallback(await this.fallback.decide(ctx));
  }

  /** 标记启发式接管，避免观众误以为是模型自己的思考 */
  private markFallback(d: Decision): Decision {
    if (d.reason) d.reason = `[超时·机器人接管] ${d.reason}`;
    else d.reason = '[超时·机器人接管]';
    return d;
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
        const text = await this.provider.chat(messages, { temperature: 1.0, maxTokens: 200, signal: controller.signal });
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
