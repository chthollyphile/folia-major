# 各平台依赖的上游

每个在线平台靠什么拿到数据和音频、版本钉在哪里、我们在上面包了或改了什么、上游变了怎么跟。平台清单以 `providerRegistry.ts` 为准；接入一个新平台见同目录 `README.md` 的“接入一个新平台”。

Folium 2.0 起平台逐家迁成仓库内的音源模组（`sources/<id>/`），迁过去的那一家，这里的一节搬进它自己的 `sources/<id>/README.md`：已经迁的有 `sources/bodian/`、`sources/qishui/`、`sources/fnmusic/`、`sources/kugou/`、`sources/ytm/`、`sources/appleMusic/`、`sources/spotify/`、`sources/qq/`。

几条各平台通用的事实：

- 版本以 `package-lock.json` 为准。`npm ci` 按锁文件装，`package.json` 里写的范围只在改依赖时起作用。
- 网页版的三个平台（网易云、酷狗、QQ）要一个部署好的服务，地址写在环境变量里（`.env.example` 的 `VITE_NETEASE_API_BASE`、`VITE_KUGOU_API_BASE`、`VITE_QQ_API_BASE`）。Docker 部署的那份在 `deploy/docker/<平台>-api/package.json`，版本和根目录的分开钉，升级时两处都要改。
- `deploy/docker/**` 有改动时，CI 的 `docker-stack-check` 会构建镜像，并用 `deploy/docker/scripts/smoke-test.sh` 请求一次 `/netease/`、`/kugou/`、`/qq/login/status`。
- 下面“哪些测试能抓到”只算单元测试。大多数测试用替身代替上游的包，上游换了答复的样子它们照样通过；这种情况写明“抓不到”，升级后要在应用里用真账号试。

## 网易云（`netease`）

- **上游**：第三方库 `@neteasecloudmusicapienhanced/api`（仓库 NeteaseCloudMusicApiEnhanced/api-enhanced），它代我们向网易云自己的接口（例如 `interface.music.163.com`）发请求。
- **版本**：4.41.1，根目录 `package.json`（钉死）和 `deploy/docker/netease-api/package.json` 都是。升级时两处和各自的锁文件一起改。
- **桌面端怎么用**：主进程在工作线程里加载这个包，起一个只听 `127.0.0.1` 的本地服务（`electron/netease/neteaseApiWorker.cjs`，线程由 `neteaseApiHost.cjs` 开）；页面直接向 `http://127.0.0.1:<端口>` 发 HTTP（`netease/netease.ts`）。网页版发到 `VITE_NETEASE_API_BASE`。
- **我们改了什么**（都在 `electron/netease/`）：
  - 加载前替换包内部的 `util/request` 导出（`withoutImplicitClientIp`）：只有显式要求随机国内 IP 的请求才带伪造的来源 IP，其余请求不写 `X-Real-IP` / `X-Forwarded-For`。原因写在 `neteaseApiStartup.cjs`：上游默认的写法会让扫码确认失败。Docker 镜像用 `deploy/docker/scripts/patch-music-api-client-ip.mjs` 对包的 `server.js` 做同样的事。
  - 推迟加载包依赖的 jsdom，到收藏歌单这类带 checkToken 的请求才加载（`lazyJsdom.cjs`）。
  - 启动时刷新匿名 token 和 xeapi 公钥，每个网络请求有时限（`neteaseApiStartup.cjs`），因为上游的启动请求本身没有超时。
  - 登录诊断包在请求外面（`neteaseLoginDiagnostics.cjs`）。
- **上游变了怎么跟**：
  - `neteaseApiWorker.cjs` 直接 require 包里的这几个路径：`util/request`、`main`、`util/xeapiKey`、`util/index`、`server`；补丁脚本改的是 `server.js`。升级前先看这些文件还在不在、导出的名字变没变。
  - 升级要改三处：根目录 `package.json` 和锁文件、`deploy/docker/netease-api/package.json` 和它的锁文件。
  - 模组的实验接口 `platform.raw`（Folium 1.7）按包里 `module/` 的文件名直通后端：哪些模块能读、能写、永远拒绝，记在 `netease/neteaseRaw.ts` 的分类表里，表外的一律拒绝。上游新增模块、有人要用时在表里补一行；改名或删掉的模块，`test/unit/onlineMusic/neteaseRaw.test.ts` 读包的 `module/` 目录会报出来。那里报给模组的后端名字和版本取自包自己的 `package.json`，升级后不用改。
  - 测试：`test/unit/electron/neteaseApiStartup.test.ts`、`neteaseApiHost.test.ts`、`lazyJsdom.test.ts`、`neteaseLoginDiagnostics.test.ts` 都用替身，抓不到上游的变化。`npm run probe:netease-xeapi`（`test/manual/netease_xeapi_probe.cjs`）是手动跑的诊断，看 xeapi key 接口在不同网络路径下的答复。


## Navidrome（不是 Omni 的 provider）

- **上游**：用户自己的 Navidrome 服务，走 Subsonic API（`/rest/<接口>`），入口是 `src/services/navidromeService.ts`。歌词等扩展先问 `getOpenSubsonicExtensions` 再决定用不用。
- **版本**：请求里写 `v=1.16.1`（Subsonic API 版本）、`c=Folia`；鉴权用 `md5(密码 + salt)` 的 token。没有要装的包。
- **上游变了怎么跟**：Subsonic 是公开的协议，服务端版本由用户自己定。`test/unit/navidrome/navidromeService.test.ts` 用替身代替服务端，管的是我们拼请求和读答复的写法。
