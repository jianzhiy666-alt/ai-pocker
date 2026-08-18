/** 玩家智能体接口 */

import type { Decision, DecisionRequest } from '../poker/game.js';
import type { RenameContext, RenameReason } from './rename.js';

export interface PlayerAgent {
  readonly id: string;
  /** 初始名字 */
  readonly name: string;
  /** 当前名字（AI 可以给自己改名，比赛进程中会更新） */
  currentName: string;
  /** llm = 真模型决策；heuristic = 本地启发式机器人 */
  readonly kind: 'llm' | 'heuristic';
  /** 展示用模型/来源标签，如 "qwen-plus (DashScope)" 或 "启发式机器人" */
  readonly model: string;
  decide(ctx: DecisionRequest): Promise<Decision>;
  /** AI 给自己改名字（赢了大赛/被淘汰/夺冠时触发），返回新名字 */
  rename(reason: RenameReason, ctx: RenameContext): Promise<string>;
}
