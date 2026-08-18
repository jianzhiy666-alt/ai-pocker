/** LLM 智能体：把牌局渲染成文本给大模型，解析 JSON 决策，失败时重试并回退启发式 */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { buildSystemPrompt, renderState, parseDecision, sanitizeDecision } from './prompt.js';
import type { ChatMessage, ChatProvider } from '../providers/types.js';
import { HeuristicAgent } from './heuristic-agent.js';
import { RenameContext, RenameReason, randomNameFromPool, sanitizeName, ensureUnique } from './rename.js';

export interface LLMAgentOptions {
  id: string;
  name: string;
  provider: ChatProvider;
  persona?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const RENAME_SITUATION_CN: Record<RenameReason, (amount?: number) => string> = {
  big_win: (amount) => `你刚刚一口气赢了 ${amount ?? '一大笔'} 筹码的底池，感觉自己就是天命之子。`,
  busted: () => '你刚刚筹码清零，被淘汰出局了。这是你这一世的谢幕时刻。',
  champion: () => '你刚刚赢得了整场锦标赛的冠军，站上了巅峰！',
};

export class LLMAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  currentName: string;
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
    this.currentName = opts.name;
    this.provider = opts.provider;
    this.persona = opts.persona;
    this.model = opts.provider.label;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fallback = new HeuristicAgent({ id: opts.id, name: opts.name });
  }

  async decide(ctx: DecisionRequest): Promise<Decision> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.currentName, this.persona) },
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

  /** 让大模型给自己起个新名字；失败则用词库兜底 */
  async rename(reason: RenameReason, ctx: RenameContext): Promise<string> {
    const situation = RENAME_SITUATION_CN[reason](ctx.amount);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是一个有性格的 AI 德州扑克玩家。请根据下面描述的情况，给自己起一个新名字：要有梗、贴合此刻的心情或战绩、2~6 个中文字符（允许字母数字和少量符号如 ·）。只输出一个 JSON 对象：{"name": "新名字"}，不要输出其他内容。',
      },
      { role: 'user', content: `你现在的名字叫「${ctx.oldName}」。${situation}\n请输出 JSON。` },
    ];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const text = await this.provider.chat(messages, { temperature: 1.1, maxTokens: 60, signal: controller.signal });
        const name = extractNameFromJson(text);
        const clean = sanitizeName(name ?? '');
        if (clean) return ensureUnique(clean, ctx.takenNames ?? [], Math.random);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 超时/失败：词库兜底
    }
    return ensureUnique(randomNameFromPool(Math.random), ctx.takenNames ?? [], Math.random);
  }
}

/** 从模型回复里提取 {"name": "..."} 中的名字 */
function extractNameFromJson(text: string): string | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const m = cleaned.match(/"name"\s*:\s*"([^"]+)"/);
  return m ? (m[1] ?? null) : null;
}
