/** 入口：启动 HTTP 服务器（浏览器打开观战），默认自动开局 */

import { config } from './config.js';
import { buildAgents, loadPlayerConfigs } from './agents/factory.js';
import { GameRunner } from './runner.js';
import { createServer } from './server/server.js';

const agents = buildAgents(loadPlayerConfigs());
console.log(`选手就绪 (${agents.length} 人):`);
for (const a of agents) console.log(`  - ${a.name} [${a.model}]`);

const runner = new GameRunner({ agents });
runner.on('event', (evt) => {
  if (evt.type === 'tournament_end') {
    console.log(`\n🏆 冠军: ${evt.championId}`);
    for (const s of evt.standings) console.log(`   #${s.rank} ${s.name} 筹码 ${s.stack}`);
  }
});

const app = createServer(runner);
app.listen(config.port, () => {
  console.log(`\n🤠 AI 扑克擂台已启动: http://localhost:${config.port}`);
  console.log(`   初始筹码 ${config.startingStack} | 每 ${config.handsPerLevel} 手升盲 | 双击空格可暂停\n`);
  runner.start();
});
