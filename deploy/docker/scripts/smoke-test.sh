#!/bin/sh
set -eu

# 当前文件：启动本地构建的完整 Compose 堆栈并验证公开入口和网络隔离。
compose_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
sync_data_dir="$(mktemp -d)"

export FOLIA_IMAGE_NAMESPACE=folia-local
export FOLIA_STACK_VERSION=check
export FOLIA_SYNC_VERSION=check
export FOLIA_HTTP_BIND=127.0.0.1
export FOLIA_HTTP_PORT="${FOLIA_HTTP_PORT:-18080}"
export FOLIA_SYNC_BIND=127.0.0.1
export FOLIA_SYNC_PORT="${FOLIA_SYNC_PORT:-13000}"
export FOLIA_SYNC_DATA_DIR="$sync_data_dir"
export SYNC_TOKEN="${SYNC_TOKEN:-docker-smoke-token}"

# 用函数包住 compose 文件参数，避免仓库路径含空格时被词分割。
compose() {
  docker compose -f "$compose_dir/compose.yaml" -f "$compose_dir/compose.build.yaml" "$@"
}

cleanup() {
  # sync-server 启动时会把 bind mount 的 /app/data 改为 node:node。
  # 清理前恢复为宿主用户，避免 /tmp 的 sticky bit 阻止 runner 删除临时目录。
  compose exec -T --user root sync-server \
    chown -R "$(id -u):$(id -g)" /app/data 2>/dev/null || true
  compose down --volumes --remove-orphans
  rm -rf "$sync_data_dir"
}
trap cleanup EXIT INT TERM

compose up -d --wait
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/healthz" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/api/healthz" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_SYNC_PORT/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/" | grep -q '<div id="root"></div>'
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/runtime-config.js" | grep -q 'aiProvider:"gemini"'
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/netease/" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/kugou/" >/dev/null
# QQ 用 /login/status 而不是 /：它只读进程内会话状态，不会建立 QR session 或注册装置。
curl --fail --silent --show-error "http://127.0.0.1:$FOLIA_HTTP_PORT/qq/login/status" >/dev/null

for service in backend netease-api kugou-api qq-api; do
  container_id="$(compose ps -q "$service")"
  bindings="$(docker inspect "$container_id" --format '{{json .HostConfig.PortBindings}}')"
  if [ "$bindings" != "{}" ] && [ "$bindings" != "null" ]; then
    echo "$service unexpectedly publishes a host port" >&2
    exit 1
  fi
done

sync_networks="$(docker inspect folia-sync-server-1 --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}')"
if printf '%s' "$sync_networks" | grep -q 'folia-internal'; then
  echo "sync-server must not join the Web internal network" >&2
  exit 1
fi