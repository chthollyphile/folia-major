# Apple Music（`appleMusic`，macOS 与 Windows 桌面端）

Folia 内置的 Apple Music 音源模组（Folium 2.0，模组 id `apple-music`）。原来是 `src/services/onlineMusic/UPSTREAMS.md`
里的一节和 `src/services/onlineMusic/README.md` 的「Apple Music（桌面端，companion）」一节，随平台搬到这里（路径改成
本目录的，其余照旧，日期是当时写的）。构建、布局和依赖的规矩见 `dev/sources/README.md`。

## 迁成模组后变了什么

- **布局**：`client/` 是渲染端的音源定义（`folium.sources.register`），`main/` 是 main 入口和原样搬来的伴侣程序
  客户端（`companion*.cjs`、`nativeSpawn.cjs`），`native/` 是伴侣程序的源码（`windows/` 的 C# WebView2 宿主、
  `macos/` 的 Swift WKWebView 宿主、构建脚本和它的 `README.md`）。`native/` 不打进模组：构建产物仍在
  `build/apple-music-native/<平台>/`，打包时照旧放进安装包的 `resources/apple-music/`。
- **原生件**：清单的 `native` 和受信表那一行都写着 `apple-music-companion`；main 入口经 `api.native.path` 拿到
  伴侣程序可执行文件的路径（宿主在 `electron/modSystem/nativeFiles.cjs` 里按名字找：打包后在 `resources/apple-music/`，
  开发时在 `build/apple-music-native/`，`ELECTRON_DEV=true` 时认环境变量 `FOLIA_APPLE_MUSIC_NATIVE`）。Linux 没有，
  请求答 `runtime-unavailable`。
- **接管**：安装包不带 Apple Music 时也不带伴侣程序。`npm run sources:pack -- appleMusic`（Windows x64）把
  `build/apple-music-native/windows` 那五个文件放进包里的 `native/apple-music-companion/win32-x64/`，接管副本的 `api.native.path`
  答这份的 `FoliaAppleMusicCompanion.exe`。macOS 的 `.app` 不带（经 zip 解到用户目录后签名和可执行位没验证），macOS 上接管后
  每个请求答 `runtime-unavailable`。
- **请求通道**：client 经 `folium.rpc` 的 `request` 把操作交给 main 入口（`main/index.ts`），宿主只放主窗口主框架的调用
  进来，和以前 `apple-music-request` 那条 IPC 的来源校验（`companionIpc.cjs`，已删）一样。操作白名单仍在
  `main/companionRequests.cjs`。
- **伴侣程序的资料夹**：仍是 `userData/apple-music-companion`（受信表认领的旧目录，`api.paths.legacy`），登录、
  storefront 和 WebView2 / WKWebView 的数据都在里面；「清除数据」删的就是它。
- **停用与退出**：停用（`api.onBeforeUnload`）时关掉伴侣程序；退出时（`api.onBeforeQuit`，只在伴侣程序运行时登记）
  同样关掉，代替以前 main.cjs 在 `will-quit` 里的那一句。
- **没人接手的播放器**：主窗口重建、新窗口没接手时，宿主经 `api.onPlayersOrphaned` 通知，main 入口暂停伴侣程序
  （以前是 main.cjs `pauseExternalPlayersNobodyFollows` 里直接调）。
- **Windows 隐藏宿主只在启播时保持可见**（PR #1080）和**大陆 storefront 在页面里改 `storefrontId` / `playbackMode`**
  （PR #1169）都在原样搬来的 `main/nativeSpawn.cjs`、`main/companionRequests.cjs`、`main/companionStorefront.cjs` 里，没有改。
- **播放**：`playback.external@1`（伴侣程序播放，宿主驱动它并跟随它的时钟；主窗口重建后经 `adopt` 接手仍在响的
  播放器）。没有 `mount`、没有 `playback.surface@1`：伴侣程序的播放器不是应用里的画面，有 `mount` 的音源会被当成
  画面歌重新播放而不是接手。没有 `routeOf`（只走外部播放）。
- **可用与否**：client 按 `navigator` 判断系统：macOS、Windows 可用；Linux 不可用，说明是语言表的 `linuxUnsupported`。
- **文字**：短名、登录窗口的标题与说明、Linux 不支持的说明、「全部歌曲」歌单名都在 `locales/`；全名 `Apple Music`
  写在定义里，各语言相同。
- **歌词**：TTML 原样作为 `main` 交给宿主，由宿主解析（逐词与否看文件自己的 `itunes:timing`）；是别的歌的歌词来源
  （`crossSource`，要登录），`prefersOwnWordByWord` 照旧。搜别名（`getSearchAlias`）去 jp 目录查原名。

## 上游

- **上游**：Apple Music 官方网页与页面内 MusicKit；网页会变化，没有固定版本。macOS 使用系统 WKWebView，不引入独立浏览器 SDK。
- **Windows SDK**：`Microsoft.Web.WebView2` 固定为 `1.0.4314.35`，在 `native/windows/FoliaAppleMusicCompanion.csproj` 用 NuGet 精确版本区间 `[1.0.4314.35]` 声明。升级时只改这个宿主的 SDK 声明，并重新构建及执行 Windows 验收。
- **Windows 运行时**：使用本机 WebView2 Evergreen，独立于 SDK 更新；不随仓库分发浏览器。需要系统 .NET Framework 4.8。源码已提供，未在 Windows 编译或验证 DRM，默认入口停用；实验开关与验收见 `native/windows/README.md`。
- **哪些测试能抓到**：Vitest 覆盖父进程请求、队列、协议与平台可用性分支；抓不到 C# 编译、WebView2 登录/DRM 出声或运行时升级造成的网页行为变化，必须在 Windows 实机验收。

## 平台说明

macOS 14+ 开发版已提供系统 WKWebView companion（`native/macos/`）。编译原生宿主后
开发版与正式打包均只使用原生宿主，保留原有 provider、请求白名单与队列函数；通过私有管道连接，无 EVS 依赖。
实际 macOS 15.0.1 / arm64 已验证登录、隐藏播放、重启恢复以及控制桥的播放/暂停/跳转/TTML/切歌。
用户已在 Folia 主界面确认正常播放与切歌。正式打包已接入按目标架构编译与资源分发，实际安装包仍待验收。
Windows 使用 WebView2 Evergreen 原生宿主，已实测登录与整首播放，随正式安装包分发、默认启用。
Linux 登录行显示「Linux 暂未支援」。构建和验证范围见 `native/windows/README.md`。

`client/appleMusicProvider.ts` 接入独立 companion 里的 Apple Music 网页会话：登录（Apple 自己的窗口）、
歌曲搜索、个人歌单及分页、歌单歌曲、账号，以及 `v1/catalog/<store>/songs/<id>/syllable-lyrics` 的 TTML。
目录歌曲与资料库歌曲的 id 分别保留（`sourceRef.providerData.catalogId`），歌词和播放都按目录 id 请求。
Apple Music 已提供资料库专辑页签及专辑歌曲分页；账号社交资料有头像时显示头像，没有时仍显示字母。
歌曲的专辑与歌手使用目录关系按需解析：资料库曲目先使用其目录映射，多艺人的关系只有 ID 时逐个取名字，
再经 Omni 打开目录专辑、歌手热门歌曲和歌手专辑。真实 macOS 账号已核验资料库专辑、其曲目的目录映射、
目录专辑及歌手端点；首页呈现、头像及点击导航仍需真人验收。
喜爱歌单通过 `extend: tags` 的 `favorited` 标记识别并分页同步；爱心写入经 companion 的
`v1/me/favorites` POST / DELETE。`library.getSongLikeId` 将资料库/目录行统一到同一个喜爱 ID，
Omni 的爱心读取、未决操作和写入共用这个 ID，播放 ID 不变。真实账号的双向写入尚待验收。
「加入歌单」复用 Omni 的选择器与 `updatePlaylistTracks('add')`，只接受明确可编辑的资料库歌单，
提交前在 companion 重新核对权限。系统喜爱歌单不作为追加目标；普通歌单删除与创建暂未开放，
真实账号追加结果尚待验收。
TTML 经现有 `parseTTML` 转成 `LyricData`：`isWordByWord` 和 `ttml.timingMode` 来自文件的 `itunes:timing`，
逐行文件不会标成逐词；Apple 没有歌词时交出 `lyrics: null`，不报成错误。provider 声明
`prefersOwnWordByWord`：自己的歌词是逐词时，自动匹配只先问“歌词匹配优先级”选的来源，它有逐词歌词才替换，
其他来源不再搜（#1127）；歌词设置里的“保留平台自带的逐字歌词”关掉后，和别的歌一样按优先级择优。

Apple 的音频受 DRM 保护，不能交出地址，所以能力是 `externalPlayback: true`、`playback: false`。播放走
`src/services/onlineMusic/externalPlayback.ts` 的 `external` 路线（`PlaybackRoute` 的第三个值）：Folia 经
`omni.playSongExternally` / `pauseExternalPlayback` / `resumeExternalPlayback` / `seekExternalPlayback` 驱动
companion；声音不经过 Folia 的增益节点，音量和静音由 `setExternalPlaybackVolume` 交给页面里的 MusicKit（启播前后各发一次，拖动时一次只发一个、最后发最新值）。`getExternalPlaybackStatus` 每 500 ms 报告一次位置和状态，`externalPlayback` 用外推时钟驱动歌词和
进度条；换到别的音源、HiFi 或 Stage 时这条路线会停掉 companion 的播放器。播放器自己换到别的歌时暂停并提示。
主窗口重建（透明背景、壁纸换屏等）时播放器不停：旧窗口抓完交接快照就交出（`handOverExternalPlayback`，不再轮询、不再按答复动作），新窗口恢复时问一次状态，还是那首就接管（`adoptExternalPlayback`，经 `omni.adoptExternalPlayback` 让平台重建自己的播放尝试），不是或没有新窗口接管就停掉；旧窗口最后没被重建（主进程拒绝或放弃）时把播放器收回来（`reclaimExternalPlayback`）。主进程自己发起的重建（壁纸窗口按桌面架构改透明度、壁纸助手放弃）同样先向页面要快照（`electron/main.cjs` 的 `rebuildMainWindowWithPlaybackHandoff`）；新窗口还没恢复完就又被重建时，把收到的快照原样交给下一个窗口，自己随后的接管落成已交出（`handOverExternalPlaybackDuringRestore`），恢复中途有人点了别的歌则照常答自己的状态、停掉没人接的那首；窗口来不及听到请求就被换掉时，主进程把它在请求发出后读走的快照转给下一个窗口（`windowPlaybackHandoff.cjs` 的 `carryForward`）；重建时下一个窗口什么快照都拿不到（旧窗口没及时回答），主进程直接暂停还在运行的外部播放器（`pauseExternalPlayersNobodyFollows`），因为换掉的旧窗口已经够不着它们。
companion 读到账号后先导航到账号的 storefront（`https://music.apple.com/<storefront>/`）再回答账号请求：MusicKit 只按页面地区解析目录 id，页面地区和账号不同时会接受队列却播不出来。播放命令在 companion 里串行执行，暂停/换歌不会被并发拒绝丢掉。Apple Music 在 macOS 和 Windows 上声明可用（`appleMusicAvailability`），Linux 显示暂未支援。companion 的窗口、协议和安全边界见 `native/README.md`。

仍未完成的验收包括：正式安装包、Windows 编译与 DRM 实机测试、退出清理与异常恢复全流程、
长时间和曲末行为，以及逐词时间的覆盖率和同步精度。收藏/歌单写入适配已修正，真实写入由用户手动验收。

Apple Music 的推荐能力已接入个人 FM（Apple personal station 持续补歌）与地区可用的直播电台。
直播作为单个外部播放项目，无歌曲进度和拖动；卡片与曲目读取都经 Omni。真实中国大陆会话中，个人 FM
取歌与播放时间推进已通过，直播列表为空，直播出声尚未实测。详细范围见 `native/README.md`。
