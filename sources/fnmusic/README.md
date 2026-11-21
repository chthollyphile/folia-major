# 飞牛音乐（`fnmusic`，仅桌面端）

Folia 内置的飞牛音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节和
`docs/fnmusic-protocol.md`（现在是本目录的 `PROTOCOL.md`），随平台搬到这里。构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：用户自己的飞牛（fnOS）NAS 上的飞牛音乐服务，走其网页端 HTTP API（`/music/api/v1/...`，fnOS 内网服务）。登录 `POST /music/api/v1/user/password-login`（SHA-256 密码摘要 + 32hex deviceId；2026-10-28 实测不需要 `authx` 签名），后续请求带设备 Cookie（`music-token`）。接口路径与答复字段见 `PROTOCOL.md`。
- **版本**：无外部 npm 包；协议按用户机器上运行的 fnOS 网页端实测。没有要装的依赖，`package.json` 里没有 `dependencies`。
- **怎么用**：main 入口（`main/index.ts`）在主进程里调 `main/fnmusicApiBridge.cjs` 的 `createFnmusicApiBridge({ store, safeStorage, mediaUrl })`：服务器地址、token 与设备 id 经 `api.legacy.store` 沿用迁移前的存储键（`fnmusic-config`、`fnmusic-device-id`），配置用 `api.seal` 加密（加密不可用时只在本次运行内保存）。请求由桥自己用 Node 的 `http` / `https` 发：私网地址（局域网 NAS 常见的自签名证书）放行证书校验，公网（FN Connect 中继）严格校验；`api.net.fetch` 是 Chromium 的网络栈，放不过自签名证书，所以不用它。清单里 `sources[].selfSignedUserServers: true` 如实声明这一点：第三方与覆盖副本的启用确认窗口里列出，内置副本不经确认，在「设置 → 音源」它那一行写明。这只是声明，放行与否仍由桥按私网 / 公网判断，宿主管不到 Node 直连。播放与封面是两条 `_media` 路由（`api.media.serve('stream')`、`api.media.serve('cover')`）：地址 `folia-mod://fnmusic/_media/stream?guid=…`、`…/cover?coverId=…&size=…` 不带凭据，路由转发到 NAS 时带上 Cookie 与 Range，回答带 `Access-Control-Allow-Origin: *`。迁移前存下的 `folia-fnmusic://` 地址由宿主交到同样的路由（受信表的 `legacyMediaSchemes`）；只交给这个内置模组，别的模组接管短 id `fnmusic`（takeover）时这些旧地址回 404。client 经 `folium.rpc` 的 `request` 发操作名（`login`、`logout`、`request`、`stream`、`getStatus`），不经手凭据与 token。
- **我们不改上游**：Folia 不覆盖 fnOS 网页端文件，不保留客户端标识、签名或协议实现，只适配其公开 HTTP 接口。
- **上游变了怎么跟**：fnOS 网页端改接口或字段后，`main/fnmusicApiBridge.cjs` 的请求与 `client/fnmusicProvider.ts` 的归一化要跟着改；登录失败、接口返回变化以 `[FnMusic]` 前缀日志为准。
- **测试**：`test/unit/fnmusic/fnmusicProvider.test.ts` 经注册着的模组音源（`test/unit/helpers/fnmusicSource.ts`）覆盖归一化、登录参数、翻页、歌词和封面地址；`test/unit/electron/fnmusicApiBridge.test.ts` 用替身测服务器地址识别、中继 Cookie、加密配置恢复和两条媒体路由，并用假的 `api` 与假的 fnOS 服务测 main 入口接到 `api.*` 的那一层。

## 能力

表单登录（服务器地址、账号、密码；地址可以是局域网 IP[:端口]、带协议的地址，或一个纯 FN ID——依次试 `https://<fnid>.5ddd.com`、`https://<fnid>.fnos.net`）、歌曲搜索、按 id 读歌、歌词（飞牛给的是 Folia 歌词文档，交成 `folia` 格式的行轨，由宿主解析）、播放（原始文件，只列一档音质）、我的歌单与专辑列表、红心、歌单 / 专辑 / 歌手的歌曲与详情、红心增删、歌单加删歌、建歌单。没有推荐、探索页、收藏歌单（网页端没有这个功能）。不是别的歌的歌词来源。搜索在没登录时不列（`search@1` 的 `access: 'account'`，和迁移前「有登录的平台算要账号」一致）。

登录表单的文字和错误提示都在本目录的 `locales/`：错误按错误码显示（`auth-required` 账号或密码错，`network` 连不上，`unavailable` 地址不成形，`invalid-response` 读不懂的答复）。

## 目录

| 位置 | 是什么 |
| --- | --- |
| `mod.json` | 清单：`folium: 2`，音源 `fnmusic`，四种语言的名字 |
| `client/index.ts` | client 入口：接上请求通道，在第一个 `await` 前 `folium.sources.register` |
| `client/fnmusicProvider.ts` | 音源定义：`search@1`、`songs@1`、`playback.audio@1`、`lyrics@1`、`auth@1`、`library@1`、`catalog@1`、`mutations@1`，以及归一化 |
| `client/fnmusicTransport.ts` | 经 `folium.rpc` 调 main 入口，桥的失败翻成宿主的错误码；封面路由的地址 |
| `main/index.ts` | main 入口：存储、加密、两条媒体路由与操作接到 `api.*` |
| `main/fnmusicApiBridge.cjs` | 原 `electron/fnmusic/fnmusicApiBridge.cjs`，协议换成媒体路由 |
| `locales/` | 短名、登录窗口、登录表单与它的错误提示；`zh-TW.json` 由构建生成 |
| `PROTOCOL.md` | 飞牛音乐服务器协议的实测记录 |
