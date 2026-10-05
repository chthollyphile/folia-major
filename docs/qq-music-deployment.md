# 部署 QQ 音乐服务

这篇指南会带你为 Folia Web 版启用 QQ 音乐，包括登录、歌单、收藏专辑、我喜欢和播放功能。

桌面版已经内置 QQ 音乐服务，不需要按照本文额外部署。本文主要面向 Vercel、Cloudflare、Docker 和裸 Node.js 用户。

## 先说结论

QQ 音乐提供两种扫码登录方式：微信扫码和 QQ 扫码。不同平台支持的登录方式如下：

| 部署方式 | 微信扫码 | QQ 扫码 | 登录态保存方式 | 适合场景 |
| --- | --- | --- | --- | --- |
| Vercel | 支持 | 不支持 | 加密令牌 | 最省事的 Web 部署 |
| Cloudflare（默认） | 支持 | 不支持 | 加密令牌 | 已经使用 Cloudflare 的用户 |
| Cloudflare + Durable Object | 支持 | 支持 | 加密令牌 | 希望 Web 版同时支持两种扫码方式 |
| Docker / Node.js | 支持 | 支持 | 服务端会话，可选加密文件持久化 | VPS、NAS 或长期自托管 |
| Electron 桌面版 | 支持 | 支持 | 系统安全存储 | 无需自行部署 |

> [!IMPORTANT]
> Vercel 只有微信扫码登录方式是平台能力限制，不是配置错误。QQ 扫码需要在二维码有效期内持续保持 MQTT WebSocket，Vercel 没有可跨请求持有这条连接的运行时原语。

## 开始前准备

请先准备：

- 一个 GitHub 账号；
- 目标平台账号，例如 Vercel 或 Cloudflare；
- 一段只保存在服务端的随机密钥 `QQ_SESSION_SECRET`；
- 如果要在 Cloudflare 使用 QQ 扫码登录，Folia 必须使用包含 `@yakult-green-tea/qq-music-api` 3.1.0 或更高版本的代码。

可以任选一种方式生成密钥：

```bash
openssl rand -base64 32
```

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> [!WARNING]
> `QQ_SESSION_SECRET` 不要加 `VITE_` 前缀，不要写进仓库、截图、构建日志或镜像。带 `VITE_` 前缀的变量会被编进前端资源。

## 先认识三个配置项

| 配置项 | 用途 | 是否必需 |
| --- | --- | --- |
| `VITE_QQ_API_BASE` | Folia 前端请求 QQ 音乐 API 的地址 | Web 版需要 |
| `QQ_SESSION_SECRET` | 加密 serverless 登录态；也是常驻服务启用登录态文件时的密钥 | 使用内置 serverless 或持久化登录态时需要 |
| `QQ_SESSION_SECRET_PREVIOUS` | 轮换密钥时临时验证旧令牌，避免所有用户同时退出 | 可选 |

使用 Folia 内置的 Vercel 或 Cloudflare 接口时，`VITE_QQ_API_BASE` 固定填写：

```env
VITE_QQ_API_BASE=/api/qq
```

如果 QQ 音乐 API 是单独部署的常驻服务，则填写完整地址，例如：

```env
VITE_QQ_API_BASE=https://qq-api.example.com
```

## 方案一：部署到 Vercel

Vercel 适合希望快速上线 Web 版的用户。该方案支持微信扫码登录，不支持 QQ 扫码登录。

### 第 1 步：导入 Folia

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)

登录 Vercel，选择自己的 GitHub 账号，然后导入 Folia 仓库。

### 第 2 步：配置环境变量

在项目的 **Settings → Environment Variables** 中添加：

```env
VITE_QQ_API_BASE=/api/qq
QQ_SESSION_SECRET=<刚才生成的随机密钥>
```

如果还需要配置其他在线音源或可选功能，请继续按照 [Folia Web 版部署指南](https://folia-site.cielaniska.top/guide/deploy-vercel) 填写对应变量。

### 第 3 步：重新部署

环境变量只会进入新的 Deployment。添加变量后，到 **Deployments** 页面重新部署一次。

部署完成后打开：

```text
https://你的域名/api/qq/login/channels
```

期望返回 JSON，且 `channels` 只有 `wechat`：

```json
{"code":200,"data":{"channels":["wechat"],"sessionMode":"sealed","configured":true}}
```

如果返回 Folia HTML 页面，不要把 HTTP 200 当作成功，应先检查仓库根目录的 `vercel.json` 是否仍包含 `/api/qq/:path*` rewrite，并确认当前 Deployment 来自包含 QQ serverless 入口的分支。

## 方案二：部署到 Cloudflare

Cloudflare 默认与 Vercel 一样只提供微信扫码登录。需要增加 QQ 扫码登录方式时，再启用 Durable Object。

### 方式 A：一键部署微信扫码登录

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major)

部署完成后，在 Worker 的变量和密钥设置中添加：

```env
VITE_QQ_API_BASE=/api/qq
QQ_SESSION_SECRET=<刚才生成的随机密钥>
```

`VITE_QQ_API_BASE` 是构建时变量，修改后必须重新构建并部署。`QQ_SESSION_SECRET` 应保存为 Secret。

### 方式 B：使用 Wrangler 手动部署

先克隆并安装依赖：

```bash
git clone https://github.com/chthollyphile/folia-major.git
cd folia-major
npm install
```

PowerShell：

```powershell
$env:VITE_QQ_API_BASE='/api/qq'
npm run build
npx wrangler deploy
npx wrangler secret put QQ_SESSION_SECRET
npx wrangler deploy
```

macOS / Linux：

```bash
VITE_QQ_API_BASE=/api/qq npm run build
npx wrangler deploy
npx wrangler secret put QQ_SESSION_SECRET
npx wrangler deploy
```

Wrangler 会要求你输入 Secret。不要把密钥直接写在命令参数里。

部署后打开：

```text
https://你的-worker.workers.dev/api/qq/login/channels
```

默认应只返回 `wechat`。

> [!NOTE]
> 新建 Worker 后，正式 `workers.dev` 域名可能比 Deployment Preview 晚几分钟生效。若 Preview 正常、正式域名暂时返回 Cloudflare 1042，不要反复重建 Worker；先等待域名传播，再用同一版本复查。

## Cloudflare 启用 QQ 扫码登录

QQ 扫码需要 Durable Object 在二维码有效期内持有 MQTT WebSocket。该功能不会长期保存账号凭证，二维码取消、成功或过期时都会关闭连接。

打开仓库根目录的 `wrangler.jsonc`，在顶层加入：

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "QQ_QR_CHANNEL", "class_name": "QqQrChannel" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["QqQrChannel"] }
]
```

然后重新构建并部署：

```powershell
$env:VITE_QQ_API_BASE='/api/qq'
npm run build
npx wrangler deploy
```

再次请求：

```text
https://你的-worker.workers.dev/api/qq/login/channels
```

期望 `channels` 变为：

```json
["qq","wechat"]
```

Folia 会自动显示 QQ 和微信两个选项，不需要修改前端代码。

> [!IMPORTANT]
> 绑定名必须是 `QQ_QR_CHANNEL`，类名必须是 `QqQrChannel`。仓库默认的 `wrangler.jsonc` 刻意不包含这两段，以免所有一键部署用户都自动创建有黏性的 Durable Object migration。

### Durable Object 成本说明

QQ 二维码最多存活约 3 分钟。出向 WebSocket 期间 Durable Object 不能休眠，因此会按在线时间计费；个人偶尔登录通常影响很小。关闭登录弹窗时，前端会调用取消接口并立即释放连接。

如果要退回仅支持微信扫码的登录方式，移除 `QQ_QR_CHANNEL` 的 `durable_objects.bindings` 后重新部署即可。已经执行过的 migration 属于部署历史，不要重写或复用它的 tag；失去 binding 后 Durable Object 不再收到请求，也不会继续维持 MQTT 连接。`QQ_SESSION_SECRET` 和其他 QQ API 路由不需要改动。

## 方案三：Docker Compose

Folia 的完整 Docker 堆栈已经包含 `qq-api`，不需要单独安装 npm 包：

```bash
cd deploy/docker
cp .env.example .env
docker compose up -d --wait
docker compose ps qq-api
```

外部验证：

```bash
curl http://localhost:18080/qq/login/status
```

Docker / NAS、HTTPS、反向代理和本地镜像验证见 [Docker 全栈部署文档](../deploy/docker/README.md)。QQ 服务的卷、环境变量和独立镜像说明见 [QQ API 容器文档](../deploy/docker/qq-api/README.md)。

## 方案四：裸 Node.js

需要 Node.js 20 或更高版本：

```bash
mkdir qq-api
cd qq-api
npm init -y
npm install @yakult-green-tea/qq-music-api@^3.1.0
```

macOS / Linux：

```bash
PORT=3200 \
QQ_AUTH_STATE_PATH=./.auth-state/qq-device.json \
QQ_AUTH_SESSION_PATH=./.auth-state/qq-session.enc \
QQ_SESSION_SECRET='<至少 32 字节的随机密钥>' \
node node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js
```

PowerShell：

```powershell
$env:PORT='3200'
$env:QQ_AUTH_STATE_PATH='./.auth-state/qq-device.json'
$env:QQ_AUTH_SESSION_PATH='./.auth-state/qq-session.enc'
$env:QQ_SESSION_SECRET='<至少 32 字节的随机密钥>'
node .\node_modules\@yakult-green-tea\qq-music-api\dist\src\app.js
```

然后在 Folia 的构建环境中设置：

```env
VITE_QQ_API_BASE=https://你的-qq-api-域名
```

常驻 Node 服务同时支持 QQ 扫码和微信扫码两种登录方式。`QQ_AUTH_STATE_PATH` 保存非凭证的设备标识；`QQ_AUTH_SESSION_PATH` 保存使用 `QQ_SESSION_SECRET` 加密后的登录态。不要让多个实例共用同一份状态文件。

## 部署后接入 Folia

1. 打开 Folia。
2. 切换到 QQ 音乐音源。
3. 点击连接账号。
4. 根据平台能力选择 QQ 扫码或微信扫码登录方式。
5. 登录后确认歌单、收藏专辑、我喜欢和播放功能。

建议同时检查 API：

```text
GET /api/qq/login/channels
GET /api/qq/login/status
GET /api/qq/getSongInfo/0039MnYb0qxYhV
```

前两条用于确认通道和登录服务；歌曲详情用于确认匿名曲库路由没有被登录配置拖垮。

## 扫码失败诊断

QQ 登录弹窗不显示诊断区块。普通日志面板中的 `[QQProvider] qr-login:failed` 提供安全失败摘要，可在「设置 → 开发者」或播放器的 `Alt+Shift+D` → Console 查看、筛选和复制。摘要记录扫码通道、失败步骤、HTTP 状态及后端提供的安全原因代码。`@yakult-green-tea/qq-music-api` 3.1.3 起提供这些字段，本地退避 `429` 还会带上 `last-failure`；旧后端缺失的字段显示 `unavailable`，不能据此判断首次失败原因。

摘要也覆盖缺少 key、二维码图片、未知返回码和确认后的账号加载失败，并附上确认响应是否带有会话的布尔值。只输出固定类别和安全数字，不包含 cookie、token、IP、账号、设备标识、URL、原始错误或响应正文；等待轮询不额外记录，同一轮的相同失败不会因退避倒计时重复输出。重试会清空内部摘要并隔离上一轮晚回的诊断；开发时仍可通过 `omni.getQrLoginDiagnostics('qq')` 读取。

## 一句话排错表

| 现象 | 优先检查 |
| --- | --- |
| 页面显示 `Login Error` | `/api/qq/login/channels` 是否返回 JSON，而不是 Folia HTML 或平台登录页 |
| 返回 `501` | `QQ_SESSION_SECRET` 未设置，或设置后没有重新部署 |
| Vercel 只有微信扫码 | 正常行为；Vercel 不支持 QQ 扫码登录所需的持久长连接 |
| Cloudflare 只有微信 | 检查 `QQ_QR_CHANNEL` binding、`QqQrChannel` 类名和 migration |
| Cloudflare QQ 二维码打不开 | 确认依赖为 3.1.0 或更高版本，并检查 Worker 日志中的 WebSocket 错误 |
| 正式 `workers.dev` 返回 1042，但 Preview 正常 | 等待新域名传播，不要因为这个现象修改 Static Assets 或 MQTT 代码 |
| 自建歌单打不开，提示不是公开歌单 | 后端版本过旧，缺少带凭据的 `/user/playlist-detail` 路由；升级 `@yakult-green-tea/qq-music-api` 后即可读取不公开的自建歌单 |
| 扫码后上游返回 `20279` | 先在 QQ 音乐账号中清理旧登录设备，再重新扫码 |
| 修改 `VITE_QQ_API_BASE` 后仍请求旧地址 | 该变量在构建时写入前端，必须重新构建；同时检查 `.env.local` 是否覆盖平台配置 |
| 关闭二维码后仍担心计费 | 查看日志是否出现取消请求，以及 Durable Object 的 `/open`、`/close` 是否成对出现 |

## 安全说明

- 不要记录或分享 cookie、`musickey`、`refresh_key`、二维码 key、sealed token 或完整登录请求 URL。
- 不要把 `QQ_SESSION_SECRET` 写入 Git、前端变量、Dockerfile 或公开 CI 日志。
- serverless 登录态由客户端持有加密令牌；常驻 Node 登录态由服务端会话管理，两者不要混用。
- 本项目及相关接口仅供个人学习、技术交流与非营利测试使用。请尊重数字版权，并在条件允许时通过官方平台支持正版音乐。
