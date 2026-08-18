/**
 * AI Arena v0.1：固定盲注淘汰赛
 *
 * 6 个 AI，各拿 100BB → 自己取名 → 自己打牌 → 输光出局 → 最后一人获胜
 * - 固定盲注 0.5/1 BB，永不上涨；筹码不重置，禁止 rebuy
 * - 决策与嘴炮完全分离（独立 API 调用）
 * - 每手结束所有存活 AI 说一句话（纯给观众看，不进入任何 AI 的决策上下文）
 */

import { PokerHand } from './poker/game.js';
import type { PlayerSeed, Street } from './poker/game.js';
import type { GameEvent, TablePlayerView } from './events.js';
import type { PlayerAgent } from './agents/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const IDENTITY_CACHE = path.join(ROOT, 'data', 'identities.json');

/** 每淘汰 1 位选手盲注上升的倍率档位（× 基础 BB） */
const BLIND_MULTIPLIERS = [1, 1.5, 2, 3, 4, 6, 8];

function loadIdentityCache(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(IDENTITY_CACHE, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}
function saveIdentityCache(cache: Record<string, string>): void {
  try {
    fs.mkdirSync(path.dirname(IDENTITY_CACHE), { recursive: true });
    fs.writeFileSync(IDENTITY_CACHE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[身份缓存写入失败]', err instanceof Error ? err.message : err);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ArenaOptions {
  agents: PlayerAgent[];
  /** 1 BB 的筹码值（如 20） */
  bb: number;
  /** 初始筹码（BB 数，默认 100） */
  startingStackBB: number;
  /** 每手间隔（ms） */
  handDelayMs: number;
  /** 行动间隔（ms） */
  actionDelayMs: number;
  /** 跑满 N 手后自动停止（测试用；缺省打到出冠军） */
  maxHands?: number;
  /** 每 N 手末尾淘汰筹码最少者（与筹码清零并行；缺省不开启） */
  eliminateBottomEvery?: number;
  onEvent: (evt: GameEvent) => void;
  rng?: () => number;
}

export class Arena {
  private opts: ArenaOptions;
  private paused = false;
  private stopRequested = false;
  private running = false;
  private handNumber = 0;
  private stacks = new Map<string, number>();
  private aliveIds: string[] = [];
  private bustedOrder: string[] = [];
  /** 盲注档位：每淘汰 1 人 +1（6 人时 0 档） */
  private blindLevel = 0;
  /** 本手已广播的公共牌街（flop/turn/river），每手重置 */
  private shownStreets = new Set<string>();
  private rng: () => number;

  constructor(opts: ArenaOptions) {
    this.opts = opts;
    this.rng = opts.rng ?? Math.random;
  }

  get isRunning(): boolean {
    return this.running;
  }
  get currentHand(): number {
    return this.handNumber;
  }

  pause(): void {
    this.paused = true;
    // 立即中断进行中的模型思考，让暂停马上生效
    for (const a of this.opts.agents) a.cancel?.();
  }
  resume(): void {
    this.paused = false;
  }
  requestStop(): void {
    this.stopRequested = true;
  }

  private emit(evt: GameEvent): void {
    this.opts.onEvent(evt);
  }

  private async waitIfPaused(): Promise<void> {
    while (this.paused && !this.stopRequested) await sleep(100);
  }

  private agentById(id: string): PlayerAgent {
    const a = this.opts.agents.find((x) => x.id === id);
    if (!a) throw new Error(`未知玩家: ${id}`);
    return a;
  }

  /** 当前盲注（随淘汰人数上升） */
  private currentBlinds(): { sb: number; bb: number } {
    const mult = BLIND_MULTIPLIERS[Math.min(this.blindLevel, BLIND_MULTIPLIERS.length - 1)]!;
    const bb = Math.round(this.opts.bb * mult);
    return { sb: Math.round(bb / 2), bb };
  }

  /** 每淘汰 1 人，盲注升一档 */
  private raiseBlinds(): void {
    this.blindLevel++;
    const { sb, bb } = this.currentBlinds();
    this.emit({ type: 'blind_change', level: this.blindLevel, sb, bb, handNumber: this.handNumber });
  }

  /** 比赛形势文本：淘汰赛压力（排名 + 末尾淘汰倒计时），让 AI 有必须赢的紧迫感 */
  private tournamentInfoFor(playerId: string, hand: PokerHand): string {
    const every = this.opts.eliminateBottomEvery ?? 0;
    const aliveStacks = this.aliveIds.map((id) => ({ id, stack: this.stacks.get(id) ?? 0 }));
    const sorted = [...aliveStacks].sort((a, b) => b.stack - a.stack);
    const rank = sorted.findIndex((x) => x.id === playerId) + 1;
    const total = aliveStacks.length;
    const parts: string[] = [
      `【比赛形势】第 ${this.handNumber} 手 | 存活 ${total} 人 | 你的筹码排名第 ${rank}/${total}`,
    ];
    if (total === 2) {
      parts.push('⚡ 单挑模式：不再末尾淘汰，一方输光为止——每一手都是生死战，必须赢得底池！');
    } else if (every > 0) {
      const handsUntil = every - (this.handNumber % every || every);
      parts.push(`⚡ 淘汰赛规则：每 ${every} 手末尾淘汰筹码最少者！距离下次末尾淘汰还有 ${handsUntil} 手`);
      if (rank === total) parts.push('🚨 警告：你目前是全场筹码最少者，下一轮末尾淘汰随时可能出局！必须主动赢下底池！');
      else if (rank >= total - 1) parts.push('⚠️ 你处于垫底边缘，必须积极入池翻盘，保底弃牌等于慢性死亡！');
    }
    parts.push('目标是成为最后存活的赢家，冠军独享全部筹码和冠军奖杯——你必须赢！');
    return parts.join('\n');
  }

  /** 按街广播公共牌：flop 3 张 → turn 4 张 → river 5 张（每街只发一次） */
  private markStreets(hand: PokerHand): void {
    const defs: [number, Street][] = [
      [3, 'flop'],
      [4, 'turn'],
      [5, 'river'],
    ];
    const emitted: Street[] = [];
    for (const [len, street] of defs) {
      if (hand.communityCards.length >= len && !this.shownStreets.has(street)) {
        this.shownStreets.add(street);
        emitted.push(street);
        this.emit({ type: 'street', street, cards: hand.communityCards.slice(0, len).map((c) => `${c.rank}${c.suit}`) });
      }
    }
    // 一次广播了多条街 = 全员全下/无人再行动，公共牌按规则一口气发完
    if (emitted.length > 1) {
      this.emit({ type: 'note', text: `⚡ 全下！无人再行动，公共牌直接发完：${emitted.join(' → ')}` });
    }
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.handNumber = 0;
    this.blindLevel = 0;
    this.bustedOrder = [];
    this.stacks.clear();
    this.aliveIds = this.opts.agents.map((a) => a.id);
    for (const a of this.opts.agents) this.stacks.set(a.id, this.opts.startingStackBB * this.opts.bb);

    this.emit({ type: 'mode', mode: 'arena' });

    // ===== 取名 Phase：每个 AI 自己取一个 Poker Name（全局唯一，赛季锁定，重启后保留） =====
    const cache = loadIdentityCache();
    const taken = new Set<string>();
    for (const agent of this.opts.agents) {
      let name = cache[agent.id];
      let isNew = false;
      if (!name) {
        name = await agent.createIdentity();
        isNew = true;
      } else {
        agent.currentName = name;
      }
      let guard = 0;
      while (taken.has(name) && guard++ < 8) {
        name = await agent.createIdentity();
        isNew = true;
      }
      taken.add(name);
      if (isNew) {
        cache[agent.id] = name;
        saveIdentityCache(cache);
      }
      this.emit({ type: 'identity_created', playerId: agent.id, name });
    }
    this.emit({
      type: 'game_start',
      players: this.opts.agents.map((a) => ({ id: a.id, name: a.currentName, kind: a.kind, model: a.model })),
      startingStack: this.opts.startingStackBB * this.opts.bb,
    });

    let dealerIdx = -1;
    try {
      while (this.aliveIds.length > 1) {
        await this.waitIfPaused();
        if (this.stopRequested) break;
        if (this.opts.maxHands && this.handNumber >= this.opts.maxHands) break;
        this.handNumber++;
        dealerIdx = (dealerIdx + 1) % this.aliveIds.length;
        await this.playHand(dealerIdx);
        await sleep(this.opts.handDelayMs);
      }
    } finally {
      this.running = false;
    }

    if (!this.stopRequested && this.aliveIds.length > 0) {
      const championId = this.aliveIds[0]!;
      const champ = this.agentById(championId);
      const standings = [
        { playerId: championId, name: champ.currentName, stack: this.stacks.get(championId)!, rank: 1, kind: champ.kind, model: champ.model },
        ...this.bustedOrder.map((id, i) => {
          const a = this.agentById(id);
          // 最后淘汰的排名 2，最先淘汰的排名 N（逆序）
          return { playerId: id, name: a.currentName, stack: 0, rank: this.bustedOrder.length - i + 1, kind: a.kind, model: a.model };
        }),
      ];
      this.emit({ type: 'tournament_end', championId, standings });
    }
  }

  private async playHand(dealerIdx: number): Promise<void> {
    const { sb, bb } = this.currentBlinds();
    const seeds: PlayerSeed[] = this.aliveIds.map((id) => ({ id, name: this.agentById(id).currentName, stack: this.stacks.get(id)! }));
    const hand = new PokerHand({
      players: seeds,
      dealerIndex: dealerIdx,
      sb,
      bb,
      handNumber: this.handNumber,
      blindLevel: this.blindLevel,
      rng: this.rng,
    });
    hand.deal();
    this.shownStreets.clear();

    const view = (): TablePlayerView[] =>
      hand.players.map((p) => ({
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
      }));

    this.emit({ type: 'hand_start', handNumber: this.handNumber, level: this.blindLevel, sb, bb, dealerId: seeds[dealerIdx]!.id, players: view() });
    for (const p of hand.players) {
      this.emit({ type: 'hole_cards', playerId: p.id, cards: p.holeCards.map((c) => `${c.rank}${c.suit}`) });
    }

    let guard = 0;
    while (hand.isActive && guard++ < 1000) {
      await this.waitIfPaused();
      if (this.stopRequested) break;
      const req = hand.buildDecisionRequest();
      if (!req) break;
      // 注入比赛形势：淘汰压力（让 AI 有必须赢的紧迫感）
      req.tournamentInfo = this.tournamentInfoFor(req.playerId, hand);
      this.emit({ type: 'actor', playerId: req.playerId, request: req });
      const agent = this.agentById(req.playerId);
      const decision = await agent.decide(req);
      if (decision.reason) {
        this.emit({ type: 'thinking', playerId: req.playerId, text: decision.reason, model: agent.model });
      }
      // applyDecision 返回本次实际投入（换街清零不影响该值）
      const committedAmount = hand.applyDecision(decision);
      // 加注轮结束 → 翻开下一街公共牌时，逐街广播（flop 3 张 → turn 4 张 → river 5 张）
      this.markStreets(hand);
      const actor = hand.players.find((p) => p.id === req.playerId)!;
      this.emit({
        type: 'action',
        playerId: req.playerId,
        action: actor.lastAction ?? 'call',
        amount: committedAmount,
        reason: decision.reason,
        stack: actor.stack,
        committed: actor.committed,
        pot: hand.potTotal(),
        folded: actor.folded,
        allIn: actor.allIn,
      });
      await sleep(this.opts.actionDelayMs);
    }

    const result = hand.resultInfo;
    let resultText = '';
    if (result) {
      // 结算前补发尚未广播的公共牌街（如全下后连续翻牌）
      this.markStreets(hand);
      this.emit({
        type: 'showdown',
        street: result.street,
        community: result.communityCards.map((c) => `${c.rank}${c.suit}`),
        results: result.players
          .filter((p) => !p.folded)
          .map((p) => ({
            playerId: p.id,
            holeCards: p.holeCards.map((c) => `${c.rank}${c.suit}`),
            hand: result.winners.find((w) => w.playerId === p.id)?.hand ?? '',
          })),
        winners: result.winners.map((w) => ({ playerId: w.playerId, amount: w.amount, hand: w.hand })),
        pots: result.pots.map((p) => ({ amount: p.amount, winners: p.winners.map((w) => ({ playerId: w.playerId, amount: w.amount })) })),
      });
      const potBB = result.pots.reduce((s, p) => s + p.amount, 0) / bb;
      const w = result.winners[0]!;
      const winner = this.agentById(w.playerId);
      resultText = `${winner.currentName} 赢下 ${potBB.toFixed(1)} BB 底池${w.hand ? `（${w.hand}）` : ''}`;
    }

    // 结算筹码
    for (const p of hand.players) this.stacks.set(p.id, p.stack);
    this.emit({ type: 'hand_end', handNumber: this.handNumber, players: view() });

    // 淘汰 0 BB 的玩家（排名：从当前人数开始递减，保证最终 1..N 连续）
    const newAlive: string[] = [];
    for (const id of this.aliveIds) {
      if ((this.stacks.get(id) ?? 0) > 0) newAlive.push(id);
      else this.bustedOrder.push(id);
    }
    const bustedNow = this.aliveIds.filter((id) => !newAlive.includes(id));
    let rankCounter = this.aliveIds.length;
    for (const id of bustedNow) {
      this.emit({ type: 'player_busted', playerId: id, rank: rankCounter, finalStack: 0, reason: 'chips' });
      rankCounter--;
    }
    this.aliveIds = newAlive;

    // 末尾淘汰：每 N 手淘汰筹码最少者（与筹码清零并行）；只剩 2 人（单挑）时不再末尾淘汰，打到底
    const every = this.opts.eliminateBottomEvery ?? 0;
    let bottomEliminated = false;
    if (every > 0 && this.handNumber % every === 0 && this.aliveIds.length > 2) {
      const bottom = [...this.aliveIds].sort((a, b) => (this.stacks.get(a) ?? 0) - (this.stacks.get(b) ?? 0))[0]!;
      if ((this.stacks.get(bottom) ?? 0) > 0) {
        this.bustedOrder.push(bottom);
        const rank = this.aliveIds.length;
        this.emit({ type: 'player_busted', playerId: bottom, rank, finalStack: this.stacks.get(bottom) ?? 0, reason: 'bottom' });
        this.aliveIds = this.aliveIds.filter((id) => id !== bottom);
        bottomEliminated = true;
      }
    }

    // 每淘汰 1 位选手，盲注升一档（更刺激）
    const eliminatedCount = bustedNow.length + (bottomEliminated ? 1 : 0);
    for (let i = 0; i < eliminatedCount; i++) this.raiseBlinds();

    // 每手结束：存活 AI 各说一句话（纯给观众看）
    if (!this.stopRequested) {
      const situation = `第 ${this.handNumber} 手结束，${resultText || '无人摊牌'}。`;
      for (const id of this.aliveIds) {
        const agent = this.agentById(id);
        const msg = await agent.talk({ playerName: agent.currentName, situation });
        if (msg) this.emit({ type: 'table_talk', playerId: id, message: msg });
      }
    }
  }
}
