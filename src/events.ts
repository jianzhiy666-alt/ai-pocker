/** 比赛事件流：引擎 → 服务器 → SSE → 浏览器 的统一事件格式（v0.1） */

import type { ActionType, Street } from './poker/game.js';
import type { DecisionRequest } from './poker/game.js';

export interface TablePlayerView {
  id: string;
  name: string;
  stack: number;
  folded: boolean;
  allIn: boolean;
  committed: number;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: ActionType | null;
}

export type GameEvent =
  | { type: 'mode'; mode: 'arena' }
  | { type: 'identity_created'; playerId: string; name: string }
  | {
      type: 'game_start';
      players: { id: string; name: string; kind: string; model: string }[];
      startingStack: number;
    }
  | { type: 'hand_start'; handNumber: number; level: number; sb: number; bb: number; dealerId: string; players: TablePlayerView[] }
  | { type: 'hole_cards'; playerId: string; cards: string[] }
  | { type: 'street'; street: Street; cards: string[] }
  | { type: 'actor'; playerId: string; request: DecisionRequest }
  | { type: 'thinking'; playerId: string; text: string; model: string }
  | { type: 'table_talk'; playerId: string; message: string }
  | {
      type: 'action';
      playerId: string;
      action: ActionType;
      amount: number;
      reason?: string;
      stack: number;
      committed: number;
      pot: number;
    }
  | {
      type: 'showdown';
      street: Street;
      community: string[];
      results: { playerId: string; holeCards: string[]; hand: string }[];
      winners: { playerId: string; amount: number; hand?: string }[];
      pots: { amount: number; winners: { playerId: string; amount: number }[] }[];
    }
  | { type: 'hand_end'; handNumber: number; players: TablePlayerView[] }
  | { type: 'player_busted'; playerId: string; rank: number; finalStack: number; reason?: 'chips' | 'bottom' }
  | { type: 'tournament_end'; championId: string; standings: { playerId: string; name: string; stack: number; rank: number; kind: string; model: string }[] }
  | { type: 'note'; text: string };
