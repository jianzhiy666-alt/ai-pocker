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

test('Arena: 每手结束嘴炮不进决策上下文', async () => {
  const { events, arena } = makeArena(10);
  await arena.run();
  for (const e of events) {
    if (e.type === 'actor') {
      assert.equal(e.request.tableTalk, undefined, 'v0.1 决策上下文不含嘴炮');
      assert.equal(e.request.publicEvents, undefined, 'v0.1 决策上下文不含公开事件记忆');
    }
  }
});
