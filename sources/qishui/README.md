# 汽水音乐（`qishui`，仅桌面端）

Folia 内置的汽水音乐音源模组（Folium 2.0）。原来是 `src/services/onlineMusic/UPSTREAMS.md` 里的一节和
`src/services/onlineMusic/README.md` 的「汽水音乐（桌面端）」一节，随平台搬到这里。构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：[`qishui-music-api`](https://github.com/GSQZ/qishui-music-api)，MIT 许可，独立维护车机 HTTP 协议、客户端参数、票据签名、主动扫码授权、目录分页、推荐状态及未加密音频地址选择，不依赖官方客户端安装。
- **版本**：0.2.2，钉死在本目录的 `package.json`（构建核对装着的版本）和根目录 `package.json`（包从仓库根的 `node_modules` 找）。升级时两处一起改。锁文件使用 npm Registry 的 tarball 和 integrity，不使用本地文件、tarball 或 Git 分支引用。包没有传递的运行时依赖，直接打进 main 入口的 `index.cjs`（方案 §6.2）；网页版和 Docker 不调用它。
- **怎么用**：main 入口（`main/index.ts`）在主进程里调 `main/qishuiApiBridge.cjs`，它直接调用 `createQishuiApi`，注入设备标识、会话仓库和 `api.net.fetch`，只放行包导出的 `QISHUI_OPERATIONS`。注入时一律加上 `credentials: 'omit'`：不然请求会带上 defaultSession 的 cookie，平台回的 `Set-Cookie` 也会写进 defaultSession，账号只靠包自己的请求头。client 经 `folium.rpc` 的 `request` 发操作。`main/session.cjs` 经 `api.legacy.store` 沿用迁移前的存储键（`QISHUI_SESSION_V1`、`QISHUI_DEVICE_ID`），用 `api.seal` 加密，设备标识由包生成和校验；加密不可用时会话只在内存中保存。`main/mediaCors.cjs` 的规则经 `api.media.allow` 登记：已签发的音频地址，以及场景图标与封面的公共图片域名。client 只从包导入类型，不加载协议代码；凭据不交给窗口。
- **我们不改包**：Folia 不覆盖包内文件，不保留平台客户端标识、签名或协议实现。包只使用主动扫码授权的会话，不读取其他应用凭据、不加载官方客户端原生模块、不解密受保护音频；没有接口的写入能力保持关闭。
- **上游变了怎么跟**：在独立仓库修复协议并发布新版本，Folia 明确升级钉死版本后回归。确认扫码、会话恢复、搜索、自己的歌单及下一页、逐字歌词、标准音质地址、试听标记与片段歌词起点、场景切换和补歌，以及红心、自建歌单增删、最近播放分页和可播性检查；场景目录仍从包读取，不在界面写死。打包后核对 npm 包进入产物。
- **测试**：协议、扫码、推荐流和受保护音频拒绝的单测跟随独立包。Folia 的 `test/unit/electron/qishuiApiBridge.test.ts` 测操作白名单、会话加密恢复、内存回退和音频登记，`test/unit/qishui/qishuiMain.test.ts` 测 main 入口接到 `api.*` 的那一层；`test/unit/qishui/packagePaging.test.ts` 使用真实包、桥和注册着的模组音源，只替换 HTTP 答复，核对不透明游标、喜欢列表、最近播放分页和写入操作。`test/unit/qishui/` 其余测试覆盖归一化、歌词时间、本地匹配、歌词源、电台目录和 Omni 能力边界，都经注册着的模组跑（`test/unit/helpers/qishuiSource.ts`）。

## 能力

能力：抖音扫码授权、歌曲搜索与歌单搜索、歌曲详情、逐字歌词（也是别的歌的歌词来源）、账号自建及收藏歌单、歌单翻页、歌手详情和热门歌曲、推荐流（探索页），以及场景电台与私人 FM 模式。没有专辑。

电台卡片带各自的场景选择；模式面板经 `recommendations@1.getPersonalFmCatalog` 读取平台自己的场景目录：模式是 kit 的标准模式（`personalFmModes`）里汽水收的四个（默认、熟悉、探索、场景），名字在本目录的 `locales/`；场景和分组是车机写出来的字，使用车机返回的数字 ID，不套用默认目录的场景 ID。各平台分别保存选择，原有私人 FM 存储键保持不变；切换模式后自动补歌沿用新模式（`personalFmModes: true`，宿主在没给选项时按听者选的模式问）。上游的小场景图标由 `client/qishuiSceneCover.ts` 组合成有留白的封面；图标读不到时这一次只用纯矢量的底图，不记下来，下一次再去读图标。图标按字节认出的类型标进 data URL（认不出时用答复声明的位图类型），不一律标成 PNG。

播放仅使用服务直接返回的未加密地址，对外声明标准音质，试听地址保留试听标记，试听时的提示是模组自己的一句（`playback.audio@1.previewNotice`）。没有解密受保护音频、提取密钥、调用官方客户端原生签名模块的实现。支持喜欢/取消喜欢、自建普通歌单加删歌、推荐“不喜欢”、歌单页签里的只读“汽水最近播放”集合，以及搜索和详情的可播性检查。只有明确通过检查才标成可播，其余限制保持未知，不推断下架。“我喜欢”歌单走红心；收藏歌单和最近播放不可编辑。专辑详情、创建歌单及收藏写入没有接口，继续关闭。试听片段的起点由 Omni 交给歌词时钟，不写入手动歌词偏移。歌手曲目按车机首次返回的热门列表展示，不把其不前进的游标当成还有更多。

歌词交原始文本轨，由宿主解析：KRC 同时交成行轨和逐字轨，LRC 交成行轨，翻译轨带自己的格式（KRC 或 LRC），宿主按行的开始时间对上。汽水也是匹配窗口和自动选歌词时的一个来源（`lyrics@1.crossSource`，在来源列表里叫全名 `name.lyrics`）；按 id 就能再取（`lyrics@1.songIdOf`：1–30 位数字，按文字回，不转成数），本地歌匹配到的汽水歌因此保留为它的身份。

探索页（`client/qishuiExplore.ts`）只有一栏“推荐”（id `stream`，每次读取相同，标题是模组语言表里的一条），条目全是歌曲，用歌曲自己的方形封面；来源是包的 `feed` 操作的探索队列（车机的 `/feed/song-tab/`，和私人 FM 的队列分开），一次要 20 首。从头读的那一页声明 `refreshReadsAnew`：每次“换一批”从头重读；“更多”沿这一栏的游标接着要，一次读取最多 10 批。一次读取里同一首歌只出一次：各批之间和同一批里重复的歌都去掉，一批去掉后一首不剩、而平台说还有时再要，一次最多要 3 次。交过哪些歌记在 kit 的 `createHandedOut` 里（范围 `stream`），登录确认、退出登录和登录失效时整份丢掉。不用 `listened`，没有“与某首歌相似”的栏。未实测：推荐是否按账号生成、隔几秒连读两次内容是否相同、相邻两批会不会给出同样的歌、未登录能读到什么、登录过期时答什么、请求频率的限制。

要地址、读集合没有成功时，情况由 `client/qishuiFailure.ts` 说：main 入口本身抛错是 `local-service-stopped`，不当成断网自动重试；只拿到加密音频是 `no-audio`（再要一次也一样，不给重试）；没有登录的账号时说“登录后才能播放”；`Qishui HTTP <状态>` 交出 HTTP 状态，平台的错误号交出码（错误号和登录阶段挂在错误的 `cause` 上，`qishuiRefusalOf`）。按 id 查一首（`songs@1.getSong`）时平台答了却没给这首歌（包的 `not-playable`，“Qishui did not return the track”）回 null，omni 报 `missing`。登录失败按阶段说（`mainCode`：`access-code` / `ticket` / `account`，读不到账号是 `account-not-read`）；登录诊断只记登录操作（`login_*`）的失败，一行 `failure: stage=… code=… upstreamCode=…`，登录窗口开着时后台的歌词、电台请求失败不进报告。

本地 macOS Electron 开发版（迁成模组之前）已验证扫码登录、登录态恢复、歌单读取、搜索、歌词、未加密音频地址及场景电台，界面经用户实际测试。自动回归覆盖红心、歌单增删、最近播放分页、可播性检查和试听歌词时钟，HTTP 答复使用替身。Windows、Linux 和完整安装包尚未实测，不代表上游接口始终可用。

## 目录

| 位置 | 是什么 |
| --- | --- |
| `mod.json` | 清单：`folium: 2`，音源 `qishui`，四种语言的名字 |
| `client/index.ts` | client 入口：接上请求通道，在第一个 `await` 前 `folium.sources.register` |
| `client/qishuiProvider.ts` | 音源定义：`search@1`、`songs@1`、`playback.audio@1`、`lyrics@1`、`auth@1`、`catalog@1`、`library@1`、`explore@1`、`recommendations@1`、`mutations@1` |
| `client/qishuiTransport.ts` | 经 `folium.rpc` 调 main 入口，包的错误码与原话原样交给宿主，平台错误号与登录阶段挂在 `cause` 上 |
| `client/qishuiNormalize.ts` | 原始记录 → 公开契约的 DTO |
| `client/qishuiCatalog.ts`、`qishuiMutations.ts` | 目录与曲库、红心与歌单增删 |
| `client/qishuiPlayback.ts` | 按 id 读歌、可播性检查、音频地址 |
| `client/qishuiLyrics.ts` | 歌词交原始文本轨 |
| `client/qishuiExplore.ts`、`qishuiRecommendations.ts`、`qishuiSceneCover.ts` | 探索页、私人 FM 与场景电台、场景封面 |
| `client/qishuiFailure.ts` | 包的错误码与原话的意思 |
| `main/index.ts` | main 入口：会话、请求、媒体跨域接到 `api.*` |
| `main/qishuiApiBridge.cjs`、`session.cjs`、`mediaCors.cjs` | 原 `electron/qishui/` 的三个文件 |
| `locales/` | 短名、歌词来源的名字、登录窗口、最近播放、推荐栏、试听提示、私人 FM 模式；`zh-TW.json` 由构建生成 |
