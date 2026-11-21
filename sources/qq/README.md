# QQ 音乐（`qq`）

Folia 内置的 QQ 音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节和
`src/services/onlineMusic/README.md` 里 QQ 的几段，随平台搬到这里。构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：第三方库 `@yakult-green-tea/qq-music-api`（仓库 yakult-green-tea/qq-music-api），代我们向 QQ 音乐的接口发请求。
- **版本**：3.3.6。本目录的 `package.json`、根目录 `package.json`（网页版的 serverless 入口和单测用，钉死）和
  `deploy/docker/qq-api/package.json` 都是；升级时几处一起改，连同各自的锁文件。
- **桌面端怎么用**：包声明成 `asar`，构建把它和它的依赖装进 `deps.<指纹>.asar`。包在加载时自己起一个 HTTP 服务，所以 main 入口
  （`main/index.ts`）不在启动时加载它：client 第一次问 `status`（要向后端发请求）时才拉起（`main/qqBackend.cjs` 的 `start`：找空端口、
  设好环境变量、从归档加载包、装诊断钩子，`main/qqApiStartup.cjs`），以后照答；页面向 `http://127.0.0.1:<端口>` 发请求
  （`core/qqTransport.ts`）。状态每次变化经 `folium.rpc` 的 `status` 推给 client。只用于匹配歌词时宿主同样一启动就加载
  main 入口，后端同样等第一次 `status`；歌词与匿名搜歌（`musicu`）不用后端。模组停下（`onBeforeUnload`）或应用退出时关掉服务；再启用时宿主清掉模组目录的
  模块缓存（含归档里的包），`status` 拉起的是新的一个。
  - 登录会话由 `main/qqAuthSessionRepository.cjs` 存：`api.legacy.store` 沿用迁移前的存储键（`QQ_API_AUTH_SESSION_V1`），用
    `api.seal` 加密；包的设备标识文件照旧在 `<userData>/qq-auth-state/qq-device.json`（受信表认领的文件夹）。窗口里只有 opaque 的
    `qqmusic_session`（页面存储 `online_provider:qq:cookie`），QQ 的凭据不交给窗口。
  - 诊断与自检：后端登记在 `api.diagnostics`，登录窗口的诊断报告与自检经 rpc 的 `diagnostics`、`selfCheck` 取（上游连接由宿主按
    域名补上）；报告里 QQ 这一份由 `core/qqLoginDiagnostics.ts` 排，自检在 `core/qqSelfCheck.ts`。
  - 媒体跨域经 `api.media.allow`（`qq.com`、`*.qq.com` 与 `y.gtimg.cn`）。
- **网页版怎么用**：网页版不加载模组，`src/services/onlineMusic/web/qq.ts` 用 `core/` 的 `createSource` 和网页的 transport 自己注册
  （`src/services/onlineMusic/web/foliumWebSource.ts`）。后端用包的 `./serverless` 导出，Vercel 的入口是 `api-ts/qq.ts`（编译成入库的
  `api/qq.js`），Cloudflare 的是 `worker/qq.ts`，扫码登录通道在 `worker/qqQrChannel.ts`。两边都挂在 `/api/qq`，`VITE_QQ_API_BASE` 填
  `/api/qq`；没配置时这个音源列为没配好。
- **不经后端的请求**：匿名搜歌与歌词（`core/qqLyricProvider.ts`）、按数字 songid 查歌和批量查歌（`core/qqTransport.ts` 的
  `requestQqMusicu`）直接向 QQ 的 musicu 发匿名请求。桌面端由 main 入口发（rpc `musicu`：只发这一个固定地址，不带会话，经
  `api.net.fetch`），网页版经前端同源的 `/api/lyric-proxy`。
- **我们改了什么**：不改包。`api-ts/qq.ts` 和 `worker/qq.ts` 只把宿主的路径还原成包认识的路径。部署细节（Vercel、Cloudflare、
  Docker、裸 Node 四种）在 [`docs/qq-music-deployment.md`](../../docs/qq-music-deployment.md)。
- **上游变了怎么跟**：
  - `test/unit/onlineMusic/qqServerlessClosure.test.ts` 读真的包：`./serverless` 的依赖里不能有别的 npm 包和 `node:*`，
    `process.env.*` 要能在编译时换掉，入库的 `api/qq.js` 要存在。升级后这条最先告诉你网页版还能不能部署。
  - `test/unit/onlineMusic/qqServerlessAdapter.test.ts`、`qqTransport.test.ts`、`test/unit/electron/qqApiStartup.test.ts` 用替身，
    抓不到包的接口变化；`qqTransport.test.ts` 这些经注册着的模组跑（`test/unit/helpers/qqSource.ts`）。
  - 包的路径（`/getMusicPlay/:songmid` 这类）写在 `core/qqTransport.ts` 开头的操作表里，包改了路径要跟着改这张表。
  - 升级改几处的版本和锁文件，再按 `npm run build:vercel-api` 重新生成 `api/qq.js`。
  - 按数字 songid 查歌不走后端：3.3.3 的 `/getSongInfo` 把 songid 当字符串交给 QQ，QQ 只认数字（2026-10-21 实测），serverless 的
    这条路由 songmid 必填。上游修好后也不改回来：用户自己部署的后端版本跟不上。QQ 改了 musicu 的协议或子请求上限时，用
    `node test/manual/qq_musicu_song_detail_probe.mjs` 复查（加 `--relay <网页部署的源>` 查中转出口）。

- **已知情况（暂不处理）**：上游包加载时调 `app.listen(PORT)`，不带地址，所以本地后端监听所有网卡，不只 `127.0.0.1`：同一局域网里
  的别的设备在系统防火墙放行时也能连上它（端口每次拉起时找一个空的）。页面只向 `127.0.0.1:<端口>` 发请求。迁移成模组之前就是这样；
  要改得替换包的 `app.listen` 或在加载前改写监听地址，维护者 2026-11-21 定：暂不处理，不改代码。

## 能力

扫码登录（QQ、微信、QQ 音乐 App）、歌曲 / 专辑 / 歌单搜索、歌曲详情、按音质降级取地址（都不给时要试听片段）、QRC 逐字歌词
（也是别的歌的歌词来源，`lyrics@1.crossSource`，在来源列表里叫 `name.lyrics`；停用后仍可只用于匹配，`keepForMatching`）、
本地歌的元数据匹配（`songs@1.metadataMatch`）、账号的歌单与收藏、红心、音乐云盘、听歌排行（本周、年度）、歌单 / 专辑 / 歌手详情、
每日推荐、私人 FM、猜你喜欢电台（带模式）、推荐歌单、音乐偏好、探索页、歌单增删歌与收藏、建歌单、封面按尺寸要（`covers@1`）。

歌的 id 是 songmid，`lyricIds.qq` 也是它；数字 songid 记在歌的 `data`（`songId`），歌词与单曲详情按它问。集合身份一律用 mid，
数字 `albumid` / `singer.id` 会被上游拒收（返回 HTTP 200 但 `code` 非 0，只表现成空白页）；没有 mid 的歌手、专辑 `ref: false`。
歌的 `data` 是迁移前的 `providerData`，旧的队列与历史照旧读得回来。

- 扫码登录（`core/qqProvider.ts` 里的 `auth`，加上 `core/qqLoginFailure.ts`、`core/qqBackendDeclaration.ts`、`core/qqSessionRefresh.ts`）：
  后端宣告了 `qqmusic`（QQ 音乐 App 扫码）、会话又不是 `sealed`（桌面版、Docker、Node）时只给这一种、直接出码，手机 QQ、微信、
  QQ 音乐 App 都能扫；Serverless 照宣告给选项。`/login/channels` 的 `sessionMode` 由 `qqBackendDeclaration.ts` 记下。
  `qqSessionRefresh.ts` 确认登录还在后调一次 `/login/refresh`、之后每小时一次：`sealed` 的后端换了 token 就存下来，stored 后端在同一个
  token 下续期（答 `rotated: false`）；没有这条路由的旧后端第一次回 404，之后不再问。后端认出的失败原因（`failureHint`）由
  `qqLoginFailure.ts` 分成稍后再试、平台拒绝和扫错 App；登录设备满了时，登录窗口第二行说去 QQ 音乐 App 哪里移除设备（桌面版另看
  后端快照里换凭据那一步的上游码）。登录方式的图标在 `core/qqLoginIcons.ts`（字和颜色，不用平台的商标）。
- 会话：同源 base 用 `X-QQ-Session` header 送裸 token，外部 URL 与桌面版维持 `?cookie=` 送整串 cookie，两者语义不同不可互换。
  桌面版这次没有系统加密、读不出仓库时，存着的 session 这次不带（按游客请求）也不删，读账号报 `unavailable`；只有登录才有的栏目、
  推荐、收藏状态、试听按游客走（`hasUsableQqSession`）。这次运行里一扫码登录，仓库就把读不出的那份删掉，main 入口从此答「读得出」
  （`status` 的 `sessionStoreUnreadable` 每次现问）。别的路由回 401 时 transport 先问一次 `login_status`（同一时间只问一次），
  后端不再认出这个用户、存着的又还是那个 session 才删。
- 请求与归一化：`core/qqTransport.ts`（操作表、两种 transport、会话）、`core/qqNormalize.ts`；推荐（日推、猜你喜欢、推荐歌单、
  音乐偏好）在 `core/qqRecommendations.ts`、`core/qqGuessYouLike.ts`、`core/qqPreferences.ts`；写入（自建歌单加歌删歌、收藏歌单、
  收藏状态、红心、收藏专辑、建歌单）在 `core/qqMutations.ts`，写入走 POST + JSON 正文，只送一次、不重试；只有本人的普通目录
  （1–199，非「我喜欢」、无系统标记）可以加歌删歌，「我喜欢」走红心。单曲详情在 `core/qqSongDetail.ts`（按数字 songid 直发 musicu，
  一批 25 个）。搜歌在 `core/qqSearch.ts`：有会话时走后端的 `/search` 带会话搜（匿名搜歌常被上游以 2001 风控拒绝），没有会话或后端
  用不了时退回匿名直连；被拒一律报错，不当成搜不到。
- 试听：所有音质都没给链接、又有会话时，多要一次试听文件，拿到就交出 `preview: true` 的片段（`core/qqPreview.ts`）；有档连不上、
  标准音质又没回空链接时不要试听，照「连不上」报，交给播放那边再要。失败的情况由 `core/qqFailure.ts` 说。
- `core/qqLists.ts`：当成集合打开的排行榜、电台（探索页的卡片，`data.list` 记是哪一种）和音乐云盘（`/user/cloud`，只列对得上曲库、
  `playable` 的歌）。`core/qqListeningRank.ts`：听歌排行。
- `core/qqExplore.ts`：QQ 的探索页，个人化的在前（刷歌模式 `/recommend/radar`、每日 30 首、客户端首页 feed、推荐歌单与榜单），
  往下相似歌曲和公开的栏交替（新歌速递与新碟上架、榜单的歌、歌单分类、登录后的电台）。第一页声明 `refreshReadsAnew`：每次换一批
  整页重读。
