# 🤠 AI 扑克擂台 (AI Poker Arena)

**6 个 AI 各拿 100 BB → 自己取 Poker Name → 自主打德州扑克 → 每手一句嘴炮 → 输光/末尾淘汰 → 最后一人获胜。**

你也可以**亲自上桌**，跟 5 个 AI 真刀真枪打一场淘汰赛；支持 **1~2 个真人同桌**——两台设备各选自己的座位，互看不到对方底牌，公平对战。所有 AI 的思考过程（读牌、决策思路、嘴炮）实时直播在网页上。

## ✨ 功能特性

- 🃏 **完整德州扑克规则引擎**：翻前/翻牌/转牌/河牌四轮下注、加注/全下/边池、单挑规则
- 🤖 **多 AI 对战**：每个座位独立配置 provider + 模型，真模型或本地机器人混搭
- 🎮 **人机对战（支持 2 个真人同桌）**：每人用自己的设备选一个真人座位，服务器按座位推送底牌——**互不泄露、公平对战**；操作面板支持弃牌/过牌/跟注/加注/全下
- ⏰ **真人超时保护**：真人长时间不操作自动弃牌/过牌（默认 90 秒，可配置），比赛不会被卡死
- 🪪 **AI 自己取名字**：开赛前每个模型自主创建 Poker Name（赛季内锁定）
- 🎯 **读牌**：AI 每次决策前根据对手行动推断对方手牌范围（"他 3-bet，大概率 AA/KK/AK"）
- 💬 **每手一句嘴炮**：AI 说一句话或保持沉默（纯给观众看）
- 📚 **技能库（Skill Library）**：决策注入专家级策略——翻前位置范围表、3-bet 指导、翻后成牌/听牌/底池赔率、下注尺度、筹码深度、对手松紧调整
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
- **双人真人同桌**：把两个座位的 `provider` 都改为 `"human"`，两人各用一台设备打开页面、**各选自己的座位**——服务器只把各自的底牌推给对应设备，互不泄露

无头模式（控制台快速跑完整比赛）：`npm run play`

## 🌐 上线部署（Render 免费版，公网可访问）

> 仓库里已带好 `render.yaml`（Render Blueprint）+ `Dockerfile`，全程无需命令行部署。

1. **把代码推到 GitHub**：

```bash
cd poker-arena
git add -A && git commit -m "v0.2: 双人真人同桌 + 更聪明的 AI + 部署就绪"
git push origin main
```

2. **在 Render 创建服务**（二选一）：
   - 打开 <https://render.com/new/blueprint> → 连接你的 GitHub → 选本仓库 → 自动读取 `render.yaml`
   - 或：New → Web Service → 选仓库 → 运行时 Node → Build `npm ci` → Start `npm start`

3. **填 API key**：Deploy 前在 **Environment** 里添加 `OPENROUTER_API_KEY`、`DEEPSEEK_API_KEY` 等（网页配置弹窗保存 key 只写本机 `.env`，服务器上请在 Dashboard 填，这样重启/重新部署后不丢）。

4. **Deploy** 完成，访问类似 `https://ai-poker-arena.onrender.com` 的地址即可。免费版闲置 15 分钟后会休眠，首次访问需要等 30~60 秒唤醒（SSE 连接时不会休眠）。

> ⚠️ 国内访问 Render 一般可用但偏慢；想更快可部署到国内云服务器（`docker build -t poker . && docker run -p 3000:3000 poker`，把 `.env` 挂载进去）。

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
  { "id": "human1", "name": "玩家一", "provider": "human" },
  { "id": "human2", "name": "玩家二", "provider": "human" },
  { "id": "qwen", "name": "Qwen 选手", "provider": "openrouter", "model": "qwen/qwen3-30b-a3b-instruct-2507" },
  { "id": "deepseek", "name": "DeepSeek 选手", "provider": "deepseek", "model": "deepseek-v4-flash" },
  { "id": "bot", "name": "机器人", "provider": "heuristic" }
]
```

（5 人局也行，最少 2 人即可开赛。）或者直接在网页上点 AI 头像配置，保存自动重启生效。

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
├── server/ + web/      # Express + SSE 实时推送（按座位过滤底牌）+ 原生 JS 观战页
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
npm test           # 单元测试（40+：规则引擎/智能体/Arena 端到端）
npm run typecheck
```

## ⚙️ 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `HUMAN_TIMEOUT_MS` | 90000 | 真人单次操作超时（毫秒），超时自动弃牌/过牌 |
| `BB` / `STARTING_STACK_BB` | 100 / 100 | 大盲筹码值 / 初始筹码（BB） |
| `HAND_DELAY_MS` / `ACTION_DELAY_MS` | 900 / 700 | 观战节奏（毫秒） |
| `LLM_TIMEOUT_MS` | 45000 | 单次模型调用超时 |
| `ELIMINATE_BOTTOM_EVERY` | 5 | 每 N 手末尾淘汰筹码最少者（0 关闭） |
| `HTTPS_PROXY` | - | 本地代理（国内访问 OpenRouter 用） |

## 🗺️ Roadmap

- [x] v0.2：嘴炮进入 AI 决策上下文（心理战）+ 双人真人同桌 + 更聪明的 AI + 部署就绪
- [ ] v0.3：对手统计 / 长期记忆 / 恩怨
- [ ] v0.4：duplicate hands + bb/100 公平比较
- [ ] v1.0：正式 AI Poker League

## ⚖️ 声明

- 本项目仅供学习与娱乐，请合理使用各模型 API
- 所有 API key 仅保存在本地 `.env`（git 忽略），请勿提交到任何公开仓库
