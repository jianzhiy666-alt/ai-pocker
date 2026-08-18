/** 人类玩家智能体：决策挂起等待 UI 输入（人机同桌对战） */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { TalkContext } from './talk.js';

export class HumanAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  currentName: string;
  readonly kind = 'human' as const;
  readonly model = '人类玩家';
  /** 当前等待人类决策的上下文（服务器提交决策时用于校验） */
  currentCtx: DecisionRequest | null = null;
  private resolver: ((d: Decision) => void) | null = null;

  constructor(opts: { id: string; name: string }) {
    this.id = opts.id;
    this.name = opts.name;
    this.currentName = opts.name;
  }

  async createIdentity(): Promise<string> {
    return this.currentName; // 人类不需要 AI 取名
  }

  /** 挂起等待 UI 提交决策 */
  decide(ctx: DecisionRequest): Promise<Decision> {
    this.currentCtx = ctx;
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** UI 提交决策（服务器调用） */
  submit(decision: Decision): boolean {
    if (!this.resolver) return false;
    this.resolver(decision);
    this.resolver = null;
    this.currentCtx = null;
    return true;
  }

  /** 暂停/停止时兜底：不再等待人类 */
  cancel(): void {
    if (!this.resolver) return;
    const ctx = this.currentCtx;
    this.resolver({ action: ctx && ctx.toCall > 0 ? 'fold' : 'check' });
    this.resolver = null;
    this.currentCtx = null;
  }

  async talk(_ctx: TalkContext): Promise<string> {
    return '';
  }
}
