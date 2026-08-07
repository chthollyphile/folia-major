FROM node:24-alpine AS builder

WORKDIR /app

ARG VCS_REF=local
ARG STACK_VERSION=local
ARG REQUIRE_COMMIT_NAME=false
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV VITE_NETEASE_API_BASE=/netease
ENV VITE_KUGOU_API_BASE=/kugou
ENV VITE_QQ_API_BASE=/qq
ENV VITE_AI_PROVIDER=google
ENV VERCEL_GIT_COMMIT_SHA=${VCS_REF}
ENV VERCEL_GIT_COMMIT_REF=docker
ENV APP_VERSION_LABEL=Docker
ENV APP_RELEASE_CHANNEL=docker
ENV DOCKER_STACK_VERSION=${STACK_VERSION}
ENV REQUIRE_COMMIT_NAME=${REQUIRE_COMMIT_NAME}
RUN npm exec vite build

FROM nginx:1.29-alpine AS runner

RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/docker/gateway/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/docker/gateway/entrypoint.sh /usr/local/bin/folia-gateway
RUN chmod 0555 /usr/local/bin/folia-gateway

USER nginx
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/folia-gateway"]
