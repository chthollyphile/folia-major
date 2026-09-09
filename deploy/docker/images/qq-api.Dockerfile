FROM node:24-alpine

WORKDIR /app
ENV PORT=3000
ENV QQ_AUTH_STATE_PATH=/app/.auth-state/qq-device.json

# 后端由 npm 包提供，第三方 MIT 全文随包安装在
# node_modules/@yakult-green-tea/qq-music-api/LICENSE，不必再单独复制一份。
COPY deploy/docker/qq-api/package.json deploy/docker/qq-api/package-lock.json ./
COPY patches ./patches
# 临时应用 QQ CDN 补丁；上游发布修复版本后与 patches 目录一起删除。
RUN npm ci --ignore-scripts \
    && npx patch-package --patch-dir ./patches \
    && npm prune --omit=dev
RUN mkdir -p /app/.auth-state && chown node:node /app/.auth-state

ENV NODE_ENV=production
USER node
EXPOSE 3000

# netease / kugou 的镜像还会跑 patch-music-api-client-ip.mjs；QQ 后端不转发浏览器 IP，不需要这一步。
CMD ["node", "node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js"]
