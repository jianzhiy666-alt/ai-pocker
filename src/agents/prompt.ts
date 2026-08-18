/** 把牌局状态渲染成中文文本提示词，并解析模型的 JSON 决策 */

import type { Decision, DecisionRequest } from '../poker/game.js';
import { cardId } from '../poker/cards.js';

export const ACTION_CN: Record<string, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  all_in: '全下',
};

export function buildSystemPrompt(playerName: string, persona?: string): string {
  return `你是一位职业德州扑克（无限注）选手，名叫「${playerName}」。${persona ?? ''}
规则要点：
- 行动只能选择：fold（弃牌）/ check（过牌）/ call（跟注）/ raise（加注）/ all_in（全下）。
- 输出 JSON 时：action 必须是上述之一；raise 时必须给出 raiseTo（加注后的目标总额，绝对金额，不是加注幅度）；reason 用一句中文说明你的思考（例如考虑了牌力、位置、底池赔率、对手筹码）。
- 其他情况 raiseTo 可以不写或写 null。
- 像真人一样思考：考虑自己的牌力、位置、对手风格与筹码深度、底池赔率；既要敢偷盲，也要避免无谓送筹码；锦标赛后期注意 ICM 压力。
- 只输出一个 JSON 对象，不要输出其他任何文字、解释或 markdown 代码块。`;
}

export function renderState(req: DecisionRequest): string {
  const lines: string[] = [];
  lines.push(`【第 ${req.handNumber} 手 | 盲注级别 ${req.blindLevel} | SB ${req.sb} / BB ${req.bb}】`);
  lines.push(`阶段: ${req.street === 'preflop' ? '翻前' : req.street === 'flop' ? '翻牌' : req.street === 'turn' ? '转牌' : '河牌'}`);
  lines.push(`你的位置: ${req.position}`);
  lines.push(`你的底牌: ${req.holeCards.map(cardId).join(' ')}`);
  if (req.communityCards.length) lines.push(`公共牌: ${req.communityCards.map(cardId).join(' ')}`);
  lines.push(`底池: ${req.pot}（本街已投入 ${req.streetPot}）`);
  lines.push(`当前最高下注: ${req.currentBet}，你需要再跟 ${req.toCall}`);
  lines.push(`你的筹码: ${req.stack}（本街已投入 ${req.committed}）`);
  lines.push(`合法行动: ${req.legalActions.map((a) => ACTION_CN[a] ?? a).join(' / ')}`);
  if (req.legalActions.includes('raise')) {
    lines.push(`若加注：目标总额需在 ${req.minRaiseTo} ~ ${req.maxRaiseTo} 之间（可全下）`);
  }
  lines.push(`其他玩家:`);
  for (const p of req.players) {
    const tags = [p.isDealer ? '庄' : '', p.isSB ? '小盲' : '', p.isBB ? '大盲' : '', p.allIn ? '全下' : '', p.folded ? '已弃牌' : ''].filter(Boolean).join(' ');
    lines.push(`  ${p.name}: 筹码 ${p.stack}${tags ? ` (${tags})` : ''}`);
  }
  if (req.actionHistory.length) lines.push(`本街行动记录: ${req.actionHistory.join('；')}`);
  lines.push('');
  lines.push('轮到你行动。请输出 JSON：');
  return lines.join('\n');
}

/** 从模型回复中解析决策 JSON（容忍 markdown 代码块和前后杂文） */
export function parseDecision(text: string): Decision | null {
  const cleaned = text
    .replace(/```json|```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const action = String(obj.action ?? '').toLowerCase();
    const valid = ['fold', 'check', 'call', 'raise', 'all_in'];
    if (!valid.includes(action)) return null;
    const d: Decision = { action: action as Decision['action'] };
    if (typeof obj.raiseTo === 'number') d.raiseTo = Math.round(obj.raiseTo);
    if (typeof obj.reason === 'string') d.reason = obj.reason.trim().slice(0, 200);
    return d;
  } catch {
    return null;
  }
}

/** 校验并修正决策，使其在当前局面合法 */
export function sanitizeDecision(req: DecisionRequest, d: Decision): Decision {
  const legal = req.legalActions;
  let action = d.action;
  if (!legal.includes(action)) {
    // 非法行动降级
    if (action === 'check' && req.toCall > 0) action = 'call';
    else if (action === 'raise' && !legal.includes('raise')) action = req.toCall > 0 ? 'call' : 'check';
    else action = req.toCall > 0 ? 'fold' : 'check';
  }
  if (action === 'raise') {
    const raw = d.raiseTo ?? req.minRaiseTo;
    const target = Math.max(req.minRaiseTo, Math.min(raw, req.maxRaiseTo));
    if (target >= req.maxRaiseTo && req.maxRaiseTo === req.committed + req.stack && raw >= req.maxRaiseTo) {
      return { action: 'all_in', reason: d.reason };
    }
    return { action: 'raise', raiseTo: target, reason: d.reason };
  }
  if (action === 'all_in') return { action: 'all_in', reason: d.reason };
  return { action, reason: d.reason };
}
