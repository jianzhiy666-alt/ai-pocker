/** 玩家智能体接口（v0.1：取名 + 扑克决策 + 每手一句嘴炮） */

import type { Decision, DecisionRequest } from '../poker/game.js';
import type { TalkContext } from './talk.js';

export interface PlayerAgent {
  readonly id: string;
  /** 初始占位名（取名 Phase 前） */
  readonly name: string;
  /** 当前名字（AI 自己取的 Poker Name） */
  currentName: string;
  /** llm = 真模型决策；heuristic = 本地启发式机器人 */
  readonly kind: 'llm' | 'heuristic';
  /** 展示用模型/来源标签（仅观众可见，绝不进入 AI 上下文） */
  readonly model: string;
  /** 比赛开始前取一次名（赛季内锁定） */
  createIdentity(): Promise<string>;
  /** 扑克决策（独立调用，输出严格 JSON：action + amount_bb） */
  decide(ctx: DecisionRequest): Promise<Decision>;
  /** 每手结束说一句话（纯给观众看，不进入任何 AI 的决策上下文） */
  talk(ctx: TalkContext): Promise<string>;
}
