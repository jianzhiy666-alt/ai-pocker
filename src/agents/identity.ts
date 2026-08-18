/** 取名 Phase：每个 AI 自己取一个 Poker Name（只问一次，赛季内锁定） */

import type { ChatProvider } from '../providers/types.js';

/** 取名 Prompt（极简，只输出名字） */
export function buildNamePrompt(): string {
  return `你即将参加一场由 6 个自主 AI 玩家组成的无限注德州扑克冠军赛。

请给自己取一个独特的牌手昵称（1~6 个字符，中英文均可，可以有梗）。

不要提到你的 AI 模型、厂商或任何技术信息。

只输出一个 JSON 对象（不要任何其他文字）：{"name": "你的牌手昵称"}`;
}

const NAME_POOL = [
  '暗流', '静水深流', '零信号', '河牌杀手', '慢打大师', '数学怪', '老实人', '疯狗', '夜行者',
  '读心者', '铁幕', '微笑的刀', '河神', '沙漠狐狸', '冷面判官', '盲注猎人', '天选之人',
  '闷声发财', '诈唬大师', '海底针', '孤注一掷', '不败传说', '心理医生', '牌桌哲学家',
];

/** 启发式兜底：从词库随机取名 */
export function nameFromPool(rng: () => number): string {
  return NAME_POOL[Math.floor(rng() * NAME_POOL.length)]!;
}

/** 清洗模型输出的名字 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^["'“”「」\s]+|["'“”「」\s]+$/g, '')
    .trim()
    .slice(0, 10);
  return name || null;
}

/** 从模型回复解析 {"name": "..."} */
export function parseName(text: string): string | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const normalized = cleaned.slice(start, end + 1).replace(/[“”]/g, '"');
    const obj = JSON.parse(normalized) as Record<string, unknown>;
    return sanitizeName(obj.name ?? obj.poker_name);
  } catch {
    return null;
  }
}

/** 确保名字不和现有玩家重名 */
export function ensureUniqueName(name: string, taken: string[], rng: () => number): string {
  if (!taken.includes(name)) return name;
  const suffixes = ['·改', '·2.0', '·重开', '·pro', '·plus'];
  for (const s of suffixes) {
    const candidate = name.slice(0, 8) + s;
    if (!taken.includes(candidate)) return candidate;
  }
  return name + '·' + Math.floor(rng() * 100);
}

/** 为 LLM 智能体取名：尝试模型，失败用词库 */
export async function nameWithProvider(
  provider: ChatProvider,
  timeoutMs: number,
  rng: () => number,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const text = await provider.chat(
        [{ role: 'system', content: buildNamePrompt() }],
        { temperature: 1.0, maxTokens: 40, signal: controller.signal },
      );
      const name = parseName(text);
      if (name) return name;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // 失败走词库
  }
  return nameFromPool(rng);
}
