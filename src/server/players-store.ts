/** players.json 读写工具（用于网页端配置玩家 provider/model） */

import fs from 'node:fs';
import { PLAYERS_PATH } from '../config.js';

export interface PlayerConfigFile {
  id: string;
  name: string;
  provider?: string;
  model?: string;
}

export function readPlayers(): PlayerConfigFile[] {
  return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')) as PlayerConfigFile[];
}

export function writePlayers(players: PlayerConfigFile[]): void {
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2) + '\n');
}

/** 更新单个玩家配置（provider/model），不存在则抛错 */
export function updatePlayer(id: string, patch: { provider?: string; model?: string }): void {
  const players = readPlayers();
  const p = players.find((x) => x.id === id);
  if (!p) throw new Error(`未知玩家: ${id}`);
  if (patch.provider !== undefined) {
    if (!/^[a-z]+$/.test(patch.provider)) throw new Error('非法 provider');
    p.provider = patch.provider;
  }
  if (patch.model !== undefined) {
    p.model = patch.model.trim() || undefined;
  }
  writePlayers(players);
}
