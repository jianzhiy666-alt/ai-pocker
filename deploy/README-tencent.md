# 🚀 腾讯云轻量应用服务器部署指南（国内访问最快）

适合：腾讯云轻量应用服务器（Lighthouse）免费试用或付费实例，Ubuntu 22.04 / 24.04 / Debian 12。
国内访问延迟 10~30ms，比 Render（美国）快一个数量级。

## 一、购买/领取服务器（约 10 分钟）

1. 打开 **腾讯云轻量应用服务器免费试用**：<https://cloud.tencent.com/act/pro/free>（新用户 0 元 1 个月；到期续费有新人价，约 38 元/年）
2. 或直接购买：<https://cloud.tencent.com/product/lighthouse>
3. 地域：**选离你近的**（广州/上海/北京都可以，全大陆都快）
4. 镜像：**Ubuntu 22.04 LTS**（或 24.04 / Debian 12）
5. 套餐：免费试用一般是 2核2G（这个游戏绰绰有余）；最低配置即可
6. 创建后记下 **公网 IP** 和 **root 密码**（在控制台"重置密码"里设置）

## 二、一键部署（约 3 分钟，全程国内镜像）

用电脑或手机上的任意 SSH 客户端（macOS/Linux 终端、Windows 的 PowerShell 或 Termius 等）登录：

```bash
ssh root@你的服务器IP
```

然后粘贴执行（会自动装 Node → 拉代码 → 装依赖 → 配置服务）：

```bash
bash <(curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/jianzhiy666-alt/ai-pocker/main/deploy/setup.sh)
```

> 如果上面这条因为 GitHub 镜像不通失败，就手动分两步：
> ```bash
> apt-get update && apt-get install -y git curl
> git clone https://ghfast.top/https://github.com/jianzhiy666-alt/ai-pocker.git /opt/ai-pocker
> cd /opt/ai-pocker && bash deploy/setup.sh
> ```

脚本跑完后：

```bash
nano /opt/ai-pocker/.env      # 填入 OPENROUTER_API_KEY / DEEPSEEK_API_KEY（和你本地 .env 一样）
systemctl restart poker-arena # 重启生效
```

## 三、放行防火墙端口（必做，否则外网访问不了）

1. 登录腾讯云控制台 → **轻量应用服务器** → 你的实例 → **防火墙**
2. 点「**添加规则**」→ 协议 TCP → 端口填 **3000**（或你自定义的 PORT）→ 来源 0.0.0.0/0 → 确定

## 四、完成

浏览器访问 `http://你的IP:3000`，双人玩法：两人各开一个浏览器窗口，各选一个真人座位即可。

## 常用运维命令

```bash
systemctl status poker-arena        # 查看状态
systemctl restart poker-arena       # 重启
journalctl -u poker-arena -f        # 实时日志
```

## ⚠️ 注意事项

- **免费试用只有 1 个月**，到期可续费（新人约 38 元/年）或迁移到 Oracle 永久免费（见 README）
- 用 `http://IP:3000` 访问**不需要 ICP 备案**（备案只针对域名 + 80/443 对外服务）；如果以后想绑域名用 80 端口，需要备案
- 代码和 .env 都在服务器上 `/opt/ai-pocker`，换服务器时把整个目录拷走即可迁移
