/** HTTP 服务器：静态页面 + SSE 事件流 + 控制接口 */

import express from 'express';
import path from 'node:path';
import type { Response } from 'express';
import { ROOT, config } from '../config.js';
import { GameRunner } from '../runner.js';
import type { GameEvent } from '../events.js';
import { readPlayers, updatePlayer } from './players-store.js';
import { setEnvKey } from './env-store.js';
import { PROVIDER_DEFS } from '../providers/registry.js';

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
    // 新客户端先收到完整历史，恢复现场（用命名事件 replay，浏览器侧静默处理不打日志）
    for (const evt of runner.getHistory()) {
      res.write(`event: replay\ndata: ${JSON.stringify(evt)}\n\n`);
    }
    const onEvent = (evt: GameEvent) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    runner.on('event', onEvent);
    res.on('close', () => {
      runner.off('event', onEvent);
    });
  });

  // 人类玩家行动（UI 操作面板）
  app.post('/api/human-action', (req, res) => {
    const { playerId, action, raiseTo } = (req.body ?? {}) as { playerId?: string; action?: string; raiseTo?: number };
    if (!playerId || !action) {
      res.status(400).json({ error: '缺少 playerId 或 action' });
      return;
    }
    const r = runner.submitHumanAction(playerId, { action, raiseTo });
    if (!r.ok) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json({ ok: true });
  });

  // 玩家/模型配置管理（网页端点击 AI 头像配置）
  app.get('/api/players', (_req, res) => {
    const players = readPlayers().map((p) => ({ id: p.id, name: p.name, provider: p.provider ?? 'heuristic', model: p.model ?? '' }));
    const providers = Object.entries(PROVIDER_DEFS).map(([name, def]) => ({
      name,
      label: def.label,
      keySet: Boolean(process.env[def.envKey]),
      defaultModel: def.defaultModel,
    }));
    res.json({ players, providers });
  });

  app.post('/api/players/:id', (req, res) => {
    try {
      const { provider, model } = (req.body ?? {}) as { provider?: string; model?: string };
      updatePlayer(req.params.id, { provider, model });
      runner.reloadAgents();
      res.json({ ok: true, note: '配置已保存，比赛自动重启' });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/providers', (req, res) => {
    try {
      const { name, apiKey } = (req.body ?? {}) as { name?: string; apiKey?: string };
      const def = PROVIDER_DEFS[name as keyof typeof PROVIDER_DEFS];
      if (!def) return res.status(400).json({ error: `未知 provider: ${name}` });
      if (!apiKey || !apiKey.trim()) return res.status(400).json({ error: 'API key 不能为空' });
      setEnvKey(def.envKey, apiKey.trim());
      runner.reloadAgents();
      res.json({ ok: true, note: `${def.label} 的 API key 已保存，比赛自动重启` });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 状态查询
  app.get('/api/status', (_req, res) => {
    res.json({ status: runner.getStatus(), players: runner.agentCount, eliminateBottomEvery: config.eliminateBottomEvery });
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
