# 🤠 AI 扑克擂台 v0.1 (AI Poker Arena)

6 个 AI 各拿 100 BB → **自己取 Poker Name** → 自主打德州扑克 → 每手一句嘴炮 → 输光淘汰 → **最后一个 AI 获胜**。

一句话目标：6 个 AI、100BB、各自取名、自主打 NLHE、可以嘴炮、输光淘汰、最后一人获胜。

## 比赛规则 v0.1

| 项目 | 设置 |
|---|---|
| 游戏 | No-Limit Texas Hold'em，6-max |
| 玩家 | 6 个 AI（真模型或启发式机器人混搭） |
| 初始筹码 | 100 BB |
| SB / BB | 0.5 / 1 BB（固定，永不上涨） |
| 筹码 | 不重置，禁止 rebuy |
| 淘汰 | 筹码归零出局 |
| 获胜 | 最后一个留在牌桌上的 AI |
| AI 名字 | 比赛开始前每个 AI 自己取（赛季内锁定） |
| 嘴炮 | 每手结束后所有存活 AI 说一句或保持沉默（纯给观众看） |
| 模型身份 | 对 AI 隐藏（它们只知道对手是"5 个自主 AI 玩家"） |

> 固定盲注 + 不重置 + 淘汰制严格说是一个"固定盲注淘汰赛"，作为第一版 AI Arena 足够好玩，也比锦标赛简单得多。

## 技术架构

```
src/
├── arena.ts           # 核心编排：取名 → 循环打牌 → 淘汰 → 冠军 + 每手嘴炮
├── poker/             # 规则引擎：cards / evaluator(pokersolver) / game（下注轮、边池）
├── agents/
│   ├── prompt.ts      # 极简决策提示词（action + amount_bb JSON）+ 局面渲染
│   ├── identity.ts    # 取名 Phase（模型自己取 Poker Name）
│   ├── talk.ts        # 每手一句嘴炮（独立调用，不进决策上下文）
│   ├── llm-agent.ts   # 真模型智能体（决策温度 0.2，取名/嘴炮独立调用）
│   └── heuristic-agent.ts  # 启发式机器人（离线演示 / LLM 失败兜底）
├── providers/         # OpenAI 兼容适配器（OpenRouter/DashScope/DeepSeek/Gemini/xAI）
├── server/ + web/     # Express + SSE + 原生 JS 观战页
```

关键设计：
- **决策与嘴炮完全分离**（独立 API 调用）：模型不会为了说骚话而改变扑克决策
- **嘴炮纯给观众看**：v0.1 不进任何 AI 的决策上下文，直接规避 prompt injection / context 膨胀
- **决策输出严格 JSON**：`{"action": "fold|check|call|raise|all_in", "amount_bb": 0}`，amount_bb 是 BB 单位
- **Skill Library（技能库）**：决策提示词内置专家级策略知识——6-max 各位置翻前起手范围表 + 翻后按成牌强度/底池赔率给指导（简化版 PokerSkill，见 `src/agents/skill-library.ts`），让模型决策"有章可循"
- **牌力评估复用开源库** [pokersolver](https://github.com/goldfire/pokersolver)；规则引擎自研（13+ 单元测试）

## 快速开始

```bash
cd poker-arena
npm install
npm start        # 启动后自动开局
```

浏览器打开 **http://localhost:3000** 观战：牌桌、明牌、筹码、公共牌、每个 AI 的思考旁白、每手嘴炮、淘汰和冠军。

无头模式（控制台快速跑完整比赛）：`npm run play`

## 接入真实 AI 模型

1. `cp .env.example .env`，填入 API key（配了哪个启用哪个，没配的用启发式机器人）：

```
OPENROUTER_API_KEY=sk-or-xxx   # 一个 key 通吃几乎所有模型
# 或 DASHSCOPE_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY / XAI_API_KEY
```

2. （可选，国内网络必需）配置本地代理，所有 LLM 调用统一走代理：

```
# VPN/ClashX 本地代理端口
HTTPS_PROXY=http://127.0.0.1:7890
```

> ⚠️ OpenRouter 的 **Gemini 模型仅限美国地区**：即使挂了代理，节点也必须是美国（香港等地区会 403）。切换节点后重启服务即可。

3. 编辑 `config/players.json`，把选手的 `provider` 改为对应名字（`openrouter` / `dashscope` / `deepseek` / `gemini` / `xai`），可选指定 `model`：

```json
[
  { "id": "gemini", "name": "Gemini 选手", "provider": "openrouter", "model": "google/gemini-3.7-flash" },
  { "id": "qwen",   "name": "Qwen 选手",   "provider": "openrouter", "model": "qwen/qwen3-30b-a3b-instruct-2507" },
  { "id": "ling",   "name": "Ling 选手",   "provider": "openrouter", "model": "inclusionai/ling-2.6-flash" },
  { "id": "deepseek", "name": "DeepSeek 选手", "provider": "deepseek", "model": "deepseek-v4-flash" }
]
```

4. 重启 `npm start`。启动时会先做**模型健康检查**（哪些在线、哪些降级一目了然），然后每个模型自己取名（UI 实时显示）。

> 💡 推理型模型（如 minimax-m2.7、longcat-2.0）思考较慢（每行动 10~25 秒），决策 token 预算已加大适配；嫌慢可换 flash 类模型。

## 牌局参数（.env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `BB` | 20 | 大盲筹码值（SB = 0.5 BB） |
| `STARTING_STACK_BB` | 100 | 初始筹码（BB） |
| `HAND_DELAY_MS` | 900 | 每手间隔（观战节奏） |
| `ACTION_DELAY_MS` | 700 | 每次行动间隔 |
| `LLM_TIMEOUT_MS` | 45000 | 单次模型调用超时 |

## 测试与命令

```bash
npm start          # 服务 + 网页观战（自动开局）
npm run play       # 无头模式完整比赛
npm test           # 单元测试（规则引擎 + 智能体 + Arena 端到端）
npm run typecheck
```

## Roadmap（后续版本）

- v0.2：嘴炮进入 AI 决策上下文（心理战真正开始）
- v0.3：对手统计 / 长期记忆 / 恩怨
- v0.4：duplicate hands + bb/100 公平比较
- v0.5：PokerSkill
- v1.0：正式 AI Poker League
