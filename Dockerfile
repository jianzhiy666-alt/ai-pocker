# AI Poker Arena — 生产镜像（Render 免费版 / 任意 Docker 平台）
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码与静态资源
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tsx 直接运行 TS（本项目无构建步骤；类型检查在 CI/本地做）
CMD ["npm", "start"]
