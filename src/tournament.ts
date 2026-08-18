/** 锦标赛：升盲 + 筹码清零淘汰 + 多手牌编排 */

import { PokerHand, PlayerSeed } from './poker/game.js';
import type { DecisionRequest } from './poker/game.js';
import type { GameEvent, TablePlayerView } from './events.js';
import type { PlayerAgent } from './agents/types.js';

/** 盲注表（SB, BB），逐级上涨 */
export const BLIND_SCHEDULE: [number, number][] = [
  [10, 20], [15, 30], [20, 40], [25, 50], [30, 60], [40, 80], [50, 100],
  [60, 120], [80, 160], [100, 200], [120, 240], [150, 300], [200, 400],
  [250, 500], [300, 600], [400, 800], [500, 1000], [600, 1200], [800, 1600],
  [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [4000, 8000],
  [6000, 12000], [8000, 16000], [10000, 20000],
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface TournamentOptions {
  agents: PlayerAgent[];
  startingStack: number;
  /** 每个盲注级别打几手牌 */
  handsPerLevel: number;
  /** 每手牌之间间隔（观战节奏） */
  handDelayMs: number;
  /** 每次行动后间隔 */
  actionDelayMs: number;
  onEvent: (evt: GameEvent) => void;
  rng?: () => number;
}

export class Tournament {
  private opts: TournamentOptions;
  private aliveIds: string[] = [];
  private stacks = new Map<string, number>();
  private busted: { playerId: string; rank: number; finalStack: number }[] = [];
  private paused = false;
  private stopRequested = false;
  private running = false;
  private handNumber = 0;
  private level = 1;
  private handsInLevel = 0;

  constructor(opts: TournamentOptions) {
    this.opts = opts;
  }

  get isRunning(): boolean {
    return this.running;
  }

  pause(): void {
    this.paused = true;
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

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.handNumber = 0;
    this.level = 1;
    this.handsInLevel = 0;
    this.busted = [];

    const agents = this.opts.agents;
    this.aliveIds = agents.map((a) => a.id);
    for (const a of agents) this.stacks.set(a.id, this.opts.startingStack);

    this.emit({
      type: 'game_start',
      players: agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, model: a.model })),
      startingStack: this.opts.startingStack,
    });

    let dealerIdx = -1; // 从 -1 开始，第一手 dealer 是第一个玩家
    try {
      while (this.aliveIds.length > 1) {
        await this.waitIfPaused();
        if (this.stopRequested) break;

        // 盲注升级
        if (this.handsInLevel >= this.opts.handsPerLevel) {
          this.handsInLevel = 0;
          this.level = Math.min(this.level + 1, BLIND_SCHEDULE.length);
          const [sb, bb] = BLIND_SCHEDULE[this.level - 1]!;
          this.emit({ type: 'blind_change', level: this.level, sb, bb, handNumber: this.handNumber + 1 });
        }
        const [sb, bb] = BLIND_SCHEDULE[this.level - 1]!;
        dealerIdx = (dealerIdx + 1) % this.aliveIds.length;
        await this.playHand(dealerIdx, sb, bb);
        this.handsInLevel++;
        await sleep(this.opts.handDelayMs);
      }
    } finally {
      this.running = false;
    }

    if (!this.stopRequested && this.aliveIds.length > 0) {
      const championId = this.aliveIds[0]!;
      const standings = [
        { playerId: championId, name: agents.find((a) => a.id === championId)!.name, stack: this.stacks.get(championId)!, rank: 1, kind: agents.find((a) => a.id === championId)!.kind, model: agents.find((a) => a.id === championId)!.model },
        ...this.busted
          .sort((a, b) => a.rank - b.rank)
          .map((b) => {
            const a = agents.find((x) => x.id === b.playerId)!;
            return { playerId: b.playerId, name: a.name, stack: 0, rank: b.rank, kind: a.kind, model: a.model };
          }),
      ];
      this.emit({ type: 'tournament_end', championId, standings });
    }
  }

  private async playHand(dealerIdx: number, sb: number, bb: number): Promise<void> {
    this.handNumber++;
    const seeds: PlayerSeed[] = this.aliveIds.map((id) => ({ id, name: this.agentName(id), stack: this.stacks.get(id)! }));
    const hand = new PokerHand({
      players: seeds,
      dealerIndex: dealerIdx,
      sb,
      bb,
      handNumber: this.handNumber,
      blindLevel: this.level,
      rng: this.opts.rng,
    });
    hand.deal();

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

    this.emit({ type: 'hand_start', handNumber: this.handNumber, level: this.level, sb, bb, dealerId: seeds[dealerIdx]!.id, players: view() });
    for (const p of hand.players) {
      this.emit({ type: 'hole_cards', playerId: p.id, cards: p.holeCards.map((c) => `${c.rank}${c.suit}`) });
    }
    if (hand.communityCards.length) {
      this.emit({ type: 'street', street: 'preflop', cards: [] });
    }

    let guard = 0;
    while (hand.isActive && guard++ < 1000) {
      await this.waitIfPaused();
      if (this.stopRequested) break;
      const req = hand.buildDecisionRequest();
      if (!req) break;
      this.emit({ type: 'actor', playerId: req.playerId, request: req });
      const agent = this.opts.agents.find((a) => a.id === req.playerId)!;
      const decision = await agent.decide(req);
      if (decision.reason) {
        this.emit({ type: 'thinking', playerId: req.playerId, text: decision.reason, model: agent.model });
      }
      const actorBefore = hand.players.find((p) => p.id === req.playerId)!;
      const committedBefore = actorBefore.committed;
      hand.applyDecision(decision);
      const actor = hand.players.find((p) => p.id === req.playerId)!;
      this.emit({
        type: 'action',
        playerId: req.playerId,
        action: actor.lastAction ?? 'call',
        amount: actor.committed - committedBefore,
        reason: decision.reason,
        stack: actor.stack,
        committed: actor.committed,
        pot: hand.potTotal(),
      });
      await sleep(this.opts.actionDelayMs);
    }

    const result = hand.resultInfo;
    if (result) {
      if (result.communityCards.length) {
        this.emit({ type: 'street', street: result.street, cards: result.communityCards.map((c) => `${c.rank}${c.suit}`) });
      }
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
    }

    // 更新筹码
    for (const p of hand.players) this.stacks.set(p.id, p.stack);
    this.emit({ type: 'hand_end', handNumber: this.handNumber, players: view() });

    // 淘汰
    const newAlive: string[] = [];
    for (const id of this.aliveIds) {
      if ((this.stacks.get(id) ?? 0) > 0) newAlive.push(id);
    }
    const bustedNow = this.aliveIds.filter((id) => !newAlive.includes(id));
    for (let i = 0; i < bustedNow.length; i++) {
      const id = bustedNow[i]!;
      // 同时淘汰多人时按座位顺序排：第一个 = 当前人数中的最高名次
      const rank = this.aliveIds.length - i;
      this.busted.push({ playerId: id, rank, finalStack: 0 });
      this.emit({ type: 'player_busted', playerId: id, rank, finalStack: 0 });
    }
    this.aliveIds = newAlive;
  }

  private agentName(id: string): string {
    return this.opts.agents.find((a) => a.id === id)!.name;
  }
}

export type { DecisionRequest };
