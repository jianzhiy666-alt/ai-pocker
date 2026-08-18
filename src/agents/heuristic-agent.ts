/** 启发式机器人：本地规则决策（离线演示 / LLM 失败回退） */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import { evaluate7 } from '../poker/evaluator.js';
import { RANK_VALUE } from '../poker/cards.js';

export interface HeuristicAgentOptions {
  id: string;
  name: string;
  seed?: number;
}

/** 翻前 Chen 公式牌力 */
function chenFormula(cards: { rank: string }[]): number {
  const values = cards.map((c) => RANK_VALUE[c.rank as keyof typeof RANK_VALUE]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  let score: number;
  if (high === low) {
    score = Math.max(5, 2 * highValue(high));
  } else {
    score = highValue(high);
    const gap = high - low;
    if (gap === 1) score += high >= 12 ? 3 : 2;
    else if (gap === 2) score += 2;
    else if (gap === 3) score += 1;
    if (score > 5 && gap > 1) score = Math.min(score, 5) + (gap > 1 ? 0 : 0);
  }
  return score;
}
function highValue(v: number): number {
  if (v === 14) return 10;
  if (v === 13) return 8;
  if (v === 12) return 7;
  if (v === 11) return 6;
  return v - 4;
}

export class HeuristicAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  readonly kind = 'heuristic' as const;
  readonly model = '启发式机器人';
  private rand: () => number;

  constructor(opts: HeuristicAgentOptions) {
    this.id = opts.id;
    this.name = opts.name;
    let s = opts.seed ?? 42;
    this.rand = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  async decide(ctx: DecisionRequest): Promise<Decision> {
    const noise = () => (this.rand() - 0.5) * 0.16;
    const legal = ctx.legalActions;
    const toCall = ctx.toCall;

    if (ctx.street === 'preflop') {
      const chen = chenFormula(ctx.holeCards) + noise();
      const inBB = ctx.position.includes('大盲');
      if (chen >= 9) return { action: legal.includes('raise') ? 'raise' : 'all_in', raiseTo: Math.round(ctx.minRaiseTo + (ctx.maxRaiseTo - ctx.minRaiseTo) * 0.35), reason: `翻前牌力强（Chen ${chen.toFixed(1)}），加注施压` };
      if (chen >= 6) {
        if (legal.includes('raise') && (ctx.position.includes('庄') || ctx.position.includes('关位')) && this.rand() < 0.6) {
          return { action: 'raise', raiseTo: Math.round(ctx.minRaiseTo), reason: `位置好且牌力不错（Chen ${chen.toFixed(1)}），偷盲加注` };
        }
        if (legal.includes('call')) return { action: 'call', reason: `中等牌力（Chen ${chen.toFixed(1)}），平跟进池` };
        return { action: 'check', reason: '中等牌力，过牌' };
      }
      if (chen >= 4) {
        const cheap = toCall <= ctx.bb;
        if (cheap) return { action: 'call', reason: `便宜看牌（跟 ${toCall}），牌力一般` };
        if (inBB && toCall === 0) return { action: 'check', reason: '大盲位免费看牌' };
        return { action: 'fold', reason: `牌力一般（Chen ${chen.toFixed(1)}），弃牌` };
      }
      if (inBB && toCall === 0) return { action: 'check', reason: '大盲位免费看牌' };
      if (inBB && toCall <= ctx.bb && this.rand() < 0.5) return { action: 'call', reason: '大盲位便宜补足，看一手' };
      return { action: 'fold', reason: `牌力弱（Chen ${chen.toFixed(1)}），直接弃牌` };
    }

    // 翻牌后：评估成牌强度
    const result = evaluate7([...ctx.holeCards, ...ctx.communityCards]);
    const strength = (result.category + 0.5) / 9 + noise(); // 0.06 ~ 0.94
    const pot = Math.max(1, ctx.pot);
    const potOdds = toCall / (pot + toCall);
    const callEV = strength - potOdds;

    if (strength >= 0.72) {
      if (legal.includes('raise')) {
        const target = Math.round(Math.min(ctx.maxRaiseTo, ctx.currentBet + Math.max(ctx.bb, Math.round(pot * 0.6))));
        return { action: target >= ctx.maxRaiseTo && this.rand() < 0.3 ? 'all_in' : 'raise', raiseTo: target, reason: `成牌很强（${result.name}），重注价值下注` };
      }
      return { action: 'call', reason: `成牌很强（${result.name}），跟注摊牌` };
    }
    if (strength >= 0.5) {
      if (legal.includes('check')) return { action: 'check', reason: `中等偏强（${result.name}），控池过牌` };
      if (callEV > -0.15) return { action: 'call', reason: `有摊牌价值（${result.name}），跟注` };
      return { action: 'fold', reason: `赔率不划算，弃牌` };
    }
    if (strength >= 0.32) {
      if (legal.includes('check')) return { action: 'check', reason: `弱成牌（${result.name}），免费看牌` };
      if (callEV > 0.02) return { action: 'call', reason: `底池赔率合适，博一博` };
      return { action: 'fold', reason: `牌力不足且赔率不佳（${result.name}），弃牌` };
    }
    if (legal.includes('check')) return { action: 'check', reason: `没成牌（${result.name}），免费看牌` };
    return { action: 'fold', reason: `没成牌（${result.name}），弃牌` };
  }
}
