import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const PLAYERS_PATH = path.join(ROOT, 'config', 'players.json');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** 大盲筹码值（v0.1：SB = 0.5 BB，初始 100 BB，固定不涨） */
  bb: Number(process.env.BB ?? 20),
  startingStackBB: Number(process.env.STARTING_STACK_BB ?? 100),
  handDelayMs: Number(process.env.HAND_DELAY_MS ?? 900),
  actionDelayMs: Number(process.env.ACTION_DELAY_MS ?? 700),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
  /** 本地代理（VPN/ClashX），所有 LLM 调用统一走它；Gemini 需要美国节点 */
  proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || '',
  playersPath: PLAYERS_PATH,
};

export type AppConfig = typeof config;
