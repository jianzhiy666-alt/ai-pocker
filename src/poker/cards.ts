/** 扑克牌基础类型与工具 */

export type Suit = '♠' | '♥' | '♦' | '♣';
export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];

/** 牌面顺序（升序） */
export const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANK_ORDER)[number];

export const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** 唯一标识，如 "A♠" */
export const cardId = (c: Card): string => `${c.rank}${c.suit}`;

export const parseCard = (s: string): Card => {
  const rank = s[0] as Rank;
  const suit = s[1] as Suit;
  if (!(rank in RANK_VALUE) || !SUITS.includes(suit)) throw new Error(`非法牌: ${s}`);
  return { rank, suit };
};

export const cardText = (c: Card): string => `${c.rank}${c.suit}`;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANK_ORDER) deck.push({ rank, suit });
  return deck;
}

/** Fisher–Yates 洗牌 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
