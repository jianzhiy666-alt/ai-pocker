/** 玩家智能体接口 */

import type { Decision, DecisionRequest } from '../poker/game.js';

export interface PlayerAgent {
  readonly id: string;
  readonly name: string;
  /** llm = 真模型决策；heuristic = 本地启发式机器人 */
  readonly kind: 'llm' | 'heuristic';
  /** 展示用模型/来源标签，如 "qwen-plus (DashScope)" 或 "启发式机器人" */
  readonly model: string;
  decide(ctx: DecisionRequest): Promise<Decision>;
}
