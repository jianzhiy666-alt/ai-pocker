/** 启发式机器人：本地规则决策（离线演示 / LLM 失败回退）
 *
 * v0.2 增强：翻前位置范围 / 3-bet / 短码推弃 / 大盲防守；
 * 翻后按成牌强度与牌面湿润度选择下注尺度、听牌半诈唬、诈唬频率随对手松紧调整。
 */

import { PlayerAgent } from './types.js';
import { Decision, DecisionRequest } from '../poker/game.js';
import type { ActionType } from '../poker/game.js';
import { evaluate7 } from '../poker/evaluator.js';
import { RANK_VALUE } from '../poker/cards.js';
import { analyzeDraws } from './skill-library.js';
import { nameFromPool, ensureUniqueName } from './identity.js';
import { TalkContext, talkFromPool } from './talk.js';

export interface HeuristicAgentOptions {
  id: string;
  name: string;
  seed?: number;
}

/** 翻前 Chen 公式牌力（标准版：大牌差扣分、同花加分，避免 A-垃圾牌虚高） */
function chenFormula(cards: { rank: string; suit?: string }[]): number {
  const values = cards.map((c) => RANK_VALUE[c.rank as keyof typeof RANK_VALUE]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const suited = cards.length === 2 && cards[0]!.suit === cards[1]!.suit;
  let score: number;
  if (high === low) {
    score = Math.max(5, 2 * highValue(high));
  } else {
    score = highValue(high);
    const gap = high - low;
    if (gap === 1) score += high >= 12 ? 3 : 2;
    else if (gap === 2) score += 2;
    else if (gap === 3) score += 1;
    else if (gap >= 4) score -= 5; // 大牌差严重扣分（A2 不再是"强牌"）
    if (suited) score += 2;
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

/** 同牌型内的相对强弱（0~1），用于把牌力分成更细的档 */
const BASE5 = 15 ** 5;
function withinCategory(result: { score: number }): number {
  return (result.score % BASE5) / BASE5;
}

/** 牌力标尺：近似对随机手牌的胜率（0~1），顶对 ≈0.5，两对 ≈0.6，三条 ≈0.7，顺子 ≈0.8… */
const CAT_BASE = [0.06, 0.32, 0.56, 0.70, 0.80, 0.86, 0.92, 0.97, 0.995];
const CAT_SPAN = [0.26, 0.24, 0.14, 0.10, 0.06, 0.06, 0.05, 0.025, 0.005];
function handStrength(result: { category: number; score: number }): number {
  return CAT_BASE[result.category]! + withinCategory(result) * CAT_SPAN[result.category]!;
}

/** 位置分层：后位（可偷盲/下注），其余为中前位 */
function isLatePosition(position: string): boolean {
  return position.includes('庄') || position.includes('关位');
}
function isBlind(position: string): boolean {
  return position.includes('小盲') || position.includes('大盲');
}

export class HeuristicAgent implements PlayerAgent {
  readonly id: string;
  readonly name: string;
  currentName: string;
  readonly kind = 'heuristic' as const;
  readonly model = '启发式机器人';
  private rand: () => number;

  constructor(opts: HeuristicAgentOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.currentName = opts.name;
    let s = opts.seed ?? 42;
    this.rand = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  async createIdentity(): Promise<string> {
    this.currentName = nameFromPool(this.rand);
    return this.currentName;
  }

  async talk(ctx: TalkContext): Promise<string> {
    // 30% 概率保持沉默
    if (this.rand() < 0.3) return '';
    return talkFromPool(this.rand, ctx.outcome);
  }

  async decide(ctx: DecisionRequest): Promise<Decision> {
    const legal = ctx.legalActions;
    const toCall = ctx.toCall;
    const effBB = (ctx.stack + ctx.committed) / ctx.bb; // 有效筹码（BB）
    const inPos = isLatePosition(ctx.position);
    const inBB = ctx.position.includes('大盲');
    const noise = () => (this.rand() - 0.5) * 0.14;

    // 对手松紧（VPIP 高=松，低=紧）：松桌少诈唬多拿价值，紧桌多偷池
    const opps = (ctx.opponentStats ?? []).filter((s) => s.hands > 0);
    const avgVPIP = opps.length ? opps.reduce((a, s) => a + s.vpip, 0) / opps.length : 40;
    const looseTable = avgVPIP >= 45;
    const tightTable = avgVPIP < 28;

    if (ctx.street === 'preflop') return this.preflop(ctx, legal, toCall, effBB, inPos, inBB, looseTable, tightTable, noise);
    return this.postflop(ctx, legal, toCall, effBB, inPos, looseTable, tightTable, noise);
  }

  /* ================= 翻前 ================= */
  private preflop(
    ctx: DecisionRequest,
    legal: ActionType[],
    toCall: number,
    effBB: number,
    inPos: boolean,
    inBB: boolean,
    looseTable: boolean,
    tightTable: boolean,
    noise: () => number,
  ): Decision {
    const chen = chenFormula(ctx.holeCards) + noise();
    const bb = ctx.bb;
    const fold = (why: string): Decision => ({ action: 'fold', reason: why });
    const check = (why: string): Decision => ({ action: 'check', reason: why });
    const isPair = ctx.holeCards[0]!.rank === ctx.holeCards[1]!.rank;
    const hasAce = ctx.holeCards.some((c) => c.rank === 'A');
    const toCallBB = toCall / bb;
    // 修正后的 Chen：AA/KK/QQ/JJ/TT/AK/AQ 等强牌 ≥ 8
    const premium = chen >= 8;

    // —— 短码：推/弃模式（有效筹码 ≤ 12 BB） ——
    if (effBB <= 12) {
      const pushable = effBB <= 8
        ? chen >= 4.5 || isPair || hasAce // 8 BB 以下：对子、A 高、中强牌都推
        : chen >= 7 || isPair && chen >= 6; // 8~12 BB：收紧到强牌
      if (pushable && legal.includes('all_in')) {
        return { action: 'all_in', reason: `短码 ${effBB.toFixed(0)} BB，牌力够（Chen ${chen.toFixed(1)}），直接推全下` };
      }
      if (inBB && toCall === 0) return check('短码大盲位免费看牌');
      if (toCall === 0) return check('短码未有人加注，过牌');
      // 面对加注：便宜跟注看牌（对子/好牌），否则弃牌
      if (toCallBB <= 2.5 && (isPair || chen >= 5)) return { action: 'call', reason: `短码便宜补足（跟 ${toCallBB.toFixed(1)} BB），看翻牌` };
      return fold(`短码 ${effBB.toFixed(0)} BB 牌力不足（Chen ${chen.toFixed(1)}），弃牌`);
    }

    // —— 无人加注（过牌或开池） ——
    if (toCall === 0) {
      if (premium) {
        return this.raiseTo(ctx, Math.max(ctx.minRaiseTo, Math.round(3 * bb)), `起手强（Chen ${chen.toFixed(1)}），标准开池加注`);
      }
      if (chen >= 5.5) {
        if (inPos) return this.raiseTo(ctx, Math.max(ctx.minRaiseTo, Math.round(2.5 * bb)), `位置好且牌力不错（Chen ${chen.toFixed(1)}），开池偷盲`);
        return check(`中等牌力（Chen ${chen.toFixed(1)}），中前位过牌控池`);
      }
      if (inPos && this.rand() < (tightTable ? 0.25 : 0.12)) {
        return this.raiseTo(ctx, Math.max(ctx.minRaiseTo, Math.round(2.5 * bb)), `后位偷盲（Chen ${chen.toFixed(1)}），紧桌多偷池`);
      }
      return check(`牌力一般（Chen ${chen.toFixed(1)}），过牌看翻牌`);
    }

    // —— 面对加注 ——
    // 本街已发生的加注次数：1=开池(2-bet)，2=3-bet，3+=4-bet 及以上 → 决定加注大战何时收手
    const raiseCount = ctx.actionHistory.filter((a) => a.includes('加注到') || a.includes('全下')).length;
    const threeBet = (scale: number, why: string): Decision =>
      this.raiseTo(ctx, Math.round(Math.min(ctx.maxRaiseTo, toCall * scale)), why);

    // 面对 3-bet 及以上（此前已有人再加注）：只有 QQ+/AK 级别继续，中等强牌平跟或弃牌，避免加注大战
    if (raiseCount >= 2) {
      if (chen >= 12) {
        if (effBB <= 15 && legal.includes('all_in')) {
          return { action: 'all_in', reason: `超强牌（Chen ${chen.toFixed(1)}）面对再加注 + 浅码，直接全下` };
        }
        return threeBet(2.6, `超强牌（Chen ${chen.toFixed(1)}），4-bet 反击`);
      }
      if (chen >= 7 && toCallBB <= 8) {
        return { action: 'call', reason: `面对再加注，中等强牌（Chen ${chen.toFixed(1)}）平跟看翻牌` };
      }
      return fold(`面对再加注牌力不足（Chen ${chen.toFixed(1)}），弃牌`);
    }

    if (premium) {
      if (effBB <= 15 && toCallBB >= effBB / 2 && legal.includes('all_in')) {
        return { action: 'all_in', reason: `强牌（Chen ${chen.toFixed(1)}）且筹码浅，直接全下反推` };
      }
      return threeBet(3.2, `对手开池，我 3-bet 施压（Chen ${chen.toFixed(1)}）`);
    }
    if (chen >= 6.5) {
      if (inPos || looseTable) return threeBet(2.8, `牌力不错（Chen ${chen.toFixed(1)}）且位置好，3-bet 施压`);
      if (toCallBB <= 3) return { action: 'call', reason: `牌力不错（Chen ${chen.toFixed(1)}），平跟进池` };
      return fold(`跟注成本高（${toCallBB.toFixed(1)} BB），中等偏强牌弃牌`);
    }
    if (chen >= 4.5) {
      const cheap = toCallBB <= 3;
      if (cheap && (inPos || inBB)) return { action: 'call', reason: `便宜跟注（${toCallBB.toFixed(1)} BB），牌力中等` };
      return fold(`面对加注牌力不足（Chen ${chen.toFixed(1)}），弃牌`);
    }
    // 大盲防守：小额补足时放宽范围（对子/同花连牌/A 高）
    if (inBB && toCallBB <= 2.5 && (isPair || hasAce || chen >= 3.5)) {
      return { action: 'call', reason: `大盲位便宜防守（跟 ${toCallBB.toFixed(1)} BB）` };
    }
    // 偶尔诈唬 3-bet（紧桌对紧手施压）
    if (tightTable && inPos && this.rand() < 0.06) {
      return threeBet(3, `紧桌诈唬 3-bet 施压（Chen ${chen.toFixed(1)}）`);
    }
    return fold(`牌力弱（Chen ${chen.toFixed(1)}），弃牌`);
  }

  /* ================= 翻后 ================= */
  private postflop(
    ctx: DecisionRequest,
    legal: ActionType[],
    toCall: number,
    effBB: number,
    inPos: boolean,
    looseTable: boolean,
    tightTable: boolean,
    noise: () => number,
  ): Decision {
    const result = evaluate7([...ctx.holeCards, ...ctx.communityCards]);
    const bb = ctx.bb;
    const strength = handStrength(result) + noise(); // 顶对≈0.5，两对≈0.6，三条≈0.7，顺子≈0.8…
    const pot = Math.max(1, ctx.pot);
    const potOdds = toCall / (pot + toCall);
    const draws = analyzeDraws(ctx.holeCards, ctx.communityCards);
    const streetsToCome = ctx.street === 'flop' ? 2 : 1;
    const drawEquity = Math.min(0.9, (draws.totalOuts * (streetsToCome * 2) + 1) / 100); // 翻牌 ~4%/out，转牌 ~2%/out
    const equity = Math.max(strength, drawEquity);
    const callEV = equity - potOdds;

    // 牌面湿润度：三同花或三连张 → 对手更可能成牌/听牌，下注要重、诈唬要少
    const suitCounts = new Map<string, number>();
    for (const c of ctx.communityCards) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    const flushDrawOnBoard = [...suitCounts.values()].some((n) => n >= 3);
    const ranks = [...new Set(ctx.communityCards.map((c) => RANK_VALUE[c.rank]))].sort((a, b) => a - b);
    let straightPossible = false;
    for (let i = 0; i + 2 < ranks.length; i++) {
      if (ranks[i + 2]! - ranks[i]! === 2 && new Set(ranks.slice(i, i + 3)).size === 3) { straightPossible = true; break; }
    }
    const wet = flushDrawOnBoard || straightPossible;

    // 下注目标 = 当前下注 + 底池 × fraction（夹在合法加注区间）
    const betTo = (fraction: number): number =>
      Math.max(ctx.minRaiseTo, Math.min(ctx.maxRaiseTo, Math.round(ctx.currentBet + pot * fraction)));
    const raiseBet = (fraction: number, why: string): Decision =>
      legal.includes('raise')
        ? { action: 'raise', raiseTo: betTo(fraction), reason: why }
        : { action: 'call', reason: `无法加注：${why}（只能跟注）` };
    const fold = (why: string): Decision => ({ action: 'fold', reason: why });

    // 面对下注（toCall > 0）
    if (toCall > 0) {
      // 加注几乎等于全下时按全下处理
      const committing = toCall >= effBB * bb * 0.9;
      if (committing) {
        if (strength >= 0.62 || draws.totalOuts >= 8) {
          return legal.includes('all_in') ? { action: 'all_in', reason: `跟注会套池，${result.name} 直接全下` } : { action: 'call', reason: `跟注会套池，但牌力够，全跟` };
        }
        return fold(`对手重注套池，${result.name} 不够强，弃牌`);
      }
      if (strength >= 0.85) return raiseBet(wet ? 0.85 : 0.7, `${result.name} 极强，加注拿最大价值`);
      if (strength >= 0.7) return raiseBet(wet ? 0.75 : 0.6, `${result.name} 强牌，加注价值下注`);
      if (strength >= 0.5) {
        if (callEV > -0.15) return { action: 'call', reason: `${result.name} 有摊牌价值且赔率尚可，跟注` };
        return fold(`${result.name} 赔率不划算，弃牌`);
      }
      // 弱牌：强听牌/便宜卡顺按赔率跟，偶尔诈唬加注
      if (draws.totalOuts >= 8 && callEV > -0.05) return { action: 'call', reason: `强听牌（${draws.totalOuts} outs，约 ${(drawEquity * 100).toFixed(0)}%），赔率合适跟注` };
      if (draws.totalOuts >= 4 && toCall <= ctx.bb && callEV > -0.05) return { action: 'call', reason: `便宜卡顺/后门听（${draws.totalOuts} outs），跟注博一张` };
      if (tightTable && strength < 0.3 && this.rand() < 0.06) return raiseBet(0.6, `对手示弱我诈唬加注（${result.name}）`);
      return fold(`${result.name} 没成牌且赔率差，弃牌`);
    }

    // 无人下注（免费看牌）
    if (strength >= 0.75) {
      if (effBB <= 12 && legal.includes('all_in')) return { action: 'all_in', reason: `${result.name} 强牌 + 短码，直接全下` };
      return raiseBet(wet ? 0.75 : 0.6, `${result.name} 强牌，价值下注`);
    }
    if (strength >= 0.52) {
      if (inPos) return raiseBet(0.45, `${result.name} 顶对/两对级牌力，有位置下注保护`);
      return { action: 'check', reason: `${result.name} 中等偏强，无位置控池过牌` };
    }
    if (draws.totalOuts >= 8 && (inPos || this.rand() < 0.45)) {
      return raiseBet(0.5, `强听牌半诈唬（${draws.totalOuts} outs）`);
    }
    if (strength >= 0.35) return { action: 'check', reason: `${result.name} 弱成牌，免费看牌` };
    // 空气：单挑/紧桌/位置好时偷池
    const headsUp = ctx.players.filter((p) => !p.folded && p.id !== ctx.playerId).length <= 1;
    if ((headsUp || (inPos && tightTable)) && this.rand() < (looseTable ? 0.15 : 0.35)) {
      return raiseBet(0.5, `没成牌，${headsUp ? '单挑' : '对手紧'}，诈唬偷池`);
    }
    return { action: 'check', reason: `没成牌（${result.name}），免费看牌` };
  }

  private raiseTo(ctx: DecisionRequest, target: number, why: string): Decision {
    if (!ctx.legalActions.includes('raise')) return { action: ctx.toCall > 0 ? 'call' : 'check', reason: why };
    const t = Math.max(ctx.minRaiseTo, Math.min(target, ctx.maxRaiseTo));
    if (t >= ctx.maxRaiseTo) return { action: 'all_in', reason: why };
    return { action: 'raise', raiseTo: t, reason: why };
  }
}

export { ensureUniqueName };