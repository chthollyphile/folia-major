# 部署 QQ 音乐服务

这篇指南会带你为 Folia Web 版启用 QQ 音乐，包括登录、歌单、收藏专辑、我喜欢、播放，电台页的每日推荐、私人 FM 和推荐歌单，以及探索页、音乐云盘和会员等级。

桌面版已经内置 QQ 音乐服务，不需要按照本文额外部署。本文主要面向 Vercel、Cloudflare、Docker 和裸 Node.js 用户。

## 先说结论

QQ 音乐提供三种扫码登录方式：微信扫码、QQ 扫码（用手机 QQ 扫）和 QQ 音乐 App 扫码（用 QQ 音乐 App 的扫一扫，App 登的是 QQ 还是微信账号都行）。不同平台支持的登录方式如下：

| 部署方式 | 微信扫码 | QQ 扫码 | QQ 音乐 App 扫码 | 登录态保存方式 | 适合场景 |
| --- | --- | --- | --- | --- | --- |
| Vercel | 支持 | 支持（网页登录） | 不支持 | 加密令牌 | 最省事的 Web 部署 |
| Cloudflare（默认） | 支持 | 支持（网页登录） | 不支持 | 加密令牌 | 已经使用 Cloudflare 的用户 |
| Cloudflare + Durable Object | 支持 | 支持 | 支持 | 加密令牌 | 希望 Web 版支持全部扫码方式 |
| Docker / Node.js | 支持 | 支持 | 支持 | 服务端会话，可选加密文件持久化 | VPS、NAS 或长期自托管 |
| Electron 桌面版 | 支持 | 支持 | 支持 | 系统安全存储 | 无需自行部署 |

Docker、Node.js 和桌面版的后端有 QQ 音乐 App 扫码时（3.3.2 或更高版本），Folia 只给这一种：打开登录就直接显示二维码，用手机 QQ、微信、QQ 音乐 App 哪个扫都能登录，不用先选。后端低于 3.3.2 时照旧让你选 QQ 扫码或微信扫码。Vercel、Cloudflare 这类 serverless 部署照旧按支持的方式让你选。

> [!IMPORTANT]
> Vercel 没有 QQ 音乐 App 扫码是平台能力限制，不是配置错误：它需要在二维码有效期内一直保持 MQTT WebSocket，Vercel 没有能跨请求持有这条连接的运行时原语。Vercel 和默认的 Cloudflare 上，QQ 扫码改走 QQ 互联的网页登录（和 QQ 音乐官网的「QQ 登录」是同一套），需要 `@yakult-green-tea/qq-music-api` 3.3.3 或更高版本，细节见下面的 [Serverless 上的扫码登录](#serverless-上的扫码登录)。

## 开始前准备

请先准备：

- 一个 GitHub 账号；
- 目标平台账号，例如 Vercel 或 Cloudflare；
- 一段只保存在服务端的随机密钥 `QQ_SESSION_SECRET`；
- 如果要在 Vercel 或默认的 Cloudflare 上使用 QQ 扫码登录，Folia 必须使用包含 `@yakult-green-tea/qq-music-api` 3.3.3 或更高版本的代码；用 Durable Object 的 Cloudflare 需要 3.1.0 或更高版本。

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

Vercel 适合希望快速上线 Web 版的用户。该方案支持微信扫码和 QQ 扫码（网页登录），不支持 QQ 音乐 App 扫码。

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

期望返回 JSON，且 `channels` 是 `qq` 和 `wechat`（后面还有一段 `features`，列出后端实现了哪些功能，这里省略）：

```json
{"code":200,"data":{"channels":["qq","wechat"],"sessionMode":"sealed","configured":true}}
```

如果 `channels` 只有 `wechat`，说明后端低于 3.3.3。

如果返回 Folia HTML 页面，不要把 HTTP 200 当作成功，应先检查仓库根目录的 `vercel.json` 是否仍包含 `/api/qq/:path*` rewrite，并确认当前 Deployment 来自包含 QQ serverless 入口的分支。

## 方案二：部署到 Cloudflare

Cloudflare 默认与 Vercel 一样提供微信扫码和 QQ 扫码（网页登录）。需要增加 QQ 音乐 App 扫码时，再启用 Durable Object。

### 方式 A：一键部署

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

默认应返回 `qq` 和 `wechat`。

> [!NOTE]
> 新建 Worker 后，正式 `workers.dev` 域名可能比 Deployment Preview 晚几分钟生效。若 Preview 正常、正式域名暂时返回 Cloudflare 1042，不要反复重建 Worker；先等待域名传播，再用同一版本复查。

## Cloudflare 启用 QQ 音乐 App 扫码登录

QQ 音乐 App 扫码需要 Durable Object 在二维码有效期内持有 MQTT WebSocket。启用后 QQ 扫码也改走这条连接，不再用网页登录。该功能不会长期保存账号凭证，二维码取消、成功或过期时都会关闭连接。

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
["qq","wechat","qqmusic"]
```

Folia 会自动显示 QQ、微信和 QQ 音乐 App 三个选项，不需要修改前端代码。

> [!IMPORTANT]
> 绑定名必须是 `QQ_QR_CHANNEL`，类名必须是 `QqQrChannel`。仓库默认的 `wrangler.jsonc` 刻意不包含这两段，以免所有一键部署用户都自动创建有黏性的 Durable Object migration。

### Durable Object 成本说明

QQ 二维码最多存活约 3 分钟。出向 WebSocket 期间 Durable Object 不能休眠，因此会按在线时间计费；个人偶尔登录通常影响很小。关闭登录弹窗时，前端会调用取消接口并立即释放连接。

如果要退回默认的登录方式（微信扫码和网页登录的 QQ 扫码），移除 `QQ_QR_CHANNEL` 的 `durable_objects.bindings` 后重新部署即可。已经执行过的 migration 属于部署历史，不要重写或复用它的 tag；失去 binding 后 Durable Object 不再收到请求，也不会继续维持 MQTT 连接。`QQ_SESSION_SECRET` 和其他 QQ API 路由不需要改动。

## Serverless 上的扫码登录

这一节说的是 Vercel 和没有启用 Durable Object 的 Cloudflare。

**QQ 扫码走网页登录。** 这两个平台撑不住长连接，所以 QQ 扫码改走 QQ 互联的网页登录，不需要另外配存储。用起来和桌面版有几点不同：

- 二维码大约 120 秒就失效（桌面版、Docker 是 180 秒），过期后刷新二维码再扫就好。
- 手机上确认之后，后端要多跑几步换登录凭证，这一次会慢一些，最多 15 秒；没换完会提示失败，重新扫一次即可。
- 这是兼容做法：QQ 改了网页登录流程，或者 QQ 拦下部署平台机房发出的请求时，可能会失败。想要最稳定的 QQ 扫码，就用 Docker、Node 或桌面版。

**每个新部署对 QQ 来说都是一台新设备。** Serverless 没有设备文件，设备身份是从 `QQ_SESSION_SECRET` 推导出来的：换一个部署、或者换了密钥，就算一台新设备。账号的登录设备满了的话，第一次扫码会提示设备超限，先到 QQ 音乐 App「设置」最下面的「设备管理」移除不用的设备再扫。所以密钥定下来以后别随便换。

**登录能保持多久。** Serverless 的登录态装在加密令牌里，跟着 QQ 给的凭证寿命走，目前大约 3 天。后端 3.3.2 起有续期接口 `POST /api/qq/login/refresh`：Folia 网页版确认登录还在之后会问一次，之后开着时每小时问一次；离到期不到 6 小时时，后端才换一个新令牌，Folia 存下来接着用。所以只有在快到期的最后几个小时里开着 Folia 网页版，登录才会续上，续上之后又能用大约 3 天；从第一次扫码算起最多 30 天，之后要重新扫码。那几个小时里没有开着 Folia，或者后端低于 3.3.2，大约 3 天就要重扫。

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
npm install @yakult-green-tea/qq-music-api@^3.3.3
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

常驻 Node 服务支持 QQ 扫码、微信扫码和 QQ 音乐 App 扫码；后端 3.3.2 起，Folia 只显示 QQ 音乐 App 扫码的二维码，手机 QQ、微信、QQ 音乐 App 都能扫。`QQ_AUTH_STATE_PATH` 保存非凭证的设备标识；`QQ_AUTH_SESSION_PATH` 保存使用 `QQ_SESSION_SECRET` 加密后的登录态。不要让多个实例共用同一份状态文件。

Folia 的每日推荐、私人 FM、推荐歌单、往自建歌单加歌删歌和收藏歌单用到 3.3.0 新增的接口，红心和收藏专辑用到 3.3.1 新增的接口。已经部署的旧版本服务请升级到 3.3.3 或更高版本（Folia 现在锁定的版本），否则这些入口照样显示，但内容是空的，加歌、收藏、红心会提示失败。3.3.0 起常驻服务会在登录凭证到期前自动续期，不用再隔几天重新扫码；Vercel、Cloudflare 这类 serverless 部署从 3.3.2 起由开着的 Folia 网页版在快到期时续期，最多 30 天（见 [Serverless 上的扫码登录](#serverless-上的扫码登录)）。

探索页、音乐云盘和会员等级用到 3.3.3 才齐的接口（`/recommend/radar`、`/recommend/toplists`、`/recommend/new-albums`、`/song/similar`、`/user/cloud` 等）。后端低于 3.3.3 时，探索页读不出 QQ 的内容，歌单里没有音乐云盘，会员账号不显示皇冠，其他功能照旧。

## 部署后接入 Folia

1. 打开 Folia。
2. 切换到 QQ 音乐音源。
3. 点击连接账号。
4. 扫码登录。Docker、Node.js 和桌面版直接显示 QQ 音乐 App 扫码的二维码，用手机 QQ、微信或 QQ 音乐 App 扫都行；serverless 部署按平台能力选择 QQ 扫码、微信扫码或 QQ 音乐 App 扫码（后端只提供一种时不显示选择）。
5. 登录后确认歌单、收藏专辑、我喜欢和播放功能，再到电台页确认每日推荐、私人 FM 和推荐歌单。

建议同时检查 API：

```text
GET /api/qq/login/channels
GET /api/qq/login/status
GET /api/qq/getSongInfo/0039MnYb0qxYhV
```

前两条用于确认通道和登录服务；歌曲详情用于确认匿名曲库路由没有被登录配置拖垮。

## 扫码失败诊断

QQ 扫码失败后，登录界面与其它平台一样在二维码旁边给出失败帮助：先是两条简单办法（重启 Folia 再扫码；换个网络，例如手机热点，再重启 Folia），然后是自动检查（本地服务、凭据保存、DNS、IPv4 / IPv6 的 TCP 与 TLS 握手、HTTPS、代理、系统时间）的一句结论与逐项结果，最后才是收起的「还是不行？」——展开后有「复制诊断」「反馈」（TUI 登录框里排在最后，F4 复制）。在手机上取消不跑自检、不给这块帮助。

后端 3.3.3 起会在认得出原因的失败里带上 `failureHint`：登录太频繁时按「稍后再试」处理；被拒绝时，状态行显示平台拒绝并引用后端给的原话；账号被封、暂时受限或绑定有问题时，状态行显示平台拒绝，再说明是哪一种：被封的无法登录，受限的暂时不能登录，绑定有问题的要到 QQ 音乐 App 里检查账号绑定；用 QQ 音乐 App 扫了 QQ 扫码的二维码时，状态行说扫码用的 App 不对，并提示改选「QQ 音乐 App 扫码」（部署没有这种方式时，提示用手机 QQ 扫）。QQ 音乐 App 扫码的二维码三种 App 都能扫，那边就算后端这样说也不提示扫错 App，按普通的失败处理。

账号的登录设备数已达上限（凭据交换返回 `20279`）时，登录窗口直接说明设备超限，下面一行告诉用户去哪里清：打开 QQ 音乐 App，进入「设置」，滑到最下面点「设备管理」，移除不用的设备后再扫码；自动检查照常跑。微信通道的 `20279` 直接出现在响应的 `upstreamCode` 上（3.3.0 起还有 `upstreamErrorKey: auth.device-limit`）；QQ 扫码和 QQ 音乐 App 扫码交换失败后，后端会用 MQTT 凭据再验一次，顶层只剩验证那一步的码，3.3.0 起被盖掉的换凭证结果放在 `primaryFailure` 里，网页版和桌面版都能认出来。后端低于 3.3.0 时，只有桌面版能从主进程记下的本轮 `qq-auth.upstream-result` 里认出来，网页版仍按普通失败处理，以排错表为准。

报告分三段：本轮扫码的时间线（每一步的错误原文、HTTP 状态、后端原始响应，包括 `failureStage`、`failureReason`、`upstreamCode`、`retryAfterMs`、`lastFailure`、`upstreamErrorKey`、`failureHint`、`primaryFailure` 等字段，后端新增的类别也原样保留）、自检结果、`qq details`。`qq details` 来自主进程：应用与系统环境、凭据加密后端（Linux 上为 `basic_text` 时 QQ 登录态无法保存，自检会直接给出这个结论）、QQ 本地服务的状态与拉起步骤、包内扫码服务的原始失败（挂在 `failSession` / `failBootstrap` 上的钩子记下的错误名、原文、错误码、上游 HTTP 状态与栈顶几行）、`qq-auth.*` 事件、上游连接记录（`u.y.qq.com`、`mu.y.qq.com` 的 MQTT 等，含连上的地址与断在哪一步），以及最近一次登录态检查的结论。报告不做隐私脱敏，界面会告知其中包含版本、网卡与 IP、请求记录与错误原文；登录凭据（session 的值）不在其中。

没扫过码就自然过期不算失败：后端回 `failureReason=qr-timeout`，或会话已被清掉、回一个不带任何失败字段的 `800` 时，会话记为过期、不跑自检。判定只看这些结构化字段，不比对后端文案；带失败字段的 `800`（上游拒绝、MQTT 断开、凭据交换失败等）一律算失败。关闭登录框、二维码到期时 Folia 取消当前二维码，之后才回来的轮询结果作废。

## 一句话排错表

| 现象 | 优先检查 |
| --- | --- |
| 页面显示 `Login Error` | `/api/qq/login/channels` 是否返回 JSON，而不是 Folia HTML 或平台登录页 |
| 返回 `501` | `QQ_SESSION_SECRET` 未设置，或设置后没有重新部署 |
| Vercel 没有 QQ 音乐 App 扫码 | 正常行为；Vercel 不支持它需要的持久长连接 |
| Vercel 或 Cloudflare 只有微信扫码 | 后端低于 3.3.3 |
| Cloudflare 没有 QQ 音乐 App 扫码 | 检查 `QQ_QR_CHANNEL` binding、`QqQrChannel` 类名和 migration |
| 网页版大约 3 天就要重新扫码 | 两种原因：后端低于 3.3.2，没有续期接口；或者登录快到期的最后 6 小时里没有开着 Folia 网页版，没续上。到了 30 天要重扫是正常的 |
| Cloudflare QQ 二维码打不开 | 确认依赖为 3.1.0 或更高版本，并检查 Worker 日志中的 WebSocket 错误 |
| 正式 `workers.dev` 返回 1042，但 Preview 正常 | 等待新域名传播，不要因为这个现象修改 Static Assets 或 MQTT 代码 |
| 自建歌单打不开，提示不是公开歌单 | 后端版本过旧，缺少带凭据的 `/user/playlist-detail` 路由；升级 `@yakult-green-tea/qq-music-api` 后即可读取不公开的自建歌单 |
| 收藏的「百万收藏」「歌手漫游」等官方歌单打不开，报 `code 10` | 后端低于 3.1.4，或 serverless 部署未设置 `QQ_SESSION_SECRET`；这类歌单只能带登录会话读取 |
| 扫码后上游返回 `20279` | 账号的登录设备满了：打开 QQ 音乐 App，进入「设置」，滑到最下面点「设备管理」，移除不用的设备后再扫码。serverless 部署换一次 `QQ_SESSION_SECRET` 或换一个部署，对 QQ 来说就是一台新设备 |
| 电台页的每日推荐、私人 FM、推荐歌单都是空的，加歌、收藏歌单按钮点了提示失败 | 后端低于 3.3.0，缺少这些接口（Folia 不按后端版本隐藏这些入口）；内置的 Vercel、Cloudflare、Docker 入口已经是 3.3.3，自行部署的 Node 服务需要升级 |
| QQ 的歌点红心、专辑点收藏提示失败，其他功能正常 | 后端低于 3.3.1，缺少 `/user/song/like`、`/user/album/subscribe`；升级到 3.3.1 或更高版本 |
| 网页版个别歌曲提示「暂时无法播放」，桌面版同一账号能播 | serverless 由平台机房向 QQ 取链接，QQ 看到的是机房的网络；见下面「Serverless 部署的网络」 |
| 修改 `VITE_QQ_API_BASE` 后仍请求旧地址 | 该变量在构建时写入前端，必须重新构建；同时检查 `.env.local` 是否覆盖平台配置 |
| 关闭二维码后仍担心计费 | 查看日志是否出现取消请求，以及 Durable Object 的 `/open`、`/close` 是否成对出现 |
| 探索页读不出 QQ 的内容，歌单里没有音乐云盘，会员账号没有皇冠 | 后端低于 3.3.3，缺少 `/recommend/radar`、`/user/cloud`、`/user/vip` 等接口；升级到 3.3.3 或更高版本 |
| 网页版搜歌有时一首都搜不到，换个时间又好了 | serverless 由平台机房向 QQ 搜，QQ 对机房来的请求有时只回空结果；见下面「Serverless 部署的网络」 |
| QQ 的歌词、未登录时的搜歌、模组按 id 找回 QQ 的歌都失败 | 前端没有 `/api/lyric-proxy`：这三样不经 QQ 后端，经前端同源的这个中转。Vercel、Cloudflare、Docker 都带着它，只托管静态文件的部署没有 |

## Serverless 部署的网络

部署到 Vercel 或 Cloudflare 时，向 QQ 发请求的是平台的机房，QQ 看到的是机房的网络，不是你自己的网络。所以网页版可能遇到桌面版、Docker 和 Node 不会遇到的两种情况：

- **搜歌偶尔一首都搜不到。** QQ 对机房来的搜索有时只回一个空结果，不报错。过一会儿再搜，或者换个关键字；经常这样的话，改用 Docker、Node 或桌面版。
- **个别歌曲提示「暂时无法播放」，桌面版同一账号能播。** QQ 按请求来自哪里决定给不给这首歌的播放链接，机房拿不到的歌，在家里的网络往往拿得到。

这两种都是部署形态的限制，不是配置错了，改环境变量也没有用。想让能搜到、能播的歌最多，就用 Docker、Node 或桌面版。

## 安全说明

- 不要记录或分享 cookie、`musickey`、`refresh_key`、二维码 key、sealed token 或完整登录请求 URL。
- 不要把 `QQ_SESSION_SECRET` 写入 Git、前端变量、Dockerfile 或公开 CI 日志。
- serverless 登录态由客户端持有加密令牌；常驻 Node 登录态由服务端会话管理，两者不要混用。
- 本项目及相关接口仅供个人学习、技术交流与非营利测试使用。请尊重数字版权，并在条件允许时通过官方平台支持正版音乐。
