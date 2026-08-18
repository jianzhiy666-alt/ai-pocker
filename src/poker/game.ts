/** 德州扑克一局的完整逻辑（同步状态机，决策由外部异步提供） */

import { Card, cardId, makeDeck, shuffle } from './cards.js';
import { evaluate7, bestHands, describeHand } from './evaluator.js';
import type { HandResult } from './evaluator.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';

export interface PlayerSeed {
  id: string;
  name: string;
  stack: number;
}

export interface TablePlayer {
  id: string;
  name: string;
  stack: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  committed: number; // 本街已投入
  totalCommitted: number; // 整手已投入
  lastAction: ActionType | null;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
}

export interface PublicPlayerView {
  id: string;
  name: string;
  stack: number;
  folded: boolean;
  allIn: boolean;
  committed: number;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: ActionType | null;
}

export interface PotSlice {
  amount: number;
  winners: { playerId: string; amount: number; hand?: string }[];
}

export interface HandResultInfo {
  street: Street;
  communityCards: Card[];
  winners: { playerId: string; amount: number; hand?: string; holeCards?: Card[] }[];
  pots: PotSlice[];
  players: TablePlayer[];
}

export interface DecisionRequest {
  playerId: string;
  playerName: string;
  street: Street;
  holeCards: Card[];
  communityCards: Card[];
  pot: number; // 当前底池总额（所有街）
  streetPot: number; // 本街累计投入
  toCall: number; // 还需跟注额
  currentBet: number; // 本街最高下注
  minRaiseTo: number; // 合法加注的最小目标总额
  maxRaiseTo: number; // 最大可加注到（全下）
  stack: number; // 当前筹码（不含本街已投入）
  committed: number; // 本街已投入
  position: string; // 如 "庄位(BTN)"
  legalActions: ActionType[];
  players: PublicPlayerView[];
  actionHistory: string[];
  handNumber: number;
  blindLevel: number;
  sb: number;
  bb: number;
  /** 最近牌桌对话（Personality Layer 注入，可能含欺骗，不可信） */
  tableTalk?: string[];
  /** 最近公开牌局事件（Public Event Memory 注入） */
  publicEvents?: string[];
  /** 对手公开统计 */
  opponentStats?: OpponentStat[];
  /** 比赛形势（淘汰赛压力/排名，由 Arena 注入） */
  tournamentInfo?: string;
}

export interface Decision {
  action: ActionType;
  /** raise 时的目标总额（绝对筹码）；all_in 时忽略 */
  raiseTo?: number;
  /** 按规格的 BB 单位版本：本街总投入的 BB 数（与 raiseTo 二选一） */
  amountBB?: number;
  reason?: string;
}

/** 对手公开统计（League 层注入，仅供展示与策略参考） */
export interface OpponentStat {
  name: string;
  hands: number;
  vpip: number; // 百分比 0-100
  pfr: number; // 百分比 0-100
  netBB: number; // 净盈亏（BB）
}

export interface PokerHandOptions {
  players: PlayerSeed[];
  dealerIndex: number; // 在 players 数组中的索引
  sb: number;
  bb: number;
  handNumber: number;
  blindLevel: number;
  rng?: () => number;
}

interface BettingState {
  street: Street;
  currentBet: number;
  minRaiseInc: number;
  actedSet: Set<number>; // 最近一次加注后已行动过的活跃玩家
  actionHistory: string[];
  turnIndex: number;
}

export class PokerHand {
  readonly players: TablePlayer[];
  readonly communityCards: Card[] = [];
  readonly handNumber: number;
  readonly blindLevel: number;
  readonly sb: number;
  readonly bb: number;
  private deck: Card[];
  private betting: BettingState | null = null;
  private status: 'betting' | 'finished' = 'betting';
  private result: HandResultInfo | null = null;

  constructor(opts: PokerHandOptions) {
    this.handNumber = opts.handNumber;
    this.blindLevel = opts.blindLevel;
    this.sb = opts.sb;
    this.bb = opts.bb;
    this.players = opts.players.map((p) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      holeCards: [],
      folded: false,
      allIn: false,
      committed: 0,
      totalCommitted: 0,
      lastAction: null,
      isDealer: false,
      isSB: false,
      isBB: false,
    }));
    const n = this.players.length;
    this.players[opts.dealerIndex]!.isDealer = true;
    if (n === 2) {
      // 单挑：庄家即小盲
      this.players[opts.dealerIndex]!.isSB = true;
      this.players[(opts.dealerIndex + 1) % 2]!.isBB = true;
    } else {
      this.players[(opts.dealerIndex + 1) % n]!.isSB = true;
      this.players[(opts.dealerIndex + 2) % n]!.isBB = true;
    }
    this.deck = shuffle(makeDeck(), opts.rng ?? Math.random);
  }

  get isActive(): boolean {
    return this.status === 'betting';
  }
  get isFinished(): boolean {
    return this.status === 'finished';
  }
  get resultInfo(): HandResultInfo | null {
    return this.result;
  }
  get activeCount(): number {
    return this.players.filter((p) => !p.folded).length;
  }
  potTotal(): number {
    return this.players.reduce((s, p) => s + p.totalCommitted, 0);
  }

  /** 发牌 + 下盲注 + 进入翻前 */
  deal(): void {
    const n = this.players.length;
    const sbIdx = this.players.findIndex((p) => p.isSB);
    const bbIdx = this.players.findIndex((p) => p.isBB);
    if (sbIdx >= 0) this.postBlind(sbIdx, this.sb);
    if (bbIdx >= 0) this.postBlind(bbIdx, this.bb);
    for (const p of this.players) p.holeCards = [this.deck.pop()!, this.deck.pop()!];
    this.startStreet('preflop');
  }

  private postBlind(idx: number, amount: number): void {
    const p = this.players[idx]!;
    const bet = Math.min(amount, p.stack);
    p.stack -= bet;
    p.committed += bet;
    p.totalCommitted += bet;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = 'raise';
  }

  private startStreet(street: Street): void {
    const b: BettingState = {
      street,
      currentBet: 0,
      minRaiseInc: this.bb,
      actedSet: new Set(),
      actionHistory: [],
      turnIndex: -1,
    };
    // 非翻前街：本街投入清零（上一街的下注不带入新街）；翻前保留盲注
    if (street !== 'preflop') {
      for (const p of this.players) p.committed = 0;
    }
    if (street === 'preflop') {
      b.currentBet = Math.max(...this.players.map((p) => p.committed));
      const bbIdx = this.players.findIndex((p) => p.isBB);
      b.turnIndex = this.nextActiveAfter(bbIdx);
    } else {
      const dealerIdx = this.players.findIndex((p) => p.isDealer);
      b.turnIndex = this.nextActiveAfter(dealerIdx);
    }
    this.betting = b;
    this.advanceToLegalActor();
  }

  private nextActiveAfter(idx: number): number {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (idx + step) % n;
      const p = this.players[i]!;
      if (!p.folded && !p.allIn) return i;
    }
    return -1;
  }

  /** 是否还需要有人行动（存在未匹配下注或未行动的活跃玩家） */
  private bettingRoundNeedsAction(): boolean {
    const b = this.betting!;
    const actives = this.players.filter((p) => !p.folded && !p.allIn);
    if (actives.length === 0) return false; // 全部全下或弃牌
    for (const p of actives) {
      const i = this.players.indexOf(p);
      if (p.committed < b.currentBet || !b.actedSet.has(i)) return true;
    }
    return false;
  }

  /** 推进到下一个合法行动者；若本街结束则翻牌或摊牌 */
  private advanceToLegalActor(): void {
    if (!this.bettingRoundNeedsAction()) {
      this.maybeEndStreet();
      return;
    }
    const b = this.betting!;
    const n = this.players.length;
    for (let step = 0; step < n; step++) {
      const i = (b.turnIndex + step) % n;
      const p = this.players[i]!;
      if (p.folded || p.allIn) continue;
      if (p.committed < b.currentBet || !b.actedSet.has(i)) {
        b.turnIndex = i;
        return;
      }
    }
    this.maybeEndStreet();
  }

  private maybeEndStreet(): void {
    if (this.status !== 'betting') return;
    if (this.players.filter((p) => !p.folded).length <= 1) {
      this.finishAsWalk();
      return;
    }
    if (this.bettingRoundNeedsAction()) return;
    const b = this.betting!;
    if (b.street === 'preflop') {
      this.communityCards.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      this.startStreet('flop');
    } else if (b.street === 'flop') {
      this.communityCards.push(this.deck.pop()!);
      this.startStreet('turn');
    } else if (b.street === 'turn') {
      this.communityCards.push(this.deck.pop()!);
      this.startStreet('river');
    } else {
      this.doShowdown();
    }
  }

  /** 当前需要决策的玩家 */
  get currentActor(): TablePlayer | null {
    if (this.status !== 'betting') return null;
    const b = this.betting!;
    const p = this.players[b.turnIndex];
    if (!p || p.folded || p.allIn) return null;
    return p;
  }

  buildDecisionRequest(): DecisionRequest | null {
    const actor = this.currentActor;
    const b = this.betting!;
    if (!actor) return null;
    const toCall = Math.max(0, b.currentBet - actor.committed);
    const minRaiseTo = b.currentBet + b.minRaiseInc;
    const maxRaiseTo = actor.committed + actor.stack;
    const legal: ActionType[] = ['fold'];
    if (toCall === 0) legal.push('check');
    else legal.push('call');
    // 只有能构成合法加注时才提供 raise（最小加注额 ≤ 可投入上限）
    if (actor.stack > 0 && maxRaiseTo > b.currentBet && minRaiseTo <= maxRaiseTo) legal.push('raise');
    legal.push('all_in');
    return {
      playerId: actor.id,
      playerName: actor.name,
      street: b.street,
      holeCards: actor.holeCards,
      communityCards: [...this.communityCards],
      pot: this.potTotal(),
      streetPot: this.players.reduce((s, p) => s + p.committed, 0),
      toCall,
      currentBet: b.currentBet,
      minRaiseTo,
      maxRaiseTo,
      stack: actor.stack,
      committed: actor.committed,
      position: actor.isDealer ? '庄位(BTN)' : actor.isSB ? '小盲(SB)' : actor.isBB ? '大盲(BB)' : this.positionName(this.players.indexOf(actor)),
      legalActions: legal,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        folded: p.folded,
        allIn: p.allIn,
        committed: p.committed,
        isDealer: p.isDealer,
        isSB: p.isSB,
        isBB: p.isBB,
        lastAction: p.lastAction,
      })),
      actionHistory: [...b.actionHistory],
      handNumber: this.handNumber,
      blindLevel: this.blindLevel,
      sb: this.sb,
      bb: this.bb,
    };
  }

  private positionName(idx: number): string {
    const n = this.players.length;
    const d = this.players.findIndex((p) => p.isDealer);
    const off = ((idx - d) % n + n) % n;
    if (off === 1) return '小盲(SB)';
    if (off === 2) return '大盲(BB)';
    if (n === 3) return '枪口(UTG)';
    if (n === 4) return off === 3 ? '关位(CO)' : '枪口(UTG)';
    if (n === 5) return off === 3 ? '枪口(UTG)' : '关位(CO)';
    if (n === 6) return off === 3 ? '枪口(UTG)' : off === 4 ? '劫位(HJ)' : '关位(CO)';
    if (off === 3) return '枪口(UTG)';
    if (off === 4) return '枪口+1(UTG+1)';
    if (off === 5) return '中位(MP)';
    if (off === 6) return '中位+1(MP+1)';
    if (off === n - 2) return '劫位(HJ)';
    if (off === n - 1) return '关位(CO)';
    return `位置${off}`;
  }

  /** 应用玩家决策，返回本次实际投入的筹码数（用于事件展示，不受换街清零影响） */
  applyDecision(decision: Decision): number {
    const actor = this.currentActor;
    const b = this.betting!;
    if (!actor) throw new Error('当前没有需要行动的玩家');
    const idx = this.players.indexOf(actor);
    const toCall = Math.max(0, b.currentBet - actor.committed);
    let action = decision.action;
    const desc = (text: string) => `${actor.name}: ${text}`;

    if (action === 'fold') {
      actor.folded = true;
      actor.lastAction = 'fold';
      b.actionHistory.push(desc('弃牌'));
      b.actedSet.add(idx);
      b.turnIndex = this.nextActiveAfter(idx);
      this.advanceToLegalActor();
      return 0;
    }
    if (action === 'check' && toCall > 0) action = 'call';
    if (action === 'check' || action === 'call') {
      const pay = Math.min(toCall, actor.stack);
      actor.stack -= pay;
      actor.committed += pay;
      actor.totalCommitted += pay;
      if (actor.stack === 0) actor.allIn = true;
      actor.lastAction = toCall === 0 ? 'check' : 'call';
      b.actionHistory.push(desc(toCall === 0 ? '过牌' : `跟注 ${pay}`));
      b.actedSet.add(idx);
      b.turnIndex = this.nextActiveAfter(idx);
      this.advanceToLegalActor();
      return pay;
    }
    if (action === 'raise' || action === 'all_in') {
      let target: number;
      if (action === 'all_in') {
        target = actor.committed + actor.stack;
      } else {
        const raw = typeof decision.raiseTo === 'number' && Number.isFinite(decision.raiseTo) ? decision.raiseTo : b.currentBet + b.minRaiseInc;
        target = Math.round(Math.max(b.currentBet + b.minRaiseInc, Math.min(raw, actor.committed + actor.stack)));
        // 防御：无法构成合法加注（目标不超过已投入，或最小加注额超过可投入上限）→ 降级为跟注/过牌
        if (target <= actor.committed || b.currentBet + b.minRaiseInc > actor.committed + actor.stack) {
          const pay = Math.min(Math.max(0, b.currentBet - actor.committed), actor.stack);
          actor.stack -= pay;
          actor.committed += pay;
          actor.totalCommitted += pay;
          if (actor.stack === 0) actor.allIn = true;
          actor.lastAction = pay === 0 ? 'check' : 'call';
          b.actionHistory.push(desc(pay === 0 ? '过牌' : `跟注 ${pay}`));
          b.actedSet.add(idx);
          b.turnIndex = this.nextActiveAfter(idx);
          this.advanceToLegalActor();
          return pay;
        }
      }
      const add = target - actor.committed;
      const bet = Math.min(add, actor.stack);
      actor.stack -= bet;
      actor.committed += bet;
      actor.totalCommitted += bet;
      const isAllIn = actor.stack === 0;
      if (isAllIn) actor.allIn = true;
      actor.lastAction = isAllIn ? 'all_in' : 'raise';
      const wasRaise = target > b.currentBet;
      if (wasRaise) {
        b.minRaiseInc = Math.max(b.minRaiseInc, target - b.currentBet);
        b.currentBet = target;
        b.actedSet = new Set([idx]);
      } else {
        b.actedSet.add(idx);
      }
      b.actionHistory.push(desc(isAllIn ? `全下 ${target}` : `加注到 ${target}`));
      b.turnIndex = this.nextActiveAfter(idx);
      this.advanceToLegalActor();
      return bet;
    }
    throw new Error(`非法行动: ${decision.action}`);
  }

  /** 所有人弃牌，未弃牌者直接收池 */
  private finishAsWalk(): void {
    const b = this.betting!;
    const winner = this.players.find((p) => !p.folded)!;
    const pot = this.potTotal();
    winner.stack += pot;
    this.result = {
      street: b.street,
      communityCards: [...this.communityCards],
      winners: [{ playerId: winner.id, amount: pot, holeCards: winner.holeCards }],
      pots: [{ amount: pot, winners: [{ playerId: winner.id, amount: pot }] }],
      players: this.players.map((p) => ({ ...p })),
    };
    this.status = 'finished';
  }

  private doShowdown(): void {
    const b = this.betting!;
    const contenders = this.players.filter((p) => !p.folded);
    const evals = new Map<string, HandResult>();
    for (const p of contenders) evals.set(p.id, evaluate7([...p.holeCards, ...this.communityCards]));

    // 边池：按投入层级切分；某层无人可领（该层贡献者全部弃牌）时向下层累积
    const pots: PotSlice[] = [];
    const levels = [...new Set(this.players.map((p) => p.totalCommitted))].sort((a, z) => a - z);
    let prev = 0;
    let unclaimed = 0;
    for (const level of levels) {
      const slice = (level - prev) * this.players.filter((p) => p.totalCommitted >= level).length + unclaimed;
      unclaimed = 0;
      if (slice > 0) {
        const eligible = contenders.filter((p) => p.totalCommitted >= level);
        if (eligible.length === 0) {
          unclaimed = slice;
        } else {
          pots.push({ amount: slice, winners: this.resolveSlice(eligible, evals, slice) });
        }
      }
      prev = level;
    }
    if (unclaimed > 0 && pots.length > 0) {
      // 最后兜底：分给主池赢家
      const main = pots[0]!;
      const top = main.winners[0]!;
      top.amount += unclaimed;
      main.amount += unclaimed;
    }

    const winners: HandResultInfo['winners'] = [];
    for (const pot of pots) {
      for (const w of pot.winners) {
        const p = this.players.find((x) => x.id === w.playerId)!;
        p.stack += w.amount;
        winners.push({ playerId: w.playerId, amount: w.amount, hand: w.hand, holeCards: p.holeCards });
      }
    }
    this.result = {
      street: b.street,
      communityCards: [...this.communityCards],
      winners,
      pots,
      players: this.players.map((p) => ({ ...p })),
    };
    this.status = 'finished';
  }

  private resolveSlice(
    eligible: TablePlayer[],
    evals: Map<string, HandResult>,
    slice: number,
  ): { playerId: string; amount: number; hand?: string }[] {
    const best = bestHands(eligible.map((p) => evals.get(p.id)!));
    const top = eligible.filter((p) => best.includes(evals.get(p.id)!));
    const share = Math.floor(slice / top.length);
    const out = top.map((p) => ({ playerId: p.id, amount: share, hand: describeHand(evals.get(p.id)!) }));
    const remainder = slice - share * top.length;
    if (remainder > 0) out[0]!.amount += remainder;
    return out;
  }

  summaryLines(): string[] {
    const lines: string[] = [];
    lines.push(`第 ${this.handNumber} 手 (庄:${this.players.find((p) => p.isDealer)?.name ?? '-'} SB ${this.sb} / BB ${this.bb})`);
    for (const p of this.players) {
      const state = p.folded ? '弃牌' : p.allIn ? '全下' : '';
      lines.push(`  ${p.name}: ${p.holeCards.map(cardId).join(' ')} 筹码 ${p.stack} ${state}`.trim());
    }
    if (this.communityCards.length) lines.push(`  公共牌: ${this.communityCards.map(cardId).join(' ')}`);
    if (this.result) {
      for (const w of this.result.winners) lines.push(`  赢家: ${w.playerId} +${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
    }
    return lines;
  }
}
