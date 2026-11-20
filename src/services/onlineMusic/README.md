# Omni 在线音乐层

`src/services/onlineMusic/omni.ts` 是普通在线歌曲数据的唯一公开入口。组件、hook、store 和普通 app service 不得直接调用具体 provider、registry、transport 或 raw API；只有明确的跨 provider 编排，或 provider adapter/transport 自身，才可以使用 provider-explicit 层。

## Layer map

```text
UI / hooks / stores / app services
  -> omni.ts
       -> providerRegistry.ts
            -> 内置音源模组（sources/<id>/，经 folium.sources 注册；网页版由 web/<id>.ts 注册 core）
       -> account/（各平台账号共用的逻辑，只从 omni 进入）
       -> login/（登录失败的分类和请求时限，不认识任何平台）
       -> providerAccountCache.ts / providerStorage.ts
  -> src/types/onlineMusic.ts（共享合同）
```

各平台的 `<id>Provider.ts` 和 `<id>Transport.ts` 都在各自音源模组的 `sources/<id>/core/` 里（例如 `sources/netease/core/neteaseProvider.ts`）。网易云没有单独的 transport，请求在 `sources/netease/core/netease.ts`。

九个内置平台都已迁成音源模组，宿主 registry 不再静态注册任何一家（`BUILT_IN_SOURCE_ORDER` 只留它们的顺序）。波点接入状态、接口与剩余验收见
[`docs/bodian.md`](../../../docs/bodian.md)；支持喜欢与自建歌单歌曲增删，收藏写入尚未实现。Navidrome 是独立的 Subsonic 服务，入口是 `src/services/navidromeService.ts`，不属于 Omni provider。

登录的分工：provider 把后端的回答翻成 `LoginState`。失败带着平台的原话（`message`）和事实（`failure`：码、原话、HTTP 状态、要等多久，或者直接点名的情况，比如 QQ 的登录设备超限 `device-limit`）；这一次检查在网络这一层没拿到回答、码在平台那边还有效时标 `transient`，登录接着检查。要码与生成二维码拿不到 key / 图片时直接抛错，不交出空值。情况怎么分在 `login/loginFailureCase.ts`，平台自己的码是什么意思由它的 `describeLoginFailure` 说。登录失败后由登录调用一次 `omni.runLoginSelfCheck` 主动自检（平台的 `auth@1.runLoginSelfCheck`，例如 `sources/netease/core/neteaseSelfCheck.ts`），结果进诊断报告；`omni.getLoginDiagnostics` 的 provider 段每一行都由 `login/loginDiagnosticReport.ts` 的 `diagnosticLine` 写，放进去的文字先洗过：登录凭据、IP 和账号不进报告。

网易扫码轮询（`/login/qr/check`）在桌面端由本地服务换掉的 `login_qr_check` 处理（`sources/netease/main/neteaseApiStartup.cjs` 的 `createLoginQrCheck`）：上游原版请求被拒时只回 `404 Not Found`，换掉以后页面拿到网易云真正回的 `{ code, msg }`。扫码的要码与轮询遇到网络层失败时重发一次（同一文件的 `withQrNetworkRetry`）。识别网络层失败用 `shared/networkErrorText`（`.mjs` 给渲染进程，`.cjs` 给主进程，内容一致）。

要地址、读集合没有成功时，失败分成有名字的情况（`failure/onlineFailureCase.ts`，不认识任何平台；平台自己的码是什么意思由它的 `describeFailure` 说），提示条按情况说发生了什么、该做什么，再引平台的原话（`failure/onlineFailureTexts.ts`）。要地址连不上时先自己再要两次（到了时限的请求只再要一次），并提示正在重试；平台要求稍后再试而说了等多久时，到点之前这个平台的地址点歌和预取都不再去要；没说多久、或平台的服务出了错（5xx）时只让预取先停 30 秒（`failure/onlineRequestCooldown.ts`）。播放时失败只按情况说，从不回写歌曲的可用性、预取或缓存。

每个平台靠哪个库或哪个服务拿数据、版本钉在哪、上游变了怎么跟，见同目录 [`UPSTREAMS.md`](UPSTREAMS.md)。

## 接入一个新平台

Folium 2 起一个平台就是一个**音源模组**：仓库里的放在 `sources/<id>/`，经 `folium.sources.register` 注册进宿主的注册表，宿主自己的代码里没有任何一家的静态注册、主进程块或 preload 通道。以前「`src/services/onlineMusic/<id>/` 加 `electron/<id>/`、在 `providerRegistry.ts` 里 import 并登记、在 `main.cjs` / `preload.cjs` / `vite-env.d.ts` 加通道」的做法全部作废。

先读这三份：[`docs/folium/sources.md`](../../../docs/folium/sources.md)（音源模组怎么写、能力、`playback.surface`、main 入口的 `api`）、[`sources/README.md`](../../../sources/README.md)（仓库里的音源要守的规矩）、[`dev/sources/README.md`](../../../dev/sources/README.md)（构建、依赖的做法、打包）。签名以生成的 [`docs/folium/api.md`](../../../docs/folium/api.md) 为准。现成的例子：只在桌面、依赖打进 bundle 的 `sources/bodian/`（最短）、带 core 和网页版的 `sources/kugou/`、带依赖归档和 worker 的 `sources/netease/`。

下面用 `foo` 代表新平台的短 id。`OnlineProviderId` 是开放的字符串，不用改类型。

### 必须做的

1. **目录**：`sources/foo/`，目录名就是短 id。里面是 `mod.json`（`folium: 2`、`sources[{ id: 'foo', name: 四种语言, requires }]`、`client`、`main`、`locales`）、`package.json`（上游库钉死版本，`folia.dependencies` 写做法）、`README.md`（这一家靠哪个上游、版本钉在哪、我们改了什么、上游变了怎么跟，见 `UPSTREAMS.md` 的规矩）、`locales/` 的 zh-CN、en、in、vi 四份（zh-TW 由构建生成）。源码只能 import 自己目录里的文件、`@folia/folium`（类型）、`@folia/folium-source-kit` 和声明了的包，不 import `src/`、`electron/`（Dedicatus D130）。
2. **受信表**：`electron/modSystem/builtinSources.cjs` 加一行：模组 id → 短 id，以及它要认领的旧 electron-store 键、session 分区、userData 目录、原生件（新平台一般都是空的）。内置清单校验要求模组 id 在这张表里、目录名是那一行的短 id（`dev/sources/manifestCheck.mjs`）。
3. **client**（`client/index.ts`）：`activate(folium)` 里先接上请求通道（`folium.rpc`），在第一个 `await` 之前 `folium.sources.register(...)`。音源定义按能力族写成员（`search@1`、`songs@1`、`playback.audio@1`、`lyrics@1`、`auth@1`……），宿主的开关由实现了哪些能力推导；平台的错误换成 `folium.sources.error(code, …)`；界面文字全走模组自己的语言表（`folium.i18n.key`），宿主语言包里不加这一家的 key；记号是一个字加一个颜色，不用平台的商标图。
4. **main**（`main/index.ts`，要在主进程里请求时才有）：`activate(api)` 只做接线。请求用 `api.net`（Electron `net`，可用自己的分区），凭据用 `api.seal` 加密后放 `api.legacy.store` 认领的键或清单 `secrets` 的槽，不交给窗口；音频要特殊请求头、跨域或会重定向的用 `api.media.allow`，要自己出流的用 `api.media.serve`；收尾用 `api.onBeforeUnload` / `onBeforeQuit`。窗口经 `folium.rpc` 调它（`api.rpc.handle`），宿主只放主窗口的调用进来。
5. **顺序**：九家内置音源在切换器、登录窗口、搜索命令里的位置由 `providerRegistry.ts` 的 `BUILT_IN_SOURCE_ORDER` 定，没列进去的排在它们后面、按注册先后。新的内置平台要固定位置就加进去；是歌词来源的，歌词来源表 `src/utils/lyrics/lyricSources.ts` 的 `BUILT_IN_ORDER` 同理。
6. **架构检查要认得新平台**：`test/unit/onlineMusic/platformNameCount.ts` 的 `PLATFORM_NAMES` 加上平台的名字（id 和中文名）；平台目录之外提到它的文件在 `platformNamePlaces.ts` 里登记行数和原因（`node test/unit/onlineMusic/platformNameCount.ts --files` 列出这些文件和数字）。界面、hook、store 不能 import `sources/` 的规则（`omniArchitecture.test.ts`、Dedicatus D131）已经挡住所有平台，不用再加名字。新的存储键登记进 `dev/dedicatus/storageKeys.mjs`（D507），写登录凭据的函数登记进 `dev/dedicatus/credentialWriters.mjs`（D604）。
7. **测试**放 `test/unit/foo/`：归一化、翻页、错误答复这些用的人看不出来的逻辑，用量到的最小答复做数据；main 入口用假的 `api` 驱动（升级来的会话照读、只碰认领的键、请求走哪条 net、媒体规则）。要经宿主注册表测的文件第一行写 `// @builtin-sources`，`test/unit/helpers/builtinSources.ts` 会在 `beforeAll` 里注册仓库里的音源（测试文件顶层还拿不到）。
8. **构建与实测**：`npm run sources:build` 出 `dist-mods/foo/`（`npm run dev:electron` 会 watch 着构建），开发版以内置层级加载它；桌面实测按 `run-desktop` skill 走。拿不到真账号时可以照 `test/manual/fakeSourceNetwork/` 给它写一张假网络路由表，验证的是管道，不是真实接口。

### 网页版

网页版没有模组运行时。要在网页版也能用的平台，把区分桌面与网页的那部分抽成 `sources/foo/core/`：`createSource(env)`，桌面的 client 注入 `folium.rpc` 和 `folium.sources.pageStore`，网页由 `src/services/onlineMusic/web/foo.ts` 注入 `VITE_FOO_API_BASE` 的 HTTP 传输和 `providerStorage`（照 `web/kugou.ts`）。宿主只有 `src/services/onlineMusic/web/*` 可以 import `sources/*/core`（D131）。安装包和网页版带哪几家由构建参数决定，见 `dev/sources/README.md`。

### 按需要做的

- 探索页：见同目录 `EXPLORE_ADAPTER.md`（`explore@1`）。
- 电台页签和音质档位：见 `EXPLORE_ADAPTER.md` 最后一节。
- 推荐偏好（账号上那份会影响推荐的设置）：见下面「推荐偏好」。
- 应用开着时要盯着的东西（比如本地服务起不来）：`handle.notify(...)`，由 `src/components/app/useProviderNotices.ts` 统一显示。
- 登录要靠的本地服务：`auth@1.localService`，登录窗口会显示它的错误和重启按钮；登录诊断与自检用 main 入口的 `api.diagnostics`。
- 跨源歌词匹配的来源：`lyrics@1.crossSource`（只知道 id 时直接取歌词再加 `songIdOf`）。哪个来源此刻参加匹配由 `crossSource.ts` 统一判断（没注册、没配好、要账号没登录的都跳过）。
- 跨源歌词匹配搜不到时换个名字再搜：`lyrics@1.getSearchAlias` 回原名和歌手，`getAlternateArtistName` 回歌手在别处的写法。歌名去掉的部分是伴奏一类标记时不换名字搜；歌名的译名和说明常是「某剧主题曲」一类文字，不当别名。
- 本地歌匹配在线信息：`songs@1.metadataMatch`（要有 `search@1`）。匿名就能配歌词或信息的音源，用户可以把它设成「只用于匹配」；内置的在清单里标 `keepForMatching`，全新安装没勾它时落到这个状态。
- 命令面板：「搜某平台的歌」（`search-<id>`）和「启用 / 只用于匹配 / 停用某平台」（`source-*-<id>`）按注册表和主进程的音源状态自动生成，不用改。
- 封面按尺寸取图：`covers@1`。认不出的封面按原图用。
- 新的缓存键：用 `providerStorage.ts` 的 `online_provider_<id>_...` 前缀就不用改（「清除数据」按这个前缀清）；新的前缀要登记到 `src/services/repositories/cacheRepository.ts` 的 `getCacheTableName` 和 `matchesCategory`。

### 不用改的

- 登录界面 `src/components/login/`：平台的记号、标题、说明、失败说明都由音源声明，界面经 omni 去问。
- 登录失败的分类和请求时限（`login/`）。
- 账号状态：`src/stores/useOnlineProviderAccountStore.ts`、`providerAccountCache.ts`、`account/accountRead.ts`。
- 平台切换：`omni.ts` 的 `getProviderSummaries` 按注册表列出，只列音源状态（`sourceStates.ts`）是启用的；只用于匹配的音源只在 `getMatchingProviderSummaries` 里（按没登录给出），见下表“provider 状态”一行。
- 设置页（「设置 → 音源」按主进程的音源状态列出每个音源）。
- 探索页的界面和页面数据（`src/components/app/home/explore/`、`src/stores/useExploreFeedStore.ts`）。
- `electron/main.cjs`、`electron/preload.cjs`、`src/vite-env.d.ts`：音源只经模组系统的 `folium.rpc` 和 `api.*`，不加平台专属的主进程块和通道。

### 第三方的音源模组

不进 Folia 仓库、由第三方发布的音源模组用的是同一套接口，见 [`docs/folium/sources.md`](../../../docs/folium/sources.md)；它没有受信表的那一行（不能认领内置平台的旧数据），装在用户的模组目录里，启用要经用户确认。Folium 1 的实验接口 `omni.providers` 还能用，能力少得多，迁过来的步骤在同一份文档里。

## Public contract

调用前先看 `omni.ts` 的方法和 `src/types/onlineMusic.ts` 的类型。常用入口按能力分组：

| 能力 | Omni 方法/区域 | 结果/边界 |
| --- | --- | --- |
| provider 状态 | `getProviderSummaries`、`getMatchingProviderSummaries`、`isProviderShown`、`getActiveProviderSummary`、`getProviderCapabilities` | `useOnlineProviderAccountStore` 提供 active provider 与账号快照。两种列表（Folium 2.0 方案 §5.3）：`getProviderSummaries` 给界面和模组，只含启用的音源；`getMatchingProviderSummaries` 给歌词与元数据匹配，另含只用于匹配的音源，它们按没登录给出（不读、不显示账号）。只用于匹配的音源不能成为生效音源（存着的选择不改写）、不读账号（`readAccount` 回 `not asked`）、它的歌不放（`canPlaySong` 为 false，`getAudioSource` 抛 `unavailable`）。`subscribeProviders` / `getProviderRegistryVersion` 同时跟注册表和音源状态表，状态一切换就通知 |
| 账号/二维码 | `readAccount`、`signOutAccount`、`startLogin`、`checkLogin`、`confirmsLoginInBrowser`、`openLoginPage` | provider auth adapter；不要在 UI 直接保留 raw session。登录有两种样子，轮询、取消、过期是同一套：扫二维码（provider 有 `createQr`）、只在浏览器里确认（provider 有 `openLoginPage`、没有 `createQr`，`startLogin` 回的图片是空串；登录一开始界面就打开那个页面，弹窗里只留一个“重新打开浏览器”的按钮；provider 自己已经打开页面的（`opensLoginPageItself`），界面不再打开，也没有这个按钮）。Spotify 和 YouTube Music 是后一种。平台自己的记号（`mark`）、登录标题和说明、只在它身上才说得通的失败说明（`getLoginTexts`）、可以在登录窗口里重启的本地服务（`localService`）都由 adapter 声明，界面经 `getProviderMark`、`getLoginTexts`、`getLoginLocalService` 来问；`src/components/login/` 里不出现任何平台的名字。登录为什么没成功：某一步抛了错时 facade 问 provider 的 `describeLoginFailure`，`checkLogin` 回 error 状态时 provider 自己带上 `failure`；provider 把自己的错误说成共用的事实或者点名是哪一种情况，`login/loginFailureCase.ts` 再分成有名字的情况（它不认识任何平台），登录会话（`library/core/account/providerLoginSession.service.ts`）把它放进账户快照的 `login.failure`，交给登录窗口。登录等着的请求里自己没有时限的（网易云、QQ、酷狗的取 key、取二维码、检查这三个），由各自的 transport 套上 `login/loginRequestLimit.ts` 的 20 秒时限，到点算作「没有回应」；要一首歌的地址、读集合歌曲的请求（网易云的 song/url/v1、playlist/track/all、album，QQ 的 music_play、song_list_detail、user_playlist_detail、user_liked_songs、album_info；QQ 要地址时一档超时就不再试下一档），套上 `failure/onlineRequestLimit.ts` 的时限，到点算作「连不上」；时限比那个平台的后端最慢的正常回答还长，由各自的 transport 定（网易云 60 秒，QQ 70 秒，原因写在那里）；别的请求不加 |
| 搜索 | `searchSongs`、`searchProviderSongs` | 普通搜索按 active provider；显式 provider 或跨 provider 用第二个方法。可选的 `context` 参数（`ProviderSearchContext`；`searchSongs` 的第三个、`searchProviderSongs` 的第四个参数）里的 `session` 把翻页互不干扰的调用方分开，不给就是宿主自己的界面：在两页之间留着读到哪儿的 adapter 按会话分开存，别的 adapter 不看它 |
| 用户库 | `getUserPlaylists`、`getUserAlbums`、`getLikedSongIds`、`getProviderLikedSongIds`、`accountMoment`、`getCloudCollection` | 统一 `OmniCollection` / page 类型，账号快照可先展示再静默刷新。喜欢的歌读回来是 `{ ids, whole }`：adapter 在自己的上限处停下、或者说不准读没读到底时 `whole` 是 `false`；读不出来的一页必须抛错，不能当成更短的或空的列表交回。读账号的地方不自己写 `likedSongIds`：`account/accountRead.ts` 把读到的结果交给 `applyLikedRead`，由“修改”一行说的那条规则决定账号里留下什么；读失败就不交，账号里的保持原样；快照随后按 store 里此刻的 `likedSongIds` 存。回到 Folia 的窗口、进入主页这两个时机（`accountMoment`）不直接读整份：先向当前平台要“喜欢的歌”的数目（adapter 的 `getLikedSongCount`，一次请求，没有便宜办法的 adapter 不实现它），和手上的数目不一样才把喜欢的 id 整份读一遍；什么时候读只在 `account/readMoments.ts` 一处决定（见下面 `account/` 一条） |
| 推荐 | `getHomeFeed`、`getPersonalFm`、`supportsDailySongs`、`getDailySongs`、`getRecommendationHistory*`、`dislikeSong` | 首页推荐与历史推荐仍由 Omni 路由；日推入口按能力显示，空结果不隐藏入口；私人 FM 一首歌都没交回时不出这张卡片（点了也没有可播的歌） |
| 推荐偏好 | `supportsRecommendationPreferences`、`getRecommendationPreferenceEntries`、`getRecommendationPreferences`、`saveRecommendationPreferences` | 声明 `recommendationPreferences`、两个成员都有才算支持；偏好项只有选项式和比例两种，整理规则在 `recommendationPreferences.ts`。见下面「推荐偏好」 |
| 播放/歌词 | `getSongDetail`、`getSongDetails`、`canPlaySong`、`getAudioSource`、`getAudioQualityLevels`、`resolveAudioQuality`、`getLyrics`、`getChorusRanges`、`getLyricSearchAlias`、`getAlternateArtistName` | 输出 `OmniAudioSource` / `OmniLyricsResult`；Navidrome 歌词走独立 service。`getSongDetail` / `getSongDetails` 收这首歌的 `UnifiedSong.id`，也收它的 `sourceRef.mediaId`，两者不同的平台在自己的目录里两种都接受。`getSongDetails(providerId, ids, { run? })` 按 id 查多首，每个 id 按入参顺序回一项 `OmniSongDetail`：`found`、`missing`（provider 答了、没有这首）、`failed`（为它发的那次请求失败，带 provider 的错；逐首问时一首失败不影响后面的）、`skipped`（调用方的 `run` 拒绝了这次或之前的请求、或不再等它，带 `run` 的拒绝；后面的都不再问）。adapter 有 `playback.getSongDetails` 就成批问：一批最多 `playback.songDetailsPerRequest` 个（不写就是全部一批），一批接一批，每批经 `run` 一次、一批失败不影响别的批（它拒绝的回答要抛错，不能回一串 null），没有就逐首问 `getSongDetail`，不并发；`run`（可选，`OmniRequestRunner`）包住 omni 对 adapter 的每一次调用（一次批量、或一首），由调用方计数和限流（`folium.omni` 的闸门）；`capabilities.songDetail` 为 false 的 provider 不能按 id 查歌（不写按能查）。`getLyrics` 的 `extensionHooks: false` 交出 provider 的歌词（副歌已标），不经扩展层改写。音质档位：档位从低到高是 `standard`、`high`、`ultra`、`lossless`、`hires`。`OnlinePlaybackProvider.audioQualityLevels`（可选）列出这个 provider 真正分得开的档位，不写就是 `standard`、`high`、`lossless`、`hires` 四档；`ultra` 只属于把它列出来的 provider（现在只有 YouTube Music，而且只对会员列出），列表可以随账号变，所以每次用到时现读。控制面板的音质选项只显示当前 provider 列出的档位（`getAudioQualityLevels`）。存的偏好仍是一个与 provider 无关的值，不迁移；它不在某个 provider 的列表里时，亮起的按钮和实际去要的档位都是不高于它的最近一档（`resolveAudioQuality`；`getAudioSource` 按歌曲所属的 provider 统一换算后再交给 adapter），所以存着 `ultra` 时，没列它的 provider 都按 `high` 去要。`getAudioSource` 交出地址时记下这个地址是按哪一档去要的、provider 有没有把它标成试听片段（`ProviderAudioSource.preview`；内存里，最近 200 个），`levelOfAudioSource(url)` 和 `isPreviewAudioSource(url)` 按地址查；扩展换进来的地址档位不明，也不算试听。片段还可能从歌中间开始：provider 在 `ProviderAudioSource.clipStartMs` 里写起点（毫秒，只在 `preview` 时有意义，不写就是从歌头开始），omni 按同一个地址记下（`previewClipStartMsOfAudioSource`），播放的歌词时钟加上这个偏移（`usePlaybackVisualizerBridge.ts`），远程窗口和 OBS 复用同一份地址记录；记录更新或淘汰时，主窗口按 `audioSourceMetadataVersion` 失效本地缓存。进度和时长仍是片段自己的，手动歌词偏移不被改写。有一个例外（2026-10-09）：列出了档位的 provider 在交回的 `quality` 里写的是它列出的另一档时，记的是它写的那一档（YouTube Music 的歌在 `ultra` 取不到、按 `high` 给的时候）；不这样的话，那份文件会顶着去要的那一档的名字存进媒体缓存，以后一直当那一档播。没列档位的 provider 不变，仍记去要的那一档。媒体缓存存一首歌时用它记下档位，播放只用和选项同一档的那一份，见下面 `resourceCache.ts` 一条 |
| 听歌上报 | `canReportPlayback`、`reportPlayback` | 只有声明 `playbackReports` 的 provider 支持（当前仅网易云）；时长必须是真实累计播放秒数，频控在 `playbackReportGate.ts` |
| 可用性 | `getSongAvailability`、`getSongReplacement` | 静态可用性只由 provider 的显式信号给出，`state: 'unavailable'` 只表示下架（taken-down），权限 / 付费 / 地区限制是 `unknown` + `reason: 'restricted'`；一次播放失败按 `failure/onlineFailureCase.ts` 分成有名字的情况，永不回写可用性、预取或缓存 |
| 集合详情 | `getCollectionTracks`、`getCollectionDetail`、`getAlbumDetail`、`getArtistDetail`、`getArtistSongs`、`getArtistAlbums` | 按 collection 的 `providerId` 路由 |
| 探索 | `supportsExplore`、`getExploreFeed`、`getExploreSectionItems` | 给新平台接探索页，先读 `EXPLORE_ADAPTER.md`（一页）。provider 自己的推荐页：若干栏，每栏一个标题加歌曲或集合卡片（`OmniExploreSection`）。栏目是什么由 provider 决定，翻页游标对调用方不透明。账号自己的收听记录（“最近播放”“再听一次”这类栏）不属于这一页：探索页这两栏由应用自己的播放记录给出，各平台一样，provider 的页面里有这类栏时由它的适配层去掉。首页“探索”分页只看 active provider 的 `capabilities.explore`（`src/library/core/home/homeSources.ts` 的 `canUseExplore`），所以 `explore` 成员和这个开关要一起加；`supportsExplore` 两样都看，但界面没有用它，只有测试在用。页面数据在 `src/stores/useExploreFeedStore.ts`，界面在 `src/components/app/home/explore/`（第一栏放大第一条、其余列在旁边；其后每栏一排横向滚动的图，只有一条的栏显示成一条横幅）。条目带 `wideCoverUrl` 时表示它的图是宽图（视频截图），界面放进 16:9 的框里显示；不带时用条目自己的封面，按方图显示；歌手一律用自己的封面，显示成圆图。从头读这一页时，探索页把听者在应用里听过的歌（`listened`，常听的在前）交给 provider，provider 可以拿它们自己做栏目。用 `listened` 的有 YouTube Music、Spotify 和网易云（Spotify 的探索页见下文 `sources/spotify/client/spotifyProvider.ts` 一条，网易云的见 `sources/netease/core/neteaseExplore.ts` 一条）。YouTube Music 的推荐页是固定的三百来条，所以在 YouTube 自己的栏目之间和之后加“与某首歌相似”的栏（那首歌的电台，50 首），种子依次是 `listened`、YouTube 自己记的收听记录栏里的歌、页面上其他的歌；一栏只在读到它那一页时向 YouTube 要一次，一次从头读最多 12 栏；这些栏带 `changesWithRead` 标记（每次从头读都换标题、换内容的栏）：“换一批”把页面从头重读时，其余的栏先按 id 认（provider 交回的栏和页面上的栏 id 相同就是同一栏，标题变了也是：Spotify 的栏 id 是它的 uri；往下读到的新一页里的栏也这样认，id 已经在页面上的不再加一次），认不上的再按标题认；新读到的这种栏按顺序顶替页面上已有的这种栏的位置，多出来的才接在最后，页面不因此变长（例外：重读中途有一页读失败、之后又接着往下读时，那一页的新栏会接在最后，旧栏留着）（`sources/ytm/client/ytmExplore.ts`、`useExploreFeedStore.ts` 的 `freshOf`） |
| 修改 | `pressSongLike`、`likeSong`、`toggleSongLike`、`beginLikedListRead` / `endLikedListRead`、`getSubscriptionStatus`、`subscribe`、`updateCollectionTracks` | mutation 按歌曲/集合所属 provider 执行并更新 account cache。点赞（2026-10-09，只跑过单元测试）：`pressSongLike` 先让心形变（account store 的 `wantedLikes`，`isSongLiked` 先读它），请求随后发出，同一首歌一次只发一个，请求失败心形回到账号里存的状态，20 秒没有答复也算失败（之后才到的答复什么都不写），规则在 `src/utils/likePresses.ts`；请求答复时账号已经登出或换了人的，也什么都不写（发出时账号还没有名字、答复时有了的，算同一个账号：应用刚启动时会这样）；`likeSong` / `toggleSongLike` 走同一条路、等到结果才返回，请求期间心形又被按过、平台最后停在另一个状态时报错。从平台读回来的喜欢的歌和听者在应用里按过的心形怎么对账，只有一条规则（2026-10-09，只跑过单元测试），在 `account/keptAfterRead.ts`，所有把读到的结果写进 `likedSongIds` 的地方都走它（`omni.ts` 的 `applyLikedRead`）：读整个账号时读的 id（`account/accountRead.ts`）、往“我喜欢”歌单加歌之后的重读、回到窗口或进入主页时数目变了的那次重读（`accountMoment`）、账号自己的“我喜欢”歌单（带 `isLiked`、在账号的歌单列表里）从第一页起读的歌（`beginLikedListRead` / `endLikedListRead`）。规则：请求还没落定的歌、读开始前 5 秒以内有请求被平台接受的歌，保持账号里存的状态（请求失败或 20 秒没有答复的不算：那时账号里存的并不比读到的新）（平台的列表多久跟上一次点赞没有量过，5 秒是估的）；账号离开（退出登录、登录失效、平台说没人登录）或者平台报出另一个人时，之前按过的红心全部忘掉（`likePresses.ts` 的 `forget`，由 `account/accountRead.ts` 调），不挡下一个账号的读取，当时还没答复的请求之后答复了也不记、不再接着发；其余的歌以读到的为准；没读全的（`whole` 为 `false`）只加不减；比它晚开始的一次读全了的读取已经先被采用、或者登录的人已经不是开始读时的那个，整份丢掉（晚开始的那次一直没读完、读失败或没读全，不挡别的读取）。读全了却一首都没有、而账号里存着点赞的：不采用（独立检查查出三个平台上读不出来的一页会变成空列表：YouTube Music 的第一页、QQ 经过它的后端、酷狗没有列表的一页；照单全收会把所有红心灭掉并存盘）。只有一个例外（2026-10-17，起因是 QQ 上实测到的：在 QQ 里取消最后一首喜欢，这里的红心一直不灭）：回到窗口或进入主页时，平台刚数出的喜欢数也是 0（`account/readMoments.ts`），两个答复对得上，就采用空列表。有数目的几个 adapter 在答复里没有列表时都会抛错，QQ 的后端在上游报出任何错误码时也会抛错，剩下的空列表就是平台自己说的空。YouTube Music 另有一条自己的（`sources/ytm/client/ytmLibrary.ts`）：满 100 行却没有下一页标记的一页不当作末尾（标记的位置 2026-10-07 变过一次），这次读取算没读全。每采用一次记一行 `[Like] <平台>: liked songs read (whole 或 not whole, <个数> ids) applied: <加> added, <减> removed, <个数> kept because pressed`，不采用时记原因。酷狗的歌单内行号不在 account store 里，由它的 adapter 自己记（`sources/kugou/core/kugouProvider.ts` 的 `kugouLikedRowIds`，按歌的 hash）：读喜欢的歌时记下每首的行号，这次读取开始之后发过喜欢或取消请求的歌不记，读回来的列表里没有的歌不留；发喜欢或取消的请求时取出来用一次就丢，没有记着的就先到列表里找；退出登录、换账号时全部清掉，不跨会话。网易云的歌单没有 `isLiked` 标记，打开“我喜欢”歌单不会触发读取，它的心形跟账号刷新走，也跟回到窗口、进入主页时数目变了的那次重读走 |
| 外链与引用 | `canResolveCatalogRef`、`resolveCatalogRefs`、`getSongCatalogRefs`、`getSongPageUrl` | 共享 `catalogRefs.ts` 的 provider-aware 引用；`getSongCatalogRefs(song)` 一次读出一首歌的专辑和各歌手能打开的引用（带歌曲上的名字），provider 的 resolver 只问一次 |

#### 额外电台（station）

平台除私人 FM 之外还有别的电台流（独立的取歌端）时，用 station 区分，不另建第二套模式机制：

- 电台卡片在 `getRecommendedCollections` 返回的集合上写 `personalFm: { mode, scene, station }`；`station` 是平台自己的电台 id。没有 `station` 的卡片（私人 FM、场景卡）行为不变。
- `getPersonalFmCatalog(station?)`：不传是私人 FM 的模式目录；传 `station` 是这个电台自己的目录，经 `omni.getPersonalFmStationCatalog(providerId, station)` 读取，平台没有该电台时是 `null`。电台的模式沿用 `PersonalFmCatalog` 的 modes／scenes／categories，不加新的模式 id；目录可以带 `name`（电台自己的名字），电台播着时模式选择器的标题和命令面板的标签都写成「某某模式」，没有就照旧是「私人 FM 模式」。命令面板里电台和私人 FM 各有一个命令（「电台模式」`playback-station-mode`、「私人 FM 模式」`playback-fm-mode`），共用同一个选择器，同一时间只出现一个：电台播着时是前者，否则是后者；FM 面板的按钮打开当下那一个，提示文字也跟着电台的名字走。
- `getPersonalFm(options)` 的 `PersonalFmRequestOptions.station` 带着当前电台；不带就是私人 FM。点电台卡片、在电台里切模式、电台的续歌补批会带；首页 feed、集合页读私人 FM 时不带。
- 正在播的电台和它的模式选择只放内存（`usePersonalFmModeStore` 的 `stations`），不写存储：换电台、FM 结束、重开都回到电台卡片带的默认。私人 FM 原有的本机记忆（`folia.personalFm.selection`、`folia.personalFm.providerSelections`）不变。
- 点电台卡片、拿到歌之后才算该电台开播；点私人 FM 卡片（或它的场景卡）拿到歌就让电台下线。FM 没开时电台状态不起作用。
- 换窗口时（重建主窗口、桌布模式重启）交接资料带着“队列来自哪个电台”（`WindowPlaybackHandoff.fmStations`），模式选择不带，新窗口从默认模式补批。普通关闭再打开不还原 FM，所以不涉及。
- Bravais 首页直达入口为电台卡片多一种 `fm-station`（图标 `RadioTower`），入口显示卡片自己的名字（`libraryBravaisHome.special.fm-station` 只在卡片没名字时用）；同一个来源里每种只列第一张，平台有多个电台时只有第一个有直达入口。


共享类型包括 `UnifiedSong`、`OmniCollection`、`OmniPage`、`OmniLyricsResult`、`OmniAudioSource`、`OmniUser`、`OmniError`、`OmniSongUnavailableReason`、`OmniProviderCapabilities`。调用方不能依赖 provider 的 raw field、numeric id 单独比较或 raw response envelope。

### 推荐偏好

平台的账号上有一份会影响推荐的偏好时，可以接上这一项；没声明的平台什么都不变，界面不出现任何入口。

- 声明 `capabilities.recommendationPreferences`，在 `recommendations` 上实现 `getRecommendationPreferences` 和 `saveRecommendationPreferences`，三样都有才算支持。
- `preferenceEntries` 声明入口放在哪几处：`explore`（Bravais 探索页信息条）、`personal-fm`（私人 FM 页签，放在模式按钮的位置）、`daily`（每日推荐的控制列，放在「默认推荐 / 风格推荐」的位置）。命令面板只要支持就有。
- 偏好项两种：`choice`（选项个数不限）和 `ratio`（`min`、`max`、`defaultValue`，可选 `snapWithin`：离默认这么近就算默认）。滑杆旁显示「减少推荐 / 默认 / 增加推荐」，拖动时拇指上方显示在滑杆上的位置（0–100%）。名字用 `{ labelKey, labelFallback }`：有译文用译文，没有就显示平台原文。
- `note` 是面板标题下那一行说明，写清楚这份偏好影响到哪里（各平台不一样）；不给就只写「保存在账号上」。
- 打开偏好面板时，命令面板的输入框只读。焦点在按钮等非输入控件上时，按 Backspace 回到命令列表；按 Esc 关闭面板。
- 保存只交有改动的项（`key → value`），平台自己决定怎么写：整份写回，或者只写改了的字段。「重置」直接提交与当前账号值不同的默认值，已经是默认值时直接关闭。存了但读回对不上时回 `confirmed: false`；没存成就抛错，面板留着。
- 分数怎么换算、选项对应哪个值，只写在平台自己的 adapter 里，共用层不写死任何平台的数字。
- omni 会把平台交来的偏好整理一遍（`recommendationPreferences.ts`）：不认识的种类、缺字段的项、重复的 key 丢掉；比例的值夹回范围里；选项式的值不在选项里时退回默认。以后加新的种类，已经接好的平台不受影响。

## Provider and cache files

- `providerRegistry.ts`：注册、查找、按歌曲 `sourceRef` 选择 provider、能力检查。它不静态 import 任何平台：音源模组经适配层注册进来（`src/mods/folium/registries/sources.ts`），网页版由 `web/` 注册；`BUILT_IN_SOURCE_ORDER` 只定九家内置音源在列表里的位置。
- 波点已迁成音源模组：`sources/bodian/`（client 里的 `bodianProvider.ts`、`bodianTransport.ts` 等，main 入口经 `api.net.request` 调固定版本的 `bodian-music-api`，会话经 `api.legacy.store` 与 `api.seal` 加密保存，凭据不交给窗口），平台细节见 `sources/bodian/README.md` 和 `docs/bodian.md`。
- 网易云音乐已迁成音源模组：`sources/netease/`（core 里的 `neteaseProvider.ts`、`netease.ts`、`neteaseExplore.ts` 等，main 入口工作线程里内嵌的 `@neteasecloudmusicapienhanced/api`），扫码登录、本地服务、探索页、`platform.raw` 这些平台细节见 `sources/netease/README.md`。迁移前账号快照之前的旧缓存（`neteaseOldAccountCache.ts`）不再读。
- 酷狗已迁成音源模组：`sources/kugou/`（core 里的 `kugouProvider.ts`、`kugouTransport.ts`），具体接口需结合 `docs/ku-go-api-docs.md` 和 `skills/kugou-provider-alignment`。
- QQ 音乐已迁成音源模组：`sources/qq/`（core 里的 `qqProvider.ts`、`qqTransport.ts` 等，main 入口里内嵌的 qq-music-api），扫码登录、会话、推荐、写入、探索页这些平台细节见 `sources/qq/README.md`。
- `account/`：各平台账号共用的逻辑，只从 `omni.ts` 进入，平铺。`accountRead.ts`（2026-10-09，只跑过单元测试，没有用真实账号试过）：从平台读一个账号的唯一函数，不认识任何平台，规则写在文件头。经 `omni.readAccount(平台, 原因)` 进来，原因是应用启动（`src/hooks/useAccountReads.ts`）、登录完成、切换平台（这两个在 `src/library/core/account/providerAccountDeps.service.ts` 的 `readProviderAccount`，由 `providerAccountController.service.ts` 调）、同步按钮（`src/App.tsx`）；依次问 adapter 谁登录了（`auth.getLoginStatus`）、歌单（`library.getUserPlaylists`，一页 50 个）、喜欢的 id（`library.getLikedSongIds`，结果走 `applyLikedRead` 那条规则），写进 account store 并存快照。一个平台同时只有一次读取：读取进行中再来的请求等同一次的结果，不另发；登录完成是例外（进行中的那次可能是登录之前问的），它让进行中的那次作废、重新读。退出登录（`omni.signOutAccount`）或登录失效之后才到的答复什么都不写，也不存盘。谁登录了问不到（60 秒没有答复也算）、歌单读不到：账号保持原样、标成失败，不退出任何人；喜欢的歌读不到：红心保持原样，歌单照常显示和保存。平台说没人登录，或者以登录失效（`auth-required`）拒绝时账号才离开；被拒绝的是歌单时先再问一次谁登录了，平台仍然报出这个人就不退出。账号离开前先告诉 adapter（退出登录是 `auth.logout`，它在第一次等待之前丢掉自己记的东西；登录失效是可选的 `auth.signInRanOut`），再清 store。磁盘上存的账号要等平台报出同一个人之后才显示；adapter 写了 `auth.showsKeptAccountAtStart` 的平台（网易云、酷狗、QQ：登录状态和页面里存的东西是一起的；Apple Music：登录状态存在 companion 进程的本机 profile 里）启动时先把存着的账号显示出来（经 adapter 的 `normalizeUser` / `normalizeCollection` 读一遍），同时去问平台，问不到就一直显示着；磁盘上没有快照时，adapter 写了 `auth.oldKeptAccount` 的先把它给的账号存成快照再用（原来只有网易云写它，读快照之前的版本存账号的四个缓存；网易云迁成音源模组 `sources/netease/` 后不再读，现在没有平台写它）；所有平台在没人显示、正在询问登录状态时都显示“正在确认登录状态…”（包括启动、同步、登录完成及进主页后的重试）；这只是状态提示，登录窗口的平台行仍可通过鼠标或键盘选中并开始登录，不必等待读取结束或超时。平台有云盘入口的（adapter 有 `library.getCloudCollection`：网易云、酷狗、QQ）读完歌单读它，读不到就留着手上的那个。只读歌单的那一路（`omni.refreshProviderPlaylists`：在 Folia 里改了歌单之后）也在这个文件里；进入主页时读歌单是 `readAtHome`（经 `omni.accountMoment('home-entered')`）：有读取正在进行时不读，距上次开始读歌单不到 5 秒不读，失败后下一次进主页立刻再读；被平台以登录失效拒绝时同样先问一次谁登录了，平台说没人就让账号离开并提示“登录已过期”（原来只有酷狗在这里检查登录）。谁登录了没问到、所以没人显示时，进主页改为整份读一次账号（有读取正在进行就等它；距上次没问到不到 5 秒不读，连着没问到的每多一次，这段间隔翻一倍，最长一分钟：这次运行里一直读不出的存储不会每次进主页都去问），平台能连上了账号就回来（2026-10-22）。回到窗口、进入主页的时机要读喜欢的歌时，如果这个平台的整份读取正在进行，就等它的结果，不读第二遍。日志以 `[Account] <平台>: <原因>:` 开头，每次读取一行。六个平台都走这个函数（网易云 2026-10-10 搬过来，同样只跑过单元测试）；`src/hooks/useNeteaseLibrary.ts` 已在 Folium 2.0 S1 删除，首页账户只取账号摘要。`keptAfterRead.ts`：从平台读回来的喜欢的歌和听者按过的心形怎么对账的那一条规则（纯函数，规则写在文件头；见上面“修改”一行）。`readMoments.ts`（2026-10-09，只跑过单元测试，没有用真实账号试过）：在平台自己的应用里改了喜欢的歌之后，什么时候把喜欢的 id 再读一遍，只在这一处决定（`decideLikedRead` 是纯函数；`createAccountMoments` 负责要数目、发起读取、记日志）。时机两个，由 `src/hooks/useAccountReads.ts` 监听、经 `omni.accountMoment` 报进来：回到 Folia 的窗口（页面的 `focus`，以及页面重新可见；桌面版的主窗口关了后台节流，隐藏或最小化时页面一直算可见，所以桌面版只靠 `focus`；从托盘恢复时 `focus` 来不来没有在应用里试过）、进入主页（主页上没有打开的歌单；这个时机同时把歌单再读一遍，见上面 `accountRead.ts`）。每个时机只管当前平台：先要“喜欢的歌”的数目（adapter 的 `getLikedSongCount`，一次请求），和手上的数目不一样才整份读（`getLikedSongIds`，结果走 `applyLikedRead` 那条规则，变了就存快照）；数目一样、平台没给数目、adapter 没有 `getLikedSongCount`、没人登录，都不读。没有定时器。一个平台同时只有一次检查在跑，两次检查的开始至少隔 5 秒（回到窗口一次会连着来几个事件；没有人能在 5 秒里去别的应用改一次再回来；和主页歌单刷新是同一个间隔）。“手上的数目”是账号里存的喜欢 id 的个数加一个差值：上一次由这里发起的读取之后，平台报的数目比 id 个数多多少（只在内存里，按账号记）。平台的数目和读回来的 id 个数长期对不上时（波点的数目把列表里不给的歌也算进去，Spotify 把不是歌的行也算进去）只多读一次，不是每次检查都读；在 Folia 里点的红心让两边一起变，不引起读取。代价：在别处同时点一首、取消一首，数目不变，这里看不到，要打开“我喜欢”歌单或按同步；数目对不上的账号每次启动后的第一次检查会多读一次整份；读取失败时什么都不记，下一个时机再读。应用启动、登录、切换平台、同步按钮、打开“我喜欢”歌单照旧整份读，不经过这里；时机落在整份读取途中时等那一次读喜欢的结果，不读第二遍（喜欢的歌在时机到来之前已经开始读的，这次不记差值，下一个时机再比一次数）。各平台的数目从哪来：网易云没有比 `/likelist` 更小、又确定是同一份列表的请求，数目就是 `/likelist` 的 id 个数（检查一次请求；数目变了再读一次）；QQ 是 `/user/liked-songs` 第一页的 `total`；酷狗是 `user_playlist` 第一页里“我喜欢”那一行的数目（和歌单卡片的数目同一个字段，不是整份读取走的 `playlist_track_all`，两者可能不等）；波点是 `liked_songs` 第一页的 `total`；Spotify 是 `fetchLibraryTracks` 要 1 行时的 `totalCount`；YouTube Music 是“喜欢的音乐”第一页的页头写的首数（`sources/ytm/client/ytmLibrary.ts` 的 `getLikedSongCount`，页头由 `sources/ytm/main/webPages.cjs` 的 `playlistCountOf` 读），页头没写首数时是 `null`；第一页没有歌曲那一栏、页头却写着大于 0 的首数时，读取抛错（`sources/ytm/main/ytmApiBridge.cjs` 的 `playlistPageOf`），不当作空列表。日志：每次检查一行 `[Like] <平台>: <window-returned 或 home-entered>: the liked list counts <平台报的>, <手上的> held: the liked songs are read whole`（不读时结尾是 `are not read`，没有数目时前半句写原因），要数目或读取失败时是一行警告。读到的必须是平台此刻的答复：网易云的 `/likelist` 带 `timestamp`（API 服务对同一个地址缓存 2 分钟，`sources/netease/core/netease.ts`；原来不带，同步按钮读到的可能是 2 分钟前的），酷狗读账号的喜欢列表时不用它自己那份 10 秒的缓存（那份缓存留给取消喜欢时找行号）。`answeredWithin.ts`：给发往平台的一个请求定时限的小函数，`accountRead.ts`（问谁登录了，60 秒）和 `readMoments.ts`（要数目、重读，各 20 秒）共用。`likedChecks.ts`（2026-10-16，只跑过单元测试，没有用真实账号试过）：喜欢的 id 最近一次被采用的读取没读全（`getLikedSongIds` 答 `whole: false`，例如 Spotify 超过 20000 首；从第一页读账号自己的“我喜欢”歌单（`endLikedListRead`）也算这样一次读取：没读全就问，读全了就不问）的平台，正在放的歌和播放队列里的歌的红心逐首问平台（adapter 的 `library.areSongsLiked`；没有这一项的平台不问）。歌由 `src/hooks/useAccountReads.ts` 从播放的 store 听到、经 `omni.songsInPlay` 报进来，正在放的排第一。一个平台同时只有一个请求在路上，一次最多 50 首，一次接一次地发：每次发的时候从当时在放、在排的歌里取还没问过的，正在放的排第一，轮到之前已经不在队列里的歌不问；每个答复到了就按 `keptAfterRead.ts` 那条规则对账（多了 `notKept`：问到不喜欢的去掉红心，按过的除外）。请求在路上时有一次喜欢的 id 的读取被采用了，这个答复丢掉、不对账，不管两者哪个先开始（那次读取可能显示这首歌是喜欢的，更早问的答复却说不喜欢，照收会把红心灭掉）；那次读取没读全的，歌重新问，读全了的不再问。每首歌在两次读取喜欢的 id 之间只问一次（读取跟在“可能在别处改过”的时机、同步按钮、登录之后）；请求失败就停，到下一次读取喜欢的 id 之前什么都不再问（失败过的请求多半还会失败，不能每次歌变了都再发一遍）；平台对某首什么都没说的不再问。日志：对账一行 `[Like] <平台>: hearts of <n> songs in play checked (<m> liked) applied: …`，失败一行警告。代价：问到的红心让手上的 id 个数变了，下一个时机数目对不上，会整份再读一次。
- `providerAccountCache.ts`：按 provider 保存用户、集合、点赞 ID、hydration/freshness 快照；刷新失败保留旧快照。
- `listeningRank.ts`：账号的听歌排行（#1019，能力 `listeningRank`）。平台按账号收听记录排出的歌，不是应用自己的播放记录。每个时间范围（最近一周、所有时间）是一个只读条目（类型 `listening_rank`，`listeningRank` 记范围，id 带用户 id），由 `account/accountRead.ts` 跟云盘条目一起读，排在第一个歌单和云盘后面；没有歌或平台不给看的范围没有条目。歌由 `catalog.getListeningRankTracks` 整份读出，再按页切；每首带平台给的播放次数 `listenCount`。omni 不给它收藏和编辑。网易云走 `/user/record`（type 1 最近一周、0 所有时间）。2026-11-03 用真账号验过：一周 14 首、所有时间 100 首。只读当前账号自己的排行，所以 code -2（无权限访问；匿名请求也是这么答的）和别的拒绝一样按读取失败处理，不当成没有歌。酷狗走 `/user/listen`（type 0 最近一周、1 所有时间，各前 120 首），2026-11-03 用一个概念版账号实测：外壳是 `data.lists`；换一个坏 token 答 20018，说明 token 确实校验过；`/user/history`（最近播放）有记录，但排行服务对这个账号答 `total_history: 0`、`lists: []`，所以没有条目。条目的次数字段 `listen_count` 是同一模块的其他客户端在真账号上看到的，我们还没看到过。 QQ 走 qq-music-api 3.3.6 的 `/user/listening-rank`：「最近一周」对应 QQ 的本周（从周一算起，这一周没过完只算到今天）；QQ 没有所有时间的排行，这一栏暂时用年榜，统计的是去年一整年（1 月 1 日到 12 月 31 日），名字和说明都写明是年榜，不冒充历史总排行。年榜和真正的「所有时间」不是一回事，之后另开 issue 讨论怎么让平台声明自己支持哪些时段。
- `providerStorage.ts`：renderer 的 provider session/account 持久化边界。QQ 这里只保存 opaque `qqmusic_session`；真实 credential 始终由 QQ API 后端持有。桌面版由 QQ 音源模组的 main 入口加密存着跨重启恢复，独立 Node / Docker 后端可用 `QQ_AUTH_SESSION_PATH` 与 `QQ_SESSION_SECRET` 启用加密文件仓库；serverless 形态下 credential 加密在 token 里，服务端不存。桌面版这次没有系统加密、读不出仓库时（`sources/qq/main/qqAuthSessionRepository.cjs`），存着的 session 这次不带（按游客请求）也不删，读账号报 `unavailable`；只有登录才有的栏目、推荐、收藏状态、试听按游客走（`hasUsableQqSession`）。这次运行里一扫码登录，仓库就把读不出的那份删掉（和别的平台一样，新登录替掉旧登录，下次启动不会回到它），main 入口从此答「读得出」（rpc `status` 的 `sessionStoreUnreadable` 每次现问），新 session 照常带，页面重新载入以后也带。过期的会话只在到期 30 天以内多给一小时去试续期：这一小时不写盘、每次启动重给，到期更久的照包的规则删掉。别的路由回 401 时 transport 先问一次 `login_status`（同一时间只问一次），后端不再认出这个用户、存着的又还是那个 session 才删（`sources/qq/core/qqTransport.ts`）；这样删掉时账号层不知道，界面上的账号到下一次读账号（进首页、同步、重启）才离开。送出方式按部署形态分岔：同源 base 用 `X-QQ-Session` header 送裸 token，外部 URL 与 Electron 维持 `?cookie=` 送整串 cookie，两者语义不同不可互换。酷狗 Web transport 仍在这里保存远端 API 请求所需的 session；Electron transport 只保留非敏感 `userid` 提示，`token`、cookie 与 `dfid` 由主进程加密持有，不得复制到 renderer。主进程这次没有系统加密、读不出存着的会话时，它留着不被覆盖，这次也还没有新登录时登录检查报 `unavailable`；退出登录（登录失效也走这里）时连同旧版本的明文会话一起从磁盘删掉（`sources/kugou/main/kugouApiBridge.cjs`）。旧版本的明文会话写成 V2 之后才删；这次运行没有系统加密时，读进内存后马上从磁盘删掉（旁边留着读不出的 V2 时也删），只在这次运行有效，磁盘上不留不加密的登录。没有系统加密时的新登录同样只在这次运行有效，并删掉存着的 V2，下次启动不会回到旧账号；这个删除一次运行只做一次（每次删除都要重写整份配置文件），删不掉只记一行警告，请求照常。加密能用、只是这一次写不进去时，存着的留着等下一次存；是另一个账号的就删掉。
- `resourceCache.ts` / `resourceKeys.ts`：在线资源缓存键和缓存层。当前 kind：`audio`、`lyric`、`cover`、`theme`、`replayGain`。**新增 kind 必须同时在 `src/services/repositories/cacheRepository.ts` 的 `getCacheTableName` 与 `matchesCategory` 里登记前缀**，否则条目会静默落进 `api_cache` 兜底表、不属于任何一个「清除缓存」分类，变成清不掉的孤儿；若该 kind 是按歌曲存一份，还要确认它没有被计进 `mediaCount`（那个数字的语义是「已缓存歌曲数」，会翻倍）。`audio` 旁边另有一个键 `audioLevel_<歌曲键>`（不是 `SongResourceKind`，键在 `resourceCache.ts` 里拼，`saveSongAudioLevel` 写）：这份音频取自哪一档。`getCachedSongAudioBlob(song, level?)` 和 `hasCachedSongAudio(song, level?)` 带着档位问时，记着别的档位的那一份算没有；没记档位的（记档位之前存下的、网易云旧键的）问哪一档都算有；不带档位和以前一样。带档位的是播放、预取和播完写入，不带的是自动混音分析和人声分离。试听片段（2026-10-17，只跑过单元测试）：平台可能拿比整首短的文件应答一首歌，账号只能试听时给的就是试听片段。adapter 照交地址，在 `ProviderAudioSource.preview` 上标出来，omni 按地址记下（`isPreviewAudioSource`）；播放照放，放完接着放下一首。提示 `status.songPreviewOnly`（info；provider 写了 `playback.previewNoticeKey` 时换成它自己的那一句，经 `omni.previewNoticeKey` 取）只从一处来：活动播放器开始放一个标成试听的地址时（App.tsx 的 `playing` → `previewNotice.ts` 的 `notePreviewPlaying`），同一首歌每开始一次只提示一次（按 `currentSong.ts` 的 `startOfAskedSong` 分）：暂停再放、卡顿后接着放、播放中换地址（recovery）、过渡被暂停或拖动取消而回到上一首、一次放歌中途放弃而回到原来那首（后两种是 `askForSong(…, { putBack: true })`，那首歌拿回自己原来的那次开始）都不再提示，再放一次这首歌才再提示；只认播放器放的是当前那首歌、当前那个地址的时候，换歌途中上一首的地址报的 playing 不算，不会把新歌的那次提示用掉；启动时恢复上一首而不自动播放时不提示，按下播放才提示。自动混音的下一首放的是预取的地址，也从这里提示。旧窗口交给新窗口的地址（`useElectronWindowPlaybackHandoff.ts` 的退路）新窗口的 omni 不认识，不提示。长度的规则（`wholeSongCheck.ts`）有两个数，放在一处：文件头里的播放时长不到歌曲 `durationMs` 的一半，算“不是这首歌”（试听片段大约是 3 到 5 分钟歌里的 30 秒）；到 90%，算“证明是整首”。分开是因为 `durationMs` 可能是另一个版本的：拿 90% 去拒收、删除、跳过分析，会把一首整歌当成片段丢掉，离线时它的副本被删就放不了。只有“不是这首歌”拿来对付文件；“证明是整首”只用来决定能不能盖掉磁盘上已有的那份。存音频的两处（播完写入 `playedTrackCache.ts`、自动混音分析整首读下来那一次 `profileService.ts`）存之前过同一个检查（`mayStoreSongAudio`）：标成试听的地址一律不存，两处都在下载之前就停（`whyPreviewClip`），片段不白下；用一个不出声的 `Audio` 元素读文件头里的播放时长（5 秒为限），不到一半的也不存，磁盘上没有文件时也一样；别的文件（一半到 90% 之间，或读不出时长、没有 `Audio`、元素报错、5 秒没有结果、时长不是有限的数，或歌曲没有 `durationMs`），磁盘上没有文件就照旧存，要盖掉一份已经在磁盘上的文件（不论它是哪一档）就不盖，原来那份留着，只有证明是整首的文件才盖（日志 `[Cache] Copy of <歌曲键> kept, … play length <秒数或 unknown>, stated length <秒数或 unknown>`；没有旧文件而不存时是 `[Cache] <歌曲键> not stored, …`）。播放拿缓存副本时（`loadOnlineSongAudioSource`：同一档的那份，和拿不到地址时别的档位的那份）也读一次文件头，300 毫秒为限：不到一半的连同 `audioLevel_` 一起删掉（旧键下的也删），照没有缓存那样向平台要地址，以前版本存下的试听片段就这样清掉；别的副本照播，读不出或超时也照播。只删量过的那份：渲染端把读到的大小交给主进程（`remove-audio-cache`，`electron/audioCacheRemove.cjs`），磁盘上的文件大小变了（这期间播完写入写进了整首）就不删，档位也不删；IndexedDB 里的副本同样按大小比。文件删不掉时（Windows 上文件被占用，EBUSY、EPERM）主进程报错，副本和它的元数据、档位都留着，下次从缓存开始播时再查。日志在删完之后打，带结果（`[Cache] Copy of "<歌名>" deleted: …`、`left, a newer file is there: …`，删不掉是 `not deleted (…)`）。自动混音从音频量出来、按歌留下的东西用同一条规则（`whyNotTheSong`、`whyNotTheSongPlayed`）：分析结果（`profileService.ts` 存的 `automix_profile_<键>`，节拍网格、响度、开头结尾都在里面）对标成试听的地址不下载、不分析，对不到一半的文件（整首读下来的，或媒体缓存里的副本）不分析；存着的整首分析量的那个文件不到这首歌的一半时（以前版本从片段量的）不用，重新量；播完一首用播放器听到的响度补上只有开头的分析时，播的是片段就不补；问自己存文件的 provider 存不存时（`keepWithProvider`），试听地址不问。这些跳过在这次运行里记住（下载按歌和地址，缓存副本按歌），每次预取不再重新下载、重新读同一个文件；缓存副本在这首歌的音频写入、或副本不在了时忘掉；别的跳过（还没有地址、下载失败）照旧下次再试。人声分离的窗口（`stems.ts`，只在内存里）不从不到一半的缓存副本切，请求等这首歌自己的文件存进来再做。正在放的片段也不用内存里的分析：内存里有了分析，这次运行就不再量这首歌，开会员以后整首也会用片段的；没有分析时过渡照没有分析的歌那样做（读播放器的现场响度）。实测读文件头的代价（2026-10-17，在一个空的 Electron 窗口里读本机媒体缓存的 324 个文件，不是在应用里）：中位 6 毫秒，90% 在 20 毫秒内，5 MB 以下的文件（试听片段都在这里）最多 7 毫秒，每次运行第一次 126 毫秒；只用 E 核时中位 9 毫秒、第一次 282 毫秒，偶有和文件大小无关的停顿到 1.6 秒（超过 300 毫秒就照播，下次再查）。盖的时候先删 `audioLevel_`、再写音频、最后写新档位：中途失败留下的是一份没有档位的文件（哪一档都播它），不是新文件挂着旧档位。播完写入和自动混音分析这两处，写入音频后都跟一次 `saveSongAudioLevel`：地址的档位查不到时不记，并删掉这首歌以前记的（网易云旧键搬到新键那一处不跟，那份文件本来就没有档位）。前缀已在上面两处登记：和歌曲一起清、一起计大小，不计进 `mediaCount`。拿不到地址时（断网、登录失效、歌曲下架）例外：`loadOnlineSongAudioSource` 改播那份别的档位的副本，日志 `[Cache] No URL for "<歌名>": its copy of another level plays`。
- `watch`（adapter 的可选成员）：应用开着时这个平台自己要盯着的东西。应用起来之后由 `omni.watchProviders` 一起开始（只管当时注册了的平台），平台要告诉用的人的话（i18n key）由 `src/components/app/useProviderNotices.ts` 显示成底部消息。音源模组的 `watch` 由 adapter 给，转达模组经 `handle.notify` 说的话。网易云（音源模组 `sources/netease/`）：main 入口把桌面端本地后端的状态经 rpc 推给 client，`sources/netease/core/neteaseLocalService.ts` 记着它（登录窗口经音源声明的 `localService` 读它），起不来时说一句；因为断网起不来的不说（状态里带 `offline`）：要用它的请求说连不上，并且叫 main 入口再启动它一次（至多每 10 秒一次，规则在 `sources/netease/main/neteaseApiStartup.cjs` 的 `startsAgainWhenNeeded`），网通了就不用重启应用。
- `playbackReportGate.ts`：听歌上报的频控与可用性判断。上报写的是用户真实账号，突发的不可能记录会触发风控，所以这里限制最小间隔与每小时上限、串行发送，并给设置面板和命令面板提供同一个 `isPlaybackReportReady()`（有一个声明了 `playbackReports`、此刻可用的平台，而且它的账号登录着；给它一首歌时只问这首歌所属的平台）。某一首歌报不报得了由平台自己说（`playbackReports.canReport`，网易云不报云盘里的歌和 id 不是正整数的歌），经 `omni.canReportPlayback` 来问。真实播放秒数的计量在 `src/utils/playbackListenTracker.ts`，接线在 `src/components/app/playback/bridges/usePlaybackReporter.ts`。
- `songMetadata.ts` / `songAvailability.ts`：歌曲元数据、可播放性和替代歌曲相关共享逻辑。
- `catalogRefs.ts`：歌曲、歌单、专辑、歌手的 provider-aware catalog 引用。
- 应用自己的播放记录不在这个目录：`recentPlays.ts`、写它的 `useRecentPlaysRecorder.ts` 和用它做出探索页两栏的 `ownSections.ts` 都在探索页自己的目录 `src/components/app/home/explore/`（见上文“应用自己的两栏”）。
- 探索页跨会话记住的两件事也不在这个目录，在探索页 store 的旁边 `src/stores/exploreFeedMemory.ts`（localStorage 键 `folia_explore_memory`）：每一页栏目标题的先后，和听众在应用里取消收藏的集合（七天）。只由 `src/stores/useExploreFeedStore.ts` 使用。
- `exploreReads.ts`：各平台的探索页 adapter 共用的两样，不认平台（规则见 `EXPLORE_ADAPTER.md` 规则 3 和规则 10）。一，`createHandedOut()`：记前几次读取用过什么（一栏交过的条目、拿来问过的歌），按 adapter 自己定的范围记；`inTurn` 把候选排成“没用过的在前，其余最久以前用过的在前”，`note` 把这一次用的按先后记下（后记的算后用的，所以长短不一的列表都轮得匀）；每个范围最多 5000 个，超出时忘掉最久以前用过的；只在内存里。二，`stampCursor` / `cursorWords`：在游标前面写上、读出读取的序号，用来认出上一次读取的游标。用它的是 `sources/netease/core/neteaseExplore.ts`、`sources/ytm/client/ytmExplore.ts`、`sources/spotify/client/spotifyExplore.ts`，以及汽水模组的 `sources/qishui/client/qishuiExplore.ts`（经 `@folia/folium-source-kit`；Spotify 只用第一样：它的游标不带序号）；YouTube Music 只记问过的歌，它的栏不记交过的条目。

`omni.ts` 的 active-provider 调用带 request generation 检查：`withActiveProvider` 会丢弃 provider 切换后返回的旧响应，切换事务需要 `invalidateActiveRequests()`。不要在调用方重新实现一套取消/晚到响应防护。

## Routing rules

### Ordinary single-provider flow

```ts
import { omni } from '@/services/onlineMusic/omni';

const page = await omni.searchSongs(query, { limit: 30, offset: 0 });
const song = page.items[0];
if (song) {
    const lyrics = await omni.getLyrics(song);
    const audio = await omni.getAudioSource(song, 'high');
}
```

歌曲已经带有 provider identity 时，使用 song-aware 方法：

```ts
await omni.toggleSongLike(song);
await omni.getCollectionTracks(collection, { limit: 50, offset: 0 });
```

### Explicit cross-provider flow

歌词匹配、本地元数据匹配、联邦搜索、fallback、比较和迁移才是跨 provider。使用 `searchProviderSongs(providerId, ...)` 等显式方法，并保留每条结果的 `sourceRef.providerId`。不要为了“当前有两个 provider”就直接并发调用 raw adapter。

### Identity

在线歌曲身份是 `(sourceRef.kind='online', sourceRef.providerId, sourceRef.mediaId)`，不是 `song.id` 单值。比较、去重、替代、入队前优先使用：

- `src/utils/appPlaybackGuards.ts`：`getPlaybackSourceRef`、`getPlaybackSongKey`、`isSamePlaybackSong`
- `src/utils/appPlaybackHelpers.ts`：播放结构和来源相关派生

跨 provider 的 numeric id 不可直接去重；`online:netease:123` 与 `online:kugou:123` 默认是两个播放身份。

## Fast lookup

```powershell
rg -n "export const omni|searchSongs|getLyrics|getAudioSource|updateCollectionTracks" src/services/onlineMusic/omni.ts
rg -n "OnlineMusicProvider|OmniProvider|UnifiedSong|OmniLyricsResult|OmniAudioSource" src/types/onlineMusic.ts
rg -n "registerOnlineMusicProvider|BUILT_IN_SOURCE_ORDER|providerSupports" src/services/onlineMusic/providerRegistry.ts
rg -n "folium.sources.register" sources/*/client/index.ts
```

先确认 Omni 是否已有能力；没有时扩展 `types/onlineMusic.ts`、`omni.ts` 和适用 adapter，不要新增第二条公开 bypass。加一整个平台，按上面的“接入一个新平台”做。
