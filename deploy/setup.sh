#!/usr/bin/env bash
# ============================================================
# AI 扑克擂台 — 腾讯云轻量应用服务器一键部署脚本
# 适用：Ubuntu 22.04 / 24.04 / Debian 12（Lighthouse 免费试用或付费实例）
# 用法：以 root 身份执行  bash setup.sh
# 效果：装 Node 22 → 拉代码 → 装依赖 → 配置 .env → systemd 自启 → 输出访问地址
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ai-pocker}"
REPO_URL="https://github.com/jianzhiy666-alt/ai-pocker.git"
PORT="${PORT:-3000}"

say()  { printf '\033[1;32m[部署]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[注意]\033[0m %s\n' "$*"; }

# ---------- 0. 前置检查 ----------
if [ "$(id -u)" -ne 0 ]; then
  echo "请以 root 运行：sudo bash setup.sh"; exit 1
fi
command -v curl >/dev/null || { apt-get update -y >/dev/null && apt-get install -y curl >/dev/null; }

# ---------- 1. 安装 Node 22（npmmirror 国内镜像，快） ----------
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
  say "安装 Node 22（国内镜像）..."
  NODE_VER="v22.14.0"
  curl -fsSL "https://npmmirror.com/mirrors/node/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" \
    -o /tmp/node.tar.xz || {
      warn "npmmirror 下载失败，改用 NodeSource…"
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
      apt-get install -y nodejs >/dev/null
    }
  if [ -f /tmp/node.tar.xz ]; then
    mkdir -p /usr/local/lib/nodejs
    tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
    ln -sf "/usr/local/lib/nodejs/node-${NODE_VER}-linux-x64/bin/node" /usr/local/bin/node
    ln -sf "/usr/local/lib/nodejs/node-${NODE_VER}-linux-x64/bin/npm"  /usr/local/bin/npm
    ln -sf "/usr/local/lib/nodejs/node-${NODE_VER}-linux-x64/bin/npx"  /usr/local/bin/npx
    rm -f /tmp/node.tar.xz
  fi
fi
say "Node: $(node -v) / npm: $(npm -v)"

# ---------- 2. 拉取代码（GitHub 直连失败自动换国内镜像） ----------
if [ ! -f "$APP_DIR/package.json" ]; then
  say "拉取代码到 $APP_DIR …"
  mkdir -p "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR" 2>/dev/null \
    || git clone --depth 1 "https://ghfast.top/${REPO_URL}" "$APP_DIR" 2>/dev/null \
    || git clone --depth 1 "https://gitclone.com/github.com/jianzhiy666-alt/ai-pocker.git" "$APP_DIR" \
    || { warn "GitHub 与镜像都失败，请手动把项目上传到 $APP_DIR 后重试"; exit 1; }
fi

# ---------- 3. 安装依赖（npmmirror 加速） ----------
say "安装依赖（npmmirror 镜像）…"
cd "$APP_DIR"
npm config set registry https://registry.npmmirror.com --location=project
npm ci --no-audit --no-fund

# ---------- 4. 配置 .env（有则复用，无则复制示例） ----------
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  warn "已生成 .env，请编辑 $APP_DIR/.env 填入 OPENROUTER_API_KEY / DEEPSEEK_API_KEY"
  warn "（填好后再执行一次：systemctl restart poker-arena）"
else
  say "复用已有 .env"
fi
# 端口写入 .env（腾讯云防火墙也要放行该端口）
grep -q '^PORT=' "$APP_DIR/.env" || echo "PORT=$PORT" >> "$APP_DIR/.env"

# ---------- 5. systemd 服务：开机自启 + 崩溃自动重启 ----------
say "配置 systemd 服务…"
cat > /etc/systemd/system/poker-arena.service <<EOF
[Unit]
Description=AI Poker Arena
After=network.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/node_modules/.bin/tsx $APP_DIR/src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable poker-arena >/dev/null 2>&1 || true
systemctl restart poker-arena
sleep 3

# ---------- 6. 防火墙（ufw；腾讯云控制台还要单独放行） ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT/tcp" >/dev/null 2>&1 || true
fi

# ---------- 7. 输出结果 ----------
IP=$(curl -fsSL --max-time 3 ifconfig.me 2>/dev/null || curl -fsSL --max-time 3 ip.sb 2>/dev/null || echo "<服务器公网IP>")
say "✅ 部署完成！"
say "   访问地址: http://$IP:$PORT"
warn "最后一步：登录腾讯云控制台 → 轻量应用服务器 → 防火墙 → 添加规则放行 TCP $PORT"
warn "   （不放开端口，外网无法访问，这是最常见的坑）"
say "常用命令: systemctl status poker-arena | restart | logs: journalctl -u poker-arena -f"
