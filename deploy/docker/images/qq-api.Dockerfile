FROM node:24-alpine AS builder

WORKDIR /app

COPY deploy/docker/qq-api/source/package.json deploy/docker/qq-api/source/package-lock.json ./
RUN npm ci

COPY deploy/docker/qq-api/source/tsconfig.json deploy/docker/qq-api/source/tsconfig.build.json ./
COPY deploy/docker/qq-api/source/scripts ./scripts
COPY deploy/docker/qq-api/source/src ./src
COPY deploy/docker/qq-api/source/public ./public
# 构建产物是 dist/src/app.js、dist/package.json 与 dist/public；prune 后只留运行时依赖。
RUN npm run build:js && npm prune --omit=dev

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV QQ_AUTH_STATE_PATH=/app/.auth-state/qq-device.json

COPY deploy/docker/qq-api/source/package.json ./package.json
# 镜像分发的是 qq-music-api（MIT）的修改副本，MIT 要求随二进制附上版权与许可证全文。
COPY deploy/docker/qq-api/LICENSE ./LICENSE.qq-music-api
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/.auth-state && chown node:node /app/.auth-state

USER node
EXPOSE 3000

CMD ["node", "dist/src/app.js"]
