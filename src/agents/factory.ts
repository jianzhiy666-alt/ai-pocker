/** 从 config/players.json 加载玩家并构造智能体 */

import fs from 'node:fs';
import { PlayerAgent } from './types.js';
import { HeuristicAgent } from './heuristic-agent.js';
import { LLMAgent } from './llm-agent.js';
import { createProvider, ProviderName } from '../providers/registry.js';
import { config } from '../config.js';

export interface PlayerConfigEntry {
  id?: string;
  name: string;
  provider?: string;
  model?: string;
  persona?: string;
}

export function loadPlayerConfigs(): PlayerConfigEntry[] {
  if (!fs.existsSync(config.playersPath)) {
    console.warn(`[警告] 找不到 ${config.playersPath}，使用默认 2 人局`);
    return [
      { id: 'blade', name: '刀锋', provider: 'heuristic' },
      { id: 'oldghost', name: '老鬼', provider: 'heuristic' },
    ];
  }
  return JSON.parse(fs.readFileSync(config.playersPath, 'utf-8')) as PlayerConfigEntry[];
}

export function buildAgents(entries: PlayerConfigEntry[]): PlayerAgent[] {
  return entries.map((e, i) => {
    const id = e.id ?? `player${i + 1}`;
    const providerName = (e.provider ?? 'heuristic') as ProviderName | 'heuristic';
    if (providerName === 'heuristic') {
      return new HeuristicAgent({ id, name: e.name, seed: i + 1 });
    }
    const provider = createProvider(providerName, e.model);
    if (!provider) {
      console.warn(`[警告] ${e.name}: provider "${providerName}" 未配置 API key，回退为启发式机器人（在 .env 中设置对应 key 后重启生效）`);
      return new HeuristicAgent({ id, name: e.name, seed: i + 1 });
    }
    return new LLMAgent({ id, name: e.name, provider, timeoutMs: config.llmTimeoutMs });
  });
}
