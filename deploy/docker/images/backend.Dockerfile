FROM node:24-alpine AS api-builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY api-ts ./api-ts
COPY shared ./shared
RUN npm run build:vercel-api

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY deploy/docker/backend/package.json deploy/docker/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=api-builder /app/api ./api
COPY shared ./shared
COPY deploy/docker/backend/server.mjs ./server.mjs

USER node
EXPOSE 3000

CMD ["node", "server.mjs"]
