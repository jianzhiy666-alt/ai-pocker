/**
 * 7 张牌德州扑克牌力评估
 *
 * 复用开源库 pokersolver（https://github.com/goldfire/pokersolver，生产环境久经考验），
 * 本文件只是适配层：转换牌格式、提供中文牌型名与可比分数。
 */

import { createRequire } from 'node:module';
import { Card, RANK_VALUE } from './cards.js';
import type { SolvedHand } from 'pokersolver';

const require = createRequire(import.meta.url);
const { Hand } = require('pokersolver') as { Hand: typeof import('pokersolver').Hand };

/** 牌型等级，越大越强（pokersolver 的 rank 为 1..9，这里归一为 0..8） */
export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES_CN: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.OnePair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.ThreeOfAKind]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.FourOfAKind]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
};

export interface HandResult {
  category: HandCategory;
  /** 用于展示/调试的数值；同牌型内 kicker 越大越高（实际胜负判定请用 bestHands） */
  score: number;
  /** 最佳 5 张牌（展示用） */
  cards: Card[];
  /** 中文牌型名 */
  name: string;
  /** 英文详细描述，如 "Two Pair, A's & Q's" */
  descr: string;
  /** 原始 pokersolver 手牌对象（比较胜负用） */
  hand: SolvedHand;
}

const SUIT_MAP: Record<string, string> = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const SUIT_REV: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const toPokerSolverCard = (c: Card): string => `${c.rank}${SUIT_MAP[c.suit]}`;
/** pokersolver 的 cards 元素是对象 { value, suit }，如 { value: 'K', suit: 'c' } */
export const fromPokerSolverCard = (c: { value: string; suit: string }): Card => {
  const suit = SUIT_REV[c.suit];
  if (!suit) throw new Error(`非法牌: ${JSON.stringify(c)}`);
  return { rank: c.value as Card['rank'], suit: suit as Card['suit'] };
};

const BASE = 15;

/** 评估 7 张牌（5 张也会给出结果），返回最佳 5 张组合 */
export function evaluate7(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error('至少需要 5 张牌才能评估');
  const hand = Hand.solve(cards.map(toPokerSolverCard));
  const best5 = hand.cards.slice(0, 5).map(fromPokerSolverCard);
  // standard 规则 rank: 1=HighCard .. 9=StraightFlush（10 项含不可能出现的 FiveOfAKind）
  const category = (hand.rank - 1) as HandCategory;
  // 展示用分数：category * 15^5 + 5 张牌 rank 编码
  const values = best5.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  let score = category;
  for (let i = 0; i < 5; i++) score = score * BASE + (values[i] ?? 0);
  return {
    category,
    score,
    cards: best5,
    name: CATEGORY_NAMES_CN[category],
    descr: hand.descr,
    hand,
  };
}

/** 从一组已评估的手牌中选出最强的一手或多手（平局返回多个），用于分池 */
export function bestHands(results: HandResult[]): HandResult[] {
  if (results.length === 0) return [];
  if (results.length === 1) return [results[0]!];
  const winners = Hand.winners(results.map((r) => r.hand));
  const winnerSet = new Set<SolvedHand>(winners);
  return results.filter((r) => winnerSet.has(r.hand));
}

/** 展示文本，如 "葫芦 (K♥K♠K♦ T♠T♥)" */
export function describeHand(result: HandResult): string {
  return `${result.name} (${result.cards.map((c) => `${c.rank}${c.suit}`).join(' ')})`;
}
