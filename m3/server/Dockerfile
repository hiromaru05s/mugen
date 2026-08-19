# 夢幻の森 M3 サーバー
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
ENV PORT=2567
EXPOSE 2567
CMD ["node", "index.js"]
