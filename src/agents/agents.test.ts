import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderState, parseDecision, sanitizeDecision } from './prompt.js';
import { HeuristicAgent } from './heuristic-agent.js';
import { sanitizeName, ensureUnique, randomNameFromPool } from './rename.js';
import { DecisionRequest, ActionType } from '../poker/game.js';
import { Card } from '../poker/cards.js';

function makeReq(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    playerId: 'p1',
    playerName: '测试',
    street: 'preflop',
    holeCards: [{ rank: 'A', suit: '♠' } as Card, { rank: 'K', suit: '♠' } as Card],
    communityCards: [],
    pot: 100,
    streetPot: 40,
    toCall: 20,
    currentBet: 20,
    minRaiseTo: 40,
    maxRaiseTo: 200,
    stack: 180,
    committed: 20,
    position: '庄位(BTN)',
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    players: [{ id: 'p2', name: '对手', stack: 500, folded: false, allIn: false, committed: 20, isDealer: false, isSB: true, isBB: false, lastAction: null }],
    actionHistory: ['对手: 加注到 20'],
    handNumber: 1,
    blindLevel: 1,
    sb: 10,
    bb: 20,
    ...overrides,
  };
}

test('renderState 包含关键信息', () => {
  const text = renderState(makeReq());
  assert.ok(text.includes('A♠'));
  assert.ok(text.includes('K♠'));
  assert.ok(text.includes('20'));
  assert.ok(text.includes('庄位'));
  assert.ok(text.includes('加注'));
});

test('parseDecision 容忍 markdown 代码块与前后杂文', () => {
  const d = parseDecision('```json\n{"action": "raise", "raiseTo": 120, "reason": "手牌很好"}\n```');
  assert.deepEqual(d, { action: 'raise', raiseTo: 120, reason: '手牌很好' });
  const d2 = parseDecision('好的，我考虑一下。{"action":"call","reason":"赔率合适"} 结束。');
  assert.deepEqual(d2, { action: 'call', reason: '赔率合适' });
});

test('parseDecision 拒绝非法 JSON 与非法 action', () => {
  assert.equal(parseDecision('不是JSON'), null);
  assert.equal(parseDecision('{"action":"shove"}'), null);
});

test('sanitizeDecision 将加注目标钳制在合法区间', () => {
  const req = makeReq({ minRaiseTo: 40, maxRaiseTo: 200 });
  const d = sanitizeDecision(req, { action: 'raise', raiseTo: 9999 });
  // 目标达上限 = 全下
  assert.equal(d.action, 'all_in');
  const d2 = sanitizeDecision(req, { action: 'raise', raiseTo: 120 });
  assert.equal(d2.action, 'raise');
  assert.equal(d2.raiseTo, 120);
  const d3 = sanitizeDecision(req, { action: 'raise', raiseTo: 5 });
  assert.equal(d3.raiseTo, 40, '低于最小加注额时钳制到最小值');
});

test('sanitizeDecision 全下目标达到上限时转为 all_in', () => {
  const req = makeReq({ minRaiseTo: 40, maxRaiseTo: 200 });
  const d = sanitizeDecision(req, { action: 'raise', raiseTo: 200 });
  assert.equal(d.action, 'all_in');
});

test('sanitizeDecision 非法 action 降级：check 但需要跟注 → call', () => {
  const req = makeReq({ toCall: 20 });
  const d = sanitizeDecision(req, { action: 'check' });
  assert.equal(d.action, 'call');
});

test('heuristic agent 在极端局面不崩溃且决策合法', async () => {
  const agent = new HeuristicAgent({ id: 'h1', name: '机器人' });
  const scenarios: Partial<DecisionRequest>[] = [
    { toCall: 0, legalActions: ['fold', 'check', 'raise', 'all_in'] },
    { toCall: 99999, stack: 10, legalActions: ['fold', 'call', 'all_in'], minRaiseTo: 99999, maxRaiseTo: 10 },
    { street: 'river', holeCards: [{ rank: '2', suit: '♣' } as Card, { rank: '3', suit: '♦' } as Card], communityCards: [{ rank: 'A', suit: '♠' } as Card, { rank: 'K', suit: '♠' } as Card, { rank: 'Q', suit: '♠' } as Card, { rank: 'J', suit: '♠' } as Card, { rank: 'T', suit: '♠' } as Card], legalActions: ['fold', 'check', 'raise', 'all_in'] },
  ];
  for (const s of scenarios) {
    const d = await agent.decide(makeReq(s));
    assert.ok(['fold', 'check', 'call', 'raise', 'all_in'].includes(d.action), `非法决策: ${d.action}`);
    assert.ok(d.reason, '应有理由');
  }
});

test('启发式机器人改名：返回合法新名字', async () => {
  const agent = new HeuristicAgent({ id: 'h1', name: '刀锋' });
  const reasons = ['big_win', 'busted', 'champion'] as const;
  for (const reason of reasons) {
    const name = await agent.rename(reason, { oldName: '刀锋', amount: 1500, takenNames: ['老鬼', '小喵'] });
    assert.ok(name.length >= 1 && name.length <= 12, `名字长度非法: "${name}"`);
    assert.ok(!name.includes('\n') && !name.includes('<') && !name.includes('>'), `名字含危险字符: "${name}"`);
    assert.notEqual(name, '刀锋', '应改出新名字');
    assert.ok(!['老鬼', '小喵'].includes(name), '不应与现有玩家重名');
  }
});

test('sanitizeName 清洗模型输出', () => {
  assert.equal(sanitizeName('  神秘鲨鱼  '), '神秘鲨鱼');
  assert.equal(sanitizeName('"夜枭"'), '夜枭');
  assert.equal(sanitizeName(''), null);
  assert.equal(sanitizeName('   '), null);
  assert.equal(sanitizeName('这是一个非常非常长的名字超过十个字了'), '这是一个非常非常长的', '超长名字截断到 10 字');
});

test('ensureUnique 处理重名', () => {
  const rng = () => 0.5;
  assert.equal(ensureUnique('鲨鱼', ['鲨鱼', '老鬼'], rng), '鲨鱼·改');
  assert.equal(ensureUnique('老鬼', ['老鬼', '老鬼·改'], rng), '老鬼·2.0');
  assert.equal(ensureUnique('新名字', ['老鬼'], rng), '新名字');
});

test('词库随机名符合长度要求', () => {
  for (let i = 0; i < 50; i++) {
    const name = randomNameFromPool(Math.random);
    assert.ok(name.length >= 2 && name.length <= 12, `词库名过长: "${name}"`);
  }
});
