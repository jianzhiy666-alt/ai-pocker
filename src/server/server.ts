/** HTTP 服务器：静态页面 + SSE 事件流 + 控制接口 */

import express from 'express';
import path from 'node:path';
import type { Response } from 'express';
import { ROOT } from '../config.js';
import { GameRunner } from '../runner.js';
import type { GameEvent } from '../events.js';

const SSE_RETRY_MS = 3000;

export function createServer(runner: GameRunner) {
  const app = express();
  app.use(express.json());

  // 静态资源（观战页面）
  const webDir = path.join(ROOT, 'src', 'web');
  app.use(express.static(webDir));

  // SSE 事件流
  app.get('/api/events', (req: express.Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);
    // 新客户端先收到完整历史，恢复现场
    for (const evt of runner.getHistory()) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
    const onEvent = (evt: GameEvent) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    runner.on('event', onEvent);
    res.on('close', () => {
      runner.off('event', onEvent);
    });
  });

  // 状态查询
  app.get('/api/status', (_req, res) => {
    res.json({ status: runner.getStatus(), players: runner.agentCount });
  });

  // 控制
  app.post('/api/control', (req, res) => {
    const action = String(req.body?.action ?? '');
    switch (action) {
      case 'start':
        runner.start();
        break;
      case 'pause':
        runner.pause();
        break;
      case 'resume':
        runner.resume();
        break;
      case 'stop':
        runner.stop();
        break;
      case 'restart':
        runner.restart();
        break;
      case 'speed': {
        const v = Number(req.body?.value ?? 1);
        runner.setSpeed(Number.isFinite(v) ? v : 1);
        res.json({ ok: true, status: runner.getStatus(), speed: runner.getSpeed() });
        return;
      }
      default:
        res.status(400).json({ error: `未知操作: ${action}` });
        return;
    }
    res.json({ ok: true, status: runner.getStatus() });
  });

  return app;
}
