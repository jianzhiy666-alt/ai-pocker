/** 人类玩家智能体：决策挂起等待 UI 输入（人机同桌对战；支持多真人座位） */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { TalkContext } from './talk.js';

export interface HumanAgentOptions {
  id: string;
  name: string;
  /** 单次操作超时（毫秒），超时自动弃牌/过牌（防真人离席卡死比赛） */
  timeoutMs?: number;
}

export class HumanAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  currentName: string;
  readonly kind = 'human' as const;
  readonly model = '人类玩家';
  /** 当前等待人类决策的上下文（服务器提交决策时用于校验） */
  currentCtx: DecisionRequest | null = null;
  private resolver: ((d: Decision) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private timeoutMs: number;

  constructor(opts: HumanAgentOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.currentName = opts.name;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
  }

  async createIdentity(): Promise<string> {
    return this.currentName; // 人类不需要 AI 取名
  }

  /** 挂起等待 UI 提交决策；超时（真人离席）自动弃牌/过牌，保证比赛不被卡死 */
  decide(ctx: DecisionRequest): Promise<Decision> {
    this.currentCtx = ctx;
    this.clearTimer();
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.timer = setTimeout(() => {
        if (!this.resolver) return;
        const auto = ctx.toCall > 0 ? 'fold' : 'check';
        console.warn(`[${this.name}] 人类玩家 ${this.timeoutMs / 1000}s 未操作，自动${auto === 'fold' ? '弃牌' : '过牌'}`);
        this.resolve({ action: auto, reason: `⏰ 操作超时，自动${auto === 'fold' ? '弃牌' : '过牌'}` });
      }, this.timeoutMs);
    });
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private resolve(decision: Decision): void {
    this.clearTimer();
    if (!this.resolver) return;
    this.resolver(decision);
    this.resolver = null;
    this.currentCtx = null;
  }

  /** UI 提交决策（服务器调用） */
  submit(decision: Decision): boolean {
    if (!this.resolver) return false;
    this.resolve(decision);
    return true;
  }

  /** 暂停/停止时兜底：不再等待人类 */
  cancel(): void {
    if (!this.resolver) return;
    const ctx = this.currentCtx;
    this.resolve({ action: ctx && ctx.toCall > 0 ? 'fold' : 'check' });
  }

  async talk(_ctx: TalkContext): Promise<string> {
    return '';
  }
}
