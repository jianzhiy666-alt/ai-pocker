/** 比赛控制器：管理 Tournament 生命周期并把事件广播给 SSE 客户端 */

import { EventEmitter } from 'node:events';
import type { GameEvent } from './events.js';
import { Tournament } from './tournament.js';
import type { PlayerAgent } from './agents/types.js';
import { config } from './config.js';

export interface RunnerOptions {
  agents: PlayerAgent[];
  onStatusChange?: (status: RunnerStatus) => void;
}

export type RunnerStatus = 'idle' | 'running' | 'paused';

export class GameRunner extends EventEmitter {
  private opts: RunnerOptions;
  private tournament: Tournament | null = null;
  private status: RunnerStatus = 'idle';
  private history: GameEvent[] = [];
  private readonly HISTORY_LIMIT = 500;
  private speed = 1;

  constructor(opts: RunnerOptions) {
    super();
    this.opts = opts;
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
    return this.opts.agents.length;
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
    this.tournament = new Tournament({
      agents: this.opts.agents,
      startingStack: config.startingStack,
      handsPerLevel: config.handsPerLevel,
      handDelayMs: config.handDelayMs / this.speed,
      actionDelayMs: config.actionDelayMs / this.speed,
      onEvent: this.handleEvent,
    });
    this.tournament.run().catch((err) => {
      console.error('[锦标赛异常]', err);
      this.handleEvent({ type: 'note', text: `锦标赛异常终止: ${err instanceof Error ? err.message : String(err)}` });
      this.setStatus('idle');
    });
    this.setStatus('running');
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.tournament?.pause();
    this.setStatus('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.tournament?.resume();
    this.setStatus('running');
  }

  stop(): void {
    this.tournament?.requestStop();
    this.setStatus('idle');
  }

  /** 开新一局：终止当前局并从 0 开始 */
  restart(): void {
    this.tournament?.requestStop();
    this.history = [];
    // 给旧局一点时间退出，然后启动新局
    setTimeout(() => {
      this.setStatus('idle');
      this.start();
    }, 50);
  }
}
