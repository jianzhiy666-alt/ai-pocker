import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate7, bestHands, HandCategory } from './evaluator.js';
import { parseCard } from './cards.js';

const h = (...s: string[]) => s.map(parseCard);

test('高牌', () => {
  const r = evaluate7(h('2♠', '7♥', '9♦', 'J♠', 'K♣', '3♥', 'Q♦'));
  assert.equal(r.category, HandCategory.HighCard);
  assert.equal(r.cards.length, 5);
});

test('一对 / 两对 / 三条 / 顺子 / 同花 / 葫芦 / 四条 / 同花顺', () => {
  const cases: [string[], HandCategory][] = [
    [['A♠', 'A♥', '9♦', 'J♠', 'K♣', '3♥', 'Q♦'], HandCategory.OnePair],
    [['A♠', 'A♥', '9♦', '9♠', 'K♣', '3♥', 'Q♦'], HandCategory.TwoPair],
    [['A♠', 'A♥', 'A♦', '9♠', 'K♣', '3♥', 'Q♦'], HandCategory.ThreeOfAKind],
    [['9♠', 'T♥', 'J♦', 'Q♠', 'K♣', '3♥', '2♦'], HandCategory.Straight],
    [['A♠', '7♠', '9♦', 'J♠', 'K♠', '3♥', 'Q♠'], HandCategory.Flush],
    [['A♠', 'A♥', 'A♦', 'K♠', 'K♣', '3♥', 'Q♦'], HandCategory.FullHouse],
    [['A♠', 'A♥', 'A♦', 'A♣', 'K♣', '3♥', 'Q♦'], HandCategory.FourOfAKind],
    [['9♠', 'T♠', 'J♠', 'Q♠', 'K♠', '3♥', 'Q♦'], HandCategory.StraightFlush],
  ];
  for (const [cards, cat] of cases) {
    assert.equal(evaluate7(h(...cards)).category, cat, cards.join(' '));
  }
});

test('轮子顺 A2345', () => {
  const wheel = evaluate7(h('A♠', '2♥', '3♦', '4♠', '5♣', '9♥', 'T♦'));
  assert.equal(wheel.category, HandCategory.Straight);
  const six = evaluate7(h('2♠', '3♥', '4♦', '5♠', '6♣', '9♥', 'T♦'));
  const best = bestHands([wheel, six]);
  assert.equal(best.length, 1);
  assert.equal(best[0], six, '6-high 顺应大于 A2345');
});

test('牌力比较：四条 > 葫芦 > 同花 > 顺子', () => {
  const quads = evaluate7(h('A♠', 'A♥', 'A♦', 'A♣', 'K♣', '3♥', 'Q♦'));
  const full = evaluate7(h('K♠', 'K♥', 'K♦', 'Q♠', 'Q♣', '3♥', 'Q♦'));
  const flush = evaluate7(h('A♠', '7♠', '9♠', 'J♠', 'K♠', '3♥', 'Q♠'));
  const straight = evaluate7(h('9♠', 'T♥', 'J♦', 'Q♠', 'K♣', '3♥', '2♦'));
  const best = bestHands([straight, flush, full, quads]);
  assert.equal(best.length, 1);
  assert.equal(best[0], quads);
});

test('平局：公共牌两对，两人平分', () => {
  const board = ['A♠', 'A♥', '9♦', '3♠', '3♣'];
  const p1 = evaluate7(h('2♠', '4♥', ...board));
  const p2 = evaluate7(h('5♠', '6♥', ...board));
  const best = bestHands([p1, p2]);
  assert.equal(best.length, 2, '两副完全相同的两对应平局');
  assert.equal(p1.category, HandCategory.TwoPair);
  assert.equal(p1.score, p2.score);
});

test('踢脚比较：A-K 两对 > A-Q 两对', () => {
  const p1 = evaluate7(h('A♠', 'A♥', 'K♦', 'K♠', 'Q♣', '3♥', '9♦'));
  const p2 = evaluate7(h('A♠', 'A♥', 'K♦', 'K♠', 'J♣', '3♥', '9♦'));
  const best = bestHands([p2, p1]);
  assert.equal(best[0], p1);
});

test('葫芦比三条大小：AAA 葫芦 > KKK 葫芦', () => {
  const aaa = evaluate7(h('A♠', 'A♥', 'A♦', 'K♠', 'K♣', '3♥', 'Q♦'));
  const kkk = evaluate7(h('K♠', 'K♥', 'K♦', 'A♠', 'A♣', '3♥', 'Q♦'));
  const best = bestHands([kkk, aaa]);
  assert.equal(best[0], aaa);
});
