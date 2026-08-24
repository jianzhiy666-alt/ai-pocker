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
import { RANK_VALUE, Card } from '../poker/cards.js';

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
  const cheap = req.toCall > 0 && req.toCall <= req.bb * 2.5;
  const goodPos = req.position.includes('庄') || req.position.includes('关位');
  const effBB = (req.stack + req.committed) / req.bb; // 有效筹码（BB）
  const vsRaise = req.toCall > 0;
  const lines = [
    '【技能库·翻前范围】',
    range,
    `筹码深度：你有效筹码约 ${effBB.toFixed(0)} BB。`,
  ];
  if (effBB <= 12) {
    lines.push('⚠️ 短码推/弃模式：筹码 < 12 BB 时只有强牌（大对子/AK/AQ）才推全下或跟注，垃圾牌直接弃，别慢性消耗。');
  } else {
    lines.push('深码提示：位置越靠后范围越宽；面对加注收紧范围；有效筹码 < 25 BB 时避免用边缘牌跟注大额加注。');
  }
  if (vsRaise) {
    lines.push('【3-bet 指导】面对加注：');
    lines.push('- 价值 3-bet：QQ+/AK/AQ 面对松手加注，3-bet 到对手加注额的 ~3 倍；对手跟注后翻牌中顶对继续下注');
    lines.push('- 偶尔诈唬 3-bet：同花连牌/小对子面对紧手偷盲，但频率低、别上头');
    lines.push(`- 对手加注大（> ${Math.max(3, Math.round(effBB * 0.25))} BB 或超过你筹码 1/4）：没有强牌就别跟，弃牌不丢人`);
    lines.push('- 你跟注后翻牌没中：被 3-bet 过的底池很大，诈唬对手弃牌率高，可以持续施压');
  } else {
    lines.push('开池/偷盲：后位（庄/关）可用很宽的范围加注偷盲；中前位只用范围表内的牌入池。');
  }
  // 观赏性补充：小同花/同花连牌在位置好且成本低时可以入池赌听花
  if (goodPos && cheap) {
    lines.push('补充：你现在位置好且跟注成本不高（≤2.5 BB），小同花牌、同花连牌、连张牌（如 37s、68s、T9s）都可以跟注看翻牌赌听花/顺子，这很划算。');
  } else if (cheap) {
    lines.push('补充：跟注成本不高（≤2.5 BB），但位置一般；同花连牌/口袋对可以跟注看翻牌，杂乱小牌谨慎。');
  } else {
    lines.push('补充：跟注成本较高（>2.5 BB），小牌不值得看翻牌，只有符合范围的牌才继续。');
  }
  return lines.join('\n');
}

/** 听牌分析：同花听 / 顺子听（两头或卡顺）+ 总 outs */
export interface DrawInfo {
  flushDraw: boolean;
  straightType: 'open-ended' | 'gutshot' | null;
  straightOuts: number;
  totalOuts: number;
}

function hasStraight(ranks: Set<number>): boolean {
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 0; i + 4 < sorted.length; i++) {
    if (sorted[i + 4]! - sorted[i]! === 4 && new Set(sorted.slice(i, i + 5)).size === 5) return true;
  }
  // 轮子顺 A2345
  if (ranks.has(14) && ranks.has(2) && ranks.has(3) && ranks.has(4) && ranks.has(5)) return true;
  return false;
}

export function analyzeDraws(holeCards: Card[], board: Card[]): DrawInfo {
  const cards = [...holeCards, ...board];
  // 同花听：任一花色恰有 4 张（翻牌后）/ 3 张翻牌前不算
  const suitCounts = new Map<string, number>();
  for (const c of cards) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  let flushDraw = false;
  for (const n of suitCounts.values()) {
    if (n >= 4) flushDraw = true;
  }
  // 顺子听：哪些 rank 加入后能成顺（当前未成顺才算听牌）
  const ranks = new Set(cards.map((c) => RANK_VALUE[c.rank]));
  const straightOuts: number[] = [];
  if (!hasStraight(ranks)) {
    for (let v = 2; v <= 14; v++) {
      if (ranks.has(v)) continue;
      const test = new Set(ranks);
      test.add(v);
      if (hasStraight(test)) straightOuts.push(v);
    }
  }
  // 缺的 rank 种类 → 张数（每个 rank 4 张）：两头顺 2 种（8 张），卡顺 1 种（4 张）
  const outsRanks = straightOuts.length;
  const outs = outsRanks * 4;
  let straightType: DrawInfo['straightType'] = null;
  if (outsRanks >= 2) straightType = 'open-ended';
  else if (outsRanks === 1) straightType = 'gutshot';
  let totalOuts = outs;
  if (flushDraw) totalOuts += 9;
  return { flushDraw, straightType, straightOuts: outs, totalOuts };
}

/** 翻后技能库建议（按成牌强度分类 + 听牌分析 + 下注尺度 + 对手调整） */
function postflopGuide(req: DecisionRequest): string {
  const result = evaluate7([...req.holeCards, ...req.communityCards]);
  const cat = result.category; // 0=高牌 ... 8=同花顺
  let advice: string;
  if (cat >= 6) advice = `成牌很强（${result.name}），大胆下注拿价值，底池越大越敢打重注（60-80% 底池）。`;
  else if (cat === 5) advice = '同花成牌，下注拿价值（60-75% 底池）；若公对牌面（有葫芦可能）要谨慎。';
  else if (cat === 4) advice = '顺子成牌，下注拿价值（60-75% 底池）；若四同花牌面要谨慎。';
  else if (cat === 3) advice = '三条成牌，下注拿价值（55-70% 底池）。';
  else if (cat === 2) advice = '两对成牌，下注保护手牌（50-65% 底池）；牌面潮湿（有顺子/同花可能）下注要更重。';
  else if (cat === 1) advice = '只有一对：顶对/超对（有位置）下注 40-55% 底池保护；无位置控池过牌，面对大注谨慎。';
  else advice = '没成牌：对手频繁过牌示弱可以诈唬偷池（40-60% 底池）；有同花/顺子听牌可按底池赔率跟注或半诈唬；否则弃牌。';

  // 听牌分析（显式告诉模型当前有什么可买的牌）
  const draws = analyzeDraws(req.holeCards, req.communityCards);
  let drawLine = '';
  if (draws.totalOuts > 0) {
    const parts: string[] = [];
    if (draws.flushDraw) parts.push('同花听（9 张）');
    if (draws.straightType === 'open-ended') parts.push('两头顺听（8 张）');
    else if (draws.straightType === 'gutshot') parts.push('卡顺听（4 张）');
    const winPct = Math.min(100, (draws.totalOuts * 2 + 2)); // 翻牌后约 2%/out（一条街）
    drawLine = `你的听牌：${parts.join('、')}（共 ${draws.totalOuts} 张成牌牌，约 ${winPct}% 胜率）——听牌跟注要在底池赔率合理时进行，成牌后大胆拿价值。`;
  }

  const potOddsHint = req.toCall > 0
    ? `跟注 ${req.toCall} 需要 ${(req.toCall / (req.pot + req.toCall) * 100).toFixed(0)}% 左右的胜率才划算。`
    : '当前免费看牌（无跟注压力）。';

  // 对手松紧调整
  const opps = (req.opponentStats ?? []).filter((s) => s.hands > 0);
  const avgVPIP = opps.length ? opps.reduce((a, s) => a + s.vpip, 0) / opps.length : 40;
  const oppHint = avgVPIP >= 45
    ? '对手偏松（平均 VPIP 高）：他们跟注多，少诈唬、薄价值下注照打，拿价值别怕被跟。'
    : avgVPIP < 28
      ? '对手偏紧（平均 VPIP 低）：他们弃牌多，可以多偷池、多持续下注（c-bet）施压。'
      : '对手松紧适中，按标准策略打。';

  const lines = [
    `【技能库·翻后指导】${advice}`,
    drawLine,
    `提示：${potOddsHint}`,
    oppHint,
    '【下注尺度】价值下注 50-75% 底池，诈唬 40-60% 底池；听牌半诈唬 50% 左右。牌面越湿（同花/顺子可能多）下注越重。',
    '【持续下注】翻牌前你加注过、翻牌后对手过牌：无论是否中牌，60-70% 情况持续下注（c-bet 2/3 底池），有位置更应下注；无位置对中等牌过牌控池。',
  ].filter(Boolean);
  return lines.join('\n');
}

/** 生成当前局面的技能库建议（注入决策提示词） */
export function buildSkillGuide(req: DecisionRequest): string {
  return req.street === 'preflop' ? preflopGuide(req) : postflopGuide(req);
}
