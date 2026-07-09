FROM node:lts-alpine AS builder

WORKDIR /app

# Install native dependencies for sqlite3 compilation
RUN apk add --no-cache python3 make g++ 

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:node

FROM node:lts-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Install only production dependencies (this builds the native better-sqlite3 for alpine)
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Create volume mount point for database
VOLUME ["/app/data"]

# Set default port and db path inside container
ENV PORT=3000
ENV DB_PATH=/app/data/folia-sync.db

EXPOSE 3000

CMD ["node", "dist/node.js"]
