# 夢幻の森 — ゲームサーバー(Node版)
# ビルドコンテキストはリポジトリのルート: ゲーム本体を workers/src/ と共有しているため。
#   docker build -f gameserver/Dockerfile -t mnm-gameserver .
FROM node:22-alpine

WORKDIR /app

# 依存(ws のみ)を先に入れてレイヤーキャッシュを効かせる
COPY gameserver/package.json gameserver/package-lock.json* ./gameserver/
RUN cd gameserver && npm install --omit=dev --no-audit --no-fund

# ゲーム本体(Workers版と同一コード)とサーバー実装
COPY workers/src/game.mjs workers/src/shared.mjs workers/src/auth.mjs ./workers/src/
COPY workers/config.json ./workers/
COPY gameserver/index.mjs gameserver/node-room.mjs ./gameserver/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# rootでは動かさない
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/gameserver
CMD ["node", "index.mjs"]
