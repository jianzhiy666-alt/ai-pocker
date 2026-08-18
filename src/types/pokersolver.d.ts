/** pokersolver (CommonJS, 无自带类型) 的 TypeScript 声明 */

declare module 'pokersolver' {
  export interface SolvedHandCard {
    value: string;
    suit: string;
    rank: number;
    wildValue: string | null;
  }

  export interface SolvedHand {
    /** 牌型排名：1=高牌 ... 9=同花顺（standard 规则，含不可能出现的 FiveOfAKind=10） */
    rank: number;
    /** 英文牌型名，如 "Full House" */
    name: string;
    /** 详细描述，如 "Two Pair, A's & Q's" */
    descr: string;
    /** 参与成牌的最佳 5 张牌（对象数组） */
    cards: SolvedHandCard[];
    cardPool: SolvedHandCard[];
    toString(): string;
    /** 与另一手比较，返回 1/-1/0 */
    compare(other: SolvedHand): number;
  }

  export const Hand: {
    solve(cards: string[], game?: string, canDisqualify?: boolean): SolvedHand;
    /** 从一组已解算的手牌中返回最强的一手或多手（平局返回多个） */
    winners(hands: SolvedHand[]): SolvedHand[];
  };
}
