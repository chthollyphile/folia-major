FROM node:24-alpine AS builder

WORKDIR /app

ARG VCS_REF=local
ARG STACK_VERSION=local
ARG REQUIRE_COMMIT_NAME=false
# 构建来源仓库（dev/build/buildIdentity.mjs）：本仓库的 docker-stack-publish workflow 会传入，写进诊断报告的 build 行；
# 镜像本身按 APP_RELEASE_CHANNEL=docker 一律算自部署。
ARG GITHUB_REPOSITORY=
COPY package.json package-lock.json .npmrc ./
# 国内服务器使用淘宝 npm 镜像，避免访问 registry.npmjs.org 超时。
RUN npm config set registry https://registry.npmmirror.com && npm ci

COPY . .
ENV VITE_NETEASE_API_BASE=/netease
ENV VITE_KUGOU_API_BASE=/kugou
ENV VITE_QQ_API_BASE=/qq
ENV VITE_QISHUI_API_BASE=/qishui
ENV VITE_AI_PROVIDER=google
ENV VERCEL_GIT_COMMIT_SHA=${VCS_REF}
ENV VERCEL_GIT_COMMIT_REF=docker
ENV APP_VERSION_LABEL=Docker
ENV APP_RELEASE_CHANNEL=docker
ENV DOCKER_STACK_VERSION=${STACK_VERSION}
ENV REQUIRE_COMMIT_NAME=${REQUIRE_COMMIT_NAME}
ENV GITHUB_REPOSITORY=${GITHUB_REPOSITORY}
RUN npm exec vite build

FROM nginx:1.29-alpine AS runner

# 国内服务器替换 Alpine 软件源为阿里云镜像，否则 apk add 会 TLS 超时。
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
    && apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/docker/gateway/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/docker/gateway/entrypoint.sh /usr/local/bin/folia-gateway
RUN chmod 0555 /usr/local/bin/folia-gateway

USER nginx
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/folia-gateway"]
