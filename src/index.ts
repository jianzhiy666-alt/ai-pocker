/** 入口：启动 HTTP 服务器（浏览器打开观战），自动开局 */

import { config } from './config.js';
import { buildAgents, loadPlayerConfigs } from './agents/factory.js';
import { GameRunner } from './runner.js';
import { createServer } from './server/server.js';

const agents = buildAgents(loadPlayerConfigs());
console.log(`选手就绪 (${agents.length} 人):`);
for (const a of agents) console.log(`  - ${a.name} [${a.model}]`);

// 启动前健康检查：探测每个模型是否可用（不可用的会自动降级为启发式机器人）
console.log('\n模型健康检查:');
const results = await Promise.all(agents.map(async (a) => ({ a, ok: (await a.ping?.()) ?? true })));
for (const { a, ok } of results) {
  console.log(`  ${ok ? '✅' : '❌'} ${a.name} [${a.model}]${ok ? '' : '  ← 不可用，比赛中将降级为启发式机器人'}`);
}

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
const server = app.listen(config.port, () => {
  console.log(`\n🤠 AI 扑克擂台 v0.1: http://localhost:${config.port}`);
  console.log(`   6-Max NLHE | 100 BB 起步不重置 | 输光淘汰 | 最后一人获胜`);
  console.log(`   选手: ${agents.map((a) => a.name).join('、')}\n`);
  runner.start();
});

// 优雅停机（Render 等平台部署/重启时发送 SIGTERM）：先停比赛，再关服务
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在停止比赛并关闭服务器…`);
    runner.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
