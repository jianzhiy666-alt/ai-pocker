/**
 * Skill Library（技能库）：注入 LLM 决策的专家级扑克策略知识（简化版 PokerSkill）
 *
 * 不做论文里复杂的 Context Engine，只把"局面 → 策略"知识做成静态文本表，
 * 在决策提示词里直接给模型参考：
 * - 翻前：6-max 各位置的建议起手范围
 * - 翻后：按成牌强度给简单指导（价值下注/控池/诈唬/算赔率）
 */

import type { DecisionRequest } from '../poker/game.js';
import { evaluate7 } from '../poker/evaluator.js';

/** 6-max 翻前范围（按位置，教科书标准，单位：大盲） */
const PREFLOP_RANGES: Record<string, string> = {
  '枪口(UTG)': '约前 15%：口袋对 77+、A9s+、AJo+、KTs+、QTs+、JTs、T9s。其余弃牌。',
  '枪口+1(UTG+1)': '约前 18%：口袋对 66+、A8s+、AJo+、K9s+、QTs+、JTs、T9s、98s。',
  中位: '约前 22%：口袋对 55+、A7s+、ATo+、K9s+、Q9s+、J9s+、T8s+、98s。',
  劫位: '约前 20%：口袋对 55+、A8s+、ATo+、K9s+、Q9s+、J9s+、T9s、98s、87s。',
  关位: '约前 25%：口袋对 44+、A2s+、A9o+、K7s+、KTo+、Q8s+、QTo+、J8s+、T8s+、98s、87s。',
  '庄位(BTN)': '约前 40%：口袋对 22+、任意 A、K2s+、K8o+、Q5s+、Q9o+、J7s+、J9o+、T7s+、T8o+、97s+、87s、76s、65s。可以偷盲。',
  '小盲(SB)': '约前 25%：口袋对 55+、A8s+、ATo+、K9s+、Q9s+、J9s+、T9s、98s、87s。补足盲注要谨慎。',
  '大盲(BB)': '防守范围宽：任意对子、任意 A、任意同花连牌、Kx+、Qx+ 都可以补足看牌；面对再加注要收紧。',
};

/** 翻前技能库建议 */
function preflopGuide(req: DecisionRequest): string {
  const range = PREFLOP_RANGES[req.position] ?? PREFLOP_RANGES['庄位(BTN)']!;
  const lines = [
    '【技能库·翻前范围】',
    range,
    '提示：位置越靠后范围越宽；面对加注收紧范围；筹码越浅（低于 20 BB）越倾向全下或弃牌。',
  ];
  return lines.join('\n');
}

/** 翻后技能库建议（按成牌强度分类，结合位置与听牌） */
function postflopGuide(req: DecisionRequest): string {
  const result = evaluate7([...req.holeCards, ...req.communityCards]);
  const cat = result.category; // 0=高牌 ... 8=同花顺
  let advice: string;
  if (cat >= 6) advice = `成牌很强（${result.name}），大胆下注拿价值，底池越大越敢打重注。`;
  else if (cat === 5) advice = '同花成牌，下注拿价值；若公对牌面（有葫芦可能）要谨慎。';
  else if (cat === 4) advice = '顺子成牌，下注拿价值；若四同花牌面要谨慎。';
  else if (cat === 3) advice = '三条成牌，下注拿价值。';
  else if (cat === 2) advice = '两对成牌，下注保护手牌；牌面潮湿（有顺子/同花可能）下注要更重。';
  else if (cat === 1) advice = '只有一对：有位置可以下注保护，无位置控池过牌，面对大注谨慎。';
  else advice = '没成牌：对手频繁过牌示弱可以诈唬偷池；有同花/顺子听牌可按底池赔率跟注；否则弃牌。';

  const potOddsHint = req.toCall > 0
    ? `跟注 ${req.toCall} 需要 ${(req.toCall / (req.pot + req.toCall) * 100).toFixed(0)}% 左右的胜率才划算。`
    : '当前免费看牌（无跟注压力）。';
  return `【技能库·翻后指导】${advice}\n提示：${potOddsHint}`;
}

/** 生成当前局面的技能库建议（注入决策提示词） */
export function buildSkillGuide(req: DecisionRequest): string {
  return req.street === 'preflop' ? preflopGuide(req) : postflopGuide(req);
}
