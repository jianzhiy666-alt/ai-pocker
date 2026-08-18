/** 无头模式：控制台跑完整比赛（不需要浏览器），用于快速验证 */

import { config } from '../src/config.js';
import { buildAgents, loadPlayerConfigs } from '../src/agents/factory.js';
import { Arena } from '../src/arena.js';
import type { GameEvent } from '../src/events.js';

const agents = buildAgents(loadPlayerConfigs());
console.log(`选手 (${agents.length} 人): ${agents.map((a) => a.name).join('、')}`);
console.log(`初始筹码 ${config.startingStackBB} BB | 盲注 ${config.bb / 2}/${config.bb} 固定不涨\n`);

const onEvent = (evt: GameEvent) => {
  switch (evt.type) {
    case 'identity_created':
      console.log(`  🎭 ${evt.playerId} 取名: ${evt.name}`);
      break;
    case 'hand_start': {
      const lines = evt.players.map((p) => `${p.name}(${(p.stack / config.bb).toFixed(0)}BB)`).join(' ');
      console.log(`\n=== 第 ${evt.handNumber} 手 | ${evt.sb}/${evt.bb} | 庄:${evt.dealerId} ===`);
      console.log(`  ${lines}`);
      break;
    }
    case 'action':
      console.log(`  [行动] ${evt.playerId} ${evt.action}${evt.amount ? ` ${evt.amount}` : ''}${evt.reason ? ` — ${evt.reason}` : ''}`);
      break;
    case 'showdown':
      for (const w of evt.winners) console.log(`  [摊牌] ${w.playerId} 赢 ${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
      break;
    case 'table_talk':
      console.log(`  💬 ${evt.playerId}: ${evt.message}`);
      break;
    case 'player_busted':
      console.log(`  💀 ${evt.playerId} 输光淘汰 (第 ${evt.rank} 名)`);
      break;
    case 'tournament_end':
      console.log(`\n🏆 冠军: ${evt.championId}`);
      for (const s of evt.standings) console.log(`   #${s.rank} ${s.name} [${s.model}] 筹码 ${s.stack}`);
      break;
    default:
      break;
  }
};

const arena = new Arena({
  agents,
  bb: config.bb,
  startingStackBB: config.startingStackBB,
  handDelayMs: 40,
  actionDelayMs: 20,
  onEvent,
});
await arena.run();
console.log('\n[结束]');
