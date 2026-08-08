# Folia Web Docker 部署

当前目录提供面向 Docker 部署的完整 Web 堆栈：前端网关、Folia Web API、在线音乐接口和独立的 Sync Server。对外只发布 Web 网关与 Sync Server 两个端口，其余服务仅通过 Docker 网络互访。

Compose 文件边界：`compose.yaml` 是发布版完整栈，`compose.sync.yaml` 只构建 Sync Server，`compose.build.yaml` 将服务切到本地构建镜像；`backend/`、`netease-api/`、`kugou-api/`、`qq-api/` 和 `gateway/` 是内部服务实现。Web 服务从 gateway 暴露，客户端的 Sync API 直接连接独立 sync-server，不通过 Web gateway 转发。

## 快速启动

要求 Docker Engine 24+ 与 Docker Compose v2。部署不需要下载源码；新建一个空目录，只下载 Compose 和环境变量模板：

```bash
mkdir folia-docker
cd folia-docker

curl -fL \
  https://raw.githubusercontent.com/chthollyphile/folia-major/main/deploy/docker/compose.yaml \
  -o compose.yaml
curl -fL \
  https://raw.githubusercontent.com/chthollyphile/folia-major/main/deploy/docker/.env.example \
  -o .env
```

也可以在浏览器中下载这两个文件并放入同一目录。最终目录只需要：

```text
folia-docker/
├── compose.yaml
└── .env
```

生成 Sync Token：

```bash
openssl rand -hex 32
```

编辑 `.env`，把输出填入 `SYNC_TOKEN`。模板默认使用 `papersman` 官方镜像；自建镜像只需修改 `FOLIA_IMAGE_NAMESPACE`。AI 配置可留空，不影响音乐播放。确认至少包含：

```env
FOLIA_IMAGE_NAMESPACE=papersman
SYNC_TOKEN=粘贴至少八位的随机字符串
```

未填写 `FOLIA_STACK_VERSION` 和 `FOLIA_SYNC_VERSION` 时，Compose 自动使用 `latest`。

验证配置并启动：

```bash
docker compose config
docker compose pull
docker compose up -d --wait
docker compose ps
```

默认地址：

- Web：`http://NAS-IP:18080`
- Sync Server：`http://NAS-IP:13000/health`

网易云、酷狗、QQ 音乐和 Folia Web API 没有宿主机端口，不能绕过 gateway 直接访问。Sync Server 位于独立网络，不与 Web 内部服务互通。

当前健康检查入口分别是 gateway 的 `/healthz`、`/api/healthz`、`/runtime-config.js`、`/netease/`、`/kugou/`、`/qq/login/status`，以及 Sync Server 的 `/health`。本地镜像验证脚本 `scripts/smoke-test.sh` 会检查这些路径和网络隔离。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `FOLIA_IMAGE_NAMESPACE` | 模板为 `papersman` | Docker Hub 镜像命名空间，缺失时拒绝启动 |
| `FOLIA_STACK_VERSION` | `latest` | 五个 Web 堆栈镜像的统一版本 |
| `FOLIA_SYNC_VERSION` | `latest` | Sync Server 独立版本 |
| `FOLIA_HTTP_BIND` / `FOLIA_HTTP_PORT` | `0.0.0.0` / `18080` | Web 网关监听 |
| `FOLIA_AI_PROVIDER` | `google` | `google`、`gemini` 或 `openai` |
| `FOLIA_FORWARD_CLIENT_IP` | `false` | 是否把浏览器 IP 转发给音乐平台；保持 `false` 可避免 LAN/Docker 地址出现在登录地点 |
| `ENABLE_GENERAL_UNBLOCK` | `false` | 网易云 API 通用解锁开关；默认关闭 |
| `FOLIA_SYNC_BIND` / `FOLIA_SYNC_PORT` | `0.0.0.0` / `13000` | Sync Server 监听 |
| `FOLIA_SYNC_DATA_DIR` | `./data/sync` | SQLite 持久化目录 |
| `SYNC_TOKEN` | 无 | Sync 客户端 Bearer Token，至少八位，必填 |
| `DASHBOARD_TOKEN` | 空 | Sync Server 隐藏看板 Token |

AI 密钥只传给 backend 容器，不会写入前端静态文件。修改 `FOLIA_AI_PROVIDER` 后重建 gateway 容器即可，不需要重新构建镜像：

```bash
docker compose up -d --force-recreate gateway
```

网易云和酷狗镜像默认不把浏览器或 Docker 私网地址写入上游请求，音乐平台会根据连接本身识别 NAS 的公网出口。只有兼容旧部署行为时才应设置 `FOLIA_FORWARD_CLIENT_IP=true`；这可能使登录记录显示为“局域网”或“未知”。QQ 音乐镜像不转发浏览器 IP，因此不受该开关影响。

## QQ 音乐服务

`qq-api` 由 npm 包 `@yakult-green-tea/qq-music-api` 提供，网页端通过 gateway 的 `/qq/` 访问，登录走 QQ 音乐 App 原生扫码。独立部署方式、环境变量表、serverless 支持情况与常见错误见 [`qq-api/README.md`](./qq-api/README.md)。

装置状态存放在具名卷 `qq-api-state`（容器内 `/app/.auth-state/qq-device.json`），只包含 Android device 识别值，不含 `musickey`、MQTT token 或任何账号凭证。QIMEI 与 device session 跨容器重启复用，因此正常更新不需要重新注册装置。

需要更换装置身份时删除该卷：

```bash
docker compose down
docker volume rm folia_qq-api-state
docker compose up -d --wait
```

同一时间只允许一个活跃扫码会话。没有被扫过的旧二维码会被下一次登录请求直接接管，只有正在手机上确认的会话才会让新请求收到 409。上游装置注册失败时服务返回 502 加 `Retry-After`，随后返回 429，属于预期的退避行为。多实例部署不要共用同一个装置状态卷。

## HTTPS 与浏览器安全上下文

`http://NAS-IP:18080` 可以使用在线搜索、播放、歌词与大部分可视化，但局域网 IP 上的普通 HTTP 不属于浏览器安全上下文。以下能力会不可用或降级：

- File System Access API：本地音乐目录导入、重扫和恢复授权不可用。
- Service Worker / PWA：不能可靠安装或离线运行。
- OPFS：封面二进制持久缓存降级。
- 音频设备枚举和输出设备选择不可用。
- 标准 Clipboard API 不可用，只有实现旧式回退的复制入口仍可能工作。

HTTP 与 HTTPS 是不同 origin。改用 HTTPS 后，HTTP 下的 IndexedDB、登录态、设置和本地曲库索引不会自动迁移。

正式使用本地音乐时，推荐让 NAS 现有反向代理终止 HTTPS：

```text
https://folia.example.com/  ->  http://127.0.0.1:18080
https://sync.example.com/   ->  http://127.0.0.1:13000
```

证书必须具有浏览器信任的完整合法证书链。未在客户端安装根证书的自签名证书仍不属于可信安全上下文。建议使用独立根域/子域，不支持将应用挂载在 `/folia/` 子路径。

反向代理应传递：

```text
Host
X-Forwarded-Host
X-Forwarded-Proto: https
X-Forwarded-For
```

同时把 HTTP 请求重定向到 HTTPS。反向代理在 NAS 宿主机运行时，可将 `FOLIA_HTTP_BIND` 和 `FOLIA_SYNC_BIND` 改为 `127.0.0.1`，避免绕过代理；若反向代理本身位于 Docker，请按 NAS 平台要求连接代理网络或通过受防火墙保护的宿主机端口访问。

File System Access API 还取决于浏览器支持；当前应使用桌面版 Chromium 系浏览器。HTTPS 本身不会让 Firefox 或不支持该 API 的 Safari 获得目录选择能力。

## 更新、回滚和维护

更新到 `.env` 指定版本：

```bash
docker compose pull
docker compose up -d
```

模板默认使用 `latest`，但 Docker 不会自动拉取更新，仍需执行上述 `pull` 命令。回滚时在 `.env` 中加入 `FOLIA_STACK_VERSION` 或 `FOLIA_SYNC_VERSION`，将其设为先前的 `A.B.C` 标签，再重复以上命令。需要严格复现部署时也可以显式固定版本。

数据库位于 `FOLIA_SYNC_DATA_DIR`。备份前可停止 Sync Server：

```bash
docker compose stop sync-server
tar -czf folia-sync-backup.tar.gz ./data/sync
docker compose start sync-server
```

常用诊断：

```bash
docker compose ps
docker compose logs --tail=200 gateway backend netease-api kugou-api qq-api sync-server
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/api/healthz
curl http://127.0.0.1:18080/qq/login/status
curl http://127.0.0.1:13000/health
```

若只开发或运行 Sync Server，可在仓库根目录执行：

```bash
docker compose -f deploy/docker/compose.sync.yaml up -d --build
```

## 本地镜像验证

```bash
FOLIA_IMAGE_NAMESPACE=folia-local SYNC_TOKEN=docker-check-token \
  docker compose -f deploy/docker/compose.yaml -f deploy/docker/compose.build.yaml config

docker compose -f deploy/docker/compose.yaml -f deploy/docker/compose.build.yaml build
./deploy/docker/scripts/smoke-test.sh
```
