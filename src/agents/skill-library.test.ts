import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillGuide } from './skill-library.js';
import { renderState } from './prompt.js';
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
    players: [],
    actionHistory: [],
    handNumber: 1,
    blindLevel: 1,
    sb: 50,
    bb: 100,
    ...overrides,
  };
}

test('翻前技能库：庄位给放宽范围，包含偷盲提示', () => {
  const g = buildSkillGuide(makeReq({ position: '庄位(BTN)' }));
  assert.ok(g.includes('翻前范围'));
  assert.ok(g.includes('40%'));
  assert.ok(g.includes('偷盲'));
});

test('翻前技能库：枪口给紧范围', () => {
  const g = buildSkillGuide(makeReq({ position: '枪口(UTG)' }));
  assert.ok(g.includes('15%'));
  assert.ok(g.includes('口袋对 77+'));
});

test('翻前技能库：未知位置兜底为庄位', () => {
  const g = buildSkillGuide(makeReq({ position: '位置7' }));
  assert.ok(g.includes('40%'));
});

test('翻后技能库：强成牌建议价值下注', () => {
  const req = makeReq({
    street: 'river',
    holeCards: [{ rank: 'A', suit: '♠' } as Card, { rank: 'A', suit: '♥' } as Card],
    communityCards: [
      { rank: 'A', suit: '♦' } as Card, { rank: 'K', suit: '♥' } as Card,
      { rank: 'K', suit: '♠' } as Card, { rank: '3', suit: '♣' } as Card, { rank: '7', suit: '♠' } as Card,
    ],
    toCall: 0,
  });
  const g = buildSkillGuide(req);
  assert.ok(g.includes('翻后指导'));
  assert.ok(g.includes('价值'));
});

test('翻后技能库：没成牌建议控池/诈唬，并给出赔率提示', () => {
  const req = makeReq({
    street: 'river',
    holeCards: [{ rank: '2', suit: '♣' } as Card, { rank: '4', suit: '♦' } as Card],
    communityCards: [
      { rank: 'K', suit: '♠' } as Card, { rank: 'Q', suit: '♥' } as Card,
      { rank: '9', suit: '♦' } as Card, { rank: '3', suit: '♣' } as Card, { rank: '7', suit: '♠' } as Card,
    ],
    toCall: 50,
    pot: 200,
  });
  const g = buildSkillGuide(req);
  assert.ok(g.includes('诈唬') || g.includes('弃牌'));
  assert.ok(g.includes('%'), '应包含赔率提示');
});

test('renderState 已注入技能库段', () => {
  const text = renderState(makeReq());
  assert.ok(text.includes('技能库'));
});
