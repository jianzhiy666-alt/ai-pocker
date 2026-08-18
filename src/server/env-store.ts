/** .env 读写工具（用于网页端配置 API key） */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

const ENV_PATH = path.join(ROOT, '.env');

export function setEnvKey(key: string, value: string): void {
  const line = `${key}=${value.trim()}`;
  let content = '';
  if (fs.existsSync(ENV_PATH)) content = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n');
  // 同步当前进程环境变量，立即生效
  process.env[key] = value.trim();
}
