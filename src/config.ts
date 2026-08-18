import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const PLAYERS_PATH = path.join(ROOT, 'config', 'players.json');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  startingStack: Number(process.env.STARTING_CHIPS ?? 2000),
  handsPerLevel: Number(process.env.HANDS_PER_LEVEL ?? 6),
  handDelayMs: Number(process.env.HAND_DELAY_MS ?? 900),
  actionDelayMs: Number(process.env.ACTION_DELAY_MS ?? 700),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
  playersPath: PLAYERS_PATH,
};

export type AppConfig = typeof config;
