import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PokerHand, Decision, DecisionRequest } from './game.js';
import { PlayerSeed } from './game.js';

/** 用一个固定序列的决策者自动打完一手牌 */
function playHand(opts: { players: PlayerSeed[]; dealerIndex: number; sb: number; bb: number; handNumber?: number; seed?: number; strategy?: (req: DecisionRequest) => Decision }) {
  const seed = opts.seed ?? 42;
  let s = seed;
  const rng = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const hand = new PokerHand({
    players: opts.players,
    dealerIndex: opts.dealerIndex,
    sb: opts.sb,
    bb: opts.bb,
    handNumber: opts.handNumber ?? 1,
    blindLevel: 1,
    rng,
  });
  hand.deal();
  const strategy = opts.strategy ?? ((req) => ({ action: 'fold' as const }));
  let guard = 0;
  while (hand.isActive && guard++ < 500) {
    const req = hand.buildDecisionRequest();
    if (!req) break;
    hand.applyDecision(strategy(req));
  }
  return hand;
}

const P = (n: string, stack = 2000): PlayerSeed => ({ id: n, name: n, stack });

test('所有人一路过牌到底，底池=3人各跟大盲', () => {
  const hand = playHand({
    players: [P('A'), P('B'), P('C')],
    dealerIndex: 0,
    sb: 10,
    bb: 20,
    strategy: (req) => ({ action: 'check' }),
  });
  assert.ok(hand.isFinished);
  const pot = hand.potTotal();
  assert.equal(pot, 60); // 3 人各投入 20
  const totalStack = hand.players.reduce((s, p) => s + p.stack, 0);
  assert.equal(totalStack, 6000, '摊牌后筹码应守恒');
  assert.equal(hand.resultInfo!.communityCards.length, 5);
  const win = hand.resultInfo!.winners.reduce((s, w) => s + w.amount, 0);
  assert.equal(win, pot);
});

test('翻前全部弃牌给大盲，大盲直接赢', () => {
  const hand = playHand({
    players: [P('A'), P('B'), P('C')],
    dealerIndex: 0,
    sb: 10,
    bb: 20,
    strategy: (req) => {
      if (req.playerId === 'A') return { action: 'fold' }; // 庄家弃牌
      if (req.playerId === 'B') return { action: 'fold' }; // 小盲弃牌
      return { action: 'check' }; // C 是大盲，无人应战
    },
  });
  assert.ok(hand.isFinished);
  const res = hand.resultInfo!;
  assert.equal(res.winners.length, 1);
  assert.equal(res.winners[0]!.playerId, 'C');
  assert.equal(res.winners[0]!.amount, 30);
  assert.equal(hand.players.find((p) => p.id === 'C')!.stack, 2000 - 20 + 30);
  assert.equal(res.communityCards.length, 0, '无摊牌不应发公共牌');
});

test('加注-跟注-摊牌，筹码守恒且赢家正确', () => {
  const hand = playHand({
    players: [P('A'), P('B'), P('C')],
    dealerIndex: 0,
    sb: 10,
    bb: 20,
    seed: 7,
    strategy: (req) => {
      // A(庄) 翻前加注到 80，其余跟注；翻牌后全过牌
      if (req.street === 'preflop') {
        if (req.playerId === 'A') return { action: 'raise', raiseTo: 80 };
        return { action: 'call' };
      }
      return { action: 'check' };
    },
  });
  assert.ok(hand.isFinished);
  const res = hand.resultInfo!;
  assert.equal(res.communityCards.length, 5);
  const totalWin = res.winners.reduce((s, w) => s + w.amount, 0);
  assert.equal(totalWin, 240); // 80*3
  const totalStack = hand.players.reduce((s, p) => s + p.stack, 0);
  assert.equal(totalStack, 6000);
});

test('全下产生边池：主池和边池分配正确', () => {
  // A 2000 全下，B 2000 跟注，C 500 短码跟注全下
  // 主池 = 500*3 = 1500，边池 = 1500*2 = 3000
  const hand = playHand({
    players: [P('A', 2000), P('B', 2000), P('C', 500)],
    dealerIndex: 0,
    sb: 10,
    bb: 20,
    seed: 3,
    strategy: (req) => {
      if (req.playerId === 'A') return { action: 'all_in' };
      if (req.playerId === 'C') return { action: 'call' }; // 500 不够跟 2000，自动全下
      if (req.playerId === 'B') return { action: 'call' };
      return { action: 'fold' };
    },
  });
  assert.ok(hand.isFinished);
  const res = hand.resultInfo!;
  assert.equal(res.pots.length >= 2, true, `应有至少两个池，实际: ${JSON.stringify(res.pots.map((p) => p.amount))}`);
  const potSizes = res.pots.map((p) => p.amount).sort((a, b) => a - b);
  assert.equal(potSizes[0], 1500);
  assert.equal(potSizes[1], 3000);
  const totalWin = res.winners.reduce((s, w) => s + w.amount, 0);
  assert.equal(totalWin, 4500);
  const totalStack = hand.players.reduce((s, p) => s + p.stack, 0);
  assert.equal(totalStack, 2000 + 2000 + 500);
});

test('单挑（heads-up）：小盲即庄家，翻前小盲先行动', () => {
  let firstActor = '';
  const hand = playHand({
    players: [P('A'), P('B')],
    dealerIndex: 0, // A = 庄 = 小盲
    sb: 10,
    bb: 20,
    strategy: (req) => {
      if (!firstActor) firstActor = req.playerId;
      if (req.street === 'preflop' && req.playerId === 'A') return { action: 'call' };
      return { action: 'check' };
    },
  });
  assert.equal(firstActor, 'A', '单挑翻前小盲先行动');
  const a = hand.players.find((p) => p.id === 'A')!;
  const b = hand.players.find((p) => p.id === 'B')!;
  assert.equal(a.isDealer && a.isSB, true);
  assert.equal(b.isBB, true);
  assert.equal(a.stack + b.stack, 4000);
});

test('翻牌后首个行动者是庄家下家（小盲位）', () => {
  const order: string[] = [];
  const hand = playHand({
    players: [P('A'), P('B'), P('C'), P('D')],
    dealerIndex: 0, // A 庄，B 小盲，C 大盲，D 枪口
    sb: 10,
    bb: 20,
    seed: 11,
    strategy: (req) => {
      if (req.street === 'preflop') {
        if (req.playerId === 'C' && req.toCall === 0) return { action: 'raise', raiseTo: 60 };
        return { action: 'call' };
      }
      order.push(req.playerId);
      return { action: 'check' };
    },
  });
  assert.ok(order.length > 0);
  assert.equal(order[0], 'B', '翻牌后第一个行动者应是庄家下家 B(小盲)');
});

test('无法构成合法加注时降级为跟注（不产生"加注到 0"）', () => {
  // A/B 大筹码互搏到 1500，C 短码已跟 1500（剩 20）
  // C 想加注但最小加注额超过可投入上限 → 应降级为跟注/过牌
  let sawRaise0 = false;
  const hand = playHand({
    players: [P('A', 3000), P('B', 3000), P('C', 1520)],
    dealerIndex: 0,
    sb: 10,
    bb: 20,
    seed: 5,
    strategy: (req) => {
      if (req.street === 'preflop') {
        if (req.playerId === 'A' && req.toCall === 0) return { action: 'raise', raiseTo: 1500 };
        if (req.playerId === 'B') return { action: 'call' };
        if (req.playerId === 'C') {
          // C 面对 1500 只能全下或跟注；强行 raise 极小值
          return { action: 'raise', raiseTo: req.committed };
        }
        return { action: 'call' };
      }
      return { action: 'check' };
    },
  });
  for (const p of hand.players) {
    if (p.id === 'C') {
      assert.equal(p.lastAction !== 'raise' || p.allIn, true, 'C 不应产生假加注（要么全下要么跟注）');
      // C 的 committed 要么不变（跟注不了则过牌）要么变多（全下）
      assert.ok(p.committed >= 0 && Number.isFinite(p.committed));
    }
  }
  assert.ok(!sawRaise0);
});
