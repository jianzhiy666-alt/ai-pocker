/** AI 改名的辅助：启发式词库 + 名字清洗/查重 */

export type RenameReason = 'big_win' | 'busted' | 'champion';

export interface RenameContext {
  oldName: string;
  /** 大底池赢利金额（big_win 时） */
  amount?: number;
  /** 当前其他玩家的名字（避免重名） */
  takenNames?: string[];
}

/** 启发式改名词库（离线/兜底用，随机组合出有梗的名字） */
const PARTS = {
  prefix: ['疯狂', '暴躁', '佛系', '咸鱼', '破产', '无敌', '冥想的', '快乐的', '复活的', '神秘的', '逆袭的', '暴富的'],
  core: ['鲨鱼', '老猫', '猎豹', '狐狸', '夜枭', '秃鹫', '河豚', '熊猫', '章鱼', '变色龙', '斗牛犬', '蓝鲸', '螳螂', '锦鲤'],
  suffix: ['二世', '·改', '·重开', '之王', '·pro', '·plus', '·2.0', '·重装上阵'],
};

export function randomNameFromPool(rng: () => number): string {
  const pick = (arr: string[]) => arr[Math.floor(rng() * arr.length)]!;
  const r = rng();
  let name = `${pick(PARTS.prefix)}${pick(PARTS.core)}`;
  if (r < 0.35) name += pick(PARTS.suffix);
  return name;
}

/** 清洗模型输出的名字：去空白/控制字符，限制长度 */
export function sanitizeName(raw: string): string | null {
  if (!raw) return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^["'“”「」\s]+|["'“”「」\s]+$/g, '')
    .trim()
    .slice(0, 10);
  if (!name || name.length > 10) return null;
  return name;
}

/** 确保新名字不和现有玩家重名（重名则加后缀） */
export function ensureUnique(name: string, taken: string[], rng: () => number): string {
  if (!taken.includes(name)) return name;
  const suffixes = ['·改', '·2.0', '·重开', '·pro', '·plus', '·III'];
  for (const s of suffixes) {
    const candidate = name.slice(0, 8) + s;
    if (!taken.includes(candidate)) return candidate;
  }
  return name + '·' + Math.floor(rng() * 100);
}
