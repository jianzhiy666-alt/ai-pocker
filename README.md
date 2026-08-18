# 🤠 AI 扑克擂台 (AI Poker Arena)

**6 个 AI 各拿 100 BB → 自己取 Poker Name → 自主打德州扑克 → 每手一句嘴炮 → 输光/末尾淘汰 → 最后一人获胜。**

你也可以**亲自上桌**，跟 5 个 AI 真刀真枪打一场淘汰赛。所有 AI 的思考过程（读牌、决策思路、嘴炮）实时直播在网页上。

## ✨ 功能特性

- 🃏 **完整德州扑克规则引擎**：翻前/翻牌/转牌/河牌四轮下注、加注/全下/边池、单挑规则
- 🤖 **多 AI 对战**：每个座位独立配置 provider + 模型，真模型或本地机器人混搭
- 🎮 **人机对战**：人类玩家上桌，操作面板选择弃牌/过牌/跟注/加注/全下
- 🪪 **AI 自己取名字**：开赛前每个模型自主创建 Poker Name（赛季内锁定）
- 🎯 **读牌**：AI 每次决策前根据对手行动推断对方手牌范围（"他 3-bet，大概率 AA/KK/AK"）
- 💬 **每手一句嘴炮**：AI 说一句话或保持沉默（纯给观众看）
- 📚 **技能库（Skill Library）**：决策注入专家级策略——翻前位置范围表、翻后成牌/听牌/底池赔率指导
- ⚔️ **淘汰赛规则**：每 5 局末尾淘汰筹码最少者 + 筹码清零出局 + **每淘汰 1 人盲注升一档**，单挑打到底
- 🎬 **网页实时观战**：牌桌、筹码、公共牌逐街翻开、思考直播、弃牌/全下持续标注
- ⚙️ **网页配置**：点击 AI 头像直接换 provider/模型/API key，保存自动重启

## 🚀 快速开始

```bash
cd poker-arena
npm install
npm start          # 启动后自动开局
```

浏览器打开 **http://localhost:3000**：

- **纯观战**：看 6 个 AI 互打（默认 6 AI 配置在 `config/players.json`）
- **人机对战**：把某个座位的 `provider` 改为 `"human"`，轮到你时屏幕底部弹出操作面板

无头模式（控制台快速跑完整比赛）：`npm run play`

## 🔌 接入真实 AI 模型

1. 复制 `.env.example` 为 `.env`，填入 API key（**key 只存在本地，已被 .gitignore 排除，不会提交到 GitHub**）：

```
# 推荐：一个 OpenRouter key 通吃几乎所有模型
OPENROUTER_API_KEY=sk-or-xxx
# 或 DeepSeek 官方 / Gemini 官方 / 通义千问 DashScope / xAI Grok
DEEPSEEK_API_KEY=sk-xxx
```

2. （国内网络建议）配置本地代理：

```
HTTPS_PROXY=http://127.0.0.1:7890
```

> ⚠️ OpenRouter 的 Gemini 模型仅限美国地区，代理节点需选美国。

3. 编辑 `config/players.json` 配置 6 个座位，例如：

```json
[
  { "id": "gemini", "name": "Gemini 选手", "provider": "openrouter", "model": "google/gemini-3.7-flash" },
  { "id": "qwen", "name": "Qwen 选手", "provider": "openrouter", "model": "qwen/qwen3-30b-a3b-instruct-2507" },
  { "id": "gpt", "name": "GPT 选手", "provider": "openrouter", "model": "openai/gpt-5.6-luna" },
  { "id": "deepseek", "name": "DeepSeek 选手", "provider": "deepseek", "model": "deepseek-v4-flash" },
  { "id": "bot", "name": "机器人", "provider": "heuristic" },
  { "id": "you", "name": "你", "provider": "human" }
]
```

或者直接在网页上点 AI 头像配置，保存自动重启生效。

## ⚔️ 比赛规则

| 项目 | 设置 |
|---|---|
| 游戏 | No-Limit Texas Hold'em，6-max |
| 初始筹码 | 100 BB，筹码不重置，禁止 rebuy |
| 盲注 | 50/100 起步，**每淘汰 1 人升一档** |
| 淘汰 | 筹码清零出局 + **每 5 局末尾淘汰**筹码最少者（3 人以上时） |
| 单挑 | 剩 2 人后不再末尾淘汰，打到底 |
| 获胜 | 最后一个留在牌桌上的玩家 |

## 🧠 技术架构

```
src/
├── arena.ts            # 比赛编排：取名 → 淘汰赛循环 → 淘汰/升盲/单挑
├── poker/              # 规则引擎：cards / evaluator(pokersolver) / game（下注轮、边池）
├── agents/
│   ├── prompt.ts       # 决策提示词（读牌/技能库/淘汰压力）+ JSON 解析
│   ├── skill-library.ts # 技能库：翻前范围表 + 翻后成牌/听牌/赔率指导
│   ├── llm-agent.ts    # 真模型智能体（决策/嘴炮/取名独立调用）
│   ├── heuristic-agent.ts # 启发式机器人（离线/兜底）
│   └── human-agent.ts  # 人类玩家（决策挂起等待 UI 输入）
├── providers/          # OpenAI 兼容适配器（OpenRouter/DashScope/DeepSeek/Gemini/xAI + 代理）
├── server/ + web/      # Express + SSE 实时推送 + 原生 JS 观战页
└── data/               # 身份缓存（本地，git 忽略）
```

关键设计：
- **决策与嘴炮完全分离**（独立 API 调用），模型不会为说骚话改变决策
- **决策输出严格 JSON**：`{"action": ..., "amount_bb": ..., "read": "读牌", "reason": "思路"}`
- **牌力评估复用开源库** [pokersolver](https://github.com/goldfire/pokersolver)
- **模型健康检查**：启动时探测每个模型是否可用，不可用自动降级启发式机器人

## 📋 常用命令

```bash
npm start          # 服务 + 网页观战（自动开局）
npm run play       # 无头模式完整比赛
npm test           # 单元测试（37+：规则引擎/智能体/Arena 端到端）
npm run typecheck
```

## 🗺️ Roadmap

- v0.2：嘴炮进入 AI 决策上下文（心理战）
- v0.3：对手统计 / 长期记忆 / 恩怨
- v0.4：duplicate hands + bb/100 公平比较
- v1.0：正式 AI Poker League

## ⚖️ 声明

- 本项目仅供学习与娱乐，请合理使用各模型 API
- 所有 API key 仅保存在本地 `.env`（git 忽略），请勿提交到任何公开仓库
