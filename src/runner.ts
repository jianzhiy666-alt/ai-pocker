/** 比赛控制器：管理 Arena 生命周期并把事件广播给 SSE 客户端 */

import { EventEmitter } from 'node:events';
import type { GameEvent } from './events.js';
import { Arena } from './arena.js';
import type { PlayerAgent } from './agents/types.js';
import { HumanAgent } from './agents/human-agent.js';
import { buildAgents, loadPlayerConfigs } from './agents/factory.js';
import { config } from './config.js';
import type { Decision } from './poker/game.js';
import { sanitizeDecision } from './agents/prompt.js';

export interface RunnerOptions {
  agents: PlayerAgent[];
  onStatusChange?: (status: RunnerStatus) => void;
}

export type RunnerStatus = 'idle' | 'running' | 'paused';

export class GameRunner extends EventEmitter {
  private opts: RunnerOptions;
  private agents: PlayerAgent[];
  private arena: Arena | null = null;
  private status: RunnerStatus = 'idle';
  private history: GameEvent[] = [];
  private readonly HISTORY_LIMIT = 800;
  private speed = 1;

  constructor(opts: RunnerOptions) {
    super();
    this.opts = opts;
    this.agents = opts.agents;
  }

  getStatus(): RunnerStatus {
    return this.status;
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.25, Math.min(8, multiplier));
  }

  getSpeed(): number {
    return this.speed;
  }

  getHistory(): GameEvent[] {
    return this.history;
  }

  get agentCount(): number {
    return this.agents.length;
  }

  /** 从 players.json/.env 重新加载选手配置并重启比赛（网页端改配置后调用） */
  reloadAgents(): void {
    this.agents = buildAgents(loadPlayerConfigs());
    this.restart();
  }

  /** 人类玩家提交决策（UI 操作面板调用） */
  submitHumanAction(playerId: string, raw: { action: string; raiseTo?: number }): { ok: boolean; error?: string } {
    const agent = this.agents.find((a) => a.id === playerId && a.kind === 'human') as HumanAgent | undefined;
    if (!agent) return { ok: false, error: '该座位不是人类玩家' };
    if (!agent.currentCtx) return { ok: false, error: '当前不轮到你行动' };
    if (!['fold', 'check', 'call', 'raise', 'all_in'].includes(raw.action)) return { ok: false, error: '非法行动' };
    const parsed: Decision = { action: raw.action as Decision['action'] };
    if (typeof raw.raiseTo === 'number' && Number.isFinite(raw.raiseTo)) parsed.raiseTo = Math.round(raw.raiseTo);
    const decision = sanitizeDecision(agent.currentCtx, parsed);
    agent.submit(decision);
    return { ok: true };
  }

  private setStatus(s: RunnerStatus): void {
    this.status = s;
    this.opts.onStatusChange?.(s);
  }

  private handleEvent = (evt: GameEvent): void => {
    this.history.push(evt);
    if (this.history.length > this.HISTORY_LIMIT) this.history.splice(0, this.history.length - this.HISTORY_LIMIT);
    this.emit('event', evt);
  };

  start(): void {
    if (this.status === 'running') return;
    this.arena = new Arena({
      agents: this.agents,
      bb: config.bb,
      startingStackBB: config.startingStackBB,
      handDelayMs: config.handDelayMs / this.speed,
      actionDelayMs: config.actionDelayMs / this.speed,
      eliminateBottomEvery: config.eliminateBottomEvery,
      onEvent: this.handleEvent,
    });
    this.arena.run().catch((err) => {
      console.error('[比赛异常]', err);
      this.handleEvent({ type: 'note', text: `比赛异常终止: ${err instanceof Error ? err.message : String(err)}` });
      this.setStatus('idle');
    });
    this.setStatus('running');
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.arena?.pause();
    this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.arena?.resume();
    this.setStatus('running');
  }

  stop(): void {
    this.arena?.requestStop();
    this.setStatus('idle');
  }

  /** 开新一局：终止当前局并从 0 开始 */
  restart(): void {
    this.arena?.requestStop();
    this.history = [];
    setTimeout(() => {
      this.setStatus('idle');
      this.start();
    }, 80);
  }
}
