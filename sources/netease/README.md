# 网易云音乐（`netease`）

Folia 内置的网易云音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节，随平台搬到这里。
构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：第三方库 `@neteasecloudmusicapienhanced/api`（仓库 NeteaseCloudMusicApiEnhanced/api-enhanced），它代我们向网易云自己的
  接口（例如 `interface.music.163.com`）发请求。
- **版本**：4.41.1。本目录的 `package.json`、根目录 `package.json`（网页版与单测用，钉死）和 `deploy/docker/netease-api/package.json`
  都是；升级时几处一起改，连同各自的锁文件，再改 `core/neteaseRaw.ts` 的 `NETEASE_RAW_BACKEND`（单测核对它和根目录钉的版本一致）。
- **桌面端怎么用**：包声明成 `asar`，构建把它和它的依赖装进 `deps.<指纹>.asar`。main 入口（`main/index.ts`）在工作线程
  （`worker.cjs`，源码 `main/neteaseApiWorker.cjs`，线程由 `main/neteaseApiHost.cjs` 开）里经 `@folia/source-deps` 从归档加载包，
  起一个只听 `127.0.0.1` 的本地服务；页面直接向 `http://127.0.0.1:<端口>` 发 HTTP（`core/netease.ts`），端口由 rpc `status` 给。
  - main 入口一加载就起服务（和迁移前应用启动时一样）；完整启用和只用于匹配时宿主一启动都加载它（匹配要后端随时能答，冷启动要几秒，
    比自动匹配每家的等待上限长）。状态每次变化经 `folium.rpc` 的 `status` 推给 client，起不来时提示一次（`core/neteaseLocalService.ts`），登录窗口能重启它。
  - 模组停下（`onBeforeUnload`）或应用退出时结束工作线程；再启用时起新的一个。
  - 登录的 cookie 在页面存储 `online_provider:netease:cookie`（匿名的在 `anonymous_cookie`），迁移前的 `netease_cookie`、
    `netease_anonymous_cookie` 由宿主的受信表认领、读到时搬过来（`src/mods/folium/registries/sourcePageStore.ts`）。
  - 诊断与自检：后端登记在 `api.diagnostics`，登录窗口的诊断报告与自检经 rpc 的 `diagnostics`、`selfCheck` 取；报告里网易云这一份由
    `core/neteaseLoginDiagnostics.ts` 排，自检在 `core/neteaseSelfCheck.ts`。
- **网页版怎么用**：网页版不加载模组，`src/services/onlineMusic/web/netease.ts` 用 `core/` 的 `createSource` 自己注册
  （`src/services/onlineMusic/web/foliumWebSource.ts`），请求发到 `VITE_NETEASE_API_BASE`；没配置时请求报「未配置」。
- **我们改了什么**（都在 `main/`）：
  - 加载前替换包内部的 `util/request` 导出（`withoutImplicitClientIp`）：只有显式要求随机国内 IP 的请求才带伪造的来源 IP，其余请求
    不写 `X-Real-IP` / `X-Forwarded-For`。原因写在 `neteaseApiStartup.cjs`：上游默认的写法会让扫码确认失败。Docker 镜像用
    `deploy/docker/scripts/patch-music-api-client-ip.mjs` 对包的 `server.js` 做同样的事。
  - 推迟加载包依赖的 jsdom，到收藏歌单这类带 checkToken 的请求才加载（`lazyJsdom.cjs`）。
  - 启动时刷新匿名 token 和 xeapi 公钥，每个网络请求有时限（`neteaseApiStartup.cjs`），因为上游的启动请求本身没有超时。
  - 登录诊断包在请求外面（`neteaseLoginDiagnostics.cjs`）。
- **上游变了怎么跟**：
  - `main/neteaseApiWorker.cjs` 直接按路径加载包里的这几个文件：`util/request`、`main`、`util/xeapiKey`、`util/index`、`server`，
    `main/neteaseApiStartup.cjs` 还挂 `module/login_qr_check` 与 `util/option`；补丁脚本改的是 `server.js`。升级前先看这些文件还在不在、
    导出的名字变没变。
  - 模组的 `platform.raw`（`raw@1`）按包里 `module/` 的文件名直通后端：哪些模块能读、能写、永远拒绝，记在 `core/neteaseRaw.ts` 的
    分类表里，表外的一律拒绝。上游新增模块、有人要用时在表里补一行；改名或删掉的模块，`test/unit/onlineMusic/neteaseRaw.test.ts`
    读包的 `module/` 目录会报出来。
  - 测试：`test/unit/electron/neteaseApiStartup.test.ts`、`neteaseApiHost.test.ts`、`lazyJsdom.test.ts`、`neteaseLoginDiagnostics.test.ts`
    都用替身，抓不到上游的变化；音源本身的单测经注册着的模组跑（`test/unit/helpers/neteaseSource.ts`）。`npm run probe:netease-xeapi`
    （`test/manual/netease_xeapi_probe.cjs`）是手动跑的诊断，看 xeapi key 接口在不同网络路径下的答复。

- **已知情况（保持现状）**：上游包把匿名 token 和 xeapi 公钥写在系统临时目录（`os.tmpdir()`）下的 `anonymous_token`、
  `xeapi_public_key` 两个文件里（`main/neteaseApiWorker.cjs` 按这两个路径读写），不在模组数据目录里。「清除数据」不删它们：它们不是
  登录凭据（登录的 cookie 在页面存储里，会被清掉），下次启动后端时会刷新；路径是上游定的，所有用这个包的程序共用。维护者
  2026-11-21 定：保持现状，不改代码。「设置 → 音源」这一行的占用也不算这两个文件。

## 能力

扫码登录、歌曲 / 专辑 / 歌单搜索、歌曲详情（一次 50 首）、按音质取地址（会员歌曲只给试听片段时标成试听）、下架与灰色歌曲的标记和替代版本、
听歌上报（`reports@1`；云盘歌和非数字 id 不报）、逐字歌词（`yrc`，也是别的歌的歌词来源，`lyrics@1.crossSource`，在来源列表里叫
`name.lyrics`；停用后仍可只用于匹配，`keepForMatching`）、副歌区间、歌手的另一种写法、本地歌的元数据匹配（`songs@1.metadataMatch`）、
账号的歌单与收藏专辑、红心、云盘、听歌排行（最近一周、所有时间）、歌单 / 专辑 / 歌手详情、每日推荐与历史日推、日推风格、私人 FM
（模式与场景，`core/neteaseFmCatalog.ts`）、推荐歌单、探索页（`core/neteaseExplore.ts`）、歌单增删歌与收藏、封面按尺寸要（`covers@1`）、
`platform.raw`（`raw@1`）。

歌的 id 是网易云的数字 id 写成的文字，`folium.omni` 交给模组的和迁移前一样（`String(id)`）。网易云自己的字段（`fee`、`privilege`、
`noCopyrightRcmd`、`resourceState`、`t`、歌手的另一种写法 `otherArtistNames`）在歌的 `data` 上；迁移前存下的歌把这些字段放在顶层，
宿主交给模组时折回 `data`，旧的队列与历史照旧读得回来。没有 id 的歌手、专辑（云盘歌）`ref: false`。
