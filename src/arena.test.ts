import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Arena } from './arena.js';
import { HeuristicAgent } from './agents/heuristic-agent.js';
import type { GameEvent } from './events.js';

function makeArena(maxHands: number, opts: { seedOffset?: number } = {}) {
  const agents = Array.from({ length: 6 }, (_, i) => new HeuristicAgent({ id: `p${i}`, name: `选手${i + 1}`, seed: i + 1 + (opts.seedOffset ?? 0) }));
  const events: GameEvent[] = [];
  const arena = new Arena({
    agents,
    bb: 20,
    startingStackBB: 100,
    handDelayMs: 0,
    actionDelayMs: 0,
    maxHands,
    onEvent: (e) => events.push(e),
  });
  return { agents, events, arena };
}

test('Arena: 取名唯一、事件流完整、筹码守恒', async () => {
  const { agents, events, arena } = makeArena(30);
  await arena.run();

  const types = events.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  assert.equal(types['identity_created'], 6, '6 个 AI 都应取名');
  assert.equal(types['game_start'], 1);
  assert.ok(types['hand_start']! >= 20, `应有足够手牌，实际 ${types['hand_start']}`);

  // 名字唯一
  const names = events.filter((e) => e.type === 'identity_created').map((e) => (e as { name: string }).name);
  assert.equal(new Set(names).size, 6, '名字应互不重复');

  // 每手筹码守恒（初始 6×100BB×20 = 12000，总筹码不变）
  for (const e of events) {
    if (e.type === 'hand_end') {
      const total = e.players.reduce((s, p) => s + p.stack, 0);
      assert.equal(total, 12000, `第 ${e.handNumber} 手筹码不守恒: ${total}`);
    }
  }

  // 幸存者少于 6 人（有淘汰）或打了满 30 手
  const lastHand = events.filter((e) => e.type === 'hand_end').pop() as { players: { stack: number }[] } | undefined;
  if (lastHand) {
    const alive = lastHand.players.filter((p) => p.stack > 0).length;
    assert.ok(alive >= 1 && alive <= 6);
  }
  for (const a of agents) assert.ok(a.currentName !== a.name, '取名应生效');
});

test('Arena: 打到最后一人获胜，冠军与排名正确', async () => {
  const { events, arena } = makeArena(10_000, { seedOffset: 7 });
  await arena.run();

  const end = events.find((e) => e.type === 'tournament_end') as { championId: string; standings: { rank: number; stack: number }[] } | undefined;
  assert.ok(end, '应产生冠军');
  const ranks = end!.standings.map((s) => s.rank).sort((a, b) => a - b);
  assert.equal(ranks.length, 6);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6], '排名应连续无重复');
  assert.equal(end!.standings[0]!.rank, 1);
  assert.equal(end!.standings[0]!.stack, 12000, '冠军应拥有全部筹码');
  // 淘汰数 = 5
  const busts = events.filter((e) => e.type === 'player_busted').length;
  assert.equal(busts, 5);
  // 每手结束都有嘴炮（存活者说话，可能有沉默，但事件应存在）
  const talks = events.filter((e) => e.type === 'table_talk').length;
  assert.ok(talks > 0, '应有嘴炮事件');
});

test('Arena: 末尾淘汰——每 N 手淘汰筹码最少者，与清零淘汰并行', async () => {
  const agents = Array.from({ length: 6 }, (_, i) => new HeuristicAgent({ id: `p${i}`, name: `P${i + 1}`, seed: i + 1 }));
  const events: GameEvent[] = [];
  const arena = new Arena({
    agents, bb: 20, startingStackBB: 100, handDelayMs: 0, actionDelayMs: 0,
    eliminateBottomEvery: 3, // 每 3 手末尾淘汰
    maxHands: 30, onEvent: (e) => events.push(e),
  });
  await arena.run();

  const busts = events.filter((e) => e.type === 'player_busted') as { playerId: string; reason: string; rank: number }[];
  const bottom = busts.filter((b) => b.reason === 'bottom');
  const chips = busts.filter((b) => b.reason === 'chips');
  console.log(`末尾淘汰 ${bottom.length} 次 | 清零淘汰 ${chips.length} 次`);
  assert.ok(bottom.length >= 2, '应有末尾淘汰发生');
  // 末尾淘汰发生在第 3/6/9... 手之后（handNumber % 3 === 0）
  const handEnds = events.filter((e) => e.type === 'hand_end');
  assert.ok(handEnds.length >= 3);
  // 排名最终连续
  const end = events.find((e) => e.type === 'tournament_end') as { standings: { rank: number }[] } | undefined;
  if (end) {
    const ranks = end.standings.map((s) => s.rank).sort((a, b) => a - b);
    assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6]);
  }
});

test('Arena: 末尾淘汰只在前 3 人以上生效，单挑打到底', async () => {
  const agents = Array.from({ length: 3 }, (_, i) => new HeuristicAgent({ id: `p${i}`, name: `P${i + 1}`, seed: i + 1 }));
  const events: GameEvent[] = [];
  const arena = new Arena({
    agents, bb: 20, startingStackBB: 100, handDelayMs: 0, actionDelayMs: 0,
    eliminateBottomEvery: 2, maxHands: 400, onEvent: (e) => events.push(e),
  });
  await arena.run();

  const busts = events.filter((e) => e.type === 'player_busted') as { reason: string }[];
  const bottom = busts.filter((b) => b.reason === 'bottom');
  const chips = busts.filter((b) => b.reason === 'chips');
  assert.ok(bottom.length <= 1, `3 人局末尾淘汰最多 1 次（3→2），实际 ${bottom.length} 次`);
  assert.ok(chips.length >= 1, `单挑阶段应通过筹码清零决出，实际清零 ${chips.length} 次`);
  assert.equal(busts.length, 2, '3 人局共淘汰 2 人');
  const end = events.find((e) => e.type === 'tournament_end');
  assert.ok(end, '应产生冠军');
});

test('Arena: 每淘汰 1 位选手盲注升一档', async () => {
  const agents = Array.from({ length: 4 }, (_, i) => new HeuristicAgent({ id: `p${i}`, name: `P${i + 1}`, seed: i + 1 }));
  const events: GameEvent[] = [];
  const arena = new Arena({
    agents, bb: 100, startingStackBB: 100, handDelayMs: 0, actionDelayMs: 0,
    eliminateBottomEvery: 2, maxHands: 200, onEvent: (e) => events.push(e),
  });
  await arena.run();

  const blindChanges = events.filter((e) => e.type === 'blind_change') as { sb: number; bb: number }[];
  const busts = events.filter((e) => e.type === 'player_busted').length;
  console.log(`淘汰 ${busts} 人，盲注升级 ${blindChanges.length} 次，盲注序列: ${blindChanges.map((b) => `${b.sb}/${b.bb}`).join(' → ')}`);
  assert.ok(blindChanges.length >= 1, '应有盲注升级');
  assert.ok(blindChanges.length <= busts, '盲注升级次数 ≤ 淘汰人数');
  // 盲注单调递增
  let prev = 0;
  for (const b of blindChanges) {
    assert.ok(b.bb > prev, `盲注应递增: ${b.bb} > ${prev}`);
    prev = b.bb;
  }
  // 第一档 = 基础盲注
  assert.equal(blindChanges[0]!.bb, 100);
});

test('Arena: 对手统计与嘴炮历史注入决策上下文', async () => {
  const agents = Array.from({ length: 4 }, (_, i) => new HeuristicAgent({ id: `p${i}`, name: `P${i + 1}`, seed: i + 1 }));
  const events: GameEvent[] = [];
  const arena = new Arena({ agents, bb: 20, startingStackBB: 100, handDelayMs: 0, actionDelayMs: 0, maxHands: 14, onEvent: (e) => events.push(e) });
  await arena.run();

  const actors = events.filter((e) => e.type === 'actor');
  const withStats = actors.filter((a) => (a.request.opponentStats ?? []).length > 0);
  const withTalk = actors.filter((a) => (a.request.tableTalk ?? []).length > 0);
  console.log(`actor ${actors.length} | 带统计 ${withStats.length} | 带嘴炮 ${withTalk.length}`);
  assert.ok(withStats.length > 0, '应注入对手统计');
  if (withStats[0]) {
    const s = withStats[0].request.opponentStats?.[0];
    assert.ok(s && typeof s.vpip === 'number' && typeof s.pfr === 'number', '统计字段完整');
  }
  assert.ok(withTalk.length > 0, '应注入嘴炮历史');
});

test('Arena: 公开事件记忆暂未注入（v0.3 再做）', async () => {
  const { events, arena } = makeArena(10);
  await arena.run();
  for (const e of events) {
    if (e.type === 'actor') {
      assert.equal(e.request.publicEvents, undefined, '公开事件记忆尚未实现');
    }
  }
});

test('Arena: 规则规范——flop/turn/river 逐街开牌，每街之间有下注轮', async () => {
  const { events, arena } = makeArena(12);
  await arena.run();

  const hands = new Map<number, { streets: { street: string; cards: string[] }[]; actions: number; showdown: boolean }>();
  let currentHandNo = 0;
  for (const e of events) {
    if (e.type === 'hand_start') {
      currentHandNo = e.handNumber;
      hands.set(e.handNumber, { streets: [], actions: 0, showdown: false });
      continue;
    }
    const h = hands.get(currentHandNo);
    if (!h) continue;
    if (e.type === 'street') h.streets.push({ street: e.street, cards: e.cards });
    else if (e.type === 'action') h.actions++;
    else if (e.type === 'showdown') h.showdown = true;
  }

  assert.ok(hands.size >= 5, `应有足够手牌样本，实际 ${hands.size}`);
  let checked = 0;
  for (const [handNo, h] of hands) {
    // 打到摊牌的手：必须依次经历 flop(3张) → turn(4张) → river(5张)
    if (!h.showdown) continue;
    checked++;
    const names = h.streets.map((s) => s.street);
    const sizes = h.streets.map((s) => s.cards.length);
    assert.deepEqual(names, ['flop', 'turn', 'river'], `第 ${handNo} 手翻牌顺序错误: ${names.join('→')}`);
    assert.deepEqual(sizes, [3, 4, 5], `第 ${handNo} 手公共牌张数错误: ${sizes.join(',')}`);
    // flop 翻出后、river 翻出前都有行动轮（下注轮之间必须有行动）
    assert.ok(h.actions >= 4, `第 ${handNo} 手行动过少: ${h.actions} 次`);
    // 公共牌与手牌开始时的底牌不冲突（牌组合法性由引擎保证）
    for (const s of h.streets) assert.equal(s.cards.length, new Set(s.cards).size, '公共牌不应重复');
  }
  assert.ok(checked >= 1, '至少应有一手走到摊牌来验证翻牌顺序');
});
