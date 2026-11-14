# Folium 2.0 最终实现方案：音源完全外置为模组

> 依据：`plan/folium-1.9-interface-exploration.md`（A 组与开放问题）、`dev/folium/provider-v2-plan.md`（Codex e277 工作树里的那份），加上对现有代码的四轮只读核对。
> 基线：main `cb484ffdf`，Folium 1.9。本文是实施计划，文中的新接口名在 S3 定稿。

## 1. Context

现在九个在线音源（netease、kugou、qq、bodian、ytm、spotify、qishui、appleMusic、fnmusic）静态编进宿主：`providerRegistry.ts` 直接 import，`electron/main.cjs` 和 `preload.cjs` 逐个平台手写接线。模组只能用实验接口 `omni.providers` 注册四个方法的简化音源，账号、曲库、目录、推荐、外部播放全部做不到。

Folium 2.0 要做到两件事：

1. **稳定、开放的音源能力接口。** 外部模组只实现能力接口就能做出和内置音源对等的音源；能力类型本身可以增加，例如把视频站的视频挂到播放页上播放。
2. **九个内置音源全部改成模组的形式。** 源码留在本仓库，只用公开接口，构建后随安装包发布并默认加载；带官方签名的同 id 新版本可以覆盖内置版本。

已确认的取舍（不再讨论）：

| 项 | 决定 |
| --- | --- |
| 分发 | 随主程序发布 + 用户模组目录里官方签名的更高版本可覆盖 |
| 1.x 模组 | 双轨：`folium: 1` 照旧加载，接口冻结在 1.9（含 internals）；音源接口只给 `folium: 2` |
| 网页版 | 保留宿主自己的 Web Provider，不跑模组运行时 |
| 交付 | 接口先行，拆分随后（§10「交付」）。接口（S0–S4 加试点平台 bodian）做完就按当时最新的 main 切出 `edge` 分支，集成分支对 `edge` 开 PR，不等九家迁完；`edge` 走 Cielo（canary）滚动更新通道发布测试，观察一到两个发版周期、维护者确认稳定后合进 main，在那之前 main 继续维护 0.7.x。其余八家随后一家一个 PR；九家迁完之前 `folium: 2` 的音源接口标「预览」，内置的静态注册与音源模组并存 |
| 契约形状 | 开放的能力模型，播放分 `audio` / `external` / `surface` 三种且可再加 |
| 音源类模组 | 单独一类，网络、存储、签名、加载与卸载时序有自己的豁免（§5.2） |
| 单独停用 | 每个音源（含内置）可以单独停用：不加载、不起后端、界面里不出现，可一键清掉它的数据；安装包里的内置副本留在磁盘上（§5.3） |
| 默认启用 | 升级的用户九个全部保持启用；全新安装在开箱引导里勾选 |
| 只用于匹配 | 音源在启用和停用之间多一个状态：界面里不出现，只匿名参加歌词匹配和元数据匹配，后端用到时才启动。全新安装在开箱引导里没勾的网易云和 QQ 落到这个状态，不落到停用（§5.3） |
| 跨音源功能 | 联邦搜索、元数据匹配、歌词跨来源匹配在平台缺失时降级：能匿名就匿名，不能的记下缺失并隐藏（§7.1） |
| 合规预案 | 安装包可以不带某些或全部内置音源；这样的安装里，外部的音源模组经用户确认就能直接顶上那个音源的位置，不要求官方签名（§5.1） |

2.0 的范围只有音源外置。1.9 探索文档里的 B / C / D 组和「internals 清零」留给 2.x。

## 2. 对两份前期计划的查漏补缺

**改掉的结论**

| 前期计划的说法 | 最终决定 | 原因 |
| --- | --- | --- |
| main 入口也能注册 provider，宿主生成跨进程代理（v2-plan §3.2） | 只由 client 入口注册，main 入口当后端，经 `folium.rpc` 调用 | 契约里约 30 个同步成员在渲染热路径上被调用（`capabilities`、`getSongMetadata`、`playback.getAvailability(song)`、`externalPlayback.isStatusForSong` 在 500 ms 轮询里……），改成 IPC 不可行 |
| 每个音源要有独立安装产物和外部拉取地址（v2-plan 阶段 D） | 内置副本 + 官方签名覆盖 | 用户决定 |
| 模组接口分页用游标（1.9 文档 A4、开放问题 4） | 保持 offset | 九家内置和宿主所有调用方都是 offset；探索页已有自己的游标。token 分页的模组用 kit 里的换算函数 |
| 文字统一成 `FoliumLabel`（开放问题 3） | 公开契约收 `FoliumText`，适配层换成 i18next 的 key | 宿主界面全是 `t(key, params)`，不改界面 |
| 凭据经通用 secrets API 映射到旧位置 | 内置音源用 `api.legacy.store` + `api.seal`，各平台 `session.cjs` 原样搬 | 旧会话是主 `config.json` 里一个键存密文，带明文 V1 迁移和「解不开时保留旧值」的语义，`modSecrets` 的形状装不下 |
| 内置模组打进 app.asar | 放 `resources/builtin-mods/`（extraResources） | 依赖闭包要装成 `deps.asar`，asar 里不能再嵌 asar |

**两份计划都没提到、必须补的**

1. `folia-mods:rpc` 没有来源校验（`electron/modSystem/modSystem.cjs:691-708`），现有平台通道都有。凭据搬过去之前必须补上，否则是安全退化。
2. `loadAll` 每次启用、停用、安装都卸掉并重启**所有** main 入口（`modSystem.cjs:276-282,348`）。QQ 的后端包一个进程只能起一次，网易的没有关闭入口。必须改成差量重载。
3. 启动时的三处一次性逻辑会在音源晚注册时造成数据损失：选中的平台被永久改写成网易云（`providerAccountController.service.ts:313-334`）；队列里不可播的歌被滤掉并持久化（`useSessionRestoreController.ts:120-170`）；账号只在挂载时读一次（`useAccountReads.ts:32-36`）。
4. 导出窗口会把所有已加载模组的 client 再启动一遍（`src/mods/export/modExportPage.tsx:121`），音源模组不该在那里启动。
5. 依赖闭包超出模组上限：网易 4778 个文件 / 47.8 MB，QQ 2567 个文件；上限是 2000 条目、单文件 32 MB（`zipInstall.cjs:26-31`、`modDigest.cjs:17-20`）。
6. 网易云的会话在渲染进程的 localStorage 里、同步读写（`providerStorage.ts`），模组现有的 `folium.storage` 是异步 IPC。
7. `webRequest.onHeadersReceived` 每个 session 只能有一个监听器，媒体的跨域规则必须由宿主统一登记，模组不能各挂各的。
8. 歌词改成原始文本轨之后，现有的 `lyricsSource.ts` 会丢七处行为（见 §4.5）。
9. 实验接口 `platform.raw` 和权限 `platform.netease.read/write` 依赖网易云是内置的。
10. 94 个测试文件直接 import 平台目录，88 个依赖「模块加载时已注册」。
11. Vercel、Cloudflare、Docker 仍要从根依赖引三个 API 包，根 `dependencies` 不能删。
12. 条目种类开放和 `surface` 播放（这次新增的要求），两份计划都没有。
13. 音源类模组要有自己的一套豁免（网络、存储、签名、加载与卸载的时序）。两份计划都把音源当普通模组，只想着给它加权限；现有的限额（`net.fetch` 只有文本且上限 5 MB、数据文件 1 MB、密钥 8 KB、第一屏只等 1.5 秒、任一模组变动全部重启）没有一条适合音源。见 §5.2。
14. 单独停用音源。v2-plan 只说「支持零音源运行」，没说用户怎么关、关了以后占不占资源、数据怎么办；现在连内置的都关不掉。见 §5.3。
15. 跨音源功能的降级。本地歌匹配写死「网易云 → QQ → 酷狗」，歌词首选来源默认 `qq`，歌词来源表只有 `needsAccount`、`needsConfiguredProvider` 两个开关（`lyricSources.ts:43-51`、`useLyricMatchSources.ts`），都没考虑「这个平台根本不在」。音源能停用以后这是必然出现的情况。见 §7.1。

## 3. 架构

```text
界面 / hooks / stores
        │
      omni.ts（唯一入口，不变）
        │
  providerRegistry（去掉静态 import，加所有权与生命周期）
        │
  适配层 src/mods/folium/registries/sources.ts
  （能力定义 → 内部的 OnlineMusicProvider）
        │                          │
 folium.sources.register()     registerWebSources()
 （桌面：模组的 client 入口）      （网页版：宿主的 Web Provider）
        │                          │
 sources/<id>/client ───┐   src/services/onlineMusic/web/<id>.ts
        │               └────── 共用 sources/<id>/core（纯 TS）
   folium.rpc
        │
 sources/<id>/main（今天的 electron/<id>/，只用 api.*）
```

- 桌面上音源的渲染侧代码和 omni 在同一个进程里，同步成员照旧同步。
- 主进程侧代码仍在 Electron 主进程里 `require`，和今天一样；模组是可信代码不是沙箱，这一点不变。
- 第三方音源的 id 仍是 `folium.<modid>.<name>`。内置音源的短 id（`netease` 等）只能由宿主的受信表认领（唯一的例外是 §5.1 的合规预案）。

## 4. 稳定契约：`folium.sources`

契约放 `src/mods/folium/sources/`（不依赖 React、store、DOM、Electron），并入 `mods/folium.d.ts` 和 `docs/folium/api.md` 的生成。内部的 `src/types/onlineMusic.ts` 保持为宿主的内部形状，由适配层从公开契约映射过去；S0 的逐成员矩阵保证没有成员漏掉。

### 4.1 注册与能力模型

```js
folium.sources.register({
  id: 'radio', displayName: …, mark: { letter, color },
  itemKinds: { video: { lyrics: 'none' } },          // 可选，见 4.4
  capabilities: {
    'search@1': { searchSongs, searchAlbums, searchPlaylists },
    'playback.audio@1': { getAudioSource, audioQualityLevels, … },
    'lyrics@1': { getLyrics, … },
    'x.mymod.comments@1': { … },                      // 自定义能力
  },
});
```

- 标准能力 id：`search`、`songs`（按 id 取歌）、`playback.audio`、`playback.external`、`playback.surface`、`reports`、`lyrics`、`auth`、`library`、`catalog`、`recommendations`、`explore`、`mutations`、`covers`、`raw`。每个 id 带版本，各有一个类型化接口，成员与内部契约的对应子接口一一对应（S0 矩阵）。
- 宿主按「实现了哪些能力、其中哪些成员在」推导界面开关，取代手写的 `ProviderCapabilities` 布尔表。随账号或运行环境变化的（Spotify 的外部播放、YouTube Music 的音质档位）继续用 getter，模组调 `handle.changed()` 通知宿主重算。
- 协商：`folium.sources.supports(id, version)`。宿主不认识的标准能力在模组那一行报一次警告后忽略；清单 `sources[].requires` 里列的能力宿主没有时拒绝启用，不假装支持。
- 自定义能力（`x.<modid>.<name>@n`）宿主不解释，别的模组经 `folium.omni.capability(sourceId, id)` 取用。平台特有的界面用现成的扩展点（`homeTabs`、`playerPanelTabs`、`stageLayers`、命令）。
- 加一种新能力 = 加一个能力 id、一个接口、宿主的一处消费方，不动已有能力。内置和外部走同一个入口。

### 4.2 播放的三种方式

| 能力 | 含义 | 宿主路线 |
| --- | --- | --- |
| `playback.audio@1` | 给出地址，声音进宿主的音频图 | 现有的地址路线 |
| `playback.external@1` | 平台自己的播放器在应用外出声，宿主驱动并跟它的时钟 | 现有的 `external` 路线，成员即 `OnlineExternalPlaybackProvider` |
| `playback.surface@1` | 模组把自己的媒体画面（`<video>` 或 `ui.embed` 的嵌入页）挂进播放页上宿主托管的容器，宿主驱动并跟它的时钟 | 复用 `external` 路线，加 `mount(container, ctx)` |

`surface` 的实现（建在 `src/services/onlineMusic/externalPlayback.ts` 上，它本身不认识平台）：

- 路线值沿用 `'external'`，选路、传输、automix 闸门、预取与缓存跳过、均衡器提示、视频导出拒绝这些现成的分支原样生效。
- 新增常驻的 `SurfacePlaybackHost`，挂在 App 根、与 `app.overlay` 同级、层级在播放页之下，容器用现成的 `FoliumMountHost`（ShadowRoot）。不能挂在 `VisualizerBackdrop` 里：那一层是条件挂载的，卸载等于停播，iframe 被移动还会重载。
- `surface` 生效时播放页不画不透明背景（`VisualizerBackdrop.tsx:130` 已有 `renderBackground`），歌词和字幕照常压在画面上。
- 播放页不显示（首页、设置）时容器 `visibility: hidden`，声音继续；OBS、遥控、导出窗口没有画面。主窗口重建时容器随窗口销毁，新窗口按交接位置重新 `play(item, startSec)`。
- 2.0 只做声音不进宿主音频图的形态（`audio: 'own'`）：均衡器、频谱、automix、音频缓存、视频导出按 `external` 现有的规则停用。把同文档 `<video>` 接进音频图留作以后的 `playback.surface@2`。
- 一个音源可以同时有几种播放能力，由同步的 `routeOf?(item)` 按条目选；没有它时按实现的第一种。

### 4.3 歌曲 DTO

公开的 `FoliumSourceSong`：`id`、`title`、`artists[{ id, name, ref? }]`、`album?{ id, name, coverUrl?, ref? }`、`durationMs?`、`coverUrl?`、`aliases?`、`translatedTitles?`、`kind?`、`variant?`、`pureMusic?`、`video?`、`lyricIds?`（取代顶层的 `qqMid` / `kgHash`）、`row?{ id?, listenCount? }`、`replayGain?`、`data?`（即 `sourceRef.providerData`，只能是 JSON）。

- 平台自己的字段（网易云的 `fee`、`privilege`、`noCopyrightRcmd`、`resourceState`，酷狗和 QQ 的内部 id）进 `data`。
- 适配层双向转换：往宿主方向，认领旧 id 的三家继续写顶层的 `qqMid`、`kgHash` 等，直到宿主的读者（`lyricMatchSources.ts`、`autoMatchBestLyric.ts`、`onlineMetadataSearchService.ts`、`amllDbProvider.ts`）改读 `lyricIds`；往模组方向，把已持久化的旧歌的顶层字段折回 `data`。
- 歌手和专辑带真实 id 和目录引用，不再造 `<id>#artist0` 这种假 id。
- 「没有 `sourceRef` 的旧歌算网易云」（`appPlaybackGuards.ts:57-58`）是旧数据规则，留在宿主。

### 4.4 条目种类开放

- `SongResult` 加可选的 `itemKind?: string`，缺省是 `song`；`sourceRef` 仍是 `kind: 'online'`，歌曲键仍是 `online:<pid>:<mid>`，旧数据不用迁移，旧版本读到新字段会忽略。
- 音源在 `itemKinds` 里为每种声明特性（`lyrics: 'none' | 'own' | 'match'`、能不能喜欢、要不要上报）。宿主集中成一个 `itemTraits(song)`，歌词获取与跨源匹配、automix、缓存、听歌上报、队列行、红心都问它，不在各处散落判断。

### 4.5 歌词

所有音源都交原始文本轨（稳定的 `FoliumLyricsResult`），由宿主解析；解密（QRC、KRC）留在模组里。`src/mods/folium/lyricsSource.ts` 要补：

1. 按轨原样回传 `mainText` / `wordByWordText`（`chorusResolver.ts`、`onlinePlayback.ts`、`prefetchService.ts` 在读）。
2. 选中逐字轨时 `isWordByWord` 置 true。
3. 纯音乐标记和歌词可以并存（波点）。
4. 翻译轨和罗马音轨可以带自己的格式（汽水的翻译是 KRC）。
5. 平台轨直接走 `parseLyricsAsync(format, …)`，不走本地文件的预处理；加一个 `folia` 格式给飞牛。
6. 副歌由宿主的 `chorusResolver` 统一做，用测试核对与 QQ 现在的结果一致。
7. 保留 `context.userId`、`getChorusRanges`、`getSearchAlias`、`getAlternateArtistName`、`prefersOwnWordByWord`。

`krcDecrypt` 被宿主的本地文件解码用到（`lyricFileDecoding.ts:13`），挪到 kit。

### 4.6 文字、图标、错误、诊断

- 文字：清单加 `locales` 目录，宿主把它注册成 i18next 命名空间（`ponderText.ts` 已是这个做法）。公开契约的文字字段收 `FoliumText`：直接写的字符串、按语言的表，或 `folium.i18n.key('login.title', params)` 指向模组自己的语言表。适配层把三种都换成一个 key，宿主界面不改。zh-TW 由构建脚本用 `dev/i18n/traditionalLocalePlugin.mjs` 的转换生成。
- 图标：lucide 名字，或模组目录里的图片（`folia-mod://` 增加 `.svg/.png/.webp/.json`，带 `nosniff`）。登录方式的图标表（`loginMethodIcons.ts` 的构建时 glob）改成读它。
- 错误：`folium.sources.error(code, message, { httpStatus, retryAfterMs, cause })`，`code` 取内部的 `ProviderErrorCode`；保留 `describeFailure`、`describeLoginFailure`。
- 诊断：模组交 `{ label, value }`，宿主清洗后生成带标记的 `LoginDiagnosticLine`。
- 页面内的同步存储：`folium.sources.pageStore(sourceId)`，落在 localStorage 的 `online_provider:<id>:<key>` 上（就是 `providerStorage` 现在的键，内置三家不用改名）。

### 4.7 匿名可用性

跨音源功能（§7.1）要知道一个音源不登录能做什么。`search@1`、`songs@1`、`lyrics@1` 各带一个同步的 `access`：`'anonymous'`（不登录也能用，缺省）或 `'account'`（要登录）；随运行环境变的用 getter 加 `handle.changed()`。`lyrics@1` 另有 `crossSource?: { linesOnly?: boolean }`，声明自己可以给别的平台的歌和本地歌配歌词；`songs@1` 另有 `metadataMatch?: boolean`，声明可以给本地歌配在线信息。这三项取代歌词来源表里写死的 `needsAccount`、`needsConfiguredProvider`、`linesOnly`、`localMetadataIdentity`。

## 5. 模组运行时的改动

### 5.1 清单与信任层级

- `mod.json` 接受 `folium: 1` 和 `2`。只给 2 的新字段：`sources`（静态声明音源 id、名字、`requires`，不运行模组也能知道它提供什么）、`locales`、`assets`、`secrets`（不挂在设置字段上的密钥槽，上限提到 64 KB）、`contexts`、`native`。
- 新层级 `builtin`：来自 `resources/builtin-mods/`（开发时是 `dist-mods/`）。不受模组系统总开关影响，不弹确认，默认启用，可以单个停用（数据保留）；「这次不带模组启动」和窗口卡死询问都不把它算进去；不算内容摘要，用应用版本当版本记号；不带签名文件，也不验签名（§5.2 的签名一行）。
- 覆盖：`userData/mods` 里同 id 的副本要同时满足官方签名校验通过（`verified`，不含先行测试）、版本更高、`folia` 范围满足、用户确认过一次，才替代内置副本；否则继续跑内置的，并在模组面板写明原因。签名只贴标签这条不变量保留。
- 受信表 `electron/modSystem/builtinSources.cjs`：模组 id → 认领的短音源 id、旧 electron-store 键、旧 session 分区、旧 userData 目录。只对内置副本和验签通过的覆盖副本生效。存储键一个都不改名，降级回旧版本登录还在。
- 无内置副本时的接管（合规预案）：以后如果因为合规要求，安装包不能再带某个或全部内置音源，同一份宿主照样能用外部安装的音源模组，不用为此另改宿主代码。
  - **安装包自己声明带了哪些。** 构建时把随包的内置音源 id 写进 app.asar 里 `package.json` 的 `foliaBundledSources`（和现有的 `foliaReleaseChannel` 同一个做法，`main.cjs:4098`）。声明里没有的 id，这个安装就是「不带」它，才走下面的接管。声明里有、`resources/builtin-mods/` 里却找不到的，算安装损坏：报错，不放行外部副本。没有这个字段的安装包读作九个全带。
  - **不带的音源由外部模组直接顶上。** `userData/mods` 里的音源类模组在清单的 `sources[].claims` 里写明它要接的短音源 id、旧 electron-store 键、旧 session 分区、旧 userData 目录，内容和受信表里那一行相同。接管时 `claims` 必须是受信表那一行的子集：要接的 id 得在受信表里，键、分区、目录不能超出那一行（维护者 2026-11-15 定：以清单写的为准的话，九个全带的正常安装里第三方模组也能认领别家的旧登录、清掉别家的目录）。不带这个音源的安装包如果连受信表里那一行也不带，现在一律拒绝接管；那种情况下怎么核对清单写的 `claims`（不能碰别家的旧键，也不能碰宿主自己的键和目录），在 S8 做不带内置音源的打包形态时定。它要接的 id 这个安装不带时，不算覆盖：不要求官方签名，也不要求版本更高。它按第三方模组的规矩启用（模组系统总开关、启用确认、内容摘要变了重新确认）；确认窗口另加一段，逐项列出它要接管的音源 id 和上面那些旧数据，写明它会用上你在这个平台已有的登录。确认之后它认领短 id，队列、历史、歌单里 `online:<id>:…` 的歌和旧登录都接着用。
  - **签名在这里仍然只贴标签。** 官方认证、先行测试、无签名的都能接管，确认窗口照实写。签名不匹配的（签过之后内容被改过）不让接管，只能当普通的第三方音源，用它自己的 `folium.<modid>.<name>`。
  - **一个 id 只给一个模组。** 两个模组要接同一个 id 时，先确认的那个拿到；后一个在模组面板写明原因，由用户在「设置 → 音源」里换。
  - **安装包又带回来时。** 换成带这个音源的安装包后，内置副本优先；外部副本回到上面「覆盖」那一条的规矩，官方签名、版本更高才替代，否则不加载并写明原因。两边用的是同一批旧键，来回切换登录都在。
  - **界面。** 不带的音源，宿主界面里不出现它的名字。零音源的空状态和「设置 → 音源」各给一个「安装音源模组」的入口，走现有的 zip 安装；`npm run sources:pack <id>` 出的 zip 就是能这样装的包。

### 5.2 音源类模组的豁免

清单里声明了 `sources` 的 `folium: 2` 模组是**音源类模组**，和普通模组分开对待。普通模组的权限和限额是按「给界面加点东西」定的，音源要保管登录、整天发请求、比界面先起来、比别的模组晚走，套那一套行不通。豁免按类别给，内置和第三方的音源都有；信任上的三件事（总开关、启用确认、不带模组启动）不属于豁免，仍然只有 `builtin` 层级免。签名那一行两种都有：不带签名、不验签只给内置副本，第三方的音源是不要求签名，带了照旧验。

| 方面 | 普通模组（不变） | 音源类模组 |
| --- | --- | --- |
| 网络 | 要声明 `net.fetch`；Node `fetch`；只有文本；回答上限 5 MB；时限 15 秒（最多 60 秒）；没有 cookie 和分区 | 不用声明。client 的 `folium.net.fetch` 和 main 的 `api.net.*` 走 Electron `net`：二进制、流式、不设回答上限、时限由模组自己定、可用自己的命名分区、媒体规则和 `_media` 流。音源自己发出的请求不算进 `folium.omni` / `platform.raw` 那份每模组每分钟 120 次、同时 8 个的额度（那是给调用音源的模组定的） |
| 存储 | 要声明 `filesystem.data`；一个 1 MB 的数据文件；密钥只能是设置字段、每个 8 KB | 不用声明。同步的 `folium.sources.pageStore`；清单 `secrets` 声明的密钥槽，每个 64 KB；`api.storage` 的上限提到 16 MB；`api.cache.dir()` 并入宿主的缓存预算和清理。内置音源另有受信表里认领的旧键（§5.1） |
| 签名 | 带签名文件的模组每次加载都对整个目录算签名摘要并验签（最多 2000 个文件、合计 64 MB，超了算验不了）；结果只贴标签：官方认证、先行测试、无签名、不匹配；仓库 `mods/` 里的示范模组必须带有效签名，改了要重签 | 内置副本不带 `folium.sig.json`，加载时不算签名摘要、不验签，面板里标「内置」，不标「无签名」：它随安装包分发，来源由安装包保证，和 app.asar 里的宿主代码一样。`sources/` 的源码和 `dist-mods/` 的构建产物都不签，改了不用重签，也不进 `sampleMods.test.ts` 的签名检查。第三方的音源类模组不要求签名：没有签名照样能启用、照样拿到本表其余各行的豁免；带了签名的照旧验过贴标签。只有一处仍然要签名：`userData/mods` 里的副本要覆盖内置副本，必须官方签名校验通过（§5.1）。安装包不带这个音源时不算覆盖，走 §5.1 的合规预案，不要求签名 |
| 加载时序 | 按依赖顺序逐个启动；每个 5 秒算慢；第一屏对所有模组合计只等 1.5 秒；main 入口在建窗口之后启动 | 自成一组、排在所有普通模组之前：main 入口在建窗口之前并行启动，client 并行启动；第一屏单独等这一组（上限 3 秒），过了时限的继续启动，回来后选中的平台、队列里的歌、保留的账号自动恢复。普通模组不用写 `depends`，启动时音源已经在了 |
| 卸载与重载 | 任何一个模组启用、停用、安装都会让全部 main 入口重启；停用立刻卸载 | 只有它自己变了才重载，别的模组变动和窗口重建都不碰它的 main 入口。卸载排在所有普通模组之后；卸载之前宿主先停掉它名下正在放的歌（外部播放器和 `surface` 先交还），再等它的 `api.onBeforeUnload`（最多 3 秒）收尾；退出应用时等 `api.onBeforeQuit` |
| 开销与出错 | 每次调用计时，慢了在面板里标「慢」；出错提示用户 | 渲染热路径上的同步成员不计时，只包一层 try/catch：抛错时回这个成员的保守答复、记一行日志，不读时钟、不写 store（维护者 2026-11-15 定：不接住的话，一个第三方音源抛错就会冒到界面渲染里，整个主窗口白屏）。音源方法失败照旧是平常结果（只记一行、不提示），失败的含义由 `describeFailure` 说 |
| 导出窗口 | client 照常启动 | 不启动 |

第三方的音源类模组启用时，确认窗口多写一段：它提供哪些音源、会保管你在这些平台的登录、不受网络和存储限额约束、随应用一起启动。模组面板里这一类单独分组，标「音源」。

`folium:check` 对音源类模组不再因为没声明 `net.fetch`、`filesystem.data` 报错；普通模组想拿这些豁免而去声明一个空的 `sources`，清单校验拒绝（`sources` 里每一项必须在 client 里真的注册，启动完还没注册的在模组那一行报错并撤销豁免）。

### 5.3 单独停用一个音源

每个音源类模组（内置的也一样）都能单独停用，停用的音源不占任何运行时资源：

- **不加载**：main 入口不 `require`（没有后端进程、worker、本机端口、分区、内存），client 不导入，语言表不注册，媒体规则和 `_media` 路由不登记。差量重载保证开关一个音源不碰别的音源。
- **界面里不出现**：音源切换器、登录窗口、搜索来源、歌词来源、本地歌匹配的平台按钮、命令面板里它的命令都没有它这一行。它在队列、历史、歌单里的歌留着，标「音源未启用」，重新启用后恢复；选中的是它时按 §7 第一行处理。
- **数据**：停用不动数据。音源那一行另有「清除数据」：登出并删掉它的会话（受信表里认领的旧键和分区、`secrets`、`pageStore`）、`online_provider_<id>_*` 缓存、`api.cache.dir()` 和模组数据目录，列出要删什么、确认后执行。清除是单独的动作，和停用、卸载覆盖副本分开。
- **磁盘**：安装包里的内置副本留着（约定如此）；停用内置音源时，`userData/mods` 里它的覆盖副本一并不加载，可以单独删掉。
- **入口**：「设置 → 音源」新页面（用 `src/components/modal/settings/kit/` 的控件），每个音源一行：开关、状态、占用（数据与缓存）、清除数据。它不受模组系统总开关影响；模组面板里的音源分组指向这里。开关同时进命令面板（`settings-feature-integration`）。
- **默认值**：启用状态存在主进程的 `mod-system` store 里，内置音源没有记录时读作启用，所以升级的用户九个全开。全新安装的开箱引导加一步勾选音源，没勾的写成停用，清单里标了 `keepForMatching` 的内置音源（网易云、QQ）没勾时写成「只用于匹配」；用 `?skipStartup` 跳过引导时全开。
- **网页版**：同一个开关表对 `registerWebSources()` 生效，停用的不注册。

**只用于匹配。** 歌词匹配和元数据匹配绝大多数时候靠网易云和 QQ：元数据匹配只有网易云、QQ、酷狗参加，不登录就能配歌词的平台也是这三家，AMLL 库又要靠这两家的歌曲 id。所以音源在启用和停用之间多一个状态，让不用这两家听歌的人也留着匹配：

- **谁能用这个状态**：声明了 `lyrics@1.crossSource` 或 `songs@1.metadataMatch`、并且对应能力是 `access: 'anonymous'` 的音源（§4.7）。别的音源只有启用和停用两种。
- **界面里不出现**：音源切换器、登录窗口、搜索来源、首页、探索页、命令面板里它的命令都没有它。它只出现在歌词来源（歌词设置的首选来源、匹配窗口的页签）和本地歌匹配的平台按钮里。它在队列、历史、歌单里的歌和停用时一样，标「音源未启用」。
- **只做匿名的匹配**：只参加歌词跨来源匹配和元数据匹配（含 AMLL 库要的按平台搜出歌曲 id），不参加联邦搜索；一律按没登录对待，不读、不显示它的账号。已有的登录数据原样留着，切回启用后还在。
- **后端用到时才启动**：client 照常启动并注册（所以歌词来源的名字、封面规则都在），main 入口不在启动时 `require`，推迟到它的 client 第一次调 `folium.rpc` 时才启动，之后留到应用退出或状态再变。没发生过匹配就没有后端进程、worker、本机端口。
- **默认值**：升级的用户九个全开，不受影响。全新安装的开箱引导里，用户勾的是「我用哪些平台」；没勾的里面，清单标了 `sources[].keepForMatching` 的内置音源（网易云、QQ）落到这个状态，旁边写一句它的用途，其余落到停用。`keepForMatching` 只对内置副本生效，宿主自己不写平台 id。
- **入口**：「设置 → 音源」里能用这个状态的音源那一行是三选一（启用、只用于匹配、停用），其余是开关。三种状态之间切换都不需要重启。
- **合规预案**（§5.1）下经确认接管的外部音源模组同样可以设成只用于匹配；安装包不带、用户也没装的平台，匹配就没有它。
- **网页版**：同一个状态表，只用于匹配的照常 `registerWebSources()`、界面里不出现。

停用和启用都不需要重启应用。主进程里已经 `require` 过的上游包留在进程内存里直到退出这一点做不到完全干净：QQ 的后端包一个进程只能起一次，所以「停用后再启用 QQ」要求它的 main 入口支持重新启动（依赖放在 `deps.asar` 里时 `purgeModuleCache` 按目录清缓存即可），迁 QQ 时用测试钉住。

### 5.4 要改的函数

| 位置 | 改动 |
| --- | --- |
| `discovery.cjs:20-35` | 加内置目录，每个目录带 `tier`；`:94-101` 内置与用户副本同 id 时都留下 |
| `manifest.cjs:199-228` | 新字段；`folium` 接受 1 和 2；有 `sources` 的记为音源类 |
| `foliumShared.json` | 版本 2.0；音源类的限额表（网络、存储、时限）和普通模组的并列放在这里，主进程和渲染进程读同一份 |
| `modApi.cjs:15-18,173-188` | 权限闸门和 1 MB 上限按类别取 |
| `netFetch.cjs:32-34` | 音源类不查 `net.fetch` 权限，换成 Electron `net` 的实现 |
| `modSecrets.cjs:14-20,35` | 清单声明的密钥槽不用等 client 登记设置分区；上限按类别取 |
| `src/mods/folium/omni/requestQuota.ts` | 额度只记调用方，不记音源自己 |
| `src/mods/runtime/guard.ts:148-155` | 音源的同步成员不经 `timeFoliumMod` |
| `nodeEntry.cjs:183-191`、`modSystem.cjs:276-282` | 卸载顺序：普通模组先、音源后；音源卸载前的停播与 `onBeforeUnload` |
| `approval.cjs:248-279` | `builtin` 默认启用，不绑摘要 |
| `modSystem.cjs:289-335` `planMods` | 内置跳过摘要和验签（`:312` 的 `verifyModSignature`）；覆盖规则 |
| `modSystem.cjs:82-88` `publicSignatureState`、`approval.cjs:287-307` | 签名状态加一种「内置」，面板按它显示；启用确认窗口对第三方音源类模组照旧写签名那一行 |
| `discovery.cjs:94-101`、`modSystem.cjs:289-335`、`main.cjs:4098` 旁 | 短 id 的归属按顺序定：内置副本，验签通过的覆盖副本，安装包不带这个音源时经确认接管的外部副本（§5.1 的合规预案）；读 `package.json` 的 `foliaBundledSources`，声明里有而目录缺失的报安装损坏 |
| `approval.cjs:287-307`、`manifest.cjs:199-228` | 清单的 `sources[].claims`；接管的确认窗口多一段，列出音源 id 和要接的旧数据；签名不匹配的不让接管 |
| `modSystem.cjs:348` | `unloadAll()` 改成差量：目录、摘要、启用状态都没变的保留 |
| `modSystem.cjs:349-353,381-386,471-501,831` | 总开关、不带模组启动、启用确认、`hasRunningMods` 都只管非内置 |
| `modSystem.cjs:411-431` | 内置先启动、并行 |
| `nodeEntry.cjs:157-176`、`modSystem.cjs:411-431`、`mod-system` store | 音源的状态是三种：启用、只用于匹配、停用（§5.3）。只用于匹配的音源 client 照常启动，main 入口推迟到它的 client 第一次调 rpc 时才启动；清单的 `sources[].keepForMatching` |
| `modSystem.cjs:691-708` | 所有处理器加主窗口来源校验 |
| `nodeEntry.cjs:157-176` | 暴露 ready：异步 activate 没注册完时 client 的 rpc 等它，不再答 `rpc-not-found` |
| `modProtocol.cjs:98-128` | 静态资源扩展名；`/_media/<name>` 路由到模组登记的流处理器，支持 Range |
| `clientLoader.ts:236-244` | 内置一组并行，第三方仍按序；导出 `builtinSourcesSettled`；音源模组在 `export` 上下文不启动 |
| `mainWindowStart.ts:67-90`、`bootstrap.tsx:40,98-103` | 第一屏先等内置组（单独上限 3 秒），再给第三方 1.5 秒；网页版改调 `registerWebSources()` |
| `main.cjs:6635-6645` | `createModSystem` 提到建窗口之前，内置 main 入口并行启动，取代 `:6467-6468` 的两个后端启动 |

内置 client 约定在 `activate` 的第一个 `await` 之前就 `register`，用测试钉住。

### 5.5 main 入口的 `api` 新成员

九家主进程代码用到的设施归并后的最小集合。除了标「内置」的两行，其余只要是音源类模组就能用（§5.2），普通模组没有：

| 成员 | 用途 | 谁在用 |
| --- | --- | --- |
| `api.legacy.store`、`api.paths.legacy(name)`（内置） | 受信表里认领的 electron-store 键和 userData 目录 | kugou、qq、bodian、qishui、ytm、spotify、fnmusic、appleMusic |
| `api.seal` | safeStorage 封装 | 同上 |
| `api.secrets`（清单声明的键） | 第三方音源的会话 | 第三方 |
| `api.cache.dir()` / `requestPrune()` | 并入宿主缓存预算的目录 | spotify |
| `api.net.fetch`、`api.net.session(name)`、`api.net.resolveProxy` | Electron `net`、二进制、指定分区、不带 cookie | bodian、qishui、ytm、spotify |
| `api.media.allow(…)`、`api.media.serve(name, handler)` | 媒体请求头与跨域规则（带有效期、跟随重定向）；`folia-mod://<id>/_media/…` 流，取代三个特权协议 | kugou、qq、bodian、qishui、ytm、spotify、fnmusic |
| 清单声明的证书例外、歌词中继域名 | 启用确认窗口里列出 | kugou、qq |
| `api.windows.hidden()`、`api.shell.openExternal`、`api.dialog.pickFile`、`api.host.locale` | 沙箱窗口、浏览器登录、选文件、语言 | ytm、spotify |
| `api.onBeforeUnload`、`api.onBeforeQuit`、`api.onPlayersOrphaned` | 卸载前、退出前收尾；主窗口没了时暂停外部播放器 | ytm、spotify、appleMusic |
| `api.diagnostics.register(…)` | 后端状态、诊断、自检的域名；宿主补系统代理和网络记录 | netease、qq |
| `api.native.load(name)` / `path(name)` | 留在应用里的原生件 | spotify、appleMusic |

worker、子进程、本机 HTTP 服务用 Node 自带的。迁完后 `main.cjs` 里的平台块全部删掉（`:158-205, 367-449, 3850-3929, 5054-5100, 5419-5427, 6430-6432, 6702-6720, 7378-7463`），`preload.cjs:172-198` 的平台通道和 `vite-env.d.ts` 里对应的类型一起删。

## 6. 仓库内的音源模组

### 6.1 目录与边界

```text
sources/<id>/
  mod.json  package.json  README.md（接原 UPSTREAMS.md 里这一家的内容）
  core/     纯 TS，只有 netease / kugou / qq 有：createSource(env)
  client/   activate(folium)；原 src/services/onlineMusic/<id>/
  main/     activate(api)；原 electron/<id>/
  locales/  zh-CN / en / in / vi
  assets/
packages/folium-source-kit/   纯 TS 的共用函数（exploreReads、listeningRank、fmModes、
                              登录与请求限流、krcDecrypt、offset 与 token 的换算）
```

- 新的 Dedicatus 规则：`sources/**` 不得 import `src/**`、`electron/**`；宿主只有 `src/services/onlineMusic/web/*` 可以 import `sources/*/core`。`sources/` 只对着 `mods/folium.d.ts` 和 kit 编译。
- `AGENTS.md` 里「平台的目录名就是 `providerRegistry.ts` 登记的 id」改成 `sources/<id>/`。
- 测试仍放 `test/unit/`，路径随搬移批量改。

### 6.2 构建与打包

- 新脚本 `dev/sources/build.mjs`，用 rolldown（已随 Vite 8 在 `node_modules` 里，提成显式 devDependency；仓库里没有 esbuild）。
  - client：打成单个 `client.mjs`。
  - main：打成 `index.cjs`（网易云多一个 `worker.cjs`），npm 依赖按下表处理。
  - 语言表生成 zh-TW，产物放 `dist-mods/<id>/`。
- 依赖：

  | 平台 | 做法 |
  | --- | --- |
  | netease、qq、kugou | 生产依赖闭包装进模组目录里的 `deps.asar`，入口用 `createRequire` 取。三个上游库都依赖真实的文件布局（改 `require.cache`、扫 `module/` 目录、按包内路径挂钩子），不能打进 bundle |
  | bodian、qishui | 直接打进 `index.cjs` |
  | ytm | 三个 ESM-only 的包打成一个 `vendor.mjs` |
  | spotify | librespot 原生件留在应用里（现有 `asarUnpack`），经 `api.native.load` 引用；`ws` 打进 bundle |
  | appleMusic | 伴侣程序留在 `resources/apple-music`，经 `api.native.path` 引用 |
  | fnmusic | 无依赖 |

- 打包：`package.json` 的 `extraResources` 把 `dist-mods/` 放到 `resources/builtin-mods/`；`files` 加排除规则，不让那几个上游包再进一份 app.asar。根 `dependencies` 保留（Vercel、Cloudflare 的 QQ 入口还在用）。随包带哪些内置音源由构建参数 `FOLIA_BUNDLED_SOURCES` 决定（缺省九个全带，可以给一个子集，也可以给空）：它同时决定 `extraResources` 里放哪些、`foliaBundledSources` 写什么、受信表带哪几行、app.asar 的排除规则。不带的音源，安装包里没有它的任何代码和名字（§5.1 的合规预案）。
- 官方签名的覆盖包单文件上限提到 64 MB、总量 96 MB（网易云的 `deps.asar` 约 48 MB）。新增 `npm run sources:pack <id>` 出 zip，签名仍走 folium-compound 的 `tools/sign.mjs`。
- 原生件随应用走，覆盖副本用 `folia` 版本范围锁住宿主。
- 开发：`dev:electron` 同时以 watch 方式跑 `dev/sources/build.mjs`；改了文件 → 产物指纹变 → 现成的 client 重载机制只重载那一个。

**动手前先验证**：模组目录里的 `deps.asar` 能被 `createRequire` 和 Worker 正常读取（Electron 对磁盘上任意 `.asar` 路径的支持），做一个最小样例。

## 7. 宿主去硬编码

| 位置 | 改成 |
| --- | --- |
| `omni.ts:153-159`、`accountRules.ts:48-53`、`providerAccountController.service.ts:313-334` | 选中的音源不在时只在内存里回落，不写回；回来后自动恢复（与歌词样式的缺失条目规则一致）；零音源走空状态，不抛错 |
| `useSessionRestoreController.ts:83-170` | 等 `builtinSourcesSettled` 再恢复；音源不在的歌留在队列里标为不可播，不滤掉 |
| `useAccountReads.ts:32-36` | 订阅 `omni.subscribeProviders`，对新出现的平台补一次启动读取 |
| `DEFAULT_ONLINE_PROVIDER_ID`、`useSearchNavigationStore.ts`、`searchCommands.ts:106` | 没有默认平台；搜索命令按已注册的音源生成 |
| `utils/lyrics/lyricSources.ts`、`lyricMatchSources.ts` 的 `OWN_ACCESS` | 歌词来源注册表（稳定）：音源模组自己登记来源，`LyricProviderSource` 改成开放字符串，已存的取值不变；来源不在时按缺失条目处理 |
| `utils/coverUrl.ts`、`coverCache.ts` | 能力 `covers@1`：必填的 `hosts`，加同步的 `sized(url, size)`、`identity(url)`；宿主只拿 `hosts` 里那些主机上的封面地址去问它，每次给一份 URL 的副本（维护者 2026-11-15 定：不限主机的话它是全局规则，能看到别的来源带凭据的封面地址、改到共用的 URL 对象）；宿主只留通用规则 |
| `onlineMetadataSearchService.ts`、`LocalSongMetadataMatchDialog.tsx`、`localMusicService.ts:1429-1490` | 按「声明能做本地歌匹配的音源」生成，顺序取注册表 |
| `App.tsx` 的 `useNeteaseLibrary`、`homeSources.ts:59` | 删，走账号层 |
| `folia_netease_scrobble`、`settingsCommands.ts:158-164` | 宿主的通用「听歌上报」设置，按音源 id 存，网易云读旧键 |
| `electron/stageApi.cjs` | 搜索和按 id 取歌改问渲染进程的 omni；成功时线上格式不变。不带 provider 的搜索失败时回通用的三条错误码（主窗口不在、平台拒绝、超时），原来的 `NETEASE_API_UNAVAILABLE`、`NETEASE_SEARCH_FAILED` 不再出现；它用的是 Folia 里网易云的会话，不再是主进程的匿名搜索 |
| `electron/loginBackendIpc.cjs`、`networkRecorder.cjs` | 并入 `api.diagnostics` |
| `folium/platformRaw.ts`、权限 `platform.netease.*` | 改经认领该 id 的音源的 `raw@1` 能力转发，1.x 模组无感 |
| 四份语言文件里各约 190 个平台自己的 key | 搬进各音源的 `locales/` |
| `src/assets/providers/*.svg` | 搬进 `sources/qq/assets/` |

### 7.1 跨音源功能的降级

三个功能会去问「不是这首歌自己的平台」：联邦搜索（搜索页的多个来源）、元数据匹配（给本地歌和 Navidrome 的歌配在线信息）、歌词跨来源匹配（自动匹配和手动匹配窗口，含 AMLL 库按网易云 / QQ 的 id 查）。音源能停用、也可能没登录，所以每一处都按同一条规则走，规则只写一遍：

新模块 `src/services/onlineMusic/crossSource.ts`：`participants(feature)` 回 `{ ready, skipped }`。对每个声明了这项能力的音源，按顺序判：

| 音源此刻的状态 | 怎么办 |
| --- | --- |
| 启用着，这项能力 `access: 'anonymous'` | 直接用，不管登没登录 |
| 启用着，`access: 'account'`，已登录 | 用 |
| 启用着，`access: 'account'`，没登录 | 跳过，原因 `needs-account` |
| 启用着，`getAvailability()` 说没配好或运行环境不可用 | 跳过，原因照它说的 |
| 只用于匹配（§5.3），功能是歌词匹配或元数据匹配，这项能力 `access: 'anonymous'` | 用，走匿名通道，不读它的账号 |
| 只用于匹配，其余情况（联邦搜索，或这项能力要账号） | 跳过，原因 `matching-only` |
| 没启用、没装、启动失败 | 跳过，原因 `not-enabled` |

- **隐藏**：`skipped` 里的音源在搜索来源、匹配窗口的页签、歌词首选来源的选项、本地歌匹配的平台按钮里都不出现，不画成禁用的一行。
- **记下缺失**：每个功能每次运行对每个被跳过的音源记一行日志（`[crossSource] lyrics: qq skipped (not-enabled)`）。界面上只在用户的选择因此落空时说一句，说清是哪个来源、为什么、去哪里开（例如歌词设置里「首选来源 QQ 音乐未启用，现在按下一个来源匹配」，带一个跳到「设置 → 音源」的入口）；自动流程里静默跳过。
- **存着的选择不改写**：歌词首选来源（默认 `qq`）、每首歌匹配到的歌词来源、本地歌的 `onlineMetadata.source` 都保留原值；来源不在时生效的是顺序里下一个 `ready` 的，来源回来后自动用回它。已经缓存下来的歌词和元数据照常显示，只是不再去重新取。
- **顺序**：没有写死的平台顺序。自动歌词匹配按用户的来源优先级。元数据匹配按声明了 `metadataMatch` 的音源的登记顺序，不跟歌词来源优先级：九家都在时就是 2.0 之前的「网易云 → QQ → 酷狗」（首选歌词来源默认是 QQ，跟着它排会把这个顺序改掉）。其余按注册顺序。
- **依赖别家 id 的步骤**：AMLL 库按网易云 / QQ 的歌曲 id 查。歌自己带着这个 id（`lyricIds`）就直接查；要靠去那个平台搜出 id 的，那个平台被跳过时这一步跳过，不算失败。
- **一个都没有**：`ready` 为空时功能入口本身隐藏（搜索页只剩当前音源，匹配按钮不出现），不弹错。本地歌的信息匹配窗口例外：它还管恢复本地信息、标记纯音乐、选封面，入口留着，只是页签为空、不发搜索。
- 匿名调用用音源自己的匿名通道（网易云的匿名 cookie、酷狗的设备标识），宿主不替它造身份。

涉及的调用方：`components/app/search/searchSources.ts`、`onlineMetadataSearchService.ts`、`LocalSongMetadataMatchDialog.tsx`、`localMusicService.ts:1429-1490`、`utils/lyrics/lyricMatchSources.ts`、`autoMatchBestLyric.ts`、`hooks/useLyricMatchSources.ts`、`sourcePriority.ts`、`providers/amllDbProvider.ts`、`navidromeSongMatch.ts`、`useLibraryPlaybackController.ts:1000-1041`、`electron/stageApi.cjs` 的搜索。

## 8. 网页版

- 网页构建不加载模组、不调 `activate`。`registerWebSources()` 用宿主的 `src/services/onlineMusic/web/<id>.ts` 注册 netease、kugou、qq 三家，经同一个适配层。
- 这三家区分桌面与网页的代码只在传输层和歌词代理（约 40 处判断，Provider 本身各 1 处），所以抽 `sources/<id>/core`：`createSource(env)`，`env` 注入传输、同步页面存储、文字、歌词代理、诊断。桌面的 client 注入 `folium.rpc` 和 `folium.sources.pageStore`；网页的 adapter 注入 `VITE_*_API_BASE` 的 HTTP 传输和 `providerStorage`。不留两份分叉的实现。
- 其余六家在网页版不存在（现在是「运行环境不可用」的一行，以后是没有这一行）。
- 合规预案（§5.1）对网页版同样生效：`registerWebSources()` 只注册构建参数 `FOLIA_BUNDLED_SOURCES` 里有的，没有的那一家连 `sources/<id>/core` 都不打进包。网页版没有模组运行时，不带的音源在网页版就是没有。
- `api-ts/`、`worker/`、`deploy/docker/` 不动。

## 9. Folium 1 兼容

- `folium: 1` 的模组照旧加载，接口冻结在 1.9，internals 和旧名字照旧标废弃；`deprecated/` 里「Folium 2 删除」的那份清单改期到以后的 major。
- 实验接口 `omni.providers` 改成新注册表上的一层薄壳，行为不变；文档里指向 `folium.sources`。
- `mods/README.md` 改写成 Folium 2 规范，去掉「2.0 前不要做完整音源模组」那段；新增 `docs/folium/sources.md`（开发指南、能力一览、旧简化音源的迁移）。
- 示范模组：`dev/folium/sample-source-full`（覆盖每个能力族的契约测试音源）、`dev/folium/sample-video-source`（`playback.surface`）。

## 10. 实施阶段

S0–S4 与试点平台（bodian）在集成分支 `folium-2`（从 main 切，单独的工作树）上做，做完就交付到 `edge`，不等九家迁完。

**交付**（维护者 2026-11-14 定：接口先行，拆分随后）

- **第一步，接口进 `edge`**：S0–S4 加 bodian 做完、下面「进 `edge` 之前」补齐后，在 main 上按当时最新的 main 切出 `edge` 分支，集成分支对 `edge` 开 PR（目标是 `edge`，不是 main）。波点一起走：它的提交里夹着契约补充与测试夹具的改动，切不干净；带着它也正好验证安装包里内置模组这条路。这一步的验收是 §11 里不依赖九家迁完的条目（单测、启动、音源类的豁免、打包）加波点一家的桌面实测。
- **进 `edge` 之前**：打包版实测（Windows 安装包，macOS、Linux 的 CI 构建）；波点用真实账号在大陆网络下实测（维护者 2026-11-14 已测：可以播放，其它功能正常）；`dev/folium/folium-2-member-matrix.md` §4 的归属由维护者确认（2026-11-14 已确认）；对整个分支做一次完整审查；加上「预览」标记（见第二步）。
- **发布**：`edge` 发布到 Cielo（canary）的滚动更新通道（`.github/workflows/canary-pre-release.yml` 的 `rolling`）。同时改这个 workflow 里的 release note 模板，写明四件事：这个版本用于 Folium 2 的发布测试；普通用户可以下载；反馈问题要打上 `folium2` 标签；建议模组作者都下载这个版本测试自己的模组。
- **滚动版只由 `edge` 发**（维护者 2026-11-15 定）：滚动版固定发到 tag `cielo`，main 和 `edge` 都发的话 Cielo 用户会在两版之间来回升级。workflow 的 `ROLLING_BRANCH` 限定只有 `edge` 能发滚动版，别的分支的 rolling 自动降成分支版；main 上的这个文件也要有同样的改动。`edge` 合进 main 之后把它改回 main。
- **第二步，接口进 main**：`edge` 在 Cielo 上观察一到两个发版周期，维护者确认稳定后合进 main；在那之前 main 继续维护 0.7.x。`folium: 2` 的音源接口（`folium.sources` 与 main 入口给音源的 `api`）在 `docs/folium/` 和模组面板里标「预览」，写明九家内置音源迁完之前可能变动；`folium: 1` 冻结在 1.9 的承诺不变。
- **第三步，拆分**：其余八家（下面迁移顺序的 2–9）和 S6–S8 在接口合进 main 之后做，一家一个 PR。这些 PR 的目标是 main 还是继续走 `edge`，由维护者在接口合并之后定。期间内置的静态注册与音源模组并存（运行时已经支持）。九家迁完、S8 做完后去掉「预览」标记。
- **main 到 `edge` 的同步**：定期把 main 上的改动同步进 `edge`，由维护者手动触发，不自动做。

**合并纪律**：搬目录的提交只做 `git mv`、单独成组；平台文件正文尽量不动，只改接缝；每周把 main 合进来一次（`merge.renameLimit` 调大，`-X find-renames=30%`）。期间 main 上冻结：`src/types/onlineMusic.ts` 的签名、`providerRegistry.ts`、`main.cjs` 的平台块、`preload.cjs` 的平台通道、平台目录的增删文件；平台内部修 bug 照常。

| 阶段 | 内容 | 门槛 |
| --- | --- | --- |
| S0 基线 | 把本方案存为 `dev/folium/folium-2-plan.md`；生成逐成员矩阵「内部成员 → 调用方 → 公开能力 → 测试」；`deps.asar` 最小样例 | 矩阵里没有未归类的成员 |
| S1 宿主容错与去硬编码 | §7 全部，含 §7.1 的 `crossSource`（这一步先用现有的静态注册表喂它） | 九个都在时行为不变；零音源能启动；测试里逐个拿掉平台，三个跨音源功能都不报错 |
| S2 运行时 | §5：来源校验、差量重载、层级、音源类的豁免、单独停用与只用于匹配、无内置副本时的接管、协议、清单 v2、`api` 新成员 | 现有模组测试全过；内置目录为空时行为不变；普通模组的限额一条没松 |
| S3 契约与适配层 | §4；`registries/sources.ts`；`omni.providers` 薄壳；生成器；`folium:check` 的音源检查 | `sample-source-full` 不改宿主就能覆盖每个能力族 |
| S4 构建与测试夹具 | §6；kit；`test/unit/helpers/builtinSources.ts`（挂进 `vitest.config.ts` 的 `setupFiles`，用测试 `env` 调各家 `createSource` 并注册）；CI 规则改指向 | 构建产物能在开发版里以 `builtin` 加载 |
| S5 迁移九家 | 顺序见下；每家一组提交：纯搬移 → Core 接缝（三家）→ client → main → 语言表 → 删 `main.cjs` / `preload.cjs` / `vite-env.d.ts` 里对应的块。bodian 随接口交付，其余八家在接口合进 main 之后一家一个 PR（见上「交付」） | 每家迁完桌面实测通过 |
| S6 `surface` | §4.2、§4.4；`sample-video-source` | 示范模组能在播放页放视频，切歌、暂停、跳转、窗口重建正常 |
| S7 网页版 | §8 | 网页构建不含 Electron 与模组加载器，三家可用 |
| S8 收尾 | 「设置 → 音源」页面与开箱引导的勾选（含只用于匹配的三选一和引导里的默认落点）；覆盖机制与上限；不带内置音源的打包形态（`FOLIA_BUNDLED_SOURCES`）；删 `providerRegistry.ts` 的静态 import；文档；`AGENTS.md`；去掉音源接口的「预览」标记（见上「交付」） | §11 全部通过 |

**迁移顺序与各自逼出的宿主设施**

| 序 | 平台 | 逼出来的 |
| --- | --- | --- |
| 1 | bodian（试点） | 适配层、rpc、`legacy.store` + `seal`、`net`、媒体规则、语言命名空间、歌词轨补充、测试夹具。它引用的宿主模块最少，主进程只有 176 行，却覆盖登录、曲库、歌单改动和媒体跨域 |
| 2 | qishui | FM 模式、探索页、诊断的 kit；翻译轨格式 |
| 3 | fnmusic | `_media` 流、登录表单 |
| 4 | kugou | 第一个 `deps.asar`、第一个 Core、证书例外、歌词中继、凭据写入点登记 |
| 5 | qq | 进程内服务、状态推送、诊断与自检、歌词来源注册 |
| 6 | netease | worker、去掉默认平台、`stageApi`、听歌上报设置、`raw@1` |
| 7 | ytm | 命名分区、隐藏窗口、浏览器登录、退出前收尾、带 Range 的流 |
| 8 | appleMusic | 原生路径、外部播放、孤儿暂停、窗口交接、打包脚本改路径 |
| 9 | spotify | 原生加载、缓存目录与共享清理、回环 OAuth、`keepAudio` |

**CI 要改指向的**：`dev/dedicatus/rules.mjs`（D110 加 `sources/**`，加新边界规则）、`providerRegistration.test.ts`（D122 改读 `sources/*/mod.json`）、`omniArchitecture.test.ts` 与 `platformNamePlaces.ts`、`credentialWriters.mjs`（D604）、`ipcChannels.mjs`（D605，删九个通道并改正 `folia-mods:rpc` 那条的说法）、`storageKeys.mjs`（D507）、`authMembers.test.ts`（换成从矩阵生成的一致性测试）、`providerName.test.ts`、`traditionalMainProcessText.test.ts`。`sampleMods.test.ts` 只扫 `mods/`，`sources/` 不受签名要求影响，另加一个内置清单校验测试。

实现按 `development-workflow` 走：每组提交自检，S 阶段结束时派独立子代理审查。

## 11. 验收

- **契约等价**：矩阵加类型检查；内置和外部对同一个操作给出同样的身份、结果、错误。歌词用录下来的平台答复做快照对比（旧路径的 `LyricData` 对新路径）。
- **单测**：`NODE_OPTIONS=--no-experimental-webstorage npm run test:unit`、`npm run typecheck`、`npm run dedicatus`、`npm run lint`、`npm run folium:check dev/folium/sample-source-full`。
- **启动**：音源晚到、被停用、零音源三种情况下，选中的平台、队列、保留账号都不丢（单测加桌面实测）。
- **桌面实测**（`run-desktop` skill，隔离 profile）：每家登录、搜索、播放、歌词、歌单、退出登录；从 0.7.x 的 profile 升级后登录还在，再降级回去也还在；停用和重新启用一个音源时其它音源的后端不重启。
- **外部播放与 `surface`**：暂停、恢复、跳转、自然结束、单曲循环、窗口重建、进程退出；不重复切歌、不双重出声。
- **音源类的豁免**：`sample-source-full` 不声明 `net.fetch`、`filesystem.data` 也能发二进制请求、存超过 1 MB 的数据；启用、停用一个普通模组时它的 main 入口不重启；停用它时正在放的歌先停、`onBeforeUnload` 被等到；普通模组照旧被 5 MB、1 MB、权限闸门拦住。内置音源的目录里没有 `folium.sig.json` 也照常加载，面板里标「内置」；`sample-source-full` 不带签名能启用、能拿到上面的豁免。
- **单独停用**：逐个停用九个内置音源，每次确认它的后端进程、worker、本机端口都没有了（主进程里求值检查），切换器、登录窗口、搜索来源、歌词来源里没有它，别的音源没有重启；队列里它的歌标「音源未启用」，重新启用后能放；「清除数据」之后重新启用是未登录状态；升级来的 profile 九个全开，全新 profile 按引导里勾的来。
- **只用于匹配**：把网易云和 QQ 设成只用于匹配。切换器、登录窗口、搜索来源、首页、命令面板里都没有它们；没登录的情况下给本地歌配歌词、配在线信息能成功，AMLL 库按 id 查能成功；匹配发生之前主进程里没有它们的后端（主进程里求值确认），第一次匹配之后才有；它们在队列里的歌标「音源未启用」；切回启用后原来的登录还在；联邦搜索里没有它们。全新 profile 在引导里一个都不勾时，网易云和 QQ 是只用于匹配，其余七个是停用；升级来的 profile 九个全开。`crossSource` 的单测覆盖新增的两种状态。
- **跨音源降级**：`crossSource` 的单测覆盖表里五种状态；桌面上停用 QQ 后，歌词首选来源仍存着 `qq`、匹配落到下一个来源、设置里说明了原因，重新启用后用回 QQ；停用网易云、QQ、酷狗后本地歌信息匹配窗口的页签为空、不发搜索（入口留着）；九家都在时元数据匹配的顺序是网易云、QQ、酷狗；只留一个不登录的网易云时联邦搜索和歌词匹配走匿名成功。
- **覆盖**：干净的安装版上放一个官方签名的更高版本，确认后生效；未签名、版本更低、`folia` 范围不符的都继续跑内置副本。
- **合规预案**：用 `FOLIA_BUNDLED_SOURCES` 出两个安装包，一个九个都不带，一个只不带 QQ。前一个启动是零音源的空状态，安装包里搜不到任何平台的代码和名字；装上 `sources:pack` 出的未签名 zip 并确认之后，音源以短 id 出现，从九个全带的旧版本升级来的 profile 里登录还在、队列里的歌能放。后一个其余八家照常，QQ 由外部副本接管。声明里有而目录被删掉的，报安装损坏、不放行外部副本；签名不匹配的不让接管；两个模组抢同一个 id 时只有先确认的拿到；换回九个全带的安装包后，未签名的外部副本不再加载，登录还在。
- **打包**：按 `local-windows-installer-build` 的做法出 Windows 安装包，确认 `resources/builtin-mods/` 齐全、app.asar 里没有重复的上游包。
- **网页版**：`npm run build` 后三家可用，包里没有 Electron 和模组加载器的代码。
- **版本组合**：`folium: 1` 的现有示范模组和 `test/fixtures/folium-1.5-mods/` 照旧通过。

Windows 以外的系统、Apple Music 的 DRM、Spotify Soloist 以对应系统上的真实运行为准；没有实测的写进交付报告，不统称通过。

## 12. 风险

1. **长分支合并**：`main.cjs` 八千多行、平台代码约 1.7 万行都还在变。靠 §10 的合并纪律和冻结清单控制。
2. **启动回退**：§7 前三行任何一处漏掉都会改掉用户的选择或丢队列，S1 必须先做完并有测试。
3. **旧会话存储**：各平台 `session.cjs` 原样搬，不重写。
4. **依赖打包**：`deps.asar` 的做法要先过最小样例；网易云的摘要计算会整文件同步读入，内置跳过摘要和差量重载是前提。
5. **`builtin` 按目录给信任**：按用户安装时该目录可写，和 app.asar 现在的处境相同，不比现状差；内置副本不签名、不验签靠的也是这一条。覆盖副本必须验签加确认。
6. **豁免是按清单声明给的**：第三方模组声明 `sources` 就拿到不限额的网络和存储。模组本来就是可信代码、权限不是安全边界，这没有改变信任模型；靠启用确认窗口写明、空声明被拒、上架审查来约束。
7. **同步成员跨模组边界**：热路径上不计时，只有一层 try/catch 接住抛错、回保守答复（§5.2）；模组 bundle 里不能自带第二份 i18n 或 zustand，用宿主注入的。
8. **视频站**：Electron 不带 Widevine，带 DRM 的站点在嵌入页里放不了；嵌入页不可见时可能自己暂停。写进 `surface` 的文档。
9. **合规预案放宽了「短 id 只归受信表」**：安装包不带某个音源时，未签名的外部模组经确认就能拿到那个音源的旧登录。放宽的条件是安装包自己的声明，它在 app.asar 里，和宿主代码同等可信；九个全带的正常安装包里这条路走不通。模组本来就是可信代码，确认窗口逐项写明它接管什么。预案只管模组这一层：根 `dependencies` 里给 Vercel、Cloudflare、Docker 用的三个 API 包，`api-ts/`、`worker/`、`deploy/docker/` 里的平台入口，都不在它的范围内，真到那一步要另行处理。
10. **只用于匹配靠的是匿名通道**：平台对匿名请求限流或收紧时，匹配会变差或失效，和现在不登录的用户处境相同；这个状态不替用户登录，也不借用已有的登录。后端推迟到第一次匹配才启动，所以那一次匹配会慢一些（网易云要起工作线程、QQ 要起进程内服务）。

## 13. 未验证、动手时要先确认的

- `deps.asar` 在模组目录里被 `createRequire` 和 Worker 读取（S0 的最小样例）。
  - **S0 结果（2026-11-13）：四项前提都通过。** 样例是 `test/manual/folium2DepsAsarProbe.cjs`，在仓库根目录跑 `node test/manual/folium2DepsAsarProbe.cjs`；这次是 Electron 43.7.5 / Node 24.21.0 / win32-x64，退出码 0。样例包用 `@electron/asar` 打成 `deps.asar`，有 9 个文件、三层目录：入口相对 `require` 别的文件、用 `readdirSync` 扫 `module/` 目录再逐个 `require`、用 `readFileSync` 读一个 JSON、再 `require` 里一层 `node_modules` 的包。检查在 Electron 主进程里做，不开窗口，用隔离的 `--user-data-dir`。
    1. `createRequire(<模组目录>/deps.asar/node_modules/_)` 加载这个包：**通过**。输出：`加载自 deps.asar\node_modules\folium-probe-dep\index.js；require.cache 里这个目录下 5 条`。
    2. 从 asar 里面的路径起 `worker_threads` 的 Worker：**通过**。输出：`Worker 入口 deps.asar\node_modules\folium-probe-dep\worker.js，回答 sum=5 modules={"alpha":"alpha","beta":"beta:42"}`；`workerData` 也传到了。
    3. 模组目录在应用目录之外（系统临时目录里的 `userData/mods/probe`）：**通过**。第 1、2、4 项在这个位置的输出和在应用目录里面那一遍相同。
    4. 清掉 `require.cache` 里这个目录前缀的条目之后重新加载：**通过**。输出：`清掉 5 条后重新加载，得到新实例`。清之前再 `require` 一次拿到的是同一个实例。
  - 样例顺带验了三件不在前提里的事：
    - **通过**：Worker 的入口在磁盘上（模组目录里的 `worker.cjs`），在线程里用 `createRequire` 读 asar 里的依赖。§6.2 给网易云设想的 `worker.cjs` 是这种形态。
    - **不通过：`deps.asar` 在原路径被换成新内容之后重新加载。** 把它换成文件布局不同的新归档，清掉 `require.cache` 再加载，抛 `Unexpected string`。原因是 Electron 按路径把归档的文件表缓存到进程结束，读新文件时用的还是旧的偏移。同一份新内容换一个文件名（`deps.v2.asar`）就能读到。受影响的有三种情况：应用开着时升级覆盖副本（§5.1）、开发时 watch 重建了依赖（§6.2）、停用到再启用之间依赖换了版本（§5.3）。**建议**：归档的文件名带上内容指纹（例如 `deps.<hash>.asar`，由 `index.cjs` 或 `mod.json` 指过去），内容变了路径就跟着变；覆盖副本原地升级这种做不到换名的场合，提示重启后生效。文件没变时清缓存重载没有问题，就是上面第 4 项。
    - **主进程里打过补丁的 `fs` 读不了 `deps.asar` 这个文件本身。** `fs.statSync` 说它是目录；`fs.readFileSync(<模组目录>/deps.asar)` 和以它为源的 `fs.copyFileSync` 抛 `ENOENT`；用 `readdirSync` 列模组目录时它仍然是文件。`electron/modSystem/modDigest.cjs:81` 算摘要时对列到的每个文件做 `fs.readFileSync`，遇到 `deps.asar` 会抛错；安装、复制、算占用的代码同理。**建议**：模组系统里读写模组目录文件的代码（`modDigest.cjs`、`modSignature.cjs`、`zipInstall.cjs`、`modFiles.cjs`、`discovery.cjs`）在 S2 改用 `original-fs`，并加一条模组目录里带 `.asar` 文件的测试。
  - 运行时 Electron 打印一行 `[DEP0180] DeprecationWarning: fs.Stats constructor is deprecated`，出自它自己的 asar 包装层，不影响结果。
  - **没有验证到的**：打包后的安装版（宿主代码在 `app.asar` 里、内置模组在 `resources/builtin-mods/`）；macOS 和 Linux；三个真实的上游库（它们改 `require.cache`、按包内路径挂钩子）放进 asar 之后的行为，样例包只模拟了「扫 `module/` 目录」这一种。
- `adoptExternalPlayback` 在音源没有实现 `adopt` 时是否干净地落到重新播放（`surface` 依赖这一点）。
  - **S0 结论（2026-11-13，读代码得出，没有运行）：过程是干净的，但落到的是「停在原位置、暂停」，不是重新播放。**
  - 音源没有 `adopt` 本身不出问题。`omni.adoptExternalPlayback`（`src/services/onlineMusic/omni.ts:1135-1137`）用可选链调它，没有就什么都不做。接手的判断在 `src/services/onlineMusic/externalPlayback.ts:595-647`，不靠这个成员：它问一次 `getStatus`，再用 `isStatusForSong` 看播放器里是不是这首歌。Spotify 现在就是有 `externalPlayback`、没有 `adopt` 的内置音源；它的播放器（Soloist）活过窗口重建，状态对得上，接手照常完成。
  - 播放器里不是这首歌、或者 `getStatus` 抛错时，`adoptExternalPlayback` 回 `false`，路线退回 `web`。调用方（`src/components/app/playback/restore/useElectronWindowPlaybackHandoff.ts:386-401`）接着调 `releaseUnclaimedExternalTrack` 把播放器暂停（暂停失败只记日志，`externalPlayback.ts:726-733`），把播放状态设成暂停、不自动播放。歌留在原来的位置，用户按播放时由正常的播放路径从那个位置开始（`restorePlaybackSource.ts:382-399`）。全程不抛错，不会双重出声。
  - 所以 §4.2 说的「新窗口按交接位置重新 `play(item, startSec)`」现有代码做不到。`surface` 的容器随窗口销毁，新窗口里一定走到「没有可接手的」这一支，结果是暂停。**建议**：S6 在这一支加一段，只对 `surface` 路线生效：交接快照说当时在播、接手回了 `false`，就按交接位置调一次 `play`；`external` 路线（Spotify、Apple Music）保持现在的暂停，免得和还在出声的外部播放器抢。另外 `surface` 的 `getStatus` 在没有挂载任何东西时要回「没有曲目」（`mediaId` 为空）而不是抛错，这样日志里不会每次重建都多一条警告。
- 各平台依赖闭包的文件数和体积是按当前 `node_modules` 量的，换版本后重量。
