FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV QISHUI_DATA_DIR=/app/data

COPY deploy/docker/qishui-api/package.json ./
RUN npm install --omit=dev --registry https://registry.npmmirror.com

COPY deploy/docker/qishui-api/server.js ./

RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

CMD ["node", "server.js"]
