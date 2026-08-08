# QQ 音乐 API 服务（`qq-api`）

`qq-api` 是 Web 堆栈里的 QQ 音乐后端，提供搜索、歌词、专辑、歌手、原生扫码登录，以及登录后的账号歌单、我喜欢、收藏的专辑与播放链接。

服务本体来自 npm 包，本目录只有一份锁定版本的 `package.json` 与 `package-lock.json`，与 `netease-api`、`kugou-api` 的做法一致，仓库里不放任何后端源码。

| 项 | 内容 |
| --- | --- |
| npm 包 | [`@yakult-green-tea/qq-music-api`](https://www.npmjs.com/package/@yakult-green-tea/qq-music-api) |
| 版本 | `2.2.1`，锁定在 [`package.json`](./package.json) 与 `package-lock.json` |
| 原始上游 | [Rain120/qq-music-api](https://github.com/Rain120/qq-music-api)，作者 Rain120 |
| 许可证 | MIT；全文随包安装在 `node_modules/@yakult-green-tea/qq-music-api/LICENSE` |
| 镜像定义 | [`images/qq-api.Dockerfile`](../images/qq-api.Dockerfile) |
| 启动入口 | `dist/src/app.js`（包的 `main`），Koa 服务 |
| Node 要求 | `>=20`；镜像用 `node:24-alpine` |

该包是上游的 fork，相对上游增加了原生扫码登录、二维码会话的取消与抢占、账号歌单 / 我喜欢 / 收藏的专辑等接口，并把编译产物发布成可直接 `require()` 的 npm 包。完整差异见包自带 README 的「关于本 fork」一节。

后端改动一律先在 `qq-music-api` 仓库完成并发布新版本，再回到本目录升级版本号并重新生成 lockfile。

## 部署方式

### Docker Compose（本仓库堆栈）

`qq-api` 已经写在 [`compose.yaml`](../compose.yaml) 里，随整套堆栈启动，不需要额外配置：

```bash
docker compose up -d --wait
docker compose ps qq-api
```

镜像内监听 `3000`，不发布宿主机端口，只经 gateway 的 `/qq/` 前缀暴露。健康检查打的是容器内的 `/login/status`，从外部验证用：

```bash
curl http://127.0.0.1:18080/qq/login/status
```

本地构建镜像见 [`../README.md`](../README.md) 的「本地镜像验证」一节。

### 独立 Docker

只想要这个 API、不需要 Folia 其余服务时，可以单独构建并运行。构建上下文是仓库根目录：

```bash
docker build -f deploy/docker/images/qq-api.Dockerfile -t folia-qq-api:local .

docker run -d --name qq-api \
  -p 3200:3000 \
  -v qq-api-state:/app/.auth-state \
  folia-qq-api:local

curl http://127.0.0.1:3200/login/status
```

### 裸 Node（VPS / NAS）

不使用 Docker 时直接装包运行，同样只需要一个常驻 Node 进程：

```bash
mkdir qq-api && cd qq-api
npm init -y
npm i @yakult-green-tea/qq-music-api

PORT=3200 QQ_AUTH_STATE_PATH=./.auth-state/qq-device.json \
  node node_modules/@yakult-green-tea/qq-music-api/dist/src/app.js
```

该包在被 `require()` 时就会 `app.listen()`，并导出 http server 句柄 `server`。嵌入到其他 Node 进程时应等 `listening` 事件确认端口绑定成功、挂 `error` 监听避免绑定失败变成未处理异常，退出时主动 `close()`；因为 `require` 有模块缓存，同一进程内只应该 `require()` 一次。Electron 版走的正是这条路径（见 [`electron/qqApiStartup.cjs`](../../../electron/qqApiStartup.cjs)），端口动态分配，装置状态写在 `userData/qq-auth-state/qq-device.json`。

### Web 版接法

把 `VITE_QQ_API_BASE` 指向你的实例，然后重启 Vite 或重新构建前端：

```env
VITE_QQ_API_BASE=http://localhost:3200
```

该变量留空时 QQ 入口仍然可见但不可用。经 gateway 部署时前端已经通过同源的 `/qq/` 访问，不需要设置这个变量。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3200`（镜像内设为 `3000`） | HTTP 监听端口 |
| `QQ_AUTH_STATE_PATH` | 相对工作目录的 `.auth-state/qq-device.json` | 装置标识的持久化路径；设为 `memory` 则完全不落盘 |
| `QQ_ENABLE_UPDATE_CHECK` | 未设置 | 设为 `true` 时启动会向 npm registry 查询新版本；默认不查 |
| `QQ_DISABLE_UPDATE_CHECK` | 未设置 | 设为 `true` 强制关闭版本检查，优先级高于上一项 |
| `AUTO_OPEN_EXPLORER` | 未设置 | 设为 `true` 时启动自动打开内置 API Explorer；存在 `CI` 环境变量时永不打开 |
| `LOG_LEVEL` | `info` | 日志级别 |

版本检查默认关闭：这个包会被当作依赖 `require()` 进宿主进程（Docker 镜像、Electron 主进程），在 import 期 spawn `npm` 是不受欢迎的副作用。已经在部署里写了 `QQ_DISABLE_UPDATE_CHECK=true` 的不必改，它仍然有效。

## 装置状态与持久化

QQ 音乐的原生扫码协议要求 QIMEI 引导和后续调用跑在同一个稳定的装置身份上，因此该身份需要跨进程重启保留。

Compose 里它挂在具名卷 `qq-api-state` 上（容器内 `/app/.auth-state/qq-device.json`，文件权限 `0600`）。该文件**只存 Android device 识别值，不含 `musickey`、MQTT token 或任何账号凭证**；写入失败时上游代码会降级成进程内状态而不阻断登录。

需要更换装置身份时删除该卷：

```bash
docker compose down
docker volume rm folia_qq-api-state
docker compose up -d --wait
```

登录凭证与二维码会话只存在于单进程内存中，不写盘。服务重启会清除全部会话，客户端需要重新扫码。

## Serverless 支持情况

**结论：当前不支持 Cloudflare Workers 与 Vercel Serverless Functions，需要一个常驻的 Node 进程。** 这不是打包方式的问题，三条阻碍都在协议实现本身：

1. **长连线**。QQ 音乐 App 的原生扫码靠 MQTT over WebSocket（`wss://mu.y.qq.com`，subprotocol `mqtt`），一条连线要活到用户扫完码，二维码 TTL 是 3 分钟。Vercel serverless function 的执行时长远短于此；Cloudflare Workers 没有 Node 的 `ws`。
2. **跨请求状态**。二维码会话与登录会话是进程内的 `Map`。serverless 每次调用都可能落在不同实例上，`/login/qr/key` 与随后的 `/login/qr/check` 会分别看到两个互不相识的内存。
3. **可写文件系统**。装置身份持久化依赖同步读写文件（`QQ_AUTH_STATE_PATH`）。虽然可以设成 `memory` 关闭落盘，但那样每个实例都会注册出一个新装置身份，等于把第 2 条的问题换个位置再出现一次。

值得说明的是**只读曲库子集本身是无状态的**：`/getSearchByKey`、`/getLyric`、`/getAlbumInfo`、`/getSingerAlbum`、`/getSingerHotsong` 这些接口不碰会话也不碰装置状态，理论上可以单独 serverless 化。真正需要常驻进程的只有扫码登录与登录后的播放链接。

要完整支持 Cloudflare Workers，需要用 **Durable Objects** 承载二维码会话与 WebSocket、用 **KV 或 R2** 存装置身份，并把 `ws` 换成 Workers 的 WebSocket API。那是 `qq-music-api` 仓库的一次独立重构，不在本仓库的改动范围内。

## 多实例部署

不要让多个实例共用同一份装置状态。Compose 之外自行编排时，各实例应各自指定 `QQ_AUTH_STATE_PATH`（或各挂各的卷）。

会话只在单进程内存里，因此实例之间不共享登录态：多实例前面有负载均衡时，扫码登录的整个流程必须落在同一个实例上，否则轮询会读不到刚创建的二维码会话。

## 常见错误

| 状态码 | 含义 | 处理 |
| --- | --- | --- |
| `409` | 有一个二维码正在被手机确认中（已扫码 / 正在换取凭证），或对同一个 key 重复调用了 `/login/qr/create` | 等确认完成或超时；**没有被扫过的旧二维码不会 409**，会被新的登录请求直接接管 |
| `404` | 二维码会话不存在或已过期（`/login/qr/create`、`/login/qr/check`） | 重新调用 `/login/qr/key` 换一个 |
| `429` | 建立会话前的失败触发了指数退避 | 按响应里的 `Retry-After` 等待后重试 |
| `502` | 装置注册（QIMEI / GetSession）或二维码创建向上游失败 | 首次返回 502 并附 `Retry-After`，随后转为 429；属于预期的退避行为 |

`GET /login/qr/cancel?key=<key>` 是幂等的，未知或已过期的 key 同样返回 200：客户端在关闭登录弹窗时会直接发送取消而不等待结果，不应该因此收到需要处理的错误。已经确认成功的会话不会被取消掉，留给它自然过期，以免还在途中的轮询把一次成功的登录读成过期。

排查时先看容器日志：

```bash
docker compose logs --tail=200 qq-api
```
