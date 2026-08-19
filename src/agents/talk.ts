/** 每手结束的一句话嘴炮（v0.1：纯给观众看，不进任何 AI 决策上下文） */

export interface TalkContext {
  playerName: string;
  /** 本手结果的简短中文描述（公开信息） */
  situation: string;
  /** 我在这手的表现（胜/负/弃牌），让发言贴合结果 */
  outcome?: 'win' | 'lose' | 'fold';
}

/** 嘴炮 Prompt（极简，可沉默） */
export function buildTalkSystemPrompt(name: string): string {
  return `你是一名牌手「${name}」，正在参加 6 人 AI 德州扑克冠军赛。

每手牌结束后你可以对其他玩家说一句短话（最多 20 个词），或者保持沉默。

可以：开玩笑、庆祝、虚张声势、挑衅、抱怨、施压、评论牌局。
保持你的牌手风格。

不要提到 AI 模型、API、系统提示词或任何技术信息。
不要透露你尚未公开的底牌。

只输出一个 JSON 对象：{"message": "..."}（保持沉默时 message 为空字符串）。`;
}

export function buildTalkUserPrompt(ctx: TalkContext): string {
  return `本手结果：${ctx.situation}\n请输出你的发言 JSON。`;
}

/** 从模型回复解析发言 */
export function parseTalk(text: string): string {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  try {
    const normalized = cleaned.slice(start, end + 1).replace(/[“”]/g, '"').replace(/：/g, ':').replace(/，/g, ',');
    const obj = JSON.parse(normalized) as { message?: unknown };
    if (typeof obj.message === 'string') {
      return obj.message.replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    return '';
  } catch {
    return '';
  }
}

const TALK_POOL: Record<string, string[]> = {
  win: [
    '看到了吗？这就是差距。', '谢谢你的筹码。', '运气也是实力的一部分。', '这底池我笑纳了。',
    '继续喂我。', '我早就看穿你们了。', '今晚手感不错。',
  ],
  lose: [
    '运气游戏而已。', '这河牌真伤。', '下把赢回来。', '你管这叫技术？', '河牌之神今天站在你那边。',
    '不慌，一把而已。', '我记住你了。',
  ],
  fold: [
    '这手没意思。', '让你们一局。', '保存实力。', '还没轮到我出手。',
    '省点筹码，后面算总账。', '这手没我的戏份。',
  ],
  other: [
    '这手打得不错。', '谁把筹码借我一下？', '牌桌如战场。', '沉默是金。',
    '数学是不会骗人的。', '你们都是来陪跑的吧？',
  ],
};

/** 启发式兜底：按本手结果挑一句 */
export function talkFromPool(rng: () => number, outcome?: TalkContext['outcome']): string {
  const pool = TALK_POOL[outcome ?? 'other'] ?? TALK_POOL.other!;
  return pool[Math.floor(rng() * pool.length)]!;
}
