# Spotify（`spotify`，仅桌面端）

Folia 内置的 Spotify 音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节和
`src/services/onlineMusic/README.md` 的 Spotify 一条，随平台搬到这里（路径改成本目录的，其余照旧，
日期是当时写的）。构建、布局和依赖的规矩见 `dev/sources/README.md`；Soloist 怎么用见 `docs/spotify-soloist.md`。

## 迁成模组后变了什么

- **请求通道**：client 经 `folium.rpc` 的 `request` 发操作给 main 入口（`main/index.ts`），宿主只放主窗口的调用进来，
  和以前 `spotify-api-request` 的来源校验一样。main 入口里的 `.cjs` 除了下面几处都是原样搬来的。
- **网络**：认领的内存分区 `folia-spotify`（`api.net.session`），第一次用时设成系统代理，请求一律 `credentials: 'omit'`。
- **登录**：仍是本机回跳 `http://127.0.0.1:5588/login`（`main/signIn.cjs` 原样），授权页经 `api.shell.openExternal` 在
  系统浏览器打开；停用时进行中的登录取消、端口关掉。
- **librespot**：原生包不打进模组，宿主按名字解析（`electron/modSystem/nativeFiles.cjs` 的 `librespot`），main 入口经
  `api.native.load('librespot')` 在第一次要音频时才加载；加载失败或模块不对，取音频报 `unavailable`，其余功能照旧。
  安装包不带 Spotify 时也不带 librespot（`build/bundledSources.mjs` 把不带的音源的原生包排除在 app.asar 外）：`npm run sources:pack -- spotify`
  按系统把 librespot 的加载器和那个系统的 `.node` 放进包里的 `native/librespot/<系统>/`，接管副本的 `api.native.load` 就加载这份；
  旧音频缓存目录 `spotify` 经 `claims.legacyCacheDirs` 认领，`api.cache.legacyDir('spotify')` 照常可用。代码不用改。
- **音频地址**：`folia-spotify://audio/<id>?k=<key>` 换成 `folia-mod://spotify/_media/audio/<id>?once=<key>`
  （`api.media.serve('audio')`）；宿主比较两个地址时不看 `once`。`main/audio.cjs` 收 `audioUrl` 和 `loadLibrespot`，多了
  `serve`（拆开的一次读取），Range 的解析搬进它自己（不再 require 宿主的 `electron/transcode/protocol.cjs`）。
  key 只在一次运行内有效，旧地址不用认。
- **缓存**：加密文件仍存在宿主缓存目录下的 `spotify/`（`api.cache.legacyDir('spotify')`，内置音源表这一行认领了它），
  经 `api.cache.provideEntries` 交给宿主，和歌曲缓存一起算容量上限、统计和按最久没用的先删；存好一首后
  `api.cache.requestPrune()` 按宿主自己的上限修剪。「清除缓存」照旧删这些文件；「清除音源数据」连这个目录一起删。
  模组停用期间宿主看不到这些文件（不算进统计，也不被修剪），重新启用后照旧。
- **Soloist**：程序的数据目录在认领的 `soloist`（`api.paths.legacy`）下，选程序文件用 `api.dialog.pickFile`（默认打开
  用户目录的 `Downloads`）。在播或在启动时 main 入口挂 `api.onBeforeQuit`，退出前把它停下；没有在跑时不挡退出。
  主窗口重建时（例如切换透明），新窗口靠 `isStatusForSong` 认出 Soloist 还在放这首歌，接着跟它的时钟，不重新开始；
  没有 `adopt`、没有 `mount`。播放器都没了（`api.media.onPlayersOrphaned`）时暂停它。
- **存储**：登录、Soloist 的设置与密钥、播放方式、设备 id 仍在主进程存储的 `SPOTIFY_SESSION_V1`、`SPOTIFY_SOLOIST_V1`、
  `SPOTIFY_PLAYBACK_V1`、`SPOTIFY_DEVICE_ID`，经 `api.legacy.store` 读写、`api.seal` 加密。
- **退出与停用**：退出时续期中的令牌请求和 Soloist 收尾（`api.onBeforeQuit`，只在有事时挂上）；停用（`api.onBeforeUnload`）
  时停 Soloist、关 librespot 的连接、取消登录、作废发出的音频地址。
- **播放方式**：`routeOf` 按当前方式答 `audio`（librespot）或 `external`（Soloist），方式一变 `handle.changed()`。
- **语言**：模组收不到换语言的事件。语言表的 `pageLanguage` 每种语言一个词，每次调目录前比一下，变了就丢掉按旧语言
  读的页。日期按语言表的 `dateLocale` 写。
- **文字**：短名、登录窗口的标题与说明、几种登录失败的说明、「已点赞的歌曲」、「新发行」、探索页卡片的类型词、
  「与某首歌相似」、Soloist 配置清单的全部文字都在 `locales/`；全名 `Spotify` 写在定义里，各语言相同。
- **歌词**：交原始 LRC 行轨（有带时间的行才交），由宿主解析；是别的歌的歌词来源（`crossSource: { linesOnly: true }`，要登录）。

## 上游

- **上游**：
  - Spotify 自己应用用的两个服务，没有公开文档：查询服务 `https://api-partner.spotify.com/pathfinder/v2/query` 和 `https://spclient.wg.spotify.com`（`main/spotifyApiBridge.cjs`）。公开的 Web API 对这种登录一律答 429（那个文件开头记着 2026-10-08 实测）。
  - 登录走 `https://accounts.spotify.com/authorize` 和 `/api/token`（`main/signIn.cjs`）。
  - 音频：`@lox-audioserver/node-librespot`（仓库 lox-audioserver/node-librespot），librespot 的 Node 原生模块，用账号连上 Spotify 拿到文件位置和密钥；文件从 CDN 按范围读、边读边解密（`main/audio.cjs`）。
  - 备用的播放方式：Spotify 官方的 Soloist 程序（文档 https://developer.spotify.com/documentation/soloist），给 Spotify 不发音频密钥的账号用。用的人自己下载、自己生成 API 密钥；Folia 启动它、经它的本机 WebSocket 控制接口播放（`main/soloist.cjs`）。
- **版本**：
  - 查询服务：每个查询的名字和哈希写在 `spotifyApiBridge.cjs` 的 `QUERIES`（改账号的那些在同一文件的另一张表），注释写着 2026-10-08 读到的。这就是“钉住的版本”。
  - `@lox-audioserver/node-librespot` 0.5.1，在根目录 `package.json` 的 `optionalDependencies`：没有现成构建的系统上装不上也不让整个安装失败。本目录的 `package.json` 钉着同一版本、声明成 `native`：构建核对装着的版本，不打进模组，由宿主按名字找到（`electron/modSystem/nativeFiles.cjs` 的 `librespot`）、main 入口经 `api.native.load('librespot')` 加载。升级时两处一起改。现成构建是 win32-x64、darwin-arm64、linux-x64 和 linux-arm64（glibc），没有 darwin-x64；打包时这些 `.node` 文件放在 `asarUnpack` 里。
  - Soloist 不随 Folia 分发（Spotify 不许转发它的压缩包和程序），也就没有钉住的版本：用的人选哪个构建就是哪个。每个构建从构建日起 90 天后拒绝启动（退出码 10），版本号和构建时间从 `soloist --version` 读（`soloistBuild.cjs`，输出格式没有文档，读法是宽松的）。
- **我们包了什么**：查询和改动只能经桥接层发，页面只能发 `QUERIES` 里的名字；token 不出主进程。歌曲缓存存的是 Spotify 加密过的文件，密钥不落盘（`audioFiles.cjs`）。Soloist 的 API 密钥用系统钥匙串加密存在主进程，不回给页面；它的控制接口只开在 `127.0.0.1` 上、端口由系统挑，页面不知道端口。
- **上游变了怎么跟**：
  - Spotify 换掉一个查询时答复里带 `PersistedQueryNotFound`，主进程记一行 `[Spotify] query <名字> failed`。要改的是 `QUERIES` 里那个哈希，以及 `client/spotifyNormalize.ts` 里读答复的地方。新的哈希从哪里读到，代码和文档都没写：不清楚。
  - `test/unit/spotify/` 下的测试（`spotifyApiBridge.test.ts`、`spotifyAudio.test.ts`、`spotifyAudioFiles.test.ts` 等）用替身，抓不到 Spotify 改了查询或答复。
  - 升级 node-librespot 前看它支持哪些系统；实测在下面「平台说明」。
  - Soloist 的命令行参数和控制接口（`-n` 设备名、`-k`、`-D`、`-C`、`-z`（0 或 100 以上的 MB）、`-i` 初始音量、`-w 127.0.0.1:0` 与数据目录里的 `ws.port`，命令 `play` / `pause` / `seek` / `set_volume` / `set_repeat_*`，事件 `auth_state` / `playback_state` / `track_changed` / `position_sync`）照 2026-11 的官方文档写；它改了，`soloist.cjs` 跟着改。它没有曲目结束事件、会自己续播推荐，结束是按位置判断的；`test/unit/spotify/soloist.test.ts` 用替身，抓不到它改了协议。

## 平台说明

- `client/spotifyProvider.ts`：Spotify 音源，仅桌面端；`client/spotifyTransport.ts` 经 `folium.rpc` 的 `request` 连接 main 入口里的 `main/spotifyApiBridge.cjs`（迁之前是受限 IPC `spotify-api-request`）。
  Spotify 的文件各层都收在本目录里（`client/`、`main/`、`locales/`），测试在 `test/unit/spotify/`。
  登录在用户自己的浏览器里完成（`main/signIn.cjs`）：应用打开 Spotify 的授权页，用户点“同意”，Spotify 把浏览器送回本机的 `http://127.0.0.1:5588/login`，主进程在一次登录期间（10 分钟）监听这个地址，拿到授权码后换成令牌（authorization code + PKCE，没有密钥）。用户不用输入、不用粘贴、不用自己注册开发者应用。应用对 Spotify 用的是它官方桌面客户端的身份（开源播放器共用的那个 client id）：自己注册的应用最多 5 个用户，还要在 Spotify 后台逐个登记。授权页上显示的应用名因此是 Spotify 自己的。端口固定为 5588（实测 2026-10-08 可用；别的端口 Spotify 认不认没有测到，它在用户登录之后才检查回跳地址），被占用时登录报 `unavailable`。令牌由主进程用 `safeStorage` 加密保存（`main/session.cjs`），不进 renderer；renderer 拿到的账号 id 是 Spotify 账号名的摘要。没有系统加密时和 YouTube Music 一样：存着的读不出就留着、`login_status` 报 `unavailable`，这次的新登录只在这次运行里有效并删掉存着的。访问令牌一小时过期，到期前一分钟内的请求先续期（同时到来的请求只续一次）；请求得到 401 时续期后再试一次；向 Spotify 发的每个请求 30 秒没有答复算失败；Spotify 已经批准、读账号时网络出错的，登录不作废，下一次轮询再读；只有续期被 Spotify 以 `invalid_grant` 拒绝才清掉登录并报 `auth-required`（Spotify 的续期令牌从第一次授权起六个月失效，到时要重新登录），网络错误和别的拒绝都保留登录。登出只是忘掉令牌：Spotify 没有收回授权的接口。
  数据不走 Spotify 的公开 Web API：它对这种登录从第一个请求起一律答 429（实测 2026-10-08）。读的是 Spotify 自己的应用用的两个服务：查询服务（`api-partner.spotify.com/pathfinder`，一组有名字的查询，每个查询靠一个哈希值认，名字和哈希的清单是桥接层的 `QUERIES`，renderer 只能发清单里的，其中读账号名的那一个只有主进程自己用）和 `spclient`（一首歌的电台、歌词、账号套餐）。这两个服务没有公开文档，Spotify 改了就要跟着改；查询被换掉时 Spotify 的回答里带着 `PersistedQueryNotFound`，主进程把它记进日志（`[Spotify] query <名字> failed`）。请求带应用的界面语言（`Accept-Language`：zh-CN / en / id），栏目标题和歌单名跟着变。查询的回答原样交给 renderer，由 `client/spotifyNormalize.ts` 转成应用自己的歌曲和集合：Spotify 的每样东西都有 `spotify:<种类>:<id>` 形式的 uri，应用里的 id 是最后一段；同一首歌在不同查询里缺的字段不同（喜欢的歌 uri 在歌的旁边，专辑里的歌不带专辑，歌手热门歌的专辑没有名字），都在 `spotifySongOf` 里处理；歌单里不是歌的行（播客单集、读不出的条目、uri 不是所要种类的）去掉，翻页仍按 Spotify 自己的行数走；一整页都不是歌时接着读下一页，一次调用最多连读 5 页（应用把没有歌的一页当作列表到头）。
  音乐库（`client/spotifyLibrary.ts`）：歌单一栏是账号自己建的和收藏的歌单，最前面多一项“已点赞的歌曲”（id `liked`，带 `isLiked`，封面用最近点赞那首的封面）；歌单卡片带 `isOwned` 当且仅当 Spotify 说这个账号能改它的歌（自己的和受邀协作的）。歌单和专辑按 offset 翻页，要多少给多少（实测要 343 行，50 首的歌单整份返回），一次最多要 100 行。歌手页的歌是 Spotify 给的十首热门歌，没有下一页。
  搜索：Spotify 的搜索翻页不干净（实测 2026-10-08：每页都给足要的行数，其中约五分之一是前面给过的；它报的总数是“页大小加五分之一”；第二页起一律说没有下一页）。所以一次搜索从头往下走并留着，每页只交出没给过的歌（`spotifyProvider.ts` 的 `searchWalks`，按搜索词留最近 8 个；放不下时先丢只读过第一页的，给歌词找歌的搜索只读一页、不会回来，翻过页的是听的人正在看的），最多往下读 300 行；回到之前搜过的词接着原来读到的地方走，已经不留着的从头重走到要的那一页；同一个搜索的调用排队，不会两次要同一段。
  探索页（`client/spotifyExplore.ts`）全是 Spotify 自己按账号给的内容，分四段，读到哪段才向 Spotify 要哪段（下面的数字是实测 2026-10-08，一个很少使用的免费账号）：（1）Spotify 官方应用的首页（查询 `home`）：6 栏，每栏一个标题加歌单、专辑、歌手卡片，每栏给 10 个，各栏共有 6 到 50 个；账号自己的收听记录栏（类型 `HomeRecentlyPlayedSectionData`、`HomeShortsSectionData`）去掉，理由同上文“应用自己的两栏”；一栏的“更多”用查询 `homeSection`，它不管要哪个 offset 都给这一栏的前 20 个（换成网页播放器现在用的哈希也一样），所以每栏只有一批“更多”，内容是这 20 个里首页没给的那些。（2）关注歌手的新发行（查询 `queryWhatsNewFeed`，只要专辑类：2 张），标题是应用自己的（模组语言表的 `newReleases`）；读不到时这一栏不出现，页面照常往下。（3）Spotify 为这个账号生成的歌单（查询 `browsePage`，页面 uri `spotify:page:0JQ5DAt0tbjZptfcdMSKl3`，对所有账号相同）：9 栏共 138 个歌单，每个都带“为该账号生成”的标记（每日合辑、每周新发现、反复聆听、按歌手和按风格的合辑），没有一个出现在首页上，都能用 `fetchPlaylist` 打开（27 到 50 首）；这一页的翻页是真的（`sectionPagination` 的 offset 对页面上所有栏同时生效，100 个的一栏要第 51 到 100 个，给的是另外 50 个），每栏一批 20 个，“更多”的游标记着栏的 uri 和读到第几个；和首页同 uri 的栏不再出一次（一页里一个 id 只有一栏）；这个查询被 Spotify 拒绝或换掉时这一段不出现，页面照常往下到第（4）段，网络错误时这一页报失败、可以重试。（4）应用自己做的“与《某首歌》相似”的歌曲栏（那首歌的电台：桥接操作 `radio` 给出歌单 uri，再读它的歌；50 首，第一首是那首歌自己，再问一次是同一份；3 个电台共 150 首里 137 首不同）。种子依次是 `listened`（听者在应用里听过的 Spotify 歌）和账号在 Spotify 点赞的歌（最近的 50 首，读到这一段时才要一次；读不到时先用 `listened` 的种子，下一页再要，一个种子都没有才报失败）。一页 3 栏，一次从头读最多 9 栏（每栏向 Spotify 发两个请求）；一栏只收别的栏没有的歌，去掉种子自己和电台里重复的行，不足 12 首不成栏，只留整批（12 首一批，一般 4 批）；这些栏带 `changesWithRead`，栏的 id 和“更多”的游标每次读都是新的，上一次读的游标在这一次读里什么也拿不到。点赞不到 10 首的账号每次从头读用的是同一批种子，栏还是那几栏，只是栏里的歌换了先后。下一次从头读先用之前没用过的种子，全用过了先用最久以前用过的；一栏里先排之前各栏没交出过的歌，再排最久以前交出过的（用过的种子和交出过的歌记在各平台共用的 `exploreReads.ts` 里，见 `EXPLORE_ADAPTER.md` 规则 10；实测：第二次读到的 9 栏，首批 108 首没有一首在第一次的首批里）。Spotify 的栏各有一个各次读取都不变的 uri，用作栏目 id；隔几秒连读两次，首页和账号歌单页的栏目、条目和顺序都相同，所以每次从头读真正不同的是第（4）段。批的大小是配合“换一批”定的：探索页逐批走完每一栏、所有栏都没有新的一批了才把页面从头重读，20 个一批的最长一栏（5 批）和 12 首一批的相似栏（4 批）差一次就同时走完。Spotify 的首页和账号歌单页上没有单曲，全是集合。整页读到底是 22 个请求。
  电台页（2026-10-08 接上，`client/spotifyRecommendations.ts`，能力 `recommendations: true`；2026-10-08 在一个真实的 Premium 账号上跑过一遍读取，7 个请求：每日合辑认出来了、50 首，推荐歌单 35 个，FM 连要 4 次各 2 首、没有重复，丢弃一首后它所在电台剩下的歌一并丢掉并换了种子；页面本身还没有人看过）：三样东西都是 Spotify 自己按账号给的。私人 FM：一个接一个的“歌曲电台”（桥接操作 `radio`；种子和读电台的函数在 `client/spotifyRadio.ts`，和探索页“与某首歌相似”的栏共用）。种子是账号最近点赞的 50 首歌，加上探索页最近一次从头读时交来的 `listened`（`getPersonalFm` 拿不到 `listened`，所以本次运行里没打开过探索页时只有点赞的歌）。每次从还没用过的种子里随机取一首：同一首歌的电台每次都是同一份歌单，按固定顺序取的话每次启动都从同样的歌开始。`getPersonalFm()` 每次交出接下来的 2 首（队列因此总知道下一首是什么），一次运行里一首歌只交出一次，种子本身不交出；一个电台用完换下一个种子，种子和最后一个电台都用完时重读一次点赞的歌（期间新点赞的歌成为新种子）。`dislikeSong`（FM 的垃圾桶）不通知 Spotify：这首歌本次运行不再交出，它所属电台剩下的歌整个丢掉；已经交进播放队列的歌（最多两首）收不回来。红心走通用的 `likeSong`，就是 Spotify 的点赞。一个种子都没有（没有点赞，也没有听过）时 `getPersonalFm` 交回空表，首页不出私人 FM 卡片，不编造歌曲。不设 `personalFmModes`。每日推荐：Spotify 的第一个 Daily Mix。它每天按账号的收听重新生成，对得上卡片上“每天更新”的说法；Discover Weekly 一周才换一次，所以没有用它；其余的 Daily Mix 留在推荐歌单里。Daily Mix 是从“为你打造”那一页（`spotifyExplore.ts` 的 `spotifyMadeForAccount`）里按歌单 id 的前缀 `37i9dQZF1E3` 认出来的，这个前缀 2026-10-08 在一个真实账号上核对过（57 个歌单里认出了每日合辑）；认不出时日志写明读到多少个歌单、其中没有 Daily Mix，卡片是 0 首。推荐歌单：那一页上其余的歌单，按 Spotify 自己的顺序，最多取调用方要的数量。那一页的读取结果留一分钟，供同时来的两个请求和随后打开卡片用。Spotify 换掉查询（非网络错误）时这两样留空，FM 照常（FM 自己读“点赞歌曲”被拒时也一样：用在应用里听过的歌做种子，一首都没有就不出 FM 卡片，页签其余部分照常）；断网时整页读取失败，回到这一页时重读。登出、或一次登录成功后，FM 的记录和读到的歌单都清掉。日推页面上的“管理推荐”和历史日期只在平台有 `historyRecommendations` 能力时出现（`GridView.tsx`）：Spotify 的日推页只有歌单、数量和刷新。
  歌词：Spotify 自带的歌词只有逐行时间（`spclient` 的 `color-lyrics`，请求必须带 `app-platform: WebPlayer`，否则答 400），不带时间的当作没有，交给跨源匹配。
  Spotify 也是跨源匹配的一个歌词来源（音源定义里 `lyrics@1` 的 `crossSource: { linesOnly: true }` 加 `access: 'account'`，宿主据此登记歌词来源 `spotify`；默认顺序里的位置仍是宿主 `src/utils/lyrics/lyricSources.ts` 的 `BUILT_IN_ORDER`，怎么搜、怎么取在 `lyricMatchSources.ts`），别的平台、本地和 Navidrome 的歌都能用它。它只用账号自己的登录来答，所以只在 Spotify 登录着的时候出现在“匹配歌词”对话框的标签和设置的“歌词匹配优先级”里（`useLyricMatchSources`），自动匹配在没登录时不向它发请求（`isLyricMatchSourceOffered`）。自动匹配里它只可能当逐行的备选：别的来源已经给出逐行歌词后不再问它，每试一个歌手名最多一次搜索加一次取词（所有来源都落空、换另一种歌手写法重试时再来一遍）；正在放的就是 Spotify 的歌时直接用手上那份歌词，不发请求。把它选成首选来源时，Spotify 的歌保留自己的逐行歌词，只有别处找到逐字歌词才换。搜索用的是和其他来源一样的“歌名 - 歌手 - 专辑”（实测 2026-10-08：英文、日文、中文各取知名歌曲共 4 首，都搜到并取到带时间的歌词）。本地歌曲从 Spotify 匹配到歌词时，歌名、歌手、专辑和封面也照其他来源的规矩取自 Spotify（`onlineMetadata.source` 为 `spotify`）；“匹配元数据”对话框不搜 Spotify。设置里选了 Spotify 之后登出，这一项不再显示，自动匹配和设置页都当作没有选过，按默认的首选（QQ）走；存着的选择不动，再登录就恢复。两处留着没改：对话框开着 Spotify 标签时账号登出，标签消失但对话框还停在 Spotify 上（搜不到东西）；每次自动向 Spotify 搜歌词都会占掉搜索页留着的 8 个搜索词里的一个，被挤掉的搜索词翻下一页时从头重走。
  播放（2026-10-08 接上，`main/audio.cjs`）：Spotify 自己的音频只给付费账号（它对所有第三方播放器的限制）。账号是否付费在登录时读出并存下（`vipType`），之后每次读登录状态时最多十分钟重读一次；存下的是免费账号时，要一首歌之前先重读一次套餐（最多 30 秒一次），所以账号开通会员后不用重新登录，第一次点播放就能听。读套餐的请求还在路上时，这期间要的歌都等同一个答复。只有 Spotify 这次运行里亲口答过“免费”才报 `subscription-required`（队列停下并提示“Spotify 需要会员才能播放，当前账号不是会员”；这个原因和“只能试听”分开：平台给试听片段时照放片段并提示（见下面 `resourceCache.ts` 一条），免费账号却一段也不播；日志里带它答的 `catalogue` 和 `product`）；套餐读不到时不算免费，照常去取歌，由播放组件决定成不成；重读时发现登录已失效报 `auth-required`。套餐读失败时沿用已存的，不把付费账号记成免费。
  Spotify 把每首歌存成 CDN 上的一个加密文件。主进程用 `@lox-audioserver/node-librespot`（librespot 的 Node 绑定，原生模块，可选依赖）以账号的 token 连上 Spotify，问到文件的 CDN 地址和 AES-128 密钥（`resolveAudioFileAsync`，实测一次 0.1 到 0.4 秒，第一次连同建立连接约 1.3 秒）。音频地址是应用自己的 `folia-mod://spotify/_media/audio/<trackId>?once=<key>`，每次 `getAudioSource` 都换一把 key；音频元素要哪一段，主进程就按 Range 向 CDN 要哪一段，边读边解密（计数器模式，可以从任意字节开始），解密后的音频不落盘，也不在内存里留整首歌（加密文件本身可以存盘，见下一段）。Ogg 文件开头有 167 字节是 Spotify 自己的页，不交给播放器（应用看到的文件从它之后算起）。CDN 地址有时效：10 分钟后或被 CDN 拒绝（401/403/404/410）时重新问一次；重新问到的文件长度或类型变了，旧地址答 503，渲染端换新地址。连接放久了可能被 Spotify 关掉：在留着的连接上问失败时新建一次连接再问；Spotify 明说这首歌没有（`track is unavailable`、`no audio files available`）时报 `not-playable`，不新建。登录、登出会关掉连接并作废所有已发出的地址。音质：`standard` 要 160 kbit/s，其余档位要 320 kbit/s（Ogg Vorbis；Spotify 的无损没有接）。所以 adapter 只列两档（`playback.audioQualityLevels: ['standard', 'high']`）：音质选项在 Spotify 下只有 `standard` 和 `high` 两个按钮，存着的偏好是 `lossless` 或 `hires` 时亮的是 `high`，交给主进程的也是 `high`。
  **Spotify 的音频存盘时保持 Spotify 自己的加密**（2026-10-08，`main/audioFiles.cjs`）：Spotify 给的文件本来就是加密的，歌曲缓存开着时主进程把它原样写进缓存目录下的 `spotify/`（`<歌曲 id>-<码率>.bin`，先写 `.part`，字节数对上才改名），**密钥不写盘**，每次运行向 Spotify 重新要，所以盘上的文件离开登录着的会员账号打不开，也不能离线播放。解密后的音频不写盘，也不进渲染端的歌曲缓存。这些文件算进歌曲缓存的容量上限（和原始音频、转码一起按最久没用的先删）、大小统计和“清除缓存”；缓存目录可能是用户自己选的文件夹，所以列出、统计、删除都只认自己命名的文件，“清除缓存”不动 `spotify/` 里别的东西。只存能核对密钥的文件（Ogg；用这次拿到的密钥解开头，对不上就删掉重新走 CDN）。读：音频地址的每个请求先看盘上有没有整份（长度要和这个地址对应的文件一致），有就读盘，没有照旧读 CDN；盘上有时定位歌曲也不再向 CDN 要开头字节。写：provider 的 `playback.keepAudio(url)` / `hasKeptAudio(url)`（`providerRegistry.ts` 的 `keepsOwnSongAudio`、`keepProviderSongAudio`、`hasProviderKeptSongAudio`）。两处会要求存：automix 提前分析（`profileService.ts`，先存再读，所以分析读的就是盘上那份）和整首播完（`playedTrackCache.ts`）；存好后按歌曲缓存写入同样的方式通知（`notifyAudioCached`），并带上读这份文件用的地址，等着的人声分离被唤醒：“下一首”的分离请求常常在这首歌还没有地址时就排上了，没有这个地址它醒来也无从读。分析那边每次经过这首歌都会问一遍（`profileService.ts` 的 `keepWithProvider`），包括以前测量过、这次不再读的歌：这样的歌文件可能不在盘上（功能上线前测的，或被容量上限删了），歌曲缓存开着就补存。“盘上有没有”只看硬盘，不问 Spotify。**人声分离现在有**：`stems.ts` 仍然不下载，但盘上已有的文件它通过这首歌的地址读（读的是盘，不是网络）。注意分离本身对所有歌都会把要分离的那 30 秒解码后的采样临时写到系统临时目录（`electron/analysis/sidecar.cjs` 的 `folia-htd-*`），跑完就删；Spotify 的歌进了分离也一样，这一小段是解密后的。流量：一首歌第一次播放时，如果它之前没被当作“下一首”提前分析过，播放那一路仍从 CDN 读，另有一次整份下载写盘；之后的播放、拖进度、分析、分离都读盘。
  等待都有时限（30 秒）：建立连接、问文件位置、文件的头几个字节、CDN 的应答、读流中途没有数据。CDN 答的 `Content-Range` 起点和要的不一样时按网络错误处理（别处的字节用这里的计数器解出来是噪音）。
  原生模块只有部分系统的现成构建（0.5.1：win32-x64、darwin-arm64、linux-x64/arm64 glibc；**没有 darwin-x64**）。没有构建的系统上模块加载失败，`getAudioSource` 报 `unavailable`，其余功能不受影响；所以它是 `optionalDependencies`（安装脚本在没有现成构建时会尝试用 Rust 从源码编译，失败不应让整个安装失败）。打包时 `build/afterPack.cjs` 只留目标系统的那一份。原生模块自己直连 Spotify（接入点的 TCP 连接和几个 HTTPS 请求），不走应用的系统代理设置；CDN 的请求走。
  喜欢与收藏（2026-10-08 接上，`client/spotifyMutations.ts`；三种改动都在真实账号上各做一次、读回、再撤回）：渲染端只说“哪个 uri、留还是不留”（桥接操作 `library`，只收 `spotify:track|album|playlist:<22 位 id>`），改动的名字和哈希留在主进程（`CHANGES`），渲染端不能通过 `query` 发改动。歌和专辑用 `addToLibrary` / `removeFromLibrary`（变量是 `libraryItemUris`；这对改动拒收歌单），歌单用 `addItemsToRootlist` / `removeItemsFromRootlist`（变量是 `uris`）。Spotify 拒绝一个改动时答的是状态 200 加 `errors`，所以带 `errors` 的答复、或者没有带回改动结果的答复，一律算没改成。能收藏的是专辑和别人的歌单；账号自己的歌单和“已点赞的歌曲”不能（`canSubscribe`）。**把账号自己的歌单移出音乐库等于删掉它**，而卡片不一定知道歌单是谁的（首页和“为你打造”的卡片不带这个信息，音乐库里的卡片带），所以主进程在改歌单之前先向 Spotify 读一次这个歌单（`fetchPlaylist`）：歌单的主人是当前账号、账号能管理它、或者 Spotify 没说主人是谁，都拒绝（`unsupported`）。
  读状态：红心来自 `getLikedSongIds`（`fetchLibraryTracks`，一次要 500 行，按实际给的行数往下读，读到 Spotify 说的总数为止，最多读 20000 行，不管要几次请求，最后一次只要剩下的行数（一次请求一行都没给也停）；读到的名单和刷新期间在应用里点过的红心由 omni 的那条规则对账（上面“修改”一行）；要 1000 行的请求被接受过，但试的账号只有 27 首，Spotify 一次最多给多少没有量出来；没读到 Spotify 说的总数时记一行日志、结果标成没读全（`whole: false`），这次读取只加红心，超出的部分红心保持原样；答复里没有名单时抛错，不当成空名单），由 `account/accountRead.ts` 在读账号时读一次并存进账号快照，读失败时红心保持原样。没读全时，正在放的歌和播放队列里的歌的红心另外问（`library.areSongsLiked`，由 `account/likedChecks.ts` 发起）：`areEntitiesInLibrary` 带歌的 uri，一次请求最多 50 首，答复按行序对应（`lookup[i].data.saved`；行数和 uri 数不一样时一首都不认），日志一行 `[Spotify] areEntitiesInLibrary for <n> tracks: …`；它对歌给不给数据、一次最多收几个 uri，都没有用真实账号试过。专辑是否已收藏问 `areEntitiesInLibrary`（`lookup[0].data.saved`；它对歌单不给数据），歌单是否已关注读 `fetchPlaylist` 的 `playlistV2.following`。
  歌单里歌曲的增删和新建歌单（2026-10-08 接上；在为试验建的歌单上做过并撤回，试验歌单随后移出音乐库）：`updatePlaylistTracks` 走桥接操作 `playlist_edit {id, action: add|remove, tracks}`（一次最多 100 首），`createPlaylist` 走 `playlist_create {name}`（名字最长 100 字）。主进程每次改之前先把歌单整份读一遍（`fetchPlaylist`，一次要 500 行，按实际给的行数往下读，最多 40 次请求），一是确认 Spotify 说这个账号能改它的歌（`currentUserCapabilities.canEditItems`，否则 `unsupported`），二是因为两种改动都要用到歌单里现有的行：Spotify 的 `addToPlaylist` 会把已经在里面的歌再加一次（实测加两次得两行），所以只加歌单里没有的；`removeFromPlaylist` 按行的 `uid` 删，不按歌的 uri，所以把这首歌的每一行都删掉。只有整份读到才改：Spotify 说答复不完整（数据旁边带 `errors`）、答复里没有行、或者歌单比读取上限还长，都拒绝改动，否则会把已有的歌再加一次，或者把没删掉的歌报成已删。没有自己 `uid` 的行也算“歌单里有这首歌”。两次改动同时发给同一个歌单时不排队，各读各的（选择框自己挡住了连点）。新建分两步：`POST spclient /playlist/v2/playlist`（答 `uri`），再用 `addItemsToRootlist` 放进音乐库；第二步失败时歌单存在但不在任何人的音乐库里。新建的歌单是否公开没有量。能加歌的是带 `isOwned` 的歌单，“已点赞的歌曲”除外（`canAddToPlaylist`）。播放面板的“加入歌单”在 provider 有 `createPlaylist` 时带“新建歌单”（`omni.canCreatePlaylistForSong` / `createPlaylistWithSong`，`src/components/app/AddToPlaylistHost.tsx`），目前只有 Spotify 有。加进去的是面板上显示的那首歌，由 `AddToPlaylistHost` 交给回调（过渡期间播放状态里的当前歌已经是下一首）。新建成功但加歌失败时刷新一次歌单列表，让新歌单出现在选择框里，再试时不会建出第二个。歌已经在歌单里时没有东西发给 Spotify，界面照样提示“歌单已更新”。应用里没有删除歌单的操作。
  探索页卡片的第二行，只在 Spotify 的页面上由适配器自己写（`client/spotifyExplore.ts` 的 `itemOf` / `songItem`，放进条目的 `subtitle`；界面 `exploreFace.ts` 的 `faceOf` 有 `subtitle` 就用它，没有就按各平台共用的老规则：有名字写名字，没有才写类型）：先写这是什么，再写是谁的，例如“歌曲 · 歌手名”“专辑 · 歌手名”“歌单”。原因是老规则在这里分不出东西：首页和“为你打造”的 115 张歌单卡片主人全是 Spotify，每张都只写“Spotify”；主人是 Spotify 时不写名字，是别人时照写。专辑卡片按 `albumType` 写发行形式：Spotify 把一两首歌的发行也当作专辑（`SINGLE`），卡片上写“单曲专辑”，另有 EP 和合辑；首页卡片和新发行带 `albumType`（实测），不带的按普通专辑写。歌手卡片不设 `subtitle`（老规则本来就写“歌手”）。应用自己的两栏（最近播放、再听一次）各平台共用，没有动。
  日志都以 `[Spotify]` 开头：主进程记登录状态的变化、失败的请求（错误码加 Spotify 的状态码或原话，地址和长串抹掉）、套餐变化；渲染进程记探索页每次读到的栏数和条目数、自带歌词有没有、失败的请求及耗时。

## 目录

| 位置 | 是什么 |
| --- | --- |
| `mod.json` | 清单：`folium: 2`，原生件 `librespot`，音源 `spotify`，四种语言的名字 |
| `package.json` | `ws` 钉死版本打进 main 入口（`bundle`）；node-librespot 钉死版本，`native` |
| `client/index.ts` | client 入口：接上请求通道和播放方式，在第一个 `await` 前 `folium.sources.register` |
| `client/spotifyProvider.ts` | 音源定义：`search@1`、`songs@1`、`playback.audio@1`、`playback.external@1`、`lyrics@1`、`auth@1`、`library@1`、`catalog@1`、`recommendations@1`、`explore@1`、`mutations@1` |
| `client/spotifyTransport.ts` | 经 `folium.rpc` 调 main 入口；错误用 `folium.sources.error` 做，main 入口说的原因挂在 `cause` 上 |
| `client/spotifyNormalize.ts` | main 入口交来的查询答复 → 公开契约的 DTO |
| `client/spotifyCatalog.ts`、`spotifyLibrary.ts`、`spotifyMutations.ts` | 目录与曲库、红心、收藏与歌单增删 |
| `client/spotifyExplore.ts`、`spotifyRadio.ts`、`spotifyRecommendations.ts` | 探索页、歌曲电台、电台页 |
| `client/spotifySoloistPlayback.ts`、`spotifySetup.ts` | 播放方式与 Soloist（外部播放器）、登录窗口里的 Soloist 配置清单 |
| `client/spotifyFailure.ts`、`spotifyLoginFailure.ts` | main 入口的错误与原因的意思 |
| `main/index.ts` | main 入口：分区、音频路由、缓存、Soloist 的目录、登录存储接到 `api.*` |
| `main/*.cjs` | 原 `electron/spotify/` 的文件 |
| `locales/` | 短名、登录窗口、Soloist、探索页的字，`pageLanguage`、`dateLocale`；`zh-TW.json` 由构建生成 |
