# 🤠 AI 扑克擂台 (AI Poker Arena)

德州扑克锦标赛，**每个座位都是一个 AI 玩家**——可以接入 Qwen / DeepSeek / Gemini / Grok 等各大模型（走 OpenRouter 或官方 OpenAI 兼容端点），也可以让本地启发式机器人对战。所有 AI 的决策理由会实时展示在网页观战台上，节目效果拉满。

## 特性

- 🃏 **完整德州扑克规则引擎**：翻前/翻牌/转牌/河牌四轮下注、加注/全下/边池、单挑规则
- 🏆 **升盲锦标赛**：盲注逐级上涨，筹码清零即淘汰，最后一人夺冠
- 🤖 **多 AI 对战**：每位选手配置独立 provider + 模型 + 人设（persona），决策理由实时直播
- 🔌 **统一 OpenAI 兼容接入**：OpenRouter（一个 key 通吃几乎所有模型）、通义千问 DashScope、DeepSeek、Gemini、xAI Grok 开箱即用
- 🎬 **网页实时观战**：牌桌、明牌、筹码、公共牌、思考过程一目了然，支持暂停/倍速/新一局
- 🪪 **AI 可以给自己改名**：赢了大赛会膨胀改名、被淘汰会留下遗言名号、夺冠会加冕新称号——真模型自己起名，机器人从词库随机组合，整场比赛就是一出自带剧情的大戏
- 🛟 **无 key 也能跑**：默认 6 个启发式机器人直接开局；配置了哪个模型的 key，对应座位自动换成真 AI

## 技术栈与开源复用

Node.js + TypeScript，单服务（Express 后端 + SSE 实时推送 + 原生 JS 前端）。

| 模块 | 方案 |
|---|---|
| 牌力评估 | 复用开源库 [pokersolver](https://github.com/goldfire/pokersolver)（生产久经考验，7 张选最佳 5 张、平局判定） |
| 下注轮/边池/锦标赛引擎 | 自研（约 600 行，含 13 个单元测试）——评估过 [poker-ts](https://www.npmjs.com/package/poker-ts)、[texasholdem](https://www.npmjs.com/package/texasholdem)、[@pokertools/engine](https://www.npmjs.com/package/@pokertools/engine)、[@leoni4/poker-table](https://www.npmjs.com/package/@leoni4/poker-table) 等开源引擎，要么太新 API 未验证、要么缺少边池/全下支持，且与 AI 决策循环耦合深，故自研并配套测试 |
| 牌桌 UI | 自研轻量页面（无框架、无构建），扑克牌用 Unicode + CSS 渲染 |
| LLM 接入 | OpenAI Chat Completions 兼容适配器（OpenRouter / DashScope / DeepSeek / Gemini / xAI 全兼容） |

## 快速开始

```bash
cd poker-arena
npm install          # 或 pnpm install
npm start            # 启动后自动开局
```

浏览器打开 **http://localhost:3000** 即可观战。

## 接入真实 AI 模型

1. 复制 `.env.example` 为 `.env`，填入 API key（配哪个就能启用哪个，没配的自动用启发式机器人）：

```bash
cp .env.example .env
# 编辑 .env，至少填一个 key，例如：
# OPENROUTER_API_KEY=sk-or-xxx      ← 推荐：一个 key 通吃几乎所有模型
```

2. 编辑 `config/players.json`，把想换成真 AI 的选手的 `provider` 改为对应名字，并可选指定 `model` 与 `persona`（人设）：

```json
[
  { "id": "qwen",  "name": "通义千问", "provider": "dashscope",  "model": "qwen-plus",     "persona": "稳重老练，重视位置和赔率。" },
  { "id": "ds",    "name": "深度求索", "provider": "deepseek",   "model": "deepseek-chat", "persona": "计算流，喜欢算赔率。" },
  { "id": "gem",   "name": "双子星",   "provider": "gemini",     "model": "gemini-2.0-flash", "persona": "风格激进，爱偷盲。" },
  { "id": "grok",  "name": "格洛克",   "provider": "openrouter", "model": "x-ai/grok-3-mini", "persona": "话多但牌技好。" },
  { "id": "bot1",  "name": "刀锋",     "provider": "heuristic" }
]
```

3. 重启 `npm start`。

### 可选 provider

| provider 名 | 说明 | 环境变量 |
|---|---|---|
| `openrouter` | 万能聚合，几乎全部主流模型（qwen/deepseek/gemini/grok/claude/gpt…） | `OPENROUTER_API_KEY` |
| `dashscope` | 阿里云通义千问官方 | `DASHSCOPE_API_KEY` |
| `deepseek` | DeepSeek 官方 | `DEEPSEEK_API_KEY` |
| `gemini` | Google Gemini（OpenAI 兼容端点） | `GEMINI_API_KEY` |
| `xai` | xAI Grok 官方 | `XAI_API_KEY` |
| `heuristic` | 本地启发式机器人（离线演示 / LLM 失败兜底） | — |

## 牌局参数（.env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `STARTING_CHIPS` | 2000 | 每位选手初始筹码 |
| `HANDS_PER_LEVEL` | 6 | 每个盲注级别打几手后升级 |
| `HAND_DELAY_MS` | 900 | 每手牌间隔（观战节奏） |
| `ACTION_DELAY_MS` | 700 | 每次行动间隔 |
| `LLM_TIMEOUT_MS` | 45000 | 单次模型调用超时 |

## 命令

```bash
npm start        # 启动服务 + 网页观战（自动开局）
npm run play     # 无头模式：控制台跑完整锦标赛（快速验证）
npm test         # 单元测试（规则引擎 + 牌力评估）
npm run typecheck
```

## 目录结构

```
poker-arena/
├── config/players.json      # 选手配置（provider/model/persona）
├── src/
│   ├── index.ts             # 入口
│   ├── config.ts            # 环境配置
│   ├── events.ts            # 事件流格式（引擎→SSE→浏览器）
│   ├── runner.ts            # 比赛控制器（生命周期/速度）
│   ├── tournament.ts        # 锦标赛编排（升盲/淘汰）
│   ├── poker/               # 规则引擎（cards/evaluator/game + 测试）
│   ├── agents/              # AI 智能体（提示词/LLM 决策/启发式机器人）
│   ├── providers/           # LLM 接入（OpenAI 兼容适配器 + 注册表）
│   ├── server/              # Express + SSE
│   └── web/                 # 观战页面（纯 HTML/CSS/JS）
└── scripts/play.ts          # 无头演示
```

## 未来可加

- 每手牌的复盘回放（事件流已全量留存）
- 更多变体：限注、底池限注、比赛奖励结构
- 选手"个性"数据库（不同模型 + 人设组合的胜率统计）
- 旁观聊天/弹幕
