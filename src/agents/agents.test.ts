import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderState, parseDecision, sanitizeDecision } from './prompt.js';
import { HeuristicAgent } from './heuristic-agent.js';
import { sanitizeName, ensureUniqueName, nameFromPool, parseName } from './identity.js';
import { parseTalk, talkFromPool } from './talk.js';
import { DecisionRequest } from '../poker/game.js';
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

test('renderState 极简格式包含关键信息', () => {
  const text = renderState(makeReq());
  assert.ok(text.includes('A♠ K♠'));
  assert.ok(text.includes('位置: 庄位(BTN)'));
  assert.ok(text.includes('底池'));
  assert.ok(text.includes('合法行动'));
  assert.ok(text.includes('加注 2.0–10.0 BB'), 'BB 单位显示');
});

test('parseDecision 容忍 markdown 与 amount_bb 格式', () => {
  const d = parseDecision('```json\n{"action": "raise", "amount_bb": 6}\n```');
  assert.ok(d);
  assert.equal(d!.action, 'raise');
  assert.equal(d!.amountBB, 6);
  const d2 = parseDecision('好的。{"action":"call","reason":"赔率合适"} 结束。');
  assert.deepEqual(d2, { action: 'call', reason: '赔率合适' });
  // 中文引号（部分模型输出习惯）
  const d3 = parseDecision('{"action"：“raise”，"amount_bb"：8}');
  assert.equal(d3!.action, 'raise');
  assert.equal(d3!.amountBB, 8);
});

test('parseDecision 拒绝非法 JSON 与非法 action', () => {
  assert.equal(parseDecision('不是JSON'), null);
  assert.equal(parseDecision('{"action":"shove"}'), null);
});

test('sanitizeDecision：amount_bb 换算成筹码并钳制合法区间', () => {
  const req = makeReq({ minRaiseTo: 40, maxRaiseTo: 200, bb: 20 });
  const d = sanitizeDecision(req, { action: 'raise', amountBB: 6 }); // 6 BB = 120 筹码
  assert.equal(d.action, 'raise');
  assert.equal(d.raiseTo, 120);
  const d2 = sanitizeDecision(req, { action: 'raise', amountBB: 999 });
  assert.equal(d2.action, 'all_in');
  const d3 = sanitizeDecision(req, { action: 'raise', amountBB: 1 });
  assert.equal(d3.raiseTo, 40, '低于最小加注额钳制到最小值');
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
  }
});

test('启发式机器人取名：返回合法且唯一的名字', async () => {
  const a = new HeuristicAgent({ id: 'h1', name: '刀锋' });
  const a2 = new HeuristicAgent({ id: 'h2', name: '老鬼', seed: 99 });
  const name = await a.createIdentity();
  const name2 = await a2.createIdentity();
  assert.ok(name.length >= 1 && name.length <= 12, `名字非法: "${name}"`);
  assert.equal(a.currentName, name, '取名后 currentName 同步');
  assert.notEqual(name, '刀锋');
  // 唯一化
  const unique = ensureUniqueName(name, [name], Math.random);
  assert.notEqual(unique, name);
});

test('sanitizeName / parseName 清洗模型输出', () => {
  assert.equal(sanitizeName('  神秘鲨鱼  '), '神秘鲨鱼');
  assert.equal(sanitizeName('"夜枭"'), '夜枭');
  assert.equal(sanitizeName(''), null);
  assert.equal(parseName('{"name": "ColdRiver"}'), 'ColdRiver');
  assert.equal(parseName('{"name": "这是非常非常长的名字超过十个字"}'), '这是非常非常长的名字');
  assert.equal(parseName('不是JSON'), null);
});

test('nameFromPool 词库名字符合长度', () => {
  for (let i = 0; i < 30; i++) {
    const name = nameFromPool(Math.random);
    assert.ok(name.length >= 1 && name.length <= 12, `词库名非法: "${name}"`);
  }
});

test('parseTalk 解析发言（空消息=沉默）', () => {
  assert.equal(parseTalk('{"message": "你确定吗？"}'), '你确定吗？');
  assert.equal(parseTalk('```json\n{"message": ""}\n```'), '');
  assert.equal(parseTalk('不是JSON'), '');
});

test('talkFromPool 返回合法短句', () => {
  const msg = talkFromPool(Math.random);
  assert.ok(msg.length > 0 && msg.length <= 40);
});
