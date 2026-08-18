/** 无头模式：控制台跑完整锦标赛，用于快速验证（不需要浏览器） */

import { config } from '../src/config.js';
import { buildAgents, loadPlayerConfigs } from '../src/agents/factory.js';
import { Tournament } from '../src/tournament.js';
import type { GameEvent } from '../src/events.js';

const agents = buildAgents(loadPlayerConfigs());
console.log(`选手 (${agents.length} 人): ${agents.map((a) => a.name).join('、')}`);
console.log(`初始筹码 ${config.startingStack} | 每 ${config.handsPerLevel} 手升盲\n`);

const onEvent = (evt: GameEvent) => {
  switch (evt.type) {
    case 'blind_change':
      console.log(`\n[盲注升级] 第 ${evt.level} 级 SB ${evt.sb} / BB ${evt.bb}`);
      break;
    case 'hand_start': {
      const lines = evt.players.map((p) => `${p.name}(${p.stack})`).join(' ');
      console.log(`\n=== 第 ${evt.handNumber} 手 | L${evt.level} ${evt.sb}/${evt.bb} | 庄:${evt.dealerId} ===`);
      console.log(`  ${lines}`);
      break;
    }
    case 'action':
      console.log(`  [行动] ${evt.playerId} ${evt.action}${evt.amount ? ` ${evt.amount}` : ''} ${evt.reason ? `— ${evt.reason}` : ''}`);
      break;
    case 'showdown':
      for (const w of evt.winners) console.log(`  [摊牌] ${w.playerId} 赢 ${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
      break;
    case 'player_busted':
      console.log(`  💀 ${evt.playerId} 被淘汰 (第 ${evt.rank} 名)`);
      break;
    case 'tournament_end':
      console.log(`\n🏆 冠军: ${evt.championId}`);
      for (const s of evt.standings) console.log(`   #${s.rank} ${s.name} [${s.model}] 筹码 ${s.stack}`);
      break;
    default:
      break;
  }
};

const t = new Tournament({
  agents,
  startingStack: config.startingStack,
  handsPerLevel: config.handsPerLevel,
  handDelayMs: 60,
  actionDelayMs: 30,
  onEvent,
});
await t.run();
console.log('\n[结束]');
