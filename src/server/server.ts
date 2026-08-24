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

/** 人类玩家 id 集合（从 runner 动态读取，配置改动重启后自动生效） */
type ViewerId = string; // 声称的人类座位 id，或 'spectator'

/**
 * 按观看者身份过滤事件：
 * - 有真人同桌时，只有"该真人的座位"能收到自己的底牌；观战者与其它真人收不到任何底牌
 *   （两台设备各选座位互不泄露，公平对战；也杜绝开第二个观战标签偷看）
 * - actor 事件里的 request.holeCards 只发给行动者本人（否则会泄露 AI/其它真人底牌）
 * - 纯 AI 对局（无真人）：全部可见，观战者照常看所有底牌
 */
function filterForViewer(evt: GameEvent, viewer: ViewerId, humanIds: string[]): GameEvent | null {
  const humanSet = new Set(humanIds);
  if (evt.type === 'hole_cards') {
    if (humanSet.size > 0) {
      if (humanSet.has(evt.playerId) && evt.playerId === viewer) return evt;
      return null; // 观战者/其它真人：本手不发底牌（摊牌时通过 showdown 统一亮牌）
    }
    return evt;
  }
  if (evt.type === 'actor') {
    // 行动请求里的底牌只给行动者本人；其它客户端（含观战）去掉，避免泄露
    if (evt.playerId !== viewer && evt.request.holeCards.length > 0) {
      return { ...evt, request: { ...evt.request, holeCards: [] } };
    }
  }
  return evt;
}

export function createServer(runner: GameRunner) {
  const app = express();
  app.use(express.json());

  // 健康检查（Render 等托管平台探测用）
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, status: runner.getStatus() });
  });

  // 静态资源（观战页面）
  const webDir = path.join(ROOT, 'src', 'web');
  app.use(express.static(webDir));

  // SSE 事件流：?viewer=<人类座位id|spectator> 决定该客户端能看到谁的底牌
  app.get('/api/events', (req: express.Request, res: Response) => {
    const viewer = String(req.query.viewer ?? 'spectator');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);
    const pass = (evt: GameEvent) => {
      const f = filterForViewer(evt, viewer, runner.getHumanIds());
      if (f) res.write(`data: ${JSON.stringify(f)}\n\n`);
    };
    // 新客户端先收到完整历史，恢复现场（用命名事件 replay，浏览器侧静默处理不打日志）
    for (const evt of runner.getHistory()) {
      const f = filterForViewer(evt, viewer, runner.getHumanIds());
      if (f) res.write(`event: replay\ndata: ${JSON.stringify(f)}\n\n`);
    }
    runner.on('event', pass);
    res.on('close', () => {
      runner.off('event', pass);
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
