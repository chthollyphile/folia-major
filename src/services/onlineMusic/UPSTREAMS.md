# 各平台依赖的上游

每个在线平台靠什么拿到数据和音频、版本钉在哪里、我们在上面包了或改了什么、上游变了怎么跟。平台清单以 `providerRegistry.ts` 为准；接入一个新平台见同目录 `README.md` 的“接入一个新平台”。

Folium 2.0 起平台逐家迁成仓库内的音源模组（`sources/<id>/`），迁过去的那一家，这里的一节搬进它自己的 `sources/<id>/README.md`：已经迁的有 `sources/bodian/`、`sources/qishui/`、`sources/fnmusic/`、`sources/ytm/`。

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

## 酷狗（`kugou`）

- **上游**：第三方库 KuGouMusicApi（MakcRe/KuGouMusicApi），包名 `kugoumusicapi`。另有一处直接调酷狗旧的公开手机接口 `https://m.kugou.com/app/i/getSongInfo.php`，在 `/song/url` 拒绝一个 hash 时用来取播放地址（`kugou/kugouTransport.ts` 的 `requestKugouLegacyPlayInfo`）。
- **版本**：v1.6.0。不是从 npm 装的，是 GitHub 上这个标签的源码包：根目录 `package.json` 和 `deploy/docker/kugou-api/package.json` 都写 `https://github.com/MakcRe/KuGouMusicApi/archive/refs/tags/v1.6.0.tar.gz`。
- **桌面端怎么用**：主进程直接 require 这个包、调用它的函数，不起本地服务（`electron/kugou/kugouApiBridge.cjs`，加载前设 `process.env.platform = 'lite'`）。设备 cookie 和登录态由桥接层存，用系统加密。网页版发到 `VITE_KUGOU_API_BASE`。
- **我们改了什么**：桌面端没有改包；Docker 镜像跑同一个 `patch-music-api-client-ip.mjs`，改包的 `server.js`。
- **上游变了怎么跟**：
  - 接口的参数和答复按 `docs/ku-go-api-docs.md` 对；开发时怎么用真的服务对齐，见 skill `kugou-provider-alignment`。
  - 升级改两处的源码包地址和各自的锁文件。
  - 测试：`test/unit/electron/kugouApiBridge.test.ts` 用替身代替包，`test/unit/onlineMusic/kugouTransport.test.ts`、`kugouProvider.test.ts` 用替身代替请求：抓得到我们自己的解析错，抓不到上游改了答复。

## QQ 音乐（`qq`）

- **上游**：第三方库 `@yakult-green-tea/qq-music-api`（仓库 yakult-green-tea/qq-music-api），代我们向 QQ 音乐的接口发请求。
- **版本**：3.3.6，根目录 `package.json`（钉死）和 `deploy/docker/qq-api/package.json` 都是。
- **怎么用**：
  - 桌面端：主进程 require 这个包，包在 require 时自己起一个 HTTP 服务（`electron/qq/qqApiStartup.cjs`）；页面经 `window.electron.getQqPort` 拿到端口，向 `http://127.0.0.1:<端口>` 发请求（`qq/qqTransport.ts`）。登录会话由 `electron/qq/qqAuthSessionRepository.cjs` 存。
  - 网页版：用包的 `./serverless` 导出，Vercel 的入口是 `api-ts/qq.ts`（编译成入库的 `api/qq.js`），Cloudflare 的是 `worker/qq.ts`，扫码登录通道在 `worker/qqQrChannel.ts`。两边都挂在 `/api/qq`，`VITE_QQ_API_BASE` 填 `/api/qq`。
  - 有两处不经后端，直接向 QQ 的 musicu 发匿名请求：匿名搜歌与歌词（`qq/qqLyricProvider.ts`）、按数字 songid 查歌和批量查歌（`qq/qqTransport.ts` 的 `requestQqMusicu`）。桌面端直连 `u.y.qq.com`，网页版经前端同源的 `/api/lyric-proxy`。
- **我们改了什么**：不改包。`api-ts/qq.ts` 和 `worker/qq.ts` 只把宿主的路径还原成包认识的路径。部署细节（Vercel、Cloudflare、Docker、裸 Node 四种）在 [`docs/qq-music-deployment.md`](../../../docs/qq-music-deployment.md)。
- **上游变了怎么跟**：
  - `test/unit/onlineMusic/qqServerlessClosure.test.ts` 读真的包：`./serverless` 的依赖里不能有别的 npm 包和 `node:*`，`process.env.*` 要能在编译时换掉，入库的 `api/qq.js` 要存在。升级后这条最先告诉你网页版还能不能部署。
  - `test/unit/onlineMusic/qqServerlessAdapter.test.ts`、`qqTransport.test.ts`、`test/unit/electron/qqApiStartup.test.ts` 用替身，抓不到包的接口变化。
  - 包的路径（`/getMusicPlay/:songmid` 这类）写在 `qq/qqTransport.ts` 开头的操作表里，包改了路径要跟着改这张表。
  - 升级改根目录和 `deploy/docker/qq-api/` 两处，再按 `npm run build:vercel-api` 重新生成 `api/qq.js`。
  - 按数字 songid 查歌不走后端：3.3.3 的 `/getSongInfo` 把 songid 当字符串交给 QQ，QQ 只认数字（2026-10-21 实测），serverless 的这条路由 songmid 必填。上游修好后也不改回来：用户自己部署的后端版本跟不上。QQ 改了 musicu 的协议或子请求上限时，用 `node test/manual/qq_musicu_song_detail_probe.mjs` 复查（加 `--relay <网页部署的源>` 查中转出口）。

## Spotify（`spotify`，仅桌面端）

- **上游**：
  - Spotify 自己应用用的两个服务，没有公开文档：查询服务 `https://api-partner.spotify.com/pathfinder/v2/query` 和 `https://spclient.wg.spotify.com`（`electron/spotify/spotifyApiBridge.cjs`）。公开的 Web API 对这种登录一律答 429（那个文件开头记着 2026-10-08 实测）。
  - 登录走 `https://accounts.spotify.com/authorize` 和 `/api/token`（`electron/spotify/signIn.cjs`）。
  - 音频：`@lox-audioserver/node-librespot`（仓库 lox-audioserver/node-librespot），librespot 的 Node 原生模块，用账号连上 Spotify 拿到文件位置和密钥；文件从 CDN 按范围读、边读边解密（`electron/spotify/audio.cjs`）。
  - 备用的播放方式：Spotify 官方的 Soloist 程序（文档 https://developer.spotify.com/documentation/soloist），给 Spotify 不发音频密钥的账号用。用的人自己下载、自己生成 API 密钥；Folia 启动它、经它的本机 WebSocket 控制接口播放（`electron/spotify/soloist.cjs`）。
- **版本**：
  - 查询服务：每个查询的名字和哈希写在 `spotifyApiBridge.cjs` 的 `QUERIES`（改账号的那些在同一文件的另一张表），注释写着 2026-10-08 读到的。这就是“钉住的版本”。
  - `@lox-audioserver/node-librespot` 0.5.1，在根目录 `package.json` 的 `optionalDependencies`：没有现成构建的系统上装不上也不让整个安装失败。现成构建是 win32-x64、darwin-arm64、linux-x64 和 linux-arm64（glibc），没有 darwin-x64；打包时这些 `.node` 文件放在 `asarUnpack` 里。
  - Soloist 不随 Folia 分发（Spotify 不许转发它的压缩包和程序），也就没有钉住的版本：用的人选哪个构建就是哪个。每个构建从构建日起 90 天后拒绝启动（退出码 10），版本号和构建时间从 `soloist --version` 读（`soloistBuild.cjs`，输出格式没有文档，读法是宽松的）。
- **我们包了什么**：查询和改动只能经桥接层发，页面只能发 `QUERIES` 里的名字；token 不出主进程。歌曲缓存存的是 Spotify 加密过的文件，密钥不落盘（`audioFiles.cjs`）。Soloist 的 API 密钥用系统钥匙串加密存在主进程，不回给页面；它的控制接口只开在 `127.0.0.1` 上、端口由系统挑，页面不知道端口。
- **上游变了怎么跟**：
  - Spotify 换掉一个查询时答复里带 `PersistedQueryNotFound`，主进程记一行 `[Spotify] query <名字> failed`。要改的是 `QUERIES` 里那个哈希，以及 `spotify/spotifyNormalize.ts` 里读答复的地方。新的哈希从哪里读到，代码和文档都没写：不清楚。
  - `test/unit/spotify/` 下的测试（`spotifyApiBridge.test.ts`、`spotifyAudio.test.ts`、`spotifyAudioFiles.test.ts` 等）用替身，抓不到 Spotify 改了查询或答复。
  - 升级 node-librespot 前看它支持哪些系统；平台条目里的实测在同目录 `README.md` 的 `spotify/spotifyProvider.ts` 一条。
  - Soloist 的命令行参数和控制接口（`-n` 设备名、`-k`、`-D`、`-C`、`-z`（0 或 100 以上的 MB）、`-i` 初始音量、`-w 127.0.0.1:0` 与数据目录里的 `ws.port`，命令 `play` / `pause` / `seek` / `set_volume` / `set_repeat_*`，事件 `auth_state` / `playback_state` / `track_changed` / `position_sync`）照 2026-11 的官方文档写；它改了，`soloist.cjs` 跟着改。它没有曲目结束事件、会自己续播推荐，结束是按位置判断的；`test/unit/spotify/soloist.test.ts` 用替身，抓不到它改了协议。

## Navidrome（不是 Omni 的 provider）

- **上游**：用户自己的 Navidrome 服务，走 Subsonic API（`/rest/<接口>`），入口是 `src/services/navidromeService.ts`。歌词等扩展先问 `getOpenSubsonicExtensions` 再决定用不用。
- **版本**：请求里写 `v=1.16.1`（Subsonic API 版本）、`c=Folia`；鉴权用 `md5(密码 + salt)` 的 token。没有要装的包。
- **上游变了怎么跟**：Subsonic 是公开的协议，服务端版本由用户自己定。`test/unit/navidrome/navidromeService.test.ts` 用替身代替服务端，管的是我们拼请求和读答复的写法。

## Apple Music（`appleMusic`）原生宿主

- **上游**：Apple Music 官方网页与页面内 MusicKit；网页会变化，没有固定版本。macOS 使用系统 WKWebView，不引入独立浏览器 SDK。
- **Windows SDK**：`Microsoft.Web.WebView2` 固定为 `1.0.4314.35`，在 `electron/appleMusic/windows/FoliaAppleMusicCompanion.csproj` 用 NuGet 精确版本区间 `[1.0.4314.35]` 声明。升级时只改这个宿主的 SDK 声明，并重新构建及执行 Windows 验收。
- **Windows 运行时**：使用本机 WebView2 Evergreen，独立于 SDK 更新；不随仓库分发浏览器。需要系统 .NET Framework 4.8。源码已提供，未在 Windows 编译或验证 DRM，默认入口停用；实验开关与验收见 `electron/appleMusic/windows/README.md`。
- **哪些测试能抓到**：Vitest 覆盖父进程请求、队列、协议与平台可用性分支；抓不到 C# 编译、WebView2 登录/DRM 出声或运行时升级造成的网页行为变化，必须在 Windows 实机验收。
