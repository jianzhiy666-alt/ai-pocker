/** 入口：启动 HTTP 服务器（浏览器打开观战），自动开局 */

import { config } from './config.js';
import { buildAgents, loadPlayerConfigs } from './agents/factory.js';
import { GameRunner } from './runner.js';
import { createServer } from './server/server.js';

const agents = buildAgents(loadPlayerConfigs());
console.log(`选手就绪 (${agents.length} 人):`);
for (const a of agents) console.log(`  - ${a.name} [${a.model}]`);

const runner = new GameRunner({ agents });
runner.on('event', (evt) => {
  if (evt.type === 'identity_created') console.log(`  🎭 ${evt.playerId} 取名: ${evt.name}`);
  if (evt.type === 'player_busted') console.log(`  💀 ${evt.playerId} 被淘汰 (第 ${evt.rank} 名)`);
  if (evt.type === 'tournament_end') {
    console.log(`\n🏆 冠军: ${evt.championId}`);
    for (const s of evt.standings) console.log(`   #${s.rank} ${s.name} 筹码 ${s.stack}`);
  }
});

const app = createServer(runner);
app.listen(config.port, () => {
  console.log(`\n🤠 AI 扑克擂台 v0.1: http://localhost:${config.port}`);
  console.log(`   6-Max NLHE | 100 BB 起步不重置 | 盲注 ${config.bb / 2}/${config.bb} 固定 | 输光淘汰 | 最后一人获胜`);
  console.log(`   选手: ${agents.map((a) => a.name).join('、')}\n`);
  runner.start();
});
