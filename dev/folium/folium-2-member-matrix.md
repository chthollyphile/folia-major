# Folium 2.0 逐成员矩阵（S0）

> 方案：`dev/folium/folium-2-plan.md`。这份矩阵是方案 §10 里 S0 的产物：内部契约 `src/types/onlineMusic.ts` 的每个成员一行，写明它同步还是异步、宿主在哪里读它、九个内置音源里谁实现了它、归到方案 §4.1 的哪个公开能力、现有的测试在哪。
>
> 代码位置：分支 `claude/dazzling-chatelet-b5feef`，HEAD `202efe16c`。它比方案的基线 `cb484ffdf` 多两个提交（`01d90ccd5`、`202efe16c`），这两个提交没有动 `src/types/onlineMusic.ts`、`src/services/onlineMusic/`、`src/mods/`、`src/utils/lyrics/`、`electron/`，所以表里这些文件的行号对基线同样成立。它们改过 70 个别的文件（`src/App.tsx`、播放队列、资料库界面等），附录 A、B 里这些宿主调用方的行号以 HEAD 为准。

## 0. 这份表怎么来的、怎么读

每一列都从代码取，没有照抄方案：

- **成员清单**：`src/types/onlineMusic.ts` 里 `OnlineMusicProvider`、十三个子接口、`LoginLocalService` 和 `ProviderCapabilities` 的每个成员，括号里是它在契约文件里的行号。
- **宿主读它的地方**：用 tsgo 语言服务（`dev/mcp/ts-code-map/lsp/client.mjs`）对每个成员取全部语义引用，再按引用所在的文件分开：落在 `omni.ts` 里的写成 omni 的方法名（括号里是 `omni.ts` 的行号；引用在文件级的辅助函数里时，顺着辅助函数找到用它的 omni 方法，写「经 某函数」）；落在平台目录里的算实现；落在别处的原样列出文件和行号。语言服务看不到「按名字取成员」的写法，这样的有两处，手工补进了表（`providerRegistry.ts:85` 的 `askProviderCache`，和第 3 节的 `providerSupports(provider, '名字')`）。
- **内置实现**：九家注册之后，在 Vitest 里列出每个子对象运行时的键（和 `test/unit/onlineMusic/authMembers.test.ts` 同一个办法）。九家的 Provider 对象都没有按运行环境增减成员的写法，所以这份清单对桌面和网页版相同。「getter」表示这个成员是取值函数，值随账号或运行环境变。
- **公开能力**：方案 §4.1 的能力 id。方案写明了的照方案；方案没写明、这里给了建议的带 ※，理由都在第 4 节。
- **直接引用它的测试**：语义引用落在 `test/` 和 `dev/probes/`（组件测试用的假音源）里的文件，`×` 后面是处数；超过四个文件的在附录 C 列全。只经 omni 间接测到它的测试，按 omni 方法列在附录 A。

记号：

- `omni.xxx`：经 omni 的这个方法读到。调用这个方法的宿主代码在附录 A。
- 〔omni 组装〕：位置在 `src/services/onlineMusic/account/accountRead.ts`。它不在 `omni.ts` 里，但只由 omni 建出来（`omni.ts:471`），入口是 `omni.readAccount`、`omni.signOutAccount`、`omni.refreshProviderPlaylists`、`omni.accountMoment`，算经 omni。
- ⚠：绕过 omni，直接从注册表拿 Provider 来读。这些函数的调用方在附录 B。
- 「模组适配层也给」：实验接口 `omni.providers` 的适配层（`src/mods/folium/registries/omniProviders.ts:61-141`）给模组音源造的 Provider 里也有这个成员。

生成这份表用的脚本是一次性的，没有入库。

## 1. 统计与归类总览

契约一共 **165 行**：

| 部分 | 行数 | 其中同步 |
| --- | --- | --- |
| `OnlineMusicProvider` 顶层成员（不含子接口槽位） | 13 | 13（6 个属性、7 个同步方法） |
| 顶层的子接口槽位（`search`、`playback` 等） | 13 | — |
| 十三个子接口的成员 | 111 | 31（10 个属性、21 个同步方法），另有 1 个可同步可异步 |
| `LoginLocalService`（`auth.localService` 指向的对象） | 3 | 2 |
| `ProviderCapabilities` 的开关 | 25 | 25 |

不算开关和槽位，同步方法 30 个、同步属性 16 个、异步方法 80 个、可同步可异步 1 个（`auth.signInRanOut`）。方案 §2 说的「约 30 个同步成员」指的是这 30 个同步方法。

归类结果（没有未归类的成员）：

| 归到 | 成员数 | 说明 |
| --- | --- | --- |
| 注册字段 | 7 | `id`、`displayName`、`mark` 是方案 §4.1 写明的；`describeFailure` 是 §4.6 说保留的；`shortName`、`shortNameKey`、`getAvailability` 方案的注册示例里没有，※ |
| 宿主推导 | 1 + 25 | `capabilities` 和它的 25 个开关；其中 2 个推导不出来（第 3 节） |
| `search@1` | 3 | |
| `songs@1` | 7 | `playback` 里按 id 取歌的 3 个；`playback.getAvailability`、`getReplacement`、`getPlayedSong` 和顶层的 `getSongPageUrl` 是 ※ |
| 歌曲 DTO | 1 | `songMetadata.getSongMetadata`，※ |
| `playback.audio@1` | 5 | |
| `playback.external@1` | 12 | |
| `reports@1` | 2 | |
| `lyrics@1` | 5 | |
| `auth@1` | 29 | `auth` 的 26 个加 `localService` 的 3 个 |
| `library@1` | 8 | |
| `catalog@1` | 12 | |
| `recommendations@1` | 14 | |
| `explore@1` | 3 | |
| `mutations@1` | 8 | |
| `raw@1` | 6 | |
| 不进公开契约 | 4 | `watch`、`normalizeSong`、`normalizeUser`、`normalizeCollection`，归不进任何能力，建议见第 4 节 |
| 子接口槽位 | 13 | 各自对应上面的能力 |

方案 §4.1 的能力清单里，`covers@1` 和 `playback.surface@1` 在现在的契约里没有对应的成员：前者的规则现在写在宿主的 `src/utils/coverUrl.ts`、`coverCache.ts` 里，后者是新增的。§4.7 的 `access`、`crossSource`、`metadataMatch`，§4.4 的 `itemKinds`，§4.2 的 `routeOf` 同样是新增的声明，契约里没有前身。

## 2. 逐成员表

### 2.1 `OnlineMusicProvider` 顶层

13 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `id`（1150） | 同步属性·必有 | `omni.getRecommendationPreferences`（169，经 unsupportedPreferences）<br>`omni.saveRecommendationPreferences`（169,1031，经 unsupportedPreferences）<br>`omni.pressSongLike`（332,1511,1515，经 sendSongLike）<br>`omni.getProviderSummaries`（534,536）<br>`omni.getHomeFeed`（938）<br>`omni.setDailyStyle`（995）<br>`omni.playSongExternally`（1128）<br>`omni.pauseExternalPlayback`（1151）<br>`omni.resumeExternalPlayback`（1157）<br>`omni.seekExternalPlayback`（1163）<br>`omni.getExternalPlaybackStatus`（1184）<br>`omni.getAudioSource`（1207）<br>`omni.reportPlayback`（1283）<br>`omni.getLyrics`（1291,1293,1296）<br>`omni.dislikeSong`（1600）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:179,185,256,265,276,290,302`（keptAccount、askWho、failed、readWhole）<br>⚠ `src/services/onlineMusic/providerRegistry.ts:30`（registerOnlineMusicProvider；注册表自己的函数） | 全部九家；模组适配层也给 | 注册字段 `id` | `unit/login/loginModuleKnowsNoPlatform.test.ts`×7<br>`unit/ytm/ytmUltra.test.ts`×5<br>`unit/login/loginDiagnosticReport.test.ts`×3<br>`unit/login/loginView.test.ts`×3<br>等 30 个文件 46 处（附录 C） |
| `displayName`（1151） | 同步属性·必有 | `omni.getProviderSummaries`（537,538）<br>`omni.getProviderLabel`（597） | 全部九家；模组适配层也给 | 注册字段 `displayName` | `unit/onlineMusic/providerRegistry.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`dev/probes/collectionGrid.probe.tsx`×1<br>等 21 个文件 22 处（附录 C） |
| `shortName`（1152） | 同步属性·可选 | `omni.getProviderSummaries`（538）<br>`omni.getProviderLabel`（597） | 全部九家；模组适配层也给 | 注册字段 ※ | `dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/library/app/useLibraryAccountController.test.ts`×1 |
| `shortNameKey`（1154） | 同步属性·可选 | `omni.getProviderSummaries`（539） | 除 appleMusic 外的 8 家（8/9） | 注册字段（`FoliumText`）※ | 没有直接引用它的测试 |
| `mark`（1155） | 同步属性·可选 | `omni.getProviderMark`（652） | 全部九家 | 注册字段 `mark` | 没有直接引用它的测试 |
| `getAvailability`（1156） | 同步·可选 | `omni.getProviderSummaries`（540）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:304`（readWhole）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:69`（isLyricMatchSourceOffered；直接用注册表） | 全部九家 | 注册字段 ※ | `unit/fnmusic/fnmusicProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/onlineMusic/accountRead.test.ts`×1<br>等 6 个文件 7 处（附录 C） |
| `watch`（1162） | 同步·可选 | `omni.watchProviders`（663） | netease（1/9） | 不进契约 ※ | `unit/onlineMusic/providerWatch.test.ts`×1 |
| `describeFailure`（1168） | 同步·可选 | `omni.playSongExternally`（229，经 runRequest）<br>`omni.prepareExternalPlaybackQueue`（229，经 runRequest）<br>`omni.pauseExternalPlayback`（229，经 runRequest）<br>`omni.resumeExternalPlayback`（229，经 runRequest）<br>`omni.seekExternalPlayback`（229，经 runRequest）<br>`omni.setExternalPlaybackVolume`（229，经 runRequest）<br>`omni.setExternalPlaybackRepeatOne`（229，经 runRequest）<br>`omni.getExternalPlaybackStatus`（229，经 runRequest）<br>`omni.getAudioSource`（229，经 runRequest）<br>`omni.getSongReplacement`（229，经 runRequest）<br>`omni.getCollectionTracks`（229，经 runRequest） | 除 fnmusic 外的 8 家（8/9） | 注册字段（§4.6 保留） | `unit/onlineMusic/kugouProvider.test.ts`×4<br>`unit/onlineMusic/omni.test.ts`×2<br>`unit/qishui/failure.test.ts`×1 |
| `capabilities`（1169） | 同步属性·必有 | `omni.getProviderSummaries`（541）<br>`omni.getActiveCapabilities`（584）<br>`omni.getProviderCapabilities`（588）<br>⚠ `src/services/onlineMusic/providerRegistry.ts:66`（providerSupports；注册表自己的函数） | 全部九家；模组适配层也给 | 宿主推导（见第 3 节） | `unit/onlineMusic/omni.test.ts`×22<br>`unit/mod-system/foliumExperimental.test.ts`×6<br>`unit/onlineMusic/qqProvider.test.ts`×6<br>`dev/probes/libraryBehavior/fakeProviders.ts`×3<br>等 28 个文件 67 处（附录 C） |
| `normalizeSong`（1170） | 同步·必有 | 宿主不读 | 全部九家；模组适配层也给 | 不进契约 ※ | `unit/onlineMusic/providerRegistry.test.ts`×4<br>`unit/spotify/spotifyRecommendations.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>等 23 个文件 27 处（附录 C） |
| `normalizeUser`（1171） | 同步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:192`（keptAccount） | 全部九家 | 不进契约 ※ | `unit/onlineMusic/accountRead.test.ts`×1 |
| `normalizeCollection`（1172） | 同步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:196,199`（keptAccount） | 除 fnmusic 外的 8 家（8/9） | 不进契约 ※ | `unit/onlineMusic/neteaseProvider.test.ts`×2<br>`unit/onlineMusic/accountRead.test.ts`×1<br>`unit/onlineMusic/neteaseExplore.test.ts`×1 |
| `getSongPageUrl`（1174） | 同步·可选 | `omni.getSongPageUrl`（1632）<br>⚠ `src/services/onlineMusic/songMetadata.ts:50`（getProviderSongPageUrl；直接用注册表） | netease、qq、qishui（3/9） | `songs@1` ※ | `unit/onlineMusic/qqProvider.test.ts`×2 |

### 2.2 顶层的子接口槽位

13 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `songMetadata`（1173） | 同步属性·可选 | ⚠ `src/services/onlineMusic/songMetadata.ts:27`（getProviderSongMetadata；直接用注册表） | 除 appleMusic、fnmusic 外的 7 家（7/9） | 歌曲 DTO（§4.3） | `unit/onlineMusic/kugouProvider.test.ts`×1 |
| `search`（1175） | 同步属性·可选 | `omni.searchSongs`（604,605）<br>`omni.searchProviderSongs`（616,617）<br>`omni.getProviderSearchKinds`（624,625）<br>`omni.searchProviderCollections`（642）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:126`（platformAccess；直接用注册表）<br>⚠ `src/services/localMusicService.ts:1429`（matchLyrics；直接用注册表，写死 netease） | 全部九家；模组适配层也给 | `search@1` | `unit/onlineMusic/kugouProvider.test.ts`×13<br>`unit/spotify/spotifyProvider.test.ts`×7<br>`unit/lyrics/autoMatchBestLyric.test.ts`×4<br>`unit/onlineMusic/neteaseProvider.test.ts`×4<br>等 19 个文件 52 处（附录 C） |
| `playback`（1176） | 同步属性·可选 | `omni.resolveAudioQuality`（109，经 audioQualityLevelsOf）<br>`omni.getAudioSource`（109,1210,1230，经 audioQualityLevelsOf）<br>`omni.getAudioQualityLevels`（109，经 audioQualityLevelsOf）<br>`omni.getSongDetail`（1066）<br>`omni.getSongDetails`（1082）<br>`omni.canPlaySong`（1116）<br>`omni.previewNoticeKey`（1257）<br>`omni.getSongAvailability`（1326）<br>`omni.getSongReplacement`（1333）<br>⚠ `src/services/onlineMusic/providerRegistry.ts:78,85,99`（keepsOwnSongAudio、askProviderCache、canPlayOnlineMusicSong；注册表自己的函数）<br>⚠ `src/services/onlineMusic/songAvailability.ts:16,42,51`（getSongAvailability、getSongReplacement、askPlayedSong；直接用注册表） | 除 appleMusic 外的 8 家（8/9）；模组适配层也给 | `songs@1` + `playback.audio@1` | `unit/onlineMusic/qqProvider.test.ts`×45<br>`unit/onlineMusic/kugouProvider.test.ts`×20<br>`unit/onlineMusic/neteaseProvider.test.ts`×18<br>`unit/onlineMusic/omni.test.ts`×13<br>等 16 个文件 128 处（附录 C） |
| `externalPlayback`（1178） | 同步属性·可选 | `omni.canPlaySong`（1116）<br>`omni.playSongExternally`（1127,1130）<br>`omni.adoptExternalPlayback`（1136）<br>`omni.isExternalPlaybackPrepared`（1140）<br>`omni.prepareExternalPlaybackQueue`（1145,1146）<br>`omni.pauseExternalPlayback`（1151,1152）<br>`omni.resumeExternalPlayback`（1157,1158）<br>`omni.seekExternalPlayback`（1163,1164）<br>`omni.setExternalPlaybackVolume`（1170,1171）<br>`omni.setExternalPlaybackRepeatOne`（1177）<br>`omni.getExternalPlaybackStatus`（1184,1185）<br>`omni.isExternalPlaybackStatusForSong`（1189）<br>⚠ `src/services/onlineMusic/providerRegistry.ts:100,106`（canPlayOnlineMusicSong、canPlaySongExternally；注册表自己的函数） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×13<br>`unit/appleMusic/appleMusicRadio.test.ts`×5<br>`unit/appleMusic/appleMusicAvailability.test.ts`×2<br>`unit/appleMusic/appleMusicLibrarySongs.test.ts`×2 |
| `playbackReports`（1179） | 同步属性·可选 | `omni.canReportPlayback`（1277,1278）<br>`omni.reportPlayback`（1283,1284） | netease（1/9） | `reports@1` | `unit/onlineMusic/neteaseProvider.test.ts`×6<br>`unit/onlineMusic/omni.test.ts`×2 |
| `lyrics`（1180） | 同步属性·可选 | `omni.getLyrics`（1291,1294）<br>`omni.getChorusRanges`（1306）<br>`omni.prefersOwnWordByWordLyrics`（1312）<br>`omni.getLyricSearchAlias`（1317）<br>`omni.getAlternateArtistName`（1322）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:111,127`（fetchAmllDbCandidateLyrics、platformAccess；直接用注册表）<br>⚠ `src/utils/lyrics/autoMatchBestLyric.ts:33,443,496`（getProviderChorusRanges、matchUnderArtist、autoMatchBestLyric；直接用注册表）<br>⚠ `src/services/localMusicService.ts:1473`（matchLyrics；直接用注册表，写死 netease） | 全部九家；模组适配层也给 | `lyrics@1` | `unit/ytm/ytmProvider.test.ts`×8<br>`unit/onlineMusic/kugouProvider.test.ts`×5<br>`unit/appleMusic/appleMusicProvider.test.ts`×3<br>`unit/lyrics/autoMatchBestLyric.test.ts`×3<br>等 14 个文件 40 处（附录 C） |
| `auth`（1181） | 同步属性·可选 | `omni.getLoginTexts`（657）<br>`omni.getLoginLocalService`（669）<br>`omni.getLoginMethods`（674）<br>`omni.resolveLoginMethods`（678）<br>`omni.getLoginForm`（686）<br>`omni.submitLoginForm`（691）<br>`omni.startLogin`（699）<br>`omni.confirmsLoginInBrowser`（709）<br>`omni.opensLoginPageItself`（715）<br>`omni.openLoginPage`（719）<br>`omni.checkLogin`（725）<br>`omni.cancelLogin`（732）<br>`omni.getLoginDiagnostics`（738）<br>`omni.canRunLoginSelfCheck`（747）<br>`omni.runLoginSelfCheck`（751）<br>`omni.checksAfterLogin`（756）<br>`omni.checkAfterLogin`（761）<br>`omni.hasSetup`（766）<br>`omni.getSetup`（770）<br>`omni.runSetupAction`（774）<br>`omni.getLoginTtlMs`（781）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:180,259,276,305,312,508,513,534`（keptAccount、askWho、readWhole、readAtHome、signOut） | 全部九家 | `auth@1` | `unit/onlineMusic/qqProvider.test.ts`×40<br>`unit/onlineMusic/neteaseProvider.test.ts`×16<br>`unit/ytm/ytmProvider.test.ts`×11<br>`unit/onlineMusic/kugouProvider.test.ts`×9<br>等 22 个文件 130 处（附录 C） |
| `library`（1182） | 同步属性·可选 | `omni.isSongLiked`（195，经 likeSourceOf）<br>`omni.pressSongLike`（195，经 likeSourceOf）<br>`omni.endLikedListRead`（195,438，经 likeSourceOf/likedChecks）<br>`omni.songsInPlay`（195,438，经 likeSourceOf/likedChecks）<br>`omni.accountMoment`（438,491，经 likedChecks/accountMoments）<br>`omni.addSongsToPlaylist`（438，经 likedChecks）<br>`omni.readAccount`（438，经 likedChecks）<br>`omni.signOutAccount`（438，经 likedChecks）<br>`omni.refreshProviderPlaylists`（438，经 likedChecks）<br>`omni.getUserPlaylists`（786）<br>`omni.getUserAlbums`（900）<br>`omni.getLikedSongIds`（905）<br>`omni.getProviderLikedSongIds`（909）<br>`omni.getCloudCollection`（913）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:147,151,373,376,383,386,397,401`（playlistsOf、readWhole） | 全部九家 | `library@1` | `unit/onlineMusic/qqProvider.test.ts`×25<br>`unit/onlineMusic/kugouProvider.test.ts`×21<br>`unit/spotify/spotifyProvider.test.ts`×14<br>`unit/onlineMusic/neteaseProvider.test.ts`×10<br>等 12 个文件 89 处（附录 C） |
| `catalog`（1183） | 同步属性·可选 | `omni.getCollectionTracks`（1340,1343,1348,1354,1366）<br>`omni.getAlbumDetail`（1371）<br>`omni.getCollectionDetail`（1375）<br>`omni.getArtistDetail`（1382）<br>`omni.getArtistSongs`（1386）<br>`omni.getArtistAlbums`（1390）<br>`omni.getSubscriptionStatus`（1396）<br>`omni.canResolveCatalogRef`（1608）<br>`omni.resolveCatalogRefs`（1615）<br>⚠ `src/services/onlineMusic/catalogRefs.ts:30,100,124,171`（canResolveSongCatalogRef、resolveSongCatalogRef、resolveSongCatalogRefSet、resolveCollectionArtistCatalogId；直接用注册表） | 全部九家 | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×56<br>`unit/ytm/ytmProvider.test.ts`×30<br>`unit/onlineMusic/kugouProvider.test.ts`×17<br>`unit/onlineMusic/neteaseProvider.test.ts`×15<br>等 13 个文件 151 处（附录 C） |
| `recommendations`（1184） | 同步属性·可选 | `omni.supportsRecommendationPreferences`（164,165，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferenceEntries`（164,165,1010，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferences`（164,165,1017，经 hasRecommendationPreferences）<br>`omni.saveRecommendationPreferences`（164,165,1028，经 hasRecommendationPreferences）<br>`omni.supportsDailySongs`（592）<br>`omni.canDislikeSong`（872）<br>`omni.canDislikeCollectionSongs`（879）<br>`omni.getHomeFeed`（924）<br>`omni.getPersonalFmCatalog`（952）<br>`omni.getPersonalFmStationCatalog`（957）<br>`omni.getPersonalFm`（961）<br>`omni.getDailySongs`（965）<br>`omni.getRecommendationHistory`（969）<br>`omni.getRecommendationHistoryDates`（973）<br>`omni.getRecommendationHistorySongs`（977）<br>`omni.getDailyStyleGroups`（983）<br>`omni.getDailyStyleSongs`（988）<br>`omni.setDailyStyle`（994,996）<br>`omni.dislikeSong`（1599,1602） | 除 fnmusic 外的 8 家（8/9） | `recommendations@1` | `unit/onlineMusic/kugouProvider.test.ts`×10<br>`unit/spotify/spotifyRecommendations.test.ts`×5<br>`unit/onlineMusic/bodianProvider.test.ts`×4<br>`dev/probes/libraryBehavior/fakeProviders.ts`×3<br>等 16 个文件 39 处（附录 C） |
| `explore`（1185） | 同步属性·可选 | `omni.supportsExplore`（1046）<br>`omni.getExploreFeed`（1052）<br>`omni.getExploreSectionItems`（1056）<br>`omni.exploreSongsShownAs`（1061） | netease、qq、ytm、spotify、qishui（5/9） | `explore@1` | `unit/ytm/ytmProvider.test.ts`×36<br>`unit/spotify/spotifyProvider.test.ts`×16<br>`unit/ytm/ytmOmni.test.ts`×2<br>`dev/probes/exploreSurface.probe.tsx`×1<br>等 6 个文件 57 处（附录 C） |
| `mutations`（1186） | 同步属性·可选 | `omni.pressSongLike`（332,347,1511，经 sendSongLike）<br>`omni.getPlaylistsForSong`（818,825）<br>`omni.canAddSongToPlaylist`（835）<br>`omni.canCreatePlaylistForSong`（843）<br>`omni.canLikeSong`（852）<br>`omni.canEditCollectionTracks`（860,863,864）<br>`omni.canSubscribeCollection`（888,892,896）<br>`omni.subscribe`（1400）<br>`omni.updateCollectionTracks`（1414）<br>`omni.createPlaylistWithSongs`（1435）<br>`omni.addSongsToPlaylist`（1472） | 全部九家 | `mutations@1` | `unit/onlineMusic/kugouProvider.test.ts`×22<br>`unit/ytm/ytmProvider.test.ts`×20<br>`unit/onlineMusic/omni.test.ts`×16<br>`unit/spotify/spotifyProvider.test.ts`×5<br>等 13 个文件 75 处（附录 C） |
| `raw`（1188） | 同步属性·可选 | `omni.getRawRequestInfo`（1640）<br>`omni.describeRawEndpoint`（1646）<br>`omni.checkRawParams`（1652）<br>`omni.requestProviderRaw`（1664） | netease（1/9） | `raw@1` | 没有直接引用它的测试 |

### 2.3 `search`（`OnlineSearchProvider`）

3 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `searchSongs`（385） | 异步·必有 | `omni.searchSongs`（253,254，经 searchWith）<br>`omni.searchProviderSongs`（253,254，经 searchWith）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:126`（platformAccess；直接用注册表）<br>⚠ `src/services/localMusicService.ts:1429`（matchLyrics；直接用注册表，写死 netease） | 全部九家；模组适配层也给 | `search@1` | `unit/onlineMusic/omni.test.ts`×48<br>`unit/onlineMusic/kugouProvider.test.ts`×11<br>`unit/spotify/spotifyProvider.test.ts`×7<br>`unit/onlineMusic/omniSearchCollections.test.ts`×6<br>等 12 个文件 87 处（附录 C） |
| `searchAlbums`（390） | 异步·可选 | `omni.getProviderSearchKinds`（628）<br>`omni.searchProviderCollections`（644） | netease、kugou、qq、ytm（4/9） | `search@1` | `unit/onlineMusic/omniSearchCollections.test.ts`×5<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/onlineMusic/neteaseProvider.test.ts`×1 |
| `searchPlaylists`（395） | 异步·可选 | `omni.getProviderSearchKinds`（629）<br>`omni.searchProviderCollections`（645） | netease、kugou、qq、ytm、qishui（5/9） | `search@1` | `unit/onlineMusic/omniSearchCollections.test.ts`×3<br>`unit/qishui/adapter.test.ts`×2<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/onlineMusic/neteaseProvider.test.ts`×1 |

### 2.4 `playback`（`OnlinePlaybackProvider`）

11 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getSongDetail`（403） | 异步·必有 | `omni.getSongDetail`（1066）<br>`omni.getSongDetails`（1104） | 除 appleMusic 外的 8 家（8/9）；模组适配层也给 | `songs@1` | `unit/onlineMusic/omni.test.ts`×12<br>`unit/onlineMusic/qqProvider.test.ts`×12<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/omniAudioFailure.test.ts`×1<br>等 7 个文件 29 处（附录 C） |
| `getSongDetails`（410） | 异步·可选 | `omni.getSongDetails`（1085） | netease、qq（2/9） | `songs@1` | `unit/onlineMusic/qqProvider.test.ts`×6<br>`unit/onlineMusic/neteaseProvider.test.ts`×3<br>`unit/onlineMusic/omni.test.ts`×3 |
| `songDetailsPerRequest`（417） | 同步属性·可选 | `omni.getSongDetails`（1087） | netease、qq（2/9） | `songs@1` | `unit/onlineMusic/neteaseProvider.test.ts`×1<br>`unit/onlineMusic/omni.test.ts`×1<br>`unit/onlineMusic/qqProvider.test.ts`×1 |
| `getAudioSource`（419） | 异步·必有 | `omni.getAudioSource`（1210） | 除 appleMusic 外的 8 家（8/9）；模组适配层也给 | `playback.audio@1` | `unit/onlineMusic/qqProvider.test.ts`×24<br>`unit/onlineMusic/kugouProvider.test.ts`×20<br>`unit/onlineMusic/omni.test.ts`×12<br>`unit/onlineMusic/neteaseProvider.test.ts`×6<br>等 13 个文件 78 处（附录 C） |
| `audioQualityLevels`（429） | 同步属性·可选 | `omni.resolveAudioQuality`（109，经 audioQualityLevelsOf）<br>`omni.getAudioSource`（109,1230，经 audioQualityLevelsOf）<br>`omni.getAudioQualityLevels`（109，经 audioQualityLevelsOf） | ytm、spotify、qishui、fnmusic（4/9）；ytm 是 getter | `playback.audio@1` | `unit/ytm/ytmUltra.test.ts`×4<br>`unit/fnmusic/fnmusicProvider.test.ts`×1<br>`unit/onlineMusic/omni.test.ts`×1<br>`unit/services/onlineAudioLevelCache.test.ts`×1<br>等 5 个文件 8 处（附录 C） |
| `previewNoticeKey`（435） | 同步属性·可选 | `omni.previewNoticeKey`（1257） | qishui（1/9） | `playback.audio@1` | 没有直接引用它的测试 |
| `getAvailability`（436） | 同步·可选 | `omni.getSongAvailability`（1326）<br>⚠ `src/services/onlineMusic/songAvailability.ts:16`（getSongAvailability；直接用注册表） | netease、bodian、qishui（3/9） | `songs@1` ※ | `unit/onlineMusic/neteaseProvider.test.ts`×6<br>`unit/qishui/capabilities.test.ts`×4<br>`unit/onlineMusic/bodianProvider.test.ts`×2<br>`unit/qishui/explore.test.ts`×2<br>等 8 个文件 18 处（附录 C） |
| `getReplacement`（437） | 异步·可选 | `omni.getSongReplacement`（1333）<br>⚠ `src/services/onlineMusic/songAvailability.ts:42`（getSongReplacement；直接用注册表） | netease（1/9） | `songs@1` ※ | `unit/onlineMusic/neteaseProvider.test.ts`×2<br>`unit/onlineMusic/providerRegistry.test.ts`×1 |
| `getPlayedSong`（442） | 异步·可选 | ⚠ `src/services/onlineMusic/songAvailability.ts:52`（askPlayedSong；直接用注册表） | ytm（1/9） | `songs@1` ※ | 没有直接引用它的测试 |
| `keepAudio`（448） | 异步·可选 | ⚠ `src/services/onlineMusic/providerRegistry.ts:79,85`（keepsOwnSongAudio、askProviderCache（按名字取成员）← keepProviderSongAudio:95；注册表自己的函数） | spotify（1/9） | `playback.audio@1` | 没有直接引用它的测试 |
| `hasKeptAudio`（450） | 异步·可选 | ⚠ `src/services/onlineMusic/providerRegistry.ts:79,85`（keepsOwnSongAudio、askProviderCache（按名字取成员）← hasProviderKeptSongAudio:92；注册表自己的函数） | spotify（1/9） | `playback.audio@1` | 没有直接引用它的测试 |

### 2.5 `externalPlayback`（`OnlineExternalPlaybackProvider`）

12 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `canPlay`（503） | 同步·可选 | `omni.canPlaySong`（1116）<br>⚠ `src/services/onlineMusic/providerRegistry.ts:100`（canPlayOnlineMusicSong；注册表自己的函数） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicLibrarySongs.test.ts`×2<br>`unit/appleMusic/appleMusicAvailability.test.ts`×1<br>`unit/appleMusic/appleMusicRadio.test.ts`×1 |
| `prepareNext`（505） | 异步·可选 | `omni.prepareExternalPlaybackQueue`（1145,1146） | appleMusic（1/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×8<br>`unit/appleMusic/appleMusicRadio.test.ts`×1 |
| `isPrepared`（507） | 同步·可选 | `omni.isExternalPlaybackPrepared`（1140） | appleMusic（1/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×1 |
| `play`（509） | 异步·必有 | `omni.playSongExternally`（1130） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×7<br>`unit/appleMusic/appleMusicAvailability.test.ts`×1<br>`unit/appleMusic/appleMusicRadio.test.ts`×1<br>`unit/spotify/spotifySetup.test.ts`×1 |
| `adopt`（514） | 同步·可选 | `omni.adoptExternalPlayback`（1136） | appleMusic（1/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×3 |
| `pause`（515） | 异步·必有 | `omni.pauseExternalPlayback`（1152） | spotify、appleMusic（2/9） | `playback.external@1` | 没有直接引用它的测试 |
| `resume`（516） | 异步·必有 | `omni.resumeExternalPlayback`（1158） | spotify、appleMusic（2/9） | `playback.external@1` | 没有直接引用它的测试 |
| `seek`（517） | 异步·必有 | `omni.seekExternalPlayback`（1164） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×1<br>`unit/appleMusic/appleMusicRadio.test.ts`×1 |
| `setVolume`（519） | 异步·可选 | `omni.setExternalPlaybackVolume`（1170,1171） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/spotify/spotifySetup.test.ts`×1 |
| `setRepeatOne`（526） | 异步·可选 | `omni.setExternalPlaybackRepeatOne`（1178,1179） | spotify、appleMusic（2/9） | `playback.external@1` | 没有直接引用它的测试 |
| `getStatus`（528） | 异步·必有 | `omni.getExternalPlaybackStatus`（1185） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×25<br>`unit/spotify/spotifySetup.test.ts`×2 |
| `isStatusForSong`（530） | 同步·必有 | `omni.isExternalPlaybackStatusForSong`（1189） | spotify、appleMusic（2/9） | `playback.external@1` | `unit/appleMusic/appleMusicProvider.test.ts`×2<br>`unit/spotify/spotifySetup.test.ts`×2<br>`unit/appleMusic/appleMusicRadio.test.ts`×1 |

### 2.6 `playbackReports`（`OnlinePlaybackReportProvider`）

2 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `canReport`（472） | 同步·可选 | `omni.canReportPlayback`（1278） | netease（1/9） | `reports@1` | `unit/onlineMusic/neteaseProvider.test.ts`×1<br>`unit/onlineMusic/omni.test.ts`×1 |
| `reportPlayback`（473） | 异步·必有 | `omni.reportPlayback`（1284） | netease（1/9） | `reports@1` | `unit/onlineMusic/neteaseProvider.test.ts`×5<br>`unit/onlineMusic/omni.test.ts`×2 |

### 2.7 `lyrics`（`OnlineLyricsProvider`）

5 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getSearchAlias`（537） | 异步·可选 | `omni.getLyricSearchAlias`（1317） | kugou、qq、bodian、appleMusic（4/9） | `lyrics@1` | `unit/onlineMusic/bodianProvider.test.ts`×2<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>`unit/onlineMusic/qqProvider.test.ts`×2 |
| `getLyrics`（538） | 异步·必有 | `omni.getLyrics`（1294）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:127`（platformAccess；直接用注册表）<br>⚠ `src/services/localMusicService.ts:1473`（matchLyrics；直接用注册表，写死 netease） | 全部九家；模组适配层也给 | `lyrics@1` | `unit/ytm/ytmProvider.test.ts`×6<br>`unit/appleMusic/appleMusicProvider.test.ts`×3<br>`unit/mod-system/foliumExperimental.test.ts`×3<br>`unit/spotify/spotifyProvider.test.ts`×3<br>等 10 个文件 23 处（附录 C） |
| `prefersOwnWordByWord`（546） | 同步属性·可选 | `omni.prefersOwnWordByWordLyrics`（1312）<br>⚠ `src/utils/lyrics/autoMatchBestLyric.ts:443,496`（matchUnderArtist、autoMatchBestLyric；直接用注册表） | appleMusic（1/9） | `lyrics@1` | 没有直接引用它的测试 |
| `getChorusRanges`（547） | 异步·可选 | `omni.getChorusRanges`（1306）<br>⚠ `src/utils/lyrics/lyricMatchSources.ts:111`（fetchAmllDbCandidateLyrics；直接用注册表）<br>⚠ `src/utils/lyrics/autoMatchBestLyric.ts:33`（getProviderChorusRanges；直接用注册表） | netease、kugou（2/9） | `lyrics@1` | `unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/onlineMusic/omni.test.ts`×1 |
| `getAlternateArtistName`（549） | 异步·可选 | `omni.getAlternateArtistName`（1322） | netease、ytm（2/9） | `lyrics@1` | `unit/onlineMusic/neteaseProvider.test.ts`×2<br>`unit/ytm/ytmProvider.test.ts`×2 |

### 2.8 `songMetadata`（`OnlineSongMetadataProvider`）

1 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getSongMetadata`（553） | 同步·必有 | ⚠ `src/services/onlineMusic/songMetadata.ts:27`（getProviderSongMetadata；直接用注册表） | 除 appleMusic、fnmusic 外的 7 家（7/9） | 歌曲 DTO（§4.3）※ | `unit/onlineMusic/kugouProvider.test.ts`×1 |

### 2.9 `auth`（`OnlineAuthProvider`）

26 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getLoginStatus`（731） | 异步·必有 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:259`（askWho） | 全部九家 | `auth@1` | `unit/onlineMusic/accountRead.test.ts`×35<br>`unit/onlineMusic/qqProvider.test.ts`×14<br>`unit/onlineMusic/neteaseProvider.test.ts`×9<br>`unit/ytm/ytmUltra.test.ts`×5<br>等 12 个文件 79 处（附录 C） |
| `logout`（737） | 异步·必有 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:534`（signOut） | 全部九家 | `auth@1` | `unit/onlineMusic/accountRead.test.ts`×6<br>`unit/onlineMusic/kugouQqSignOut.test.ts`×5<br>`unit/onlineMusic/qqProvider.test.ts`×3<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>等 10 个文件 24 处（附录 C） |
| `signInRanOut`（744） | 同步或异步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:276`（askWho） | 除 bodian、spotify、fnmusic 外的 6 家（6/9） | `auth@1` | `unit/onlineMusic/accountRead.test.ts`×2<br>`unit/qishui/explore.test.ts`×2<br>`unit/onlineMusic/neteaseAccountKept.test.ts`×1<br>`unit/ytm/ytmProvider.test.ts`×1 |
| `showsKeptAccountAtStart`（751） | 同步属性·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:312`（readWhole） | netease、kugou、qq、appleMusic（4/9） | `auth@1` | 没有直接引用它的测试 |
| `oldKeptAccount`（756） | 异步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:181,182`（keptAccount） | netease（1/9） | `auth@1` | `unit/onlineMusic/accountRead.test.ts`×2<br>`unit/onlineMusic/neteaseAccountKept.test.ts`×2 |
| `forgetOldKeptAccount`（762） | 异步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:186`（keptAccount） | netease（1/9） | `auth@1` | `unit/onlineMusic/neteaseAccountKept.test.ts`×1 |
| `getLoginTexts`（764） | 同步·可选 | `omni.getLoginTexts`（657） | 全部九家 | `auth@1` | `unit/ytm/ytmProvider.test.ts`×1 |
| `localService`（766） | 同步属性·可选 | `omni.getLoginLocalService`（669） | netease（1/9） | `auth@1` | 没有直接引用它的测试 |
| `getLoginMethods`（767） | 同步·可选 | `omni.getLoginMethods`（674）<br>`omni.resolveLoginMethods`（680） | qq（1/9） | `auth@1` | `dev/probes/accountBehavior/fakeAuthProviders.ts`×1 |
| `resolveLoginMethods`（769） | 异步·可选 | `omni.resolveLoginMethods`（680） | qq、spotify（2/9） | `auth@1` | `unit/spotify/spotifySetup.test.ts`×2<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1 |
| `startLogin`（770） | 异步·可选 | `omni.startLogin`（700,702） | 全部九家 | `auth@1` | `unit/ytm/ytmProvider.test.ts`×8<br>`unit/onlineMusic/qqProvider.test.ts`×4<br>`unit/appleMusic/appleMusicProvider.test.ts`×3<br>`unit/onlineMusic/neteaseProvider.test.ts`×2<br>等 9 个文件 23 处（附录 C） |
| `getLoginForm`（773） | 同步·可选 | `omni.getLoginForm`（686） | fnmusic（1/9） | `auth@1` | 没有直接引用它的测试 |
| `submitLoginForm`（774） | 异步·可选 | `omni.submitLoginForm`（692,693） | fnmusic（1/9） | `auth@1` | 没有直接引用它的测试 |
| `describeLoginFailure`（777） | 同步·可选 | `omni.submitLoginForm`（213，经 runLoginStep）<br>`omni.startLogin`（213，经 runLoginStep）<br>`omni.openLoginPage`（213，经 runLoginStep）<br>`omni.checkLogin`（213，经 runLoginStep） | 除 bodian 外的 8 家（8/9） | `auth@1` | `unit/ytm/ytmProvider.test.ts`×4<br>`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1<br>`unit/qishui/adapter.test.ts`×1 |
| `createQr`（778） | 异步·可选 | `omni.startLogin`（700,703）<br>`omni.confirmsLoginInBrowser`（710） | netease、kugou、qq、bodian、qishui（5/9） | `auth@1` | `unit/onlineMusic/neteaseProvider.test.ts`×2<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/onlineMusic/qqProvider.test.ts`×1<br>等 6 个文件 7 处（附录 C） |
| `openLoginPage`（782） | 异步·可选 | `omni.startLogin`（700）<br>`omni.confirmsLoginInBrowser`（710）<br>`omni.openLoginPage`（720,721） | ytm、spotify、appleMusic（3/9） | `auth@1` | `unit/ytm/ytmProvider.test.ts`×1 |
| `opensLoginPageItself`（785） | 同步·可选 | `omni.opensLoginPageItself`（715） | ytm、appleMusic（2/9） | `auth@1` | 没有直接引用它的测试 |
| `checkLogin`（786） | 异步·可选 | `omni.checkLogin`（726,727） | 全部九家 | `auth@1` | `unit/onlineMusic/qqProvider.test.ts`×13<br>`unit/ytm/ytmProvider.test.ts`×7<br>`unit/appleMusic/appleMusicProvider.test.ts`×4<br>`unit/onlineMusic/neteaseProvider.test.ts`×3<br>等 8 个文件 33 处（附录 C） |
| `cancelLogin`（789） | 异步·可选 | `omni.cancelLogin`（732） | 除 netease、kugou、fnmusic 外的 6 家（6/9） | `auth@1` | `unit/ytm/ytmProvider.test.ts`×6<br>`unit/onlineMusic/qqProvider.test.ts`×2<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/appleMusic/appleMusicProvider.test.ts`×1<br>等 5 个文件 11 处（附录 C） |
| `getLoginTtlMs`（792） | 同步·可选 | `omni.getLoginTtlMs`（781） | qq、bodian、ytm、spotify、qishui（5/9） | `auth@1` | `dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/onlineMusic/qqProvider.test.ts`×1<br>`unit/ytm/ytmProvider.test.ts`×1 |
| `getLoginDiagnostics`（795） | 异步·可选 | `omni.getLoginDiagnostics`（738） | netease、qq、qishui（3/9） | `auth@1` | `unit/onlineMusic/qqProvider.test.ts`×2<br>`unit/qishui/failure.test.ts`×2<br>`dev/probes/accountBehavior/fakeAuthProviders.ts`×1<br>`unit/login/loginDiagnosticReport.test.ts`×1<br>等 6 个文件 8 处（附录 C） |
| `canRunLoginSelfCheck`（798） | 同步·可选 | `omni.canRunLoginSelfCheck`（747） | netease、qq（2/9） | `auth@1` | `dev/probes/accountBehavior/fakeAuthProviders.ts`×1 |
| `runLoginSelfCheck`（799） | 异步·可选 | `omni.runLoginSelfCheck`（751） | netease、qq（2/9） | `auth@1` | `dev/probes/accountBehavior/fakeAuthProviders.ts`×1 |
| `checkAfterLogin`（803） | 异步·可选 | `omni.checksAfterLogin`（756）<br>`omni.checkAfterLogin`（761） | spotify（1/9） | `auth@1` | 没有直接引用它的测试 |
| `getSetup`（805） | 异步·可选 | `omni.hasSetup`（766）<br>`omni.getSetup`（770） | spotify（1/9） | `auth@1` | 没有直接引用它的测试 |
| `runSetupAction`（807） | 异步·可选 | `omni.runSetupAction`（775,776） | spotify（1/9） | `auth@1` | 没有直接引用它的测试 |

### 2.10 `auth.localService`（`LoginLocalService`）

3 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `subscribe`（661） | 同步·必有 | ⚠ `src/library/core/account/providerAccountController.service.ts:310`（createProviderAccountController；经 omni.getLoginLocalService 取到对象后直接调） | netease（1/9） | `auth@1`（`localService` 之下） | `unit/library/core/providerAccountController.test.ts`×1<br>`unit/login/loginModuleKnowsNoPlatform.test.ts`×1 |
| `getStatus`（663） | 同步·必有 | ⚠ `src/library/core/account/providerAccountController.service.ts:230,501`（createProviderAccountController；经 omni.getLoginLocalService 取到对象后直接调） | netease（1/9） | `auth@1`（`localService` 之下） | `unit/login/loginModuleKnowsNoPlatform.test.ts`×6<br>`unit/library/core/providerAccountController.test.ts`×1 |
| `restart`（665） | 异步·必有 | ⚠ `src/library/core/account/providerAccountController.service.ts:506`（createProviderAccountController；经 omni.getLoginLocalService 取到对象后直接调） | netease（1/9） | `auth@1`（`localService` 之下） | `unit/login/loginModuleKnowsNoPlatform.test.ts`×2<br>`unit/library/core/providerAccountController.test.ts`×1 |

### 2.11 `library`（`OnlineLibraryProvider`）

8 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getSongLikeId`（832） | 同步·可选 | `omni.isSongLiked`（195，经 likeSourceOf）<br>`omni.pressSongLike`（195，经 likeSourceOf）<br>`omni.endLikedListRead`（195，经 likeSourceOf）<br>`omni.songsInPlay`（195，经 likeSourceOf） | appleMusic（1/9） | `library@1` | `unit/onlineMusic/omniLikePresses.test.ts`×1 |
| `getUserPlaylists`（833） | 异步·必有 | `omni.getUserPlaylists`（786）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:147,151`（playlistsOf） | 全部九家 | `library@1` | `unit/onlineMusic/accountRead.test.ts`×24<br>`unit/onlineMusic/qqProvider.test.ts`×8<br>`unit/onlineMusic/bodianLibrary.test.ts`×6<br>`unit/onlineMusic/omni.test.ts`×5<br>等 13 个文件 64 处（附录 C） |
| `getLikedSongIds`（839） | 异步·可选 | `omni.getLikedSongIds`（905）<br>`omni.getProviderLikedSongIds`（909）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:397,401`（readWhole） | 全部九家 | `library@1` | `unit/onlineMusic/accountRead.test.ts`×21<br>`unit/onlineMusic/kugouProvider.test.ts`×11<br>`unit/onlineMusic/qqProvider.test.ts`×6<br>`unit/onlineMusic/omniAccountMoments.test.ts`×5<br>等 13 个文件 66 处（附录 C） |
| `getLikedSongCount`（847） | 异步·可选 | `omni.accountMoment`（491，经 accountMoments） | 除 qishui、appleMusic、fnmusic 外的 6 家（6/9） | `library@1` | `unit/onlineMusic/omniAccountMoments.test.ts`×4<br>`unit/spotify/spotifyProvider.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×3<br>`unit/onlineMusic/bodianLibrary.test.ts`×2<br>等 8 个文件 19 处（附录 C） |
| `areSongsLiked`（855） | 异步·可选 | `omni.accountMoment`（439，经 likedChecks）<br>`omni.addSongsToPlaylist`（439，经 likedChecks）<br>`omni.readAccount`（439，经 likedChecks）<br>`omni.signOutAccount`（439，经 likedChecks）<br>`omni.refreshProviderPlaylists`（439，经 likedChecks）<br>`omni.endLikedListRead`（439，经 likedChecks）<br>`omni.songsInPlay`（439，经 likedChecks） | qq、spotify（2/9） | `library@1` | `unit/onlineMusic/omniLikedChecks.test.ts`×2<br>`unit/onlineMusic/qqProvider.test.ts`×2<br>`unit/spotify/spotifyProvider.test.ts`×2 |
| `getUserAlbums`（856） | 异步·可选 | `omni.getUserAlbums`（900） | 除 qishui 外的 8 家（8/9） | `library@1` | `unit/onlineMusic/qqProvider.test.ts`×6<br>`unit/onlineMusic/bodianAlbumPaging.test.ts`×2<br>`unit/onlineMusic/bodianLibrary.test.ts`×2<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>等 5 个文件 12 处（附录 C） |
| `getCloudCollection`（858） | 异步·可选 | `omni.getCloudCollection`（913）<br>〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:373,376`（readWhole） | netease、kugou、qq（3/9） | `library@1` | `unit/onlineMusic/accountRead.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/onlineMusic/qqProvider.test.ts`×1 |
| `getListeningRankCollections`（865） | 异步·可选 | 〔omni 组装〕`src/services/onlineMusic/account/accountRead.ts:383,386`（readWhole） | netease、kugou、qq（3/9） | `library@1` | `unit/onlineMusic/accountRead.test.ts`×4<br>`unit/onlineMusic/neteaseProvider.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×1 |

### 2.12 `catalog`（`OnlineCatalogProvider`）

12 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `canResolveSongCatalogRefs`（869） | 同步·可选 | `omni.canResolveCatalogRef`（1609）<br>⚠ `src/services/onlineMusic/catalogRefs.ts:31,172`（canResolveSongCatalogRef、resolveCollectionArtistCatalogId；直接用注册表） | kugou、qq、bodian、ytm、appleMusic（5/9） | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×2<br>`unit/ytm/ytmProvider.test.ts`×2 |
| `resolveSongCatalogRefs`（870） | 异步·可选 | `omni.canResolveCatalogRef`（1609）<br>`omni.resolveCatalogRefs`（1615）<br>⚠ `src/services/onlineMusic/catalogRefs.ts:32,100,124,172`（canResolveSongCatalogRef、resolveSongCatalogRef、resolveSongCatalogRefSet、resolveCollectionArtistCatalogId；直接用注册表） | kugou、qq、bodian、ytm、appleMusic（5/9） | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×6<br>`unit/ytm/ytmProvider.test.ts`×6<br>`unit/onlineMusic/omni.test.ts`×4<br>`unit/appleMusic/appleMusicCatalog.test.ts`×1 |
| `getPlaylistTracks`（871） | 异步·可选 | `omni.getCollectionTracks`（1366） | 全部九家 | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×14<br>`unit/ytm/ytmProvider.test.ts`×11<br>`unit/spotify/spotifyProvider.test.ts`×5<br>`unit/appleMusic/appleMusicLibrarySongs.test.ts`×3<br>等 12 个文件 51 处（附录 C） |
| `getPlaylistDetail`（872） | 异步·可选 | `omni.getCollectionDetail`（1377） | 除 netease、appleMusic 外的 7 家（7/9） | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×8<br>`unit/qishui/capabilities.test.ts`×3<br>`unit/ytm/ytmProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>等 7 个文件 17 处（附录 C） |
| `getCloudTracks`（873） | 异步·可选 | `omni.getCollectionTracks`（1343） | netease、kugou、qq（3/9） | `catalog@1` | `unit/onlineMusic/kugouProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/qqProvider.test.ts`×1 |
| `getListeningRankTracks`（875） | 异步·可选 | `omni.getCollectionTracks`（1348） | netease、kugou、qq（3/9） | `catalog@1` | `unit/onlineMusic/neteaseProvider.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>`unit/onlineMusic/omni.test.ts`×1 |
| `getAlbumTracks`（876） | 异步·可选 | `omni.getCollectionTracks`（1340） | 除 qishui 外的 8 家（8/9） | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×5<br>`unit/onlineMusic/kugouProvider.test.ts`×3<br>`unit/ytm/ytmProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>等 5 个文件 12 处（附录 C） |
| `getAlbumDetail`（877） | 异步·可选 | `omni.getAlbumDetail`（1371）<br>`omni.getCollectionDetail`（1376） | 除 qishui 外的 8 家（8/9） | `catalog@1` | `unit/ytm/ytmProvider.test.ts`×9<br>`unit/onlineMusic/qqProvider.test.ts`×5<br>`unit/onlineMusic/neteaseProvider.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>等 7 个文件 23 处（附录 C） |
| `getArtistSongs`（878） | 异步·可选 | `omni.getCollectionTracks`（1354）<br>`omni.getArtistSongs`（1386） | 全部九家 | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×5<br>`unit/onlineMusic/neteaseProvider.test.ts`×2<br>`unit/onlineMusic/omni.test.ts`×2<br>`unit/ytm/ytmProvider.test.ts`×1 |
| `getArtistAlbums`（879） | 异步·可选 | `omni.getArtistAlbums`（1390） | 除 qishui、fnmusic 外的 7 家（7/9） | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×5<br>`unit/onlineMusic/neteaseProvider.test.ts`×2<br>`unit/ytm/ytmProvider.test.ts`×2<br>`unit/onlineMusic/kugouProvider.test.ts`×1 |
| `getArtistDetail`（880） | 异步·可选 | `omni.getArtistDetail`（1382） | 全部九家 | `catalog@1` | `unit/onlineMusic/qqProvider.test.ts`×4<br>`unit/onlineMusic/neteaseProvider.test.ts`×3<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/ytm/ytmProvider.test.ts`×1 |
| `getSubscriptionStatus`（881） | 异步·可选 | `omni.getSubscriptionStatus`（1396） | netease、kugou、qq、ytm、spotify（5/9） | `catalog@1` | `unit/ytm/ytmProvider.test.ts`×8<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/omni.test.ts`×1<br>等 6 个文件 14 处（附录 C） |

### 2.13 `recommendations`（`OnlineRecommendationProvider`）

14 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getPersonalFmCatalog`（977） | 异步·可选 | `omni.getPersonalFmCatalog`（952）<br>`omni.getPersonalFmStationCatalog`（957） | qq、qishui（2/9） | `recommendations@1` | `unit/onlineMusic/qqGuessYouLike.test.ts`×6<br>`unit/onlineMusic/omni.test.ts`×1 |
| `getDailySongs`（978） | 异步·可选 | `omni.supportsDailySongs`（592）<br>`omni.getHomeFeed`（929）<br>`omni.getDailySongs`（965） | netease、kugou、qq、spotify（4/9） | `recommendations@1` | `unit/onlineMusic/qqRecommendations.test.ts`×5<br>`unit/spotify/spotifyRecommendations.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>等 5 个文件 10 处（附录 C） |
| `getPersonalFm`（979） | 异步·可选 | `omni.getHomeFeed`（928）<br>`omni.getPersonalFm`（961） | 除 fnmusic 外的 8 家（8/9） | `recommendations@1` | `unit/onlineMusic/qqGuessYouLike.test.ts`×10<br>`unit/onlineMusic/qqRecommendations.test.ts`×6<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>等 11 个文件 26 处（附录 C） |
| `getRecommendedCollections`（980） | 异步·可选 | `omni.getHomeFeed`（930） | 除 fnmusic 外的 8 家（8/9） | `recommendations@1` | `unit/onlineMusic/qqGuessYouLike.test.ts`×6<br>`unit/onlineMusic/qqRecommendations.test.ts`×5<br>`unit/onlineMusic/bodianProvider.test.ts`×3<br>`unit/onlineMusic/kugouProvider.test.ts`×3<br>等 12 个文件 26 处（附录 C） |
| `getHistoryEntries`（981） | 异步·可选 | `omni.getRecommendationHistory`（969） | netease、kugou（2/9） | `recommendations@1` | `unit/onlineMusic/kugouProvider.test.ts`×1 |
| `getHistoryDates`（982） | 异步·可选 | `omni.getRecommendationHistoryDates`（973） | netease、kugou、qq（3/9） | `recommendations@1` | `unit/onlineMusic/qqRecommendations.test.ts`×5<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/kugouProvider.test.ts`×1 |
| `getHistorySongs`（983） | 异步·可选 | `omni.getRecommendationHistorySongs`（977） | netease、kugou、qq（3/9） | `recommendations@1` | `unit/onlineMusic/qqRecommendations.test.ts`×6<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/kugouProvider.test.ts`×1 |
| `dislikeSong`（985） | 异步·可选 | `omni.canDislikeSong`（872）<br>`omni.canDislikeCollectionSongs`（879）<br>`omni.dislikeSong`（1599,1602） | 除 bodian、appleMusic、fnmusic 外的 6 家（6/9） | `recommendations@1` | `unit/onlineMusic/qqRecommendations.test.ts`×8<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/qishui/packagePaging.test.ts`×1<br>等 6 个文件 13 处（附录 C） |
| `getDailyStyleGroups`（987） | 异步·可选 | `omni.getDailyStyleGroups`（983） | netease（1/9） | `recommendations@1` | `unit/onlineMusic/neteaseProvider.test.ts`×1 |
| `getDailyStyleSongs`（988） | 异步·可选 | `omni.getDailyStyleSongs`（988） | netease（1/9） | `recommendations@1` | `unit/onlineMusic/neteaseProvider.test.ts`×2 |
| `setDailyStyle`（990） | 异步·可选 | `omni.setDailyStyle`（994） | netease（1/9） | `recommendations@1` | `unit/onlineMusic/neteaseProvider.test.ts`×3 |
| `preferenceEntries`（995） | 同步属性·可选 | `omni.getRecommendationPreferenceEntries`（1010） | qq（1/9） | `recommendations@1` | `unit/onlineMusic/recommendationPreferences.test.ts`×3<br>`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×2<br>`unit/onlineMusic/qqProvider.test.ts`×1<br>`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1 |
| `getRecommendationPreferences`（996） | 异步·可选 | `omni.supportsRecommendationPreferences`（164，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferenceEntries`（164，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferences`（164,1018，经 hasRecommendationPreferences）<br>`omni.saveRecommendationPreferences`（164，经 hasRecommendationPreferences） | qq（1/9） | `recommendations@1` | `unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×14<br>`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×13<br>`unit/onlineMusic/recommendationPreferences.test.ts`×11<br>`unit/hooks/useCommandPaletteContext.test.ts`×1<br>等 5 个文件 40 处（附录 C） |
| `saveRecommendationPreferences`（1001） | 异步·可选 | `omni.supportsRecommendationPreferences`（165，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferenceEntries`（165，经 hasRecommendationPreferences）<br>`omni.getRecommendationPreferences`（165，经 hasRecommendationPreferences）<br>`omni.saveRecommendationPreferences`（165,1029，经 hasRecommendationPreferences） | qq（1/9） | `recommendations@1` | `unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×14<br>`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×13<br>`unit/onlineMusic/recommendationPreferences.test.ts`×11<br>`unit/hooks/useCommandPaletteContext.test.ts`×1<br>等 5 个文件 40 处（附录 C） |

### 2.14 `explore`（`OnlineExploreProvider`）

3 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `getFeed`（1074） | 异步·必有 | `omni.getExploreFeed`（1052） | netease、qq、ytm、spotify、qishui（5/9） | `explore@1` | `unit/onlineMusic/neteaseExplore.test.ts`×39<br>`unit/ytm/ytmProvider.test.ts`×33<br>`unit/onlineMusic/qqExplore.test.ts`×11<br>`unit/spotify/spotifyProvider.test.ts`×11<br>等 11 个文件 112 处（附录 C） |
| `getSectionItems`（1075） | 异步·可选 | `omni.getExploreSectionItems`（1056） | netease、qq、ytm、spotify、qishui（5/9） | `explore@1` | `unit/onlineMusic/neteaseExplore.test.ts`×8<br>`unit/qishui/explore.test.ts`×6<br>`unit/spotify/spotifyProvider.test.ts`×5<br>`unit/onlineMusic/qqExplore.test.ts`×4<br>等 7 个文件 28 处（附录 C） |
| `songsShownAs`（1082） | 异步·可选 | `omni.exploreSongsShownAs`（1062） | ytm（1/9） | `explore@1` | 没有直接引用它的测试 |

### 2.15 `mutations`（`OnlineMutationProvider`）

8 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `canAddToPlaylist`（1086） | 同步·可选 | `omni.getPlaylistsForSong`（825）<br>`omni.addSongsToPlaylist`（1472） | 除 netease 外的 8 家（8/9） | `mutations@1` | `unit/onlineMusic/omni.test.ts`×2<br>`unit/onlineMusic/kugouProvider.test.ts`×1<br>`unit/qishui/capabilities.test.ts`×1<br>`unit/spotify/spotifyProvider.test.ts`×1<br>等 5 个文件 6 处（附录 C） |
| `canEditPlaylistTracks`（1088） | 同步·可选 | `omni.canEditCollectionTracks`（864） | qq、qishui、appleMusic（3/9） | `mutations@1` | `unit/appleMusic/appleMusicPlaylistMutation.test.ts`×1 |
| `likeSong`（1089） | 异步·可选 | `omni.pressSongLike`（332,347,1511，经 sendSongLike）<br>`omni.canLikeSong`（852）<br>`omni.canEditCollectionTracks`（860） | 全部九家 | `mutations@1` | `unit/onlineMusic/kugouProvider.test.ts`×19<br>`unit/onlineMusic/qqMutations.test.ts`×8<br>`unit/onlineMusic/omni.test.ts`×4<br>`unit/ytm/ytmProvider.test.ts`×4<br>等 11 个文件 48 处（附录 C） |
| `updatePlaylistTracks`（1090） | 异步·可选 | `omni.getPlaylistsForSong`（818）<br>`omni.canAddSongToPlaylist`（835）<br>`omni.canEditCollectionTracks`（863）<br>`omni.updateCollectionTracks`（1419,1423） | 全部九家 | `mutations@1` | `unit/onlineMusic/qqMutations.test.ts`×9<br>`unit/onlineMusic/omni.test.ts`×8<br>`unit/onlineMusic/bodianMutations.test.ts`×5<br>`unit/ytm/ytmProvider.test.ts`×5<br>等 10 个文件 38 处（附录 C） |
| `createPlaylist`（1096） | 异步·可选 | `omni.canCreatePlaylistForSong`（843）<br>`omni.createPlaylistWithSongs`（1436,1439） | qq、spotify、fnmusic（3/9） | `mutations@1` | `unit/onlineMusic/qqMutations.test.ts`×2<br>`unit/spotify/spotifyProvider.test.ts`×1 |
| `canSubscribe`（1098） | 同步·可选 | `omni.canSubscribeCollection`（888） | qq、ytm、spotify、fnmusic（4/9） | `mutations@1` | `unit/onlineMusic/qqMutations.test.ts`×3<br>`unit/ytm/ytmProvider.test.ts`×1 |
| `subscribePlaylist`（1099） | 异步·可选 | `omni.canSubscribeCollection`（896）<br>`omni.subscribe`（1408,1409） | netease、kugou、qq、ytm、spotify（5/9） | `mutations@1` | `unit/ytm/ytmProvider.test.ts`×3<br>`unit/onlineMusic/qqMutations.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>`unit/spotify/spotifyProvider.test.ts`×1 |
| `subscribeAlbum`（1100） | 异步·可选 | `omni.canSubscribeCollection`（892）<br>`omni.subscribe`（1405,1406） | netease、kugou、qq、ytm、spotify（5/9） | `mutations@1` | `unit/ytm/ytmProvider.test.ts`×6<br>`unit/onlineMusic/qqMutations.test.ts`×4<br>`unit/onlineMusic/kugouProvider.test.ts`×2<br>`dev/probes/libraryBehavior/fakeProviders.ts`×1<br>等 5 个文件 14 处（附录 C） |

### 2.16 `raw`（`OnlineRawRequestProvider`）

6 个成员。

| 成员（契约行号） | 形态 | 宿主读它的地方 | 内置实现 | 公开能力 | 直接引用它的测试 |
| --- | --- | --- | --- | --- | --- |
| `backend`（1133） | 同步属性·必有 | `omni.getRawRequestInfo`（1641） | netease（1/9） | `raw@1` | `unit/onlineMusic/neteaseRaw.test.ts`×2<br>`unit/mod-system/foliumPlatformRaw.test.ts`×1 |
| `reservedParams`（1135） | 同步属性·必有 | `omni.getRawRequestInfo`（1641）<br>`omni.requestProviderRaw`（1670） | netease（1/9） | `raw@1` | 没有直接引用它的测试 |
| `credentialFields`（1138） | 同步属性·可选 | `omni.requestProviderRaw`（1686） | netease（1/9） | `raw@1` | 没有直接引用它的测试 |
| `describeEndpoint`（1140） | 同步·必有 | `omni.describeRawEndpoint`（1646）<br>`omni.requestProviderRaw`（1666） | netease（1/9） | `raw@1` | `unit/onlineMusic/neteaseRaw.test.ts`×10 |
| `checkParams`（1143） | 同步·可选 | `omni.checkRawParams`（1652）<br>`omni.requestProviderRaw`（1674） | netease（1/9） | `raw@1` | `unit/onlineMusic/neteaseRaw.test.ts`×3 |
| `request`（1146） | 异步·必有 | `omni.requestProviderRaw`（1686） | netease（1/9） | `raw@1` | `unit/onlineMusic/neteaseRaw.test.ts`×6 |

## 3. `ProviderCapabilities` 的 25 个开关

方案 §4.1 要用「实现了哪些能力、其中哪些成员在」推导这张表。下表的「谁置 true」取自九家注册后的运行时对象；「宿主读它的地方」含 `providerSupports(provider, '名字')` 这种按名字读的（语言服务看不到，另用文本扫出来）。只是给对象写初值的地方（`onlineHomeProvider.service.ts:8-19` 的空能力表、模组适配层 `omniProviders.ts:62-78`）不算读。

| 开关（契约行号） | 置 true 的内置音源 | 宿主读它的地方 | 2.0 里从什么推导 |
| --- | --- | --- | --- |
| `search`（52） | 全部九家 | `src/mods/runtime/omni/omniDto.ts:119`<br>`src/mods/runtime/omni/hostOmni.ts:186`<br>`src/services/onlineMusic/omni.ts:604,616,624` | 有 `search@1` |
| `playback`（53） | 除 appleMusic 外的 8 家（8/9） | `src/mods/runtime/omni/omniDto.ts:103`<br>`src/services/onlineMusic/providerRegistry.ts:99` | 有 `playback.audio@1` |
| `lyrics`（54） | 全部九家 | `src/mods/runtime/omni/omniDto.ts:121`<br>`src/mods/runtime/omni/hostOmni.ts:317` | 有 `lyrics@1` |
| `auth`（55） | 全部九家 | `src/library/core/account/providerLoginSession.service.ts:489`<br>`src/services/onlineMusic/omni.ts:541` | 有 `auth@1` |
| `userLibrary`（56） | 全部九家 | `src/library/core/home/homeSources.ts:71,72`<br>`src/library/core/home/useLibraryHomeSources.ts:68` | 有 `library@1` |
| `playlists`（57） | 全部九家 | `src/library/core/home/homeSources.ts:71`<br>`src/library/core/home/useLibraryHomeSources.ts:68`<br>`src/services/onlineMusic/omni.ts:629` | `catalog@1` 有 `getPlaylistTracks` |
| `albums`（58） | 除 qishui 外的 8 家（8/9） | `src/mods/runtime/omni/omniDto.ts:122`<br>`src/mods/runtime/omni/hostOmni.ts:345,365`<br>`src/services/onlineMusic/omni.ts:628,1626` | `catalog@1` 有 `getAlbumTracks` |
| `artists`（59） | 全部九家 | `src/mods/runtime/omni/omniDto.ts:123`<br>`src/mods/runtime/omni/hostOmni.ts:355,365`<br>`src/services/onlineMusic/omni.ts:1627` | `catalog@1` 有 `getArtistDetail` |
| `recommendations`（60） | 除 fnmusic 外的 8 家（8/9） | `src/library/core/home/homeSources.ts:73`<br>`src/library/core/home/useLibraryHomeSources.ts:68`<br>`src/services/onlineMusic/omni.ts:871,878` | 有 `recommendations@1` |
| `mutations`（61） | 全部九家 | `src/services/onlineMusic/omni.ts:816,833,850,858,886,1417` | 有 `mutations@1` |
| `personalFmModes`（63） | netease、qishui（2/9） | `src/library/core/home/homeSources.ts:75`<br>`src/library/core/home/useLibraryHomeSources.ts:68`<br>`src/hooks/usePersonalFmModeController.ts:70` | **推导不出**：要在 `recommendations@1` 里明写（见第 7 节第 2 条） |
| `wordByWordLyrics`（64） | 除 ytm、spotify、fnmusic 外的 6 家（6/9） | 没有 | **不用推导**：宿主没有读它的地方，删掉 |
| `userCloud`（65） | netease、kugou、qq（3/9） | 没有 | `library@1` 有 `getCloudCollection`（宿主没有读这个开关的地方，直接看成员在不在） |
| `listeningRank`（70） | netease、kugou、qq（3/9） | 没有 | `library@1` 有 `getListeningRankCollections`（宿主没有读这个开关的地方，直接看成员在不在） |
| `historyRecommendations`（71） | netease、kugou、qq（3/9） | `src/library/core/collection/mutations/collectionMutations.service.ts:202` | `recommendations@1` 有 `getHistoryDates` |
| `dailyStyleRecommendations`（73） | netease（1/9） | `src/library/core/collection/dailyRecommendationLoad.service.ts:12`<br>`src/library/core/collection/mutations/collectionMutations.service.ts:209` | `recommendations@1` 有 `getDailyStyleGroups` |
| `recommendationPreferences`（79） | qq（1/9） | `src/services/onlineMusic/omni.ts:163` | `recommendations@1` 有 `getRecommendationPreferences` 和 `saveRecommendationPreferences`（宿主现在就两样都查，omni.ts:162-166） |
| `playlistSubscription`（80） | netease、kugou、qq、ytm、spotify（5/9） | `src/services/onlineMusic/omni.ts:887` | `mutations@1` 有 `subscribePlaylist` |
| `playlistTrackMutations`（81） | 全部九家 | `src/services/onlineMusic/omni.ts:817,834,862,1418` | `mutations@1` 有 `updatePlaylistTracks` |
| `likes`（82） | 全部九家 | `src/services/onlineMusic/omni.ts:851,860,1490,1549` | `mutations@1` 有 `likeSong` |
| `userAlbums`（83） | 除 qishui 外的 8 家（8/9） | `src/library/core/home/homeSources.ts:72`<br>`src/library/core/home/useLibraryHomeSources.ts:68` | `library@1` 有 `getUserAlbums` |
| `playbackReports`（85） | netease（1/9） | `src/services/onlineMusic/playbackReportGate.ts:48`<br>`src/services/onlineMusic/omni.ts:1277` | 有 `reports@1` |
| `explore`（87） | netease、qq、ytm、spotify、qishui（5/9） | `src/library/core/home/homeSources.ts:74`<br>`src/library/core/home/useLibraryHomeSources.ts:68`<br>`src/components/command-palette/commands/navigationCommands.ts:51`<br>`src/components/modal/settings/pages/HomePage.tsx:103`<br>`src/services/onlineMusic/omni.ts:1046` | 有 `explore@1` |
| `externalPlayback`（92） | spotify、appleMusic（2/9）；spotify 是 getter | `src/services/onlineMusic/omni.ts:1127`<br>`src/services/onlineMusic/providerRegistry.ts:100,106` | 有 `playback.external@1`；随账号变的用 getter 加 `handle.changed()`（§4.1） |
| `songDetail`（97） | 无 | `src/mods/runtime/omni/omniDto.ts:103` | `songs@1` 有 `getSongDetail` |

## 4. 归不进能力的成员，和方案没写明归属的成员

**维护者 2026-11-14 确认**：4.1 的 4 个不进公开契约，4.2 的 8 个按表里「建议归到」一栏定。S3 的契约与适配层已经照这两张表实现，下面的「建议」从此是定下来的归属。

### 4.1 归不进任何能力的 4 个：建议不进公开契约

| 成员 | 现状 | 建议 |
| --- | --- | --- |
| `watch` | 只有网易云实现（`neteaseProvider.ts:381`，盯本机 API 服务起没起来）；宿主只在 `omni.watchProviders` 调一次，把 `ProviderNotice` 交给提示条 | 不进契约。模组的 client 自己就是常驻的，在 `activate` 里盯，用宿主的提示接口说话。适配层给内部的 `watch` 留空。S3 定稿时要确认公开接口里有一个能发 `ProviderNotice` 这种提示（i18n 文字、类型、去重的 nonce）的入口，没有就补 |
| `normalizeSong` | 契约里是必有成员，九家都实现；但宿主没有任何地方调它（omni 0 处、别处 0 处），只有平台自己和测试在用 | 不进契约。它是平台内部把原始回答变成歌曲的函数，留在模组里。适配层对内部的必有成员给一个把公开 DTO 转成 `UnifiedSong` 的实现 |
| `normalizeUser`、`normalizeCollection` | 只在 `account/accountRead.ts:192-199` 用：读上次存下的账号快照时，让平台把旧版本存的形状重新整理一遍 | 不进契约。快照改存公开 DTO 的形状，由适配层转；旧快照（升级来的）仍要能读，所以内置三家认领旧 id 的适配要保留这一步，放在 `core` 里。动手前先确认九家里谁的旧快照形状真的和现在不同 |

### 4.2 方案没写明归属的 8 个：这里的建议

| 成员 | 建议归到 | 理由 |
| --- | --- | --- |
| `shortName` | 注册字段 | 九家都有，`omni.getProviderLabel`、`getProviderSummaries` 在读；方案 §4.1 的注册示例只有 `id`、`displayName`、`mark` |
| `shortNameKey` | 注册字段，并进 `shortName` 的 `FoliumText` | 除 appleMusic 外八家都有；按 §4.6，公开契约收 `FoliumText`，适配层换成 key |
| `getAvailability`（顶层） | 注册字段，同步 | 九家都实现；§7.1 的降级表要问它，§4.1 的注册示例里没有 |
| `playback.getAvailability`、`getReplacement`、`getPlayedSong` | `songs@1` | 这三个说的是一首歌本身（能不能放、有没有替代版本、实际放的是哪个版本），和声音走哪条路无关。放进 `playback.audio@1` 的话，只有外部播放或 `surface` 的音源就说不了这些；现在 Apple Music 没有 `playback`，就没法声明可播性 |
| `getSongPageUrl` | `songs@1` | 同步，按歌取；只有 netease、qq、qishui 实现 |
| `songMetadata.getSongMetadata` | 歌曲 DTO，不设成员 | 它回的六项（歌手、专辑、时长、封面、别名、译名）方案 §4.3 的 `FoliumSourceSong` 都有。适配层从 DTO 生成内部的 `songMetadata`。它在渲染热路径上（`getProviderSongMetadata` 有 50 处调用，附录 B），适配层的实现必须是同步、不分配多余对象的读取 |

## 5. 契约之外：宿主和平台目录之间不经契约的往来

矩阵只覆盖契约成员。下面这些不在契约里，迁移时同样要有去处。

**宿主直接 import 平台目录的**（除了 `providerRegistry.ts:5-13` 的九个注册 import）：

| 位置 | import 的东西 | 方案里的去处 |
| --- | --- | --- |
| `src/utils/lyrics/lyricFileDecoding.ts:13` | `kugou/krcDecrypt` | §4.5：挪到 kit |
| `src/utils/lyrics/lyricMatchSources.ts:6` | `qq/qqLyricProvider` 的 `searchQQLyrics`、`fetchQQLyrics` | 方案没有点名这一处；按 §7 的「歌词来源注册表」，QQ 的模组自己登记来源后这个 import 才能删 |
| `src/vite-env.d.ts:78,991-1012` | 七个平台 Transport 的类型（`window.electron.*Request` 的签名） | §5.5 末段：随平台通道一起删 |

**宿主里写死平台 id 的注册表直用**（第 2 节带 ⚠ 的位置里的三处）：`src/services/localMusicService.ts:1429,1473`（本地歌匹配写死 netease，方案 §7 已列）、`src/utils/lyrics/lyricMatchSources.ts:111`（AMLL 候选的副歌写死问 netease 的 `getChorusRanges`，方案没列）。

**平台的渲染侧代码 import 的宿主模块**。方案 §6.1 规定 `sources/**` 不得 import `src/**`，所以下面每一项都要进 kit、变成公开接口，或者随模组带一份：

| 平台 | import 的宿主模块（除 `types/onlineMusic`、`types`） |
| --- | --- |
| netease | `providerStorage`、`login/loginDiagnosticReport`、`login/loginRequestLimit`、`login/loginBackendDiagnostics`、`loginSelfCheck`、`listeningRank`、`failure/onlineRequestLimit`、`exploreReads`、`services/db`、`utils/errorText`、`utils/songMetadata`、`utils/replayGain`、`utils/lyrics/neteaseProcessing`、`utils/appPlaybackGuards`、`i18n/config`、`stores/usePersonalFmModeStore` |
| kugou | `providerStorage`、`services/lyricProxy`、`login/loginRequestLimit`、`listeningRank`、`utils/lyrics/` 下的 `searchQuery`、`parserCore`、`chorusEffects`、`validity`、`pureMusic`、`formatDetection`，`utils/songMetadata`、`utils/replayGain`、`utils/errorText`、`utils/coverUrl`、`utils/appPlaybackGuards`、`i18n/config` |
| qq | `providerStorage`、`services/lyricProxy`、`fmModes`、`loginSelfCheck`、`login/loginDiagnosticReport`、`login/loginRequestLimit`、`login/loginBackendDiagnostics`、`listeningRank`、`failure/onlineRequestLimit`、`failure/onlineFailureCase`、`exploreReads`、`utils/lyrics/` 下的 `chorusEffects`、`parserCore`、`formatDetection`，`utils/coverUrl`、`utils/appPlaybackHelpers`、`utils/songMetadata`、`utils/errorText`、`i18n/config`、`types/personalFm` |
| bodian | `utils/songMetadata`、`utils/lyrics/bodianLyrics`、`utils/appPlaybackGuards` |
| ytm | `providerAccountCache`、`exploreReads`、`utils/songMetadata`、`utils/platform`、`utils/lyrics/parserCore`、`utils/errorText`、`i18n/config` |
| spotify | `exploreReads`、`services/audioCache`、`utils/songMetadata`、`utils/lyrics/parserCore`、`utils/lyrics/lrcTimestamp`、`utils/errorText`、`i18n/config` |
| qishui | `fmModes`、`exploreReads`、`login/loginDiagnosticReport`、`utils/songMetadata`、`utils/lyrics/parserCore`、`utils/appPlaybackGuards`、`i18n/config`、`types/personalFm`、`stores/usePersonalFmModeStore` |
| appleMusic | `utils/lyrics/validity`、`utils/lyrics/parserCore`、`i18n/config` |
| fnmusic | `utils/lyrics/foliaLyricDocument` |

其中方案 §6.1 的 kit 清单已经点名的有 `exploreReads`、`listeningRank`、`fmModes`、登录与请求限流、`krcDecrypt`。没有点名、又不是纯函数的有四样，S3 要给出做法：`stores/usePersonalFmModeStore`（netease、qishui 直接读宿主的 zustand store）、`services/db` 与 `providerAccountCache`（netease、ytm 直接读宿主的 IndexedDB 缓存）、`services/audioCache`（spotify）、`i18n/config`（七家，方案 §4.6 的 `FoliumText` 是去处）。歌词解析（`utils/lyrics/parserCore` 等）按方案 §4.5 改成模组交原始文本、宿主解析之后，大部分不再需要。

**契约里用 i18n key 说话的字段**（方案 §4.6 说公开契约收 `FoliumText`、适配层换成 key，这些是要换的地方）：`shortNameKey`、`ProviderAvailability.messageKey`、`ProviderNotice.textKey`、`OnlinePlaybackProvider.previewNoticeKey`、`LoginTexts.title` / `note` / `caseNotes`、`LoginMethod.labelKey` / `noteKey`、`ProviderLoginForm` 的 `labelKey` / `placeholderKey` / `submitLabelKey` / `noteKey` / `errorKeys`、`ProviderSetupView` 与 `ProviderSetupStep` 的 `titleKey` / `noteKey` / `message.key`、`ProviderSetupAction.labelKey`、`RecommendationPreferenceLabel.labelKey`。图标名一处：`LoginMethod.iconKey`。

## 6. 各平台主进程代码用到的宿主设施，对照方案 §5.5

逐个读了 `electron/<id>/`（九个目录，`.cjs` 共约一万行）和 `electron/main.cjs` 里提到平台的每一处。「去处」是方案 §5.5 的 `api` 成员；写「没有」的是 §5.5 的表没覆盖到的。

| 平台 | 用到的宿主设施（位置） | §5.5 的去处 |
| --- | --- | --- |
| netease | 工作线程里跑上游 API（`neteaseBackend.cjs`、`neteaseApiWorker.cjs`）；渲染进程直接请求本机端口（端口经 `get-netease-port`） | Node 自带；端口经 rpc |
| | 状态推给所有窗口（`main.cjs:5063-5069,5074` 的 `broadcastToWindows`，通道 `netease-api-status-changed`） | 现有的 `api.rpc.send`，只到主窗口的 client；够用，因为模组只在主窗口跑 |
| | 没接住的 rejection 写崩溃报告（`main.cjs:5076-5078` 的 `crashLog.reportError`） | **没有** |
| | app ready 之前就开线程预热（`main.cjs:5084-5088` 的 `neteaseBackend.preload()`） | **没有**：§5.2 只说 main 入口在建窗口之前启动，ready 之前这一段没提 |
| | 端口、状态、重启、诊断快照、主动自检（`electron/loginBackendIpc.cjs`，要 `app`、`safeStorage`、默认 session 的 `resolveProxy`）；出站连接记录（worker 里自建一份 `electron/networkRecorder.cjs`） | `api.diagnostics.register`（§7 已列两个文件并入） |
| | 舞台 API 读它的端口（`main.cjs:2945`） | §7 已列（`stageApi` 改问渲染进程的 omni） |
| | 上游库写在系统临时目录的 `anonymous_token`、`xeapi_public_key`（`neteaseApiWorker.cjs:73-75`，路径由上游定死） | **没有**；§5.3 的「清除数据」清单也没有它 |
| | 没有 electron-store、没有 safeStorage（会话在渲染进程的 localStorage） | 与方案 §2 第 6 条一致 |
| kugou | `store` + `safeStorage`（`main.cjs:369`；经 `electron/osEncryption.cjs`） | `api.legacy.store` + `api.seal` |
| | 证书例外 `fs.youthandroid2.kugou.com`（`main.cjs:186-205`） | 清单声明 |
| | 媒体跨域放行 `kugou.com`（`main.cjs:3863-3890`）；歌词中继放行 `kugou.com`、`kgimg.com`（`main.cjs:3918-3929`） | `api.media.allow`；清单声明 |
| | 媒体请求出错的日志（`main.cjs:3894-3903` 的 `onErrorOccurred`） | **没有**（只是日志，可以不要） |
| | 两条 IPC 通道认主窗口和遥控窗口（`main.cjs:7399-7410`，`isFirstPartyWindowContents`） | 见表后的说明 |
| qq | `store` + `safeStorage`（`main.cjs:449`）；`userData/qq-auth-state/qq-device.json`（`main.cjs:5098`） | `api.legacy.store` + `api.seal`；`api.paths.legacy` |
| | 进程内 HTTP 服务，建窗口前 `await` 启动（`main.cjs:6468`），退出时 `stop()`（`main.cjs:6796`）；状态推给所有窗口 | Node 自带；§5.2 的并行启动；`api.onBeforeQuit`（§5.5 这一行的「谁在用」没写 qq） |
| | 出站连接记录由宿主建好注入（`main.cjs:5097`）；诊断与自检同 netease | `api.diagnostics.register` |
| | 媒体跨域放行 `qq.com`、`y.gtimg.cn`；歌词中继放行同样两个域名 | `api.media.allow`；清单声明 |
| bodian | `store` + `safeStorage`（`main.cjs:378`） | `api.legacy.store` + `api.seal` |
| | 请求走 Electron `net.request`（`main.cjs:380-384` 的 `requestFactory`，回的是 `ClientRequest`，不是 fetch） | **没有**：§5.5 只有 `api.net.fetch`。要么加 `api.net.request`，要么迁移时把 bodian 改成 fetch |
| | 媒体跨域：登记地址、放行、跟随重定向（`electron/bodian/mediaCors.cjs`；`main.cjs:3877,3892`） | `api.media.allow` |
| qishui | `store` + `safeStorage`、Electron `net.fetch`（`main.cjs:374`）；媒体跨域同 bodian（`electron/qishui/mediaCors.cjs`） | `api.legacy.store` + `api.seal`；`api.net.fetch`；`api.media.allow` |
| ytm | `store` + `safeStorage`；自己的分区 `folia-ytm`，跟系统代理、不带 cookie（`main.cjs:393-402`） | `api.legacy.store` + `api.seal`；`api.net.session` |
| | 隐藏的沙箱窗口（`electron/ytm/sandbox.cjs`，要 `BrowserWindow`、`session`） | `api.windows.hidden()` |
| | 沙箱只在主窗口还在时干活（`main.cjs:392` 的 `isAllowed`），主窗口关掉时销毁（`main.cjs:6245-6246`） | **没有**：§5.5 只有 `onPlayersOrphaned`，意思是暂停外部播放器，不是「主窗口没了」的通知 |
| | 界面语言（`main.cjs:404`）；`userData/ytm-sign-in`（`main.cjs:407`）；浏览器登录起系统浏览器（`child_process`） | `api.host.locale`；`api.paths.legacy`；Node 自带 |
| | 特权协议放音频（`main.cjs:180,6430`）；Range 解析用宿主的 `electron/transcode/protocol.cjs` | `api.media.serve`；`parseRangeHeader` **没有**去处 |
| | 退出前等它收尾（`main.cjs:6702-6716`，最多 3 秒） | `api.onBeforeQuit` |
| spotify | `store` + `safeStorage`；分区 `folia-spotify`（`main.cjs:419-428`）；`shell.openExternal`、界面语言、选文件（`main.cjs:429-446`） | `api.legacy.store` + `api.seal`；`api.net.session`；`api.shell.openExternal`、`api.host.locale`、`api.dialog.pickFile` |
| | 音频存在用户设的缓存目录下（`main.cjs:431`），存完叫宿主清一遍（`main.cjs:432`） | `api.cache.dir()` / `requestPrune()` |
| | 宿主反过来问它：列出、删掉、清空它的缓存文件，和别的媒体缓存一起算一个预算（`main.cjs:4873-4884,4909,4966` 的 `audioFiles.list / remove / clear`） | **没有**：`dir()` / `requestPrune()` 是模组找宿主，这里是宿主找模组。要么让模组登记一个「缓存条目」的提供者，要么约定宿主自己扫 `api.cache.dir()` 里的文件 |
| | `userData/soloist/{data,cache}`（`main.cjs:434-437`）；主窗口没了时暂停 Soloist（`main.cjs:5424`）；退出前收尾；特权协议（`main.cjs:181,6431`，同样用 `parseRangeHeader`） | `api.paths.legacy`；`api.onPlayersOrphaned`；`api.onBeforeQuit`；`api.media.serve` |
| | librespot 原生件、`ws`、回环 HTTP 服务、子进程 | `api.native.load`；其余 Node 自带 |
| appleMusic | 伴侣程序的路径：区分打包与开发、开发时可用环境变量覆盖（`main.cjs:410-416`，`electron/appleMusic/nativePaths.cjs`） | `api.native.path`（开发时的覆盖要一并支持） |
| | `userData/apple-music-companion`（`main.cjs:417`）；主窗口没了时暂停（`main.cjs:5421`）；退出时关掉（`main.cjs:7883`，在 `will-quit` 里） | `api.paths.legacy`；`api.onPlayersOrphaned`；`api.onBeforeQuit` |
| | IPC 只认主窗口的主 frame（`electron/appleMusic/companionIpc.cjs`） | 见表后的说明 |
| | 不用 electron-store，也不用 safeStorage | §5.5 前两行把它列在「谁在用」里，只有 `api.paths.legacy` 成立 |
| fnmusic | `store` + `safeStorage`（`main.cjs:373`）；特权协议放音频和封面（`main.cjs:182,6432`） | `api.legacy.store` + `api.seal`；`api.media.serve` |
| | 直接用 Node 的 `http` / `https` 连用户自己的服务器，私网地址的自签名证书不校验（`fnmusicApiBridge.cjs:168,302`） | Node 自带；这是另一种证书例外，§5.5 的「清单声明的证书例外」只写了 kugou、qq，建议把它也列进启用确认 |

§5.5 的表没覆盖到的，合起来 **9 项**：

1. 把错误交给宿主的崩溃报告（netease）。
2. app ready 之前的预热（netease）。
3. 写在模组目录、userData、缓存目录之外的文件（netease 在系统临时目录的两个）。
4. Electron `net.request`（bodian）。
5. 「主窗口在不在」的查询和「主窗口关了」的通知（ytm）。
6. 宿主反向列出、删除、清空模组的缓存条目（spotify）。
7. 平台代码 `require` 的宿主共用模块：`electron/backendLifecycle.cjs`（netease、qq）、`electron/osEncryption.cjs`（kugou、qq，就是 `api.seal` 要包的东西）、`electron/networkRecorder.cjs`（netease 的 worker 自己建一份）、`shared/networkErrorText.cjs`（netease）、`electron/transcode/protocol.cjs` 的 `parseRangeHeader`（ytm、spotify）。方案 §6.1 规定 `sources/**` 不得 import `electron/**`，这五个要进 kit 或由 `api` 给。
8. 用户自己服务器的自签名证书（fnmusic），要不要进启用确认。
9. 媒体请求出错的日志（kugou），可以不要。

另外两点不是缺成员，是 S2 做来源校验时要定的：

- 方案 §5.4 给 `folia-mods:rpc` 加「主窗口来源校验」。现有平台通道的信任面有三种：主窗口（qishui、bodian、ytm、spotify、fnmusic）、主窗口加遥控窗口（kugou 的两条通道和 `loginBackendIpc.cjs` 的全部通道）、主窗口的主 frame（appleMusic）。遥控窗口的代码不调 omni（`src/components/remote/` 里只用了 `externalClock`），模组也只在主窗口启动（`src/bootstrap.tsx:58-61`），所以收紧到主窗口不会断功能；但 appleMusic 现在多一层主 frame 的检查，rpc 的校验建议照它做到 frame。
- `preload.cjs:172-198` 这一段里，172 行的 `fetchLyricProxy` 宿主自己的 AMLL 来源也在用（`src/utils/lyrics/providers/amllApi.ts`），175-176 行的 `getLoginDiagnostics`、`runLoginSelfCheck` 是按 providerId 的通用通道；`main.cjs:3918-3929` 的歌词中继域名表里有宿主自己的 `api.amll.dev`。这几处不能随平台块整段删。

## 7. 与方案不符之处

共 **11 条**。前三条影响设计，其余是清单和数字上的出入。

1. **窗口重建后，没被接手的外部播放不会自动重新播放**（§4.2「新窗口按交接位置重新 `play(item, startSec)`」，§13 第二条）。现在的代码：`adoptExternalPlayback`（`src/services/onlineMusic/externalPlayback.ts:595-647`）问一次播放器的状态；状态不是这首歌、或者问不到，就回 `false`，路线退回 `web`；调用方（`src/components/app/playback/restore/useElectronWindowPlaybackHandoff.ts:386-401`）接着把播放器暂停（失败只记日志）、把这首歌显示成暂停，等用户按播放才重新开始（`restorePlaybackSource.ts:382-399` 的注释也是这么写的）。过程是干净的，不抛错、不双重出声，但结果是「停在原位置、暂停」，不是「重新播放」。`surface` 要做到方案说的效果，S6 得加一段：交接快照说在播、接手失败、这首歌是 `surface` 路线时，按交接位置调 `play`。音源没有实现 `adopt` 本身不是问题：`omni.adoptExternalPlayback`（`omni.ts:1135-1137`）用可选链调它，没有就什么都不做；Spotify 现在就是有 `externalPlayback`、没有 `adopt` 的音源，接手靠路线自己完成。
2. **25 个开关里有两个不能从「成员在不在」推导**（§4.1）。`personalFmModes`：netease、qishui 为 true，可是 `getPersonalFmCatalog` 是 qq、qishui 实现的，两边对不上（netease 没有这个成员，模式表用的是宿主里的默认表，见第 10 条；qq 有这个成员但开关是 false）。它得在 `recommendations@1` 里明写。`wordByWordLyrics`：六家为 true，宿主没有任何地方读它，可以直接删；`userCloud`、`listeningRank` 同样没有读它的地方（宿主直接看 `getCloudCollection`、`getListeningRankCollections` 在不在），这两个推导得出来，只是不用推导。另外 `songDetail` 没有任何内置音源设，只有模组适配层在用（`omniProviders.ts:77`，读在 `src/mods/runtime/omni/omniDto.ts:103`）。
3. **「成员与内部契约的对应子接口一一对应」不成立**（§4.1）。内部是 13 个子接口，公开是 15 个能力：`playback` 拆成 `songs` 和 `playback.audio`；`songMetadata` 没有对应的能力（由歌曲 DTO 取代）；`covers`、`playback.surface` 没有内部的前身；顶层还有 13 个成员不属于任何子接口，其中 4 个归不进能力（第 4 节）。
4. **§5.5「谁在用」有四处和代码对不上**：bodian 用的是 `net.request` 不是 `api.net.fetch`；没有任何平台代码调 `resolveProxy`（ytm、spotify 用的是分区的 `setProxy({ mode: 'system' })`，`resolveProxy` 只在自检里，`loginBackendIpc.cjs:104`）；appleMusic 不用 electron-store 和 safeStorage；`api.onBeforeQuit` 的使用者还有 qq。
5. **§5.5 的表缺 9 项设施**，见第 6 节。
6. **§5.5 末段的 `main.cjs` 平台块行号清单不全**。清单是 `158-205, 367-449, 3850-3929, 5054-5100, 5419-5427, 6430-6432, 6702-6720, 7378-7463`；漏了 `71-86`（平台模块的 `require`）、`2945`（`getNeteasePort`）、`4873-4884`、`4909`、`4966`（Spotify 的缓存文件进媒体缓存预算）、`6245-6246`（销毁 YouTube Music 的沙箱窗口）、`6796`（`qqBackend.stop()`）、`7883`（`appleMusicClient.close()`）；`6467-6468` 只在 §5.4 提到。清单里的 `3850-3929` 和 `preload.cjs:172-198` 各含宿主自己要留的行（第 6 节末尾）。
7. **§2 第 10 条的测试数只算了渲染侧**。直接 import `src/services/onlineMusic/<id>/` 的测试文件是 94 个，和方案一致；import `electron/<id>/` 的测试文件有 56 个，其中 36 个不在那 94 个里，合起来 130 个。S4 的夹具和 S5 的路径批量改要算上这 36 个。
8. **§5.3 的「清除数据」清单漏了网易云在系统临时目录的两个文件**（第 6 节）。
9. **§11 引用的 `local-windows-installer-build` 不在仓库里**。`skills/` 下没有这个 skill，`AGENTS.md` 的 skill 索引里也没有；实施的人按名字找不到它。
10. **网易云的 FM 模式表在宿主里，§7 的去硬编码表没有这一行**。`src/services/onlineMusic/fmModes.ts:98-100` 的 `DEFAULT_PERSONAL_FM_CATALOG` 是网易云的模式和场景；`omni.getPersonalFmCatalog`（`omni.ts:951-953`）在音源没有 `getPersonalFmCatalog` 时回它。方案 §6.1 把 `fmModes` 整个归进 kit 的共用函数；这张默认表应当搬进网易云的模组、由它实现 `getPersonalFmCatalog`，宿主的默认值改成空。
11. **§7 的去硬编码表漏了两处**：`src/utils/lyrics/lyricMatchSources.ts:111`（AMLL 候选的副歌写死问 netease）和同文件第 6 行对 `qq/qqLyricProvider` 的直接 import（第 5 节）。

`deps.asar` 样例里发现的三件和方案假设有出入的事，写在 `dev/folium/folium-2-plan.md` 第 13 节那一条下面，这里不重复。

核对过、和代码一致的：方案里引用的行号（§2、§4、§5.4、§7 抽查了 43 处，都指到了说的那段代码；其中 `modProtocol.cjs:98-128` 是请求处理函数，要改的扩展名表在同文件第 73 行）；「约 30 个同步成员」；`externalPlayback.isStatusForSong` 在 500 ms 轮询里（`externalPlayback.ts:25`）；`omni.providers` 是四个方法的简化音源；bodian 主进程 176 行；直接 import 渲染侧平台目录的测试 94 个、import `providerRegistry` 或 `omni` 的测试 88 个；网易云后端没有关闭入口（`neteaseBackend.cjs:83-90`）；`providerStorage` 的会话键是 `online_provider:<id>:<key>`、用它的平台目录正好是 netease、kugou、qq 三家；`node_modules` 里有 rolldown、没有 esbuild；`folia-mod://` 协议已经带 `stream` 和 `corsEnabled`（`modProtocol.cjs:86-94`）。

## 8. 没有验证到的

- 方案 §13 第三条：各平台依赖闭包的文件数和体积（网易云 4778 个文件 / 47.8 MB、QQ 2567 个文件）没有重新量。
- 方案 §8 的「约 40 处判断，Provider 本身各 1 处」（netease、kugou、qq 区分桌面与网页的代码量）没有数。
- 「内置实现」一列取自 Node 环境下的运行时对象。九家的 Provider 对象里没有按环境增减成员的写法，但成员内部按环境走不同分支的情况（例如 `getAvailability` 在网页版回 `runtime-unavailable`）这份表不反映。
- 「宿主读它的地方」靠语言服务的语义引用。按名字取成员的写法找到并补了两类（`askProviderCache`、`providerSupports`）。在 `src/` 里搜过 `playback?.[名字]` 这种写法（十三个子接口的名字加 `provider`），平台目录之外只有 `providerRegistry.ts:85` 一处；经过中间变量再按名字取的写法，这种搜法找不到。
- 第 6 节只读了主进程代码怎么用宿主设施，没有运行各平台去核对。Windows 以外系统上的分支（macOS 的 Apple Music 伴侣程序、Linux 的 safeStorage 后端）只读了代码。
- 第 4.1 节建议 `normalizeUser`、`normalizeCollection` 不进契约，前提是旧快照能由适配层整理；九家里谁的旧快照形状真的和现在不同，没有逐家核对。

## 附录 A：omni 方法 → 宿主调用方

只列第 2 节里出现过的 omni 方法（碰到契约成员的那些）。行号是调用处；测试文件单列在后面。`src/services/onlineMusic/omni.ts` 自己内部的互相调用也算在内。

| omni 方法（omni.ts 行号） | 宿主调用方 | 测试 |
| --- | --- | --- |
| `omni.getProviderSummaries`（531） | `src/services/onlineMusic/omni.ts:555` `src/library/core/account/providerAccountDeps.service.ts:49` `src/components/app/search/searchSources.ts:67` `src/hooks/useLyricMatchSources.ts:14` `src/services/onlineMusic/playbackReportGate.ts:47` `src/components/app/scratchpad/useScratchpadHistory.ts:22` `src/hooks/useAccountReads.ts:33` `src/mods/runtime/hostAccount.ts:102,126` `src/mods/runtime/omni/omniResolveCache.ts:71,81` `src/mods/runtime/omni/hostOmni.ts:143,433` | `unit/onlineMusic/omni.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.isSongLiked`（560） | `src/services/onlineMusic/omni.ts:578,1519,1525` `src/components/app/AddToPlaylistHost.tsx:188` `src/utils/resolveSongLiked.ts:32` | `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/omniLikePresses.test.ts` |
| `omni.getActiveCapabilities`（583） | `src/library/core/collection/dailyRecommendationLoad.service.ts:12` `src/components/command-palette/commands/navigationCommands.ts:51` `src/components/modal/settings/pages/HomePage.tsx:103` | `unit/onlineMusic/omni.test.ts` |
| `omni.getProviderCapabilities`（587） | `src/library/core/home/online/onlineHomeProvider.service.ts:26` `src/library/core/account/providerAccountDeps.service.ts:38` `src/services/onlineMusic/playbackReportGate.ts:48` `src/hooks/usePersonalFmModeController.ts:70` `src/mods/runtime/omni/hostOmni.ts:144,434` | `unit/onlineMusic/omni.test.ts` |
| `omni.supportsDailySongs`（591） | `src/library/core/home/online/onlineHomeFeedDeps.service.ts:13` | `unit/onlineMusic/bodianReview.test.ts` |
| `omni.getProviderLabel`（595） | `src/components/login/PlatformMark.tsx:16` `src/components/panelTab/OnlineLyricsTab.tsx:46` `src/utils/playerLikeAvailability.ts:39` `src/library/core/home/online/onlineHomeProvider.service.ts:32` `src/library/core/account/providerAccountDeps.service.ts:50` `src/services/onlineMusic/failure/onlineFailureTexts.ts:84` `src/mods/manager/ModListItem.tsx:44` `src/components/app/search/SearchTabs.tsx:24` `src/components/app/AddToPlaylistHost.tsx:63` `src/components/app/scratchpad/scratchpadModel.ts:14` `src/components/app/dialogs/useProviderSignOut.ts:27` `src/components/app/playback/bridges/useElectronPlaybackBridge.ts:190` `src/components/app/playback/start/useLibraryPlaybackController.ts:475,1769` | `unit/onlineMusic/onlineFailureTexts.test.ts` |
| `omni.searchSongs`（602） | `src/mods/runtime/omni/hostOmni.ts:209` | `unit/onlineMusic/omni.test.ts` |
| `omni.searchProviderSongs`（609） | `src/stores/useSearchNavigationStore.ts:181` `src/components/app/playback/start/useLibraryPlaybackController.ts:1025` `src/components/app/stage/useStagePlayerSearchBridge.ts:30` `src/mods/runtime/omni/hostOmni.ts:205` | `unit/onlineMusic/omni.test.ts` |
| `omni.getProviderSearchKinds`（622） | `src/services/onlineMusic/omni.ts:641` `src/stores/useSearchNavigationStore.ts:91` | `unit/onlineMusic/omniSearchCollections.test.ts` |
| `omni.searchProviderCollections`（635） | `src/stores/useSearchNavigationStore.ts:192` | `unit/onlineMusic/omniSearchCollections.test.ts` |
| `omni.getProviderMark`（651） | `src/components/login/PlatformMark.tsx:16` | `unit/login/loginDoneFrame.test.ts` `unit/login/loginModuleKnowsNoPlatform.test.ts` |
| `omni.getLoginTexts`（656） | `src/library/core/account/providerAccountDeps.service.ts:33` | `unit/login/loginModuleKnowsNoPlatform.test.ts` `unit/login/loginView.test.ts` `unit/onlineMusic/loginFailurePlatforms.test.ts` `unit/onlineMusic/qqLoginMethod.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.watchProviders`（662） | `src/components/app/useProviderNotices.ts:11` | `unit/onlineMusic/providerWatch.test.ts` |
| `omni.getLoginLocalService`（668） | `src/library/core/account/providerAccountDeps.service.ts:34` | `unit/login/loginModuleKnowsNoPlatform.test.ts` |
| `omni.getLoginMethods`（673） | 没有调用方 | `unit/onlineMusic/qqLoginMethod.test.ts` |
| `omni.resolveLoginMethods`（677） | `src/library/core/account/providerAccountDeps.service.ts:25` | `unit/onlineMusic/qqLoginMethod.test.ts` |
| `omni.getLoginForm`（685） | `src/components/login/window/loginView.ts:82` `src/components/login/window/FormLogin.tsx:20` `src/components/login/LoginHost.tsx:54` | `unit/login/formLogin.test.ts` |
| `omni.submitLoginForm`（690） | `src/library/core/account/providerAccountDeps.service.ts:77` | `unit/login/formLogin.test.ts` |
| `omni.startLogin`（697） | `src/library/core/account/providerAccountDeps.service.ts:26` | `unit/onlineMusic/loginFailurePlatforms.test.ts` `unit/onlineMusic/qqLoginMethod.test.ts` `unit/spotify/spotifyLoginFailure.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.confirmsLoginInBrowser`（708） | `src/library/core/account/providerAccountDeps.service.ts:29` | `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.opensLoginPageItself`（714） | `src/library/core/account/providerAccountDeps.service.ts:30` | — |
| `omni.openLoginPage`（718） | `src/library/core/account/providerAccountDeps.service.ts:31` | `unit/spotify/spotifyLoginFailure.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.checkLogin`（724） | `src/library/core/account/providerAccountDeps.service.ts:27` | `unit/onlineMusic/loginFailurePlatforms.test.ts` `unit/spotify/spotifyLoginFailure.test.ts` |
| `omni.cancelLogin`（731） | `src/library/core/account/providerAccountDeps.service.ts:28` | — |
| `omni.getLoginDiagnostics`（736） | `src/library/core/account/providerAccountDeps.service.ts:35` | `unit/login/loginDiagnosticReport.test.ts` `unit/onlineMusic/qqLoginMethod.test.ts` |
| `omni.canRunLoginSelfCheck`（746） | `src/library/core/account/providerAccountDeps.service.ts:36` | — |
| `omni.runLoginSelfCheck`（750） | `src/library/core/account/providerAccountDeps.service.ts:37` | — |
| `omni.checksAfterLogin`（755） | `src/library/core/account/providerAccountDeps.service.ts:39` | — |
| `omni.checkAfterLogin`（760） | `src/library/core/account/providerAccountDeps.service.ts:40` | — |
| `omni.hasSetup`（765） | `src/components/login/LoginHost.tsx:147` `src/library/core/account/providerAccountDeps.service.ts:41` `src/components/command-palette/commands/providerSetupCommand.ts:19` `src/components/app/playback/start/usePlaybackQueueController.ts:221` | `unit/playback/onlinePlaybackStop.test.ts` |
| `omni.getSetup`（769） | `src/library/core/account/providerAccountDeps.service.ts:42` | — |
| `omni.runSetupAction`（773） | `src/library/core/account/providerAccountDeps.service.ts:43` | — |
| `omni.getLoginTtlMs`（780） | `src/library/core/account/providerAccountDeps.service.ts:32` | `unit/onlineMusic/qqLoginMethod.test.ts` `unit/spotify/spotifyProvider.test.ts` |
| `omni.getUserPlaylists`（785） | 没有调用方 | — |
| `omni.readAccount`（793） | `src/library/core/account/providerAccountDeps.service.ts:69` `src/hooks/useAccountReads.ts:34` | `dev/probes/homeBehavior/useHomeProbeHarness.ts` `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/neteaseAccountKept.test.ts` |
| `omni.signOutAccount`（799） | `src/components/app/dialogs/useProviderSignOut.ts:38` | `dev/probes/accountBehavior/useAccountProbeHarness.ts` `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/neteaseAccountKept.test.ts` |
| `omni.refreshProviderPlaylists`（806） | `src/services/onlineMusic/omni.ts:1444,1484,1489` `src/App.tsx:811` | `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/omni.test.ts` |
| `omni.getPlaylistsForSong`（811） | `src/components/app/AddToPlaylistHost.tsx:118,123` | `unit/onlineMusic/omni.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.canAddSongToPlaylist`（829） | `src/services/onlineMusic/omni.ts:842,1467` `src/stores/useAddToPlaylistStore.ts:62` `src/components/app/AddToPlaylistHost.tsx:57` `src/components/app/playback/start/useLibraryPlaybackController.ts:472` | `unit/onlineMusic/omni.test.ts` `unit/qishui/capabilities.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.canCreatePlaylistForSong`（839） | `src/services/onlineMusic/omni.ts:1436` `src/components/app/AddToPlaylistHost.tsx:58` | `unit/qishui/capabilities.test.ts` `unit/spotify/spotifyProvider.test.ts` |
| `omni.canLikeSong`（846） | `src/services/onlineMusic/omni.ts:1511` `src/components/panelTab/FmTab.tsx:59` `src/stores/useAddToPlaylistStore.ts:62` `src/utils/playerLikeAvailability.ts:34` `src/components/app/AddToPlaylistHost.tsx:60,118` `src/components/app/playback/bridges/useElectronPlaybackBridge.ts:186` `src/components/app/playback/start/useLibraryPlaybackController.ts:1765` | `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/qqOmniGates.test.ts` `unit/qishui/capabilities.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.canEditCollectionTracks`（855） | 没有调用方 | `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/qqOmniGates.test.ts` `unit/qishui/capabilities.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.canDislikeSong`（867） | `src/services/onlineMusic/omni.ts:1599` `src/utils/playerLikeAvailability.ts:54` `src/components/app/playback/bridges/usePlaybackInteractionBridge.ts:221` | `unit/onlineMusic/omni.test.ts` `unit/qishui/capabilities.test.ts` |
| `omni.canDislikeCollectionSongs`（876） | 没有调用方 | — |
| `omni.canSubscribeCollection`（882） | `src/services/onlineMusic/omni.ts:1401` | `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/qqOmniGates.test.ts` `unit/qishui/capabilities.test.ts` `unit/spotify/spotifyProvider.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.getUserAlbums`（899） | `src/library/core/home/online/onlineHomeFeedDeps.service.ts:10` | — |
| `omni.getLikedSongIds`（904） | 没有调用方 | — |
| `omni.getProviderLikedSongIds`（908） | `src/services/onlineMusic/omni.ts:463` | — |
| `omni.getCloudCollection`（912） | 没有调用方 | — |
| `omni.getHomeFeed`（916） | `src/library/core/home/online/onlineHomeFeedDeps.service.ts:11` | `unit/library/app/libraryHomePreferenceSaves.test.ts` `unit/onlineMusic/bodianReview.test.ts` `unit/onlineMusic/qqOmniGates.test.ts` |
| `omni.getPersonalFmCatalog`（951） | `src/library/app/createLibraryHomePort.ts:82` `src/hooks/usePersonalFmCatalog.ts:10` | `unit/onlineMusic/omni.test.ts` |
| `omni.getPersonalFmStationCatalog`（956） | `src/library/app/createLibraryHomePort.ts:76` `src/hooks/usePersonalFmCatalog.ts:24` | `unit/onlineMusic/omni.test.ts` |
| `omni.getPersonalFm`（960） | `src/library/app/createLibraryHomePort.ts:109` `src/library/core/collection/resource/createCollectionResource.service.ts:20` `src/components/app/playback/start/usePlaybackQueueController.ts:1397` `src/hooks/usePersonalFmModeController.ts:133` | `unit/onlineMusic/omni.test.ts` |
| `omni.getDailySongs`（964） | `src/library/core/collection/dailyRecommendationLoad.service.ts:19` | — |
| `omni.getRecommendationHistory`（968） | 没有调用方 | — |
| `omni.getRecommendationHistoryDates`（972） | 没有调用方 | — |
| `omni.getRecommendationHistorySongs`（976） | 没有调用方 | — |
| `omni.getDailyStyleGroups`（982） | 没有调用方 | — |
| `omni.getDailyStyleSongs`（986） | `src/library/core/collection/dailyRecommendationLoad.service.ts:15` | — |
| `omni.setDailyStyle`（992） | 没有调用方 | — |
| `omni.supportsRecommendationPreferences`（1003） | `src/components/recommendationPreferences/useRecommendationPreferencesStore.ts:16` | `unit/onlineMusic/recommendationPreferences.test.ts` |
| `omni.getRecommendationPreferenceEntries`（1007） | `src/components/recommendationPreferences/useRecommendationPreferencesStore.ts:31` | `unit/onlineMusic/recommendationPreferences.test.ts` |
| `omni.getRecommendationPreferences`（1014） | `src/components/recommendationPreferences/useRecommendationPreferencesStore.ts:75` | `unit/onlineMusic/recommendationPreferences.test.ts` |
| `omni.saveRecommendationPreferences`（1022） | `src/components/recommendationPreferences/useRecommendationPreferencesStore.ts:106` | `unit/onlineMusic/recommendationPreferences.test.ts` |
| `omni.supportsExplore`（1044） | 没有调用方 | `unit/ytm/ytmOmni.test.ts` |
| `omni.getExploreFeed`（1051） | `src/stores/useExploreFeedStore.ts:105` | `unit/ytm/ytmOmni.test.ts` |
| `omni.getExploreSectionItems`（1055） | `src/stores/useExploreFeedStore.ts:190,448` | `unit/ytm/ytmOmni.test.ts` |
| `omni.exploreSongsShownAs`（1060） | `src/components/app/home/explore/ownSections.ts:35` | — |
| `omni.getSongDetail`（1065） | `src/services/lyricExport/resolveExportMetadata.ts:133` `src/components/app/playback/start/usePlaybackQueueController.ts:1658,1720` `src/components/app/playback/start/useLibraryPlaybackController.ts:1003` | `unit/mod-system/foliumExperimental.test.ts` `unit/qishui/failure.test.ts` |
| `omni.getSongDetails`（1077） | `src/mods/runtime/omni/hostOmni.ts:233,235` | `unit/onlineMusic/omni.test.ts` `unit/qishui/failure.test.ts` |
| `omni.canPlaySong`（1114） | `src/services/onlineMusic/externalPlayback.ts:183` `src/services/prefetchService.ts:315` `src/components/app/playback/playableSong.ts:19,28` `src/components/app/playback/start/usePlaybackQueueController.ts:836` `src/components/app/playback/restore/restorePlaybackSource.ts:401` | `unit/prefetchAnalysisScope.test.ts` `unit/onlineMusic/omni.test.ts` |
| `omni.playSongExternally`（1125） | `src/services/onlineMusic/externalPlayback.ts:248,549` | — |
| `omni.adoptExternalPlayback`（1135） | `src/services/onlineMusic/externalPlayback.ts:633` | — |
| `omni.isExternalPlaybackPrepared`（1139） | `src/components/app/playback/start/usePlaybackQueueController.ts:653` | — |
| `omni.prepareExternalPlaybackQueue`（1143） | `src/services/onlineMusic/externalPlayback.ts:187` | — |
| `omni.pauseExternalPlayback`（1149） | `src/services/onlineMusic/externalPlayback.ts:318,563,730,775,802` | — |
| `omni.resumeExternalPlayback`（1155） | `src/services/onlineMusic/externalPlayback.ts:814` | — |
| `omni.seekExternalPlayback`（1161） | `src/services/onlineMusic/externalPlayback.ts:835` | — |
| `omni.setExternalPlaybackVolume`（1168） | `src/services/onlineMusic/externalPlayback.ts:480` | — |
| `omni.setExternalPlaybackRepeatOne`（1175） | `src/services/onlineMusic/externalPlayback.ts:277,780` | — |
| `omni.getExternalPlaybackStatus`（1182） | `src/services/onlineMusic/externalPlayback.ts:433,580,618` | — |
| `omni.isExternalPlaybackStatusForSong`（1188） | `src/services/onlineMusic/externalPlayback.ts:311,623` | — |
| `omni.getAudioQualityLevels`（1195） | `src/components/panelTab/AccountTab.tsx:69` | `unit/spotify/spotifyRecommendations.test.ts` `unit/ytm/ytmUltra.test.ts` |
| `omni.resolveAudioQuality`（1201） | `src/components/panelTab/AccountTab.tsx:71` `src/services/prefetchService.ts:265` `src/services/onlinePlayback.ts:62` | `unit/spotify/spotifyRecommendations.test.ts` `unit/ytm/ytmUltra.test.ts` |
| `omni.getAudioSource`（1205） | `src/services/prefetchService.ts:278` `src/services/onlinePlayback.ts:146` | `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/omniAudioFailure.test.ts` `unit/onlineMusic/onlineFailurePlatforms.test.ts` `unit/qishui/capabilities.test.ts` `unit/spotify/spotifyRecommendations.test.ts` `unit/ytm/ytmUltra.test.ts` |
| `omni.previewNoticeKey`（1256） | `src/components/app/playback/source/previewNotice.ts:53` | — |
| `omni.canReportPlayback`（1275） | `src/components/app/playback/bridges/usePlaybackReporter.ts:36` | `unit/onlineMusic/omni.test.ts` |
| `omni.reportPlayback`（1281） | `src/services/onlineMusic/playbackReportGate.ts:107` | `unit/onlineMusic/omni.test.ts` |
| `omni.getLyrics`（1289） | `src/services/prefetchService.ts:383` `src/services/onlinePlayback.ts:270` `src/components/app/playback/restore/restorePlaybackSource.ts:464` `src/components/app/playback/start/useLibraryPlaybackController.ts:393,1029,1626` `src/mods/runtime/omni/hostOmni.ts:318` | `unit/mod-system/foliumExperimental.test.ts` `unit/mod-system/foliumOmni.test.ts` `unit/onlineMusic/omni.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.getChorusRanges`（1304） | 没有调用方 | `unit/onlineMusic/omni.test.ts` |
| `omni.prefersOwnWordByWordLyrics`（1311） | `src/services/prefetchService.ts:415` `src/services/onlinePlayback.ts:216` | — |
| `omni.getLyricSearchAlias`（1316） | `src/services/prefetchService.ts:431` `src/services/onlinePlayback.ts:313` `src/components/app/playback/start/useLibraryPlaybackController.ts:1633` | — |
| `omni.getAlternateArtistName`（1321） | `src/services/prefetchService.ts:430` `src/services/onlinePlayback.ts:312` `src/components/app/playback/start/useLibraryPlaybackController.ts:1632` | `unit/ytm/ytmOmni.test.ts` |
| `omni.getSongAvailability`（1325） | `src/mods/runtime/omni/hostOmni.ts:306` | — |
| `omni.getSongReplacement`（1331） | `src/components/app/playback/start/usePlaybackQueueController.ts:788,791` | `unit/playback/onlinePlaybackStop.test.ts` |
| `omni.getCollectionTracks`（1336） | `src/library/core/collection/resource/createCollectionResource.service.ts:18` `src/mods/runtime/omni/hostOmni.ts:408` | `unit/onlineMusic/omni.test.ts` `unit/onlineMusic/onlineFailurePlatforms.test.ts` `unit/qishui/capabilities.test.ts` |
| `omni.getAlbumDetail`（1370） | `src/mods/runtime/omni/hostOmni.ts:369` | — |
| `omni.getCollectionDetail`（1374） | `src/library/core/collection/resource/createCollectionResource.service.ts:19` | — |
| `omni.getArtistDetail`（1381） | `src/library/core/artist/artistResourceDeps.service.ts:13` `src/mods/runtime/omni/hostOmni.ts:369` | — |
| `omni.getArtistSongs`（1385） | `src/library/core/artist/artistResourceDeps.service.ts:14` `src/mods/runtime/omni/hostOmni.ts:408` | — |
| `omni.getArtistAlbums`（1389） | `src/library/core/artist/artistResourceDeps.service.ts:15` `src/mods/runtime/omni/hostOmni.ts:421` | — |
| `omni.getSubscriptionStatus`（1393） | 没有调用方 | `unit/onlineMusic/omni.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.subscribe`（1399） | 没有调用方 | `unit/onlineMusic/omni.test.ts` `unit/ytm/ytmOmni.test.ts` |
| `omni.updateCollectionTracks`（1412） | `src/services/onlineMusic/omni.ts:1478` | `unit/onlineMusic/omni.test.ts` `unit/qishui/capabilities.test.ts` |
| `omni.createPlaylistWithSongs`（1432） | `src/services/onlineMusic/omni.ts:1428` `src/components/app/playback/start/useLibraryPlaybackController.ts:498` | — |
| `omni.addSongsToPlaylist`（1457） | `src/services/onlineMusic/omni.ts:1441,1450` `src/components/app/playback/start/useLibraryPlaybackController.ts:483` | `unit/onlineMusic/omni.test.ts` |
| `omni.pressSongLike`（1509） | `src/services/onlineMusic/omni.ts:1535` `src/components/app/playback/start/useLibraryPlaybackController.ts:1778` | `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/omniLikePresses.test.ts` `unit/player-panel/playerPanelLikedState.test.ts` |
| `omni.endLikedListRead`（1564） | `src/library/core/collection/resource/createCollectionResource.service.ts:26` | `unit/onlineMusic/omniLikePresses.test.ts` `unit/onlineMusic/omniLikedChecks.test.ts` |
| `omni.accountMoment`（1578） | `src/hooks/useAccountReads.ts:42,51` | `unit/onlineMusic/accountRead.test.ts` `unit/onlineMusic/omniAccountMoments.test.ts` `unit/onlineMusic/omniLikedChecks.test.ts` |
| `omni.songsInPlay`（1588） | `src/hooks/useAccountReads.ts:63` | `unit/onlineMusic/omniLikedChecks.test.ts` |
| `omni.dislikeSong`（1597） | `src/components/app/playback/bridges/usePlaybackInteractionBridge.ts:223` | `unit/onlineMusic/omni.test.ts` `unit/qishui/capabilities.test.ts` |
| `omni.canResolveCatalogRef`（1605） | `src/hooks/useOnlineSongMetadataHydration.ts:39` `src/mods/runtime/omni/hostOmni.ts:328` | — |
| `omni.resolveCatalogRefs`（1612） | `src/hooks/useOnlineSongMetadataHydration.ts:43` | — |
| `omni.getSongPageUrl`（1631） | `src/mods/runtime/omni/hostOmni.ts:307` | — |
| `omni.getRawRequestInfo`（1639） | `src/mods/folium/platformRaw.ts:112,131` | `unit/onlineMusic/neteaseRaw.test.ts` |
| `omni.describeRawEndpoint`（1645） | `src/mods/folium/platformRaw.ts:133` | — |
| `omni.checkRawParams`（1651） | `src/mods/folium/platformRaw.ts:146` | — |
| `omni.requestProviderRaw`（1658） | `src/mods/folium/platformRaw.ts:184` | `unit/onlineMusic/neteaseRaw.test.ts` |

第 2 节没有出现的 omni 方法（不碰契约成员，只管账号缓存、音频地址的记录等）：`invalidateActiveRequests`、`getActiveRequestGeneration`、`subscribeProviders`、`getProviderRegistryVersion`、`getActiveProviderSummary`、`toggleSongLike`、`subscribeRecommendationPreferenceSaves`、`canPlayExternally`、`levelOfAudioSource`、`isPreviewAudioSource`、`audioSourceMetadataVersion`、`previewClipStartMsOfAudioSource`、`createPlaylistWithSong`、`addSongToPlaylist`、`likeSong`、`beginLikedListRead`、`getSongCatalogRefs`。

## 附录 B：绕过 omni 的函数 → 调用方

第 2 节里带 ⚠ 的位置所在的函数，和调用这些函数的地方。S1 去硬编码、S3 写适配层时，这些调用方看到的行为不能变。

| 函数（文件:行号） | 调用方（不含测试） | 测试 |
| --- | --- | --- |
| `platformAccess`（`src/utils/lyrics/lyricMatchSources.ts:125`） | `src/utils/lyrics/lyricMatchSources.ts:164` | — |
| `matchLyrics`（`src/services/localMusicService.ts:1335`） | `src/components/app/playback/start/useLibraryPlaybackController.ts:538,664` | 1 个文件：`unit/services/localMusicLyricsMatch.test.ts` |
| `getSongAvailability`（`src/services/onlineMusic/songAvailability.ts:12`） | `src/services/onlineMusic/songAvailability.ts:20,28` | 1 个文件：`unit/onlineMusic/providerRegistry.test.ts` |
| `getSongReplacement`（`src/services/onlineMusic/songAvailability.ts:38`） | 没有 | 1 个文件：`unit/onlineMusic/providerRegistry.test.ts` |
| `askPlayedSong`（`src/services/onlineMusic/songAvailability.ts:49`） | `src/components/app/playback/start/usePlaybackQueueController.ts:576` | — |
| `keepsOwnSongAudio`（`src/services/onlineMusic/providerRegistry.ts:77`） | `src/services/automix/profileService.ts:320,401` `src/services/playedTrackCache.ts:74` | — |
| `canPlayOnlineMusicSong`（`src/services/onlineMusic/providerRegistry.ts:97`） | 没有 | 1 个文件：`unit/onlineMusic/providerRegistry.test.ts` |
| `matchUnderArtist`（`src/utils/lyrics/autoMatchBestLyric.ts:172`） | `src/utils/lyrics/autoMatchBestLyric.ts:491,508,521` | — |
| `autoMatchBestLyric`（`src/utils/lyrics/autoMatchBestLyric.ts:485`） | `src/services/prefetchService.ts:426` `src/services/localMusicService.ts:1362` `src/services/onlinePlayback.ts:308` `src/components/app/playback/start/useLibraryPlaybackController.ts:977,1527,1578,1628` | 5 个文件：`unit/lyrics/autoMatchBestLyric.test.ts` `unit/lyrics/autoMatchNonPlatformSource.test.ts` `unit/lyrics/lyricSourceStoredValues.test.ts` `unit/qishui/localSongMatch.test.ts` `unit/services/localMusicLyricsMatch.test.ts` |
| `fetchAmllDbCandidateLyrics`（`src/utils/lyrics/lyricMatchSources.ts:103`） | `src/utils/lyrics/lyricMatchSources.ts:143` | — |
| `getProviderChorusRanges`（`src/utils/lyrics/autoMatchBestLyric.ts:32`） | `src/utils/lyrics/autoMatchBestLyric.ts:322` | — |
| `getProviderSongMetadata`（`src/services/onlineMusic/songMetadata.ts:10`） | `src/services/onlineMusic/songMetadata.ts:31,35,39,43` `src/services/sync/syncFingerprint.ts:21,40` `src/utils/playbackSongMeta.ts:14,25` `src/components/panelTab/shell/SongHeader.tsx:39` `src/components/panelTab/shell/SongCredits.tsx:42` `src/services/prefetchService.ts:423,494` `src/utils/lyrics/matchResult.ts:17,21,25,29,38` `src/services/onlineMetadataSearchService.ts:77` `src/services/localMusicService.ts:1446` `src/components/command-palette/queueSearchIndex.ts:45,68` `src/utils/songNameFormatter.tsx:11` `src/components/command-palette/queueSongMatches.ts:11,14` `src/components/app/search/SearchResultRow.tsx:51` `src/components/modal/lyric-match/NavidromeSongLyricMatch.tsx:30` `src/components/modal/lyric-match/OnlineSongLyricMatch.tsx:24` `src/components/modal/UnavailableReplacementDialog.tsx:50` `src/services/onlinePlayback.ts:304` `src/utils/stagePlayerSnapshot.ts:34,48,117,123,214` `src/components/app/playback/start/usePlaybackQueueController.ts:245,1603` `src/components/hifi/useHifiMpris.ts:77` `src/utils/appNavidromeLyrics.ts:84` `src/services/playedTrackCache.ts:126` `src/components/app/playback/start/useLibraryPlaybackController.ts:971,1005,1080,1575,1622` `src/hooks/useNavidromeScrobbleReporter.ts:64,86,87` `src/components/app/playback/bridges/usePlaybackReporter.ts:41` `src/components/app/stage/useStagePlayerSearchBridge.ts:15` | — |
| `createProviderAccountController`（`src/library/core/account/providerAccountController.service.ts:160`） | `src/library/app/useLibraryAccountController.ts:29` | 2 个文件：`dev/probes/loginAccountTab.probe.tsx` `unit/library/core/providerAccountController.test.ts` |
| `createAccountReads`（`src/services/onlineMusic/account/accountRead.ts:161`） | `src/services/onlineMusic/omni.ts:471` | — |
| `playlistsOf`（`src/services/onlineMusic/account/accountRead.ts:145`） | `src/services/onlineMusic/account/accountRead.ts:371,443` | — |
| `canResolveSongCatalogRef`（`src/services/onlineMusic/catalogRefs.ts:20`） | `src/services/onlineMusic/catalogRefs.ts:118,120` `src/components/panelTab/shell/SongCredits.tsx:48,105` `src/library/suites/grid/shared/polaroidCardParts.tsx:144` `src/library/suites/grid/shared/PolaroidCard.tsx:111` `src/library/suites/bravais/BravaisCollection.tsx:208,213` `src/library/suites/bravais/useBravaisArtistLinks.ts:46,51` `src/components/app/search/SearchResultRow.tsx:58,112` `src/library/suites/tui/LibraryTuiArtist.tsx:137,168,256,269` `src/library/suites/tui/LibraryTuiRow.tsx:79,82` `src/library/suites/tui/LibraryTuiView.tsx:202,212` | 1 个文件：`unit/onlineMusic/catalogRefs.test.ts` |
| `resolveCollectionArtistCatalogId`（`src/services/onlineMusic/catalogRefs.ts:166`） | `src/library/suites/bravais/BravaisCollection.tsx:296` `src/library/suites/grid/collection/GridView.tsx:1616` | 1 个文件：`unit/onlineMusic/catalogRefs.test.ts` |
| `resolveSongCatalogRef`（`src/services/onlineMusic/catalogRefs.ts:90`） | `src/library/app/GridViewOverlayHost.tsx:406,495` `src/components/app/search/searchCollectionAdapters.ts:48,98` `src/App.tsx:2147,2167` | 2 个文件：`unit/onlineMusic/catalogRefs.test.ts` `unit/onlineMusic/kugouProvider.test.ts` |
| `resolveSongCatalogRefSet`（`src/services/onlineMusic/catalogRefs.ts:110`） | `src/services/onlineMusic/omni.ts:1625` | — |
| `registerOnlineMusicProvider`（`src/services/onlineMusic/providerRegistry.ts:29`） | `src/services/onlineMusic/providerRegistry.ts:117,118,119,120,121,122,124,126,127` `src/mods/folium/registries/omniProviders.ts:152` | 22 个文件：`unit/onlineMusic/omniAudioFailure.test.ts` `unit/services/onlineAudioLevelCache.test.ts` `dev/probes/libraryBehavior/fakeProviders.ts` `dev/probes/accountBehavior/useAccountProbeHarness.ts` `dev/probes/artistEntrance.probe.tsx` `dev/probes/collectionGrid.probe.tsx` 等 |
| `isLyricMatchSourceOffered`（`src/utils/lyrics/lyricMatchSources.ts:65`） | `src/utils/lyrics/ownWordTiming.ts:19` `src/utils/lyrics/autoMatchBestLyric.ts:208,228` | 1 个文件：`unit/qishui/lyricAvailability.test.ts` |
| `providerSupports`（`src/services/onlineMusic/providerRegistry.ts:63`） | `src/services/onlineMusic/providerRegistry.ts:99,100,106` `src/services/onlineMusic/omni.ts:163,604,616,624,628,629,816,817,833,834,850,851,858,860,862,871,878,886,887,1046,1127,1277,1417,1418,1490,1549,1626,1627` | 2 个文件：`unit/onlineMusic/providerRegistry.test.ts` `unit/onlineMusic/recommendationPreferences.test.ts` |
| `getProviderSongPageUrl`（`src/services/onlineMusic/songMetadata.ts:46`） | `src/components/panelTab/shell/SongCredits.tsx:54` | — |
| `askProviderCache`（`src/services/onlineMusic/providerRegistry.ts:83`） | `src/services/onlineMusic/providerRegistry.ts:92,95` | — |
| `canPlaySongExternally`（`src/services/onlineMusic/providerRegistry.ts:104`） | `src/services/onlineMusic/omni.ts:1116,1122` | — |
| `isSongUnavailable`、`getSongUnavailableLabel`、`getSongTag`（`src/services/onlineMusic/songAvailability.ts:19,23,33`，包着上面的 `getSongAvailability`，同步，列表每一行都调） | 按文件列：`src/components/app/playback/playableSong.ts` `src/components/app/playback/start/usePlaybackQueueController.ts` `src/components/app/search/SearchResultRow.tsx` `src/components/app/search/searchTrackActions.ts` `src/components/command-palette/CommandPaletteQueueRow.tsx` `src/components/panelTab/QueueTab.tsx` `src/components/wall/WallToolsQueueRow.tsx` `src/library/core/artist/useArtistView.ts` `src/library/core/collection/useCollectionView.ts` `src/library/suites/bravais/BravaisHomeExplore.tsx` `src/library/suites/bravais/describeBravaisTrack.ts` `src/library/suites/grid/collection/GridView.tsx` `src/library/suites/grid/collection/gridViewContextActions.ts` `src/library/suites/grid/shared/PolaroidCard.tsx` `src/library/suites/tui/LibraryTuiArtistRows.tsx` `src/library/suites/tui/LibraryTuiRow.tsx` | — |
| `hasProviderKeptSongAudio`（`src/services/onlineMusic/providerRegistry.ts:92`） | `src/services/automix/stems.ts:448` `src/services/playedTrackCache.ts:76` | — |
| `keepProviderSongAudio`（`src/services/onlineMusic/providerRegistry.ts:95`） | `src/services/playedTrackCache.ts:76` | — |

## 附录 C：成员 → 全部测试文件

第 2 节里测试超过四个文件的成员。数字是这个文件里引用它的处数。

- `id`（30 个文件 46 处）：`unit/login/loginModuleKnowsNoPlatform.test.ts`×7、`unit/ytm/ytmUltra.test.ts`×5、`unit/login/loginDiagnosticReport.test.ts`×3、`unit/login/loginView.test.ts`×3、`unit/onlineMusic/providerRegistry.test.ts`×2、`unit/onlineMusic/recommendationPreferences.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`dev/probes/accountBehavior/useAccountProbeHarness.ts`×1、`dev/probes/collectionGrid.probe.tsx`×1、`dev/probes/exploreSurface.probe.tsx`×1、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/i18n/providerName.test.ts`×1、`unit/library/app/useLibraryAccountController.test.ts`×1、`unit/login/loginDoneFrame.test.ts`×1、`unit/login/loginFailureCase.test.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/authMembers.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1、`unit/onlineMusic/omniSearchCollections.test.ts`×1、`unit/onlineMusic/onlineFailureCase.test.ts`×1、`unit/onlineMusic/providerWatch.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1
- `displayName`（21 个文件 22 处）：`unit/onlineMusic/providerRegistry.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`dev/probes/collectionGrid.probe.tsx`×1、`dev/probes/exploreSurface.probe.tsx`×1、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/library/app/useLibraryAccountController.test.ts`×1、`unit/mod-system/foliumExperimental.test.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1、`unit/onlineMusic/omniSearchCollections.test.ts`×1、`unit/onlineMusic/recommendationPreferences.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `getAvailability`（6 个文件 7 处）：`unit/fnmusic/fnmusicProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/qishui/adapter.test.ts`×1
- `capabilities`（28 个文件 67 处）：`unit/onlineMusic/omni.test.ts`×22、`unit/mod-system/foliumExperimental.test.ts`×6、`unit/onlineMusic/qqProvider.test.ts`×6、`dev/probes/libraryBehavior/fakeProviders.ts`×3、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×3、`unit/appleMusic/appleMusicProvider.test.ts`×3、`unit/onlineMusic/providerRegistry.test.ts`×2、`unit/spotify/spotifySetup.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`dev/probes/collectionGrid.probe.tsx`×1、`dev/probes/exploreSurface.probe.tsx`×1、`unit/appleMusic/appleMusicLibraryAlbums.test.ts`×1、`unit/appleMusic/appleMusicPlaylistMutation.test.ts`×1、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/library/app/useLibraryAccountController.test.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1、`unit/onlineMusic/omniSearchCollections.test.ts`×1、`unit/onlineMusic/recommendationPreferences.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `normalizeSong`（23 个文件 27 处）：`unit/onlineMusic/providerRegistry.test.ts`×4、`unit/spotify/spotifyRecommendations.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`dev/probes/collectionGrid.probe.tsx`×1、`dev/probes/exploreSurface.probe.tsx`×1、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/library/app/useLibraryAccountController.test.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/neteaseExplore.test.ts`×1、`unit/onlineMusic/neteaseProvider.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1、`unit/onlineMusic/omniSearchCollections.test.ts`×1、`unit/onlineMusic/recommendationPreferences.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `search`（19 个文件 52 处）：`unit/onlineMusic/kugouProvider.test.ts`×13、`unit/spotify/spotifyProvider.test.ts`×7、`unit/lyrics/autoMatchBestLyric.test.ts`×4、`unit/onlineMusic/neteaseProvider.test.ts`×4、`unit/ytm/ytmProvider.test.ts`×4、`unit/mod-system/foliumExperimental.test.ts`×3、`unit/onlineMusic/bodianProvider.test.ts`×2、`unit/onlineMusic/omni.test.ts`×2、`unit/onlineMusic/omniSearchCollections.test.ts`×2、`unit/qishui/adapter.test.ts`×2、`unit/localLibrary/onlineMetadataSearchService.test.ts`×1、`unit/lyrics/autoMatchNonPlatformSource.test.ts`×1、`unit/lyrics/lyricSourceStoredValues.test.ts`×1、`unit/mod-system/foliumFaultNotice.test.ts`×1、`unit/mod-system/foliumOmni.test.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/qishui/capabilities.test.ts`×1、`unit/qishui/localSongMatch.test.ts`×1
- `playback`（16 个文件 128 处）：`unit/onlineMusic/qqProvider.test.ts`×45、`unit/onlineMusic/kugouProvider.test.ts`×20、`unit/onlineMusic/neteaseProvider.test.ts`×18、`unit/onlineMusic/omni.test.ts`×13、`unit/ytm/ytmProvider.test.ts`×7、`unit/onlineMusic/bodianProvider.test.ts`×5、`unit/ytm/ytmUltra.test.ts`×5、`unit/qishui/capabilities.test.ts`×4、`unit/fnmusic/fnmusicProvider.test.ts`×2、`unit/mod-system/foliumExperimental.test.ts`×2、`unit/qishui/explore.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/qishui/adapter.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1
- `lyrics`（14 个文件 40 处）：`unit/ytm/ytmProvider.test.ts`×8、`unit/onlineMusic/kugouProvider.test.ts`×5、`unit/appleMusic/appleMusicProvider.test.ts`×3、`unit/lyrics/autoMatchBestLyric.test.ts`×3、`unit/mod-system/foliumExperimental.test.ts`×3、`unit/onlineMusic/bodianProvider.test.ts`×3、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/onlineMusic/qqProvider.test.ts`×3、`unit/spotify/spotifyProvider.test.ts`×3、`unit/onlineMusic/omni.test.ts`×2、`unit/appleMusic/appleMusicRadio.test.ts`×1、`unit/lyrics/lyricSourceStoredValues.test.ts`×1、`unit/qishui/localSongMatch.test.ts`×1、`unit/ytm/ytmOmni.test.ts`×1
- `auth`（22 个文件 130 处）：`unit/onlineMusic/qqProvider.test.ts`×40、`unit/onlineMusic/neteaseProvider.test.ts`×16、`unit/ytm/ytmProvider.test.ts`×11、`unit/onlineMusic/kugouProvider.test.ts`×9、`unit/appleMusic/appleMusicProvider.test.ts`×8、`unit/onlineMusic/neteaseAccountKept.test.ts`×7、`unit/ytm/ytmUltra.test.ts`×6、`unit/onlineMusic/kugouQqSignOut.test.ts`×5、`unit/fnmusic/fnmusicProvider.test.ts`×4、`unit/qishui/failure.test.ts`×4、`unit/login/loginDiagnosticReport.test.ts`×3、`unit/spotify/spotifySetup.test.ts`×3、`unit/onlineMusic/qqSessionRefresh.test.ts`×2、`unit/qishui/adapter.test.ts`×2、`unit/qishui/explore.test.ts`×2、`unit/ytm/ytmOmni.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/authMembers.test.ts`×1、`unit/onlineMusic/loginFailurePlatforms.test.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1
- `library`（12 个文件 89 处）：`unit/onlineMusic/qqProvider.test.ts`×25、`unit/onlineMusic/kugouProvider.test.ts`×21、`unit/spotify/spotifyProvider.test.ts`×14、`unit/onlineMusic/neteaseProvider.test.ts`×10、`unit/ytm/ytmProvider.test.ts`×7、`unit/onlineMusic/omni.test.ts`×5、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1
- `catalog`（13 个文件 151 处）：`unit/onlineMusic/qqProvider.test.ts`×56、`unit/ytm/ytmProvider.test.ts`×30、`unit/onlineMusic/kugouProvider.test.ts`×17、`unit/onlineMusic/neteaseProvider.test.ts`×15、`unit/onlineMusic/omni.test.ts`×9、`unit/spotify/spotifyProvider.test.ts`×8、`unit/onlineMusic/bodianProvider.test.ts`×4、`dev/probes/libraryBehavior/fakeProviders.ts`×3、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×3、`unit/appleMusic/appleMusicCatalog.test.ts`×2、`unit/onlineMusic/qqLists.test.ts`×2、`dev/probes/collectionGrid.probe.tsx`×1、`unit/ytm/ytmOmni.test.ts`×1
- `recommendations`（16 个文件 39 处）：`unit/onlineMusic/kugouProvider.test.ts`×10、`unit/spotify/spotifyRecommendations.test.ts`×5、`unit/onlineMusic/bodianProvider.test.ts`×4、`dev/probes/libraryBehavior/fakeProviders.ts`×3、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/onlineMusic/omni.test.ts`×2、`unit/onlineMusic/qqProvider.test.ts`×2、`unit/ytm/ytmProvider.test.ts`×2、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/onlineMusic/bodianReview.test.ts`×1、`unit/onlineMusic/qqOmniGates.test.ts`×1、`unit/onlineMusic/recommendationPreferences.test.ts`×1、`unit/qishui/explore.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×1
- `explore`（6 个文件 57 处）：`unit/ytm/ytmProvider.test.ts`×36、`unit/spotify/spotifyProvider.test.ts`×16、`unit/ytm/ytmOmni.test.ts`×2、`dev/probes/exploreSurface.probe.tsx`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/spotify/spotifyRecommendations.test.ts`×1
- `mutations`（13 个文件 75 处）：`unit/onlineMusic/kugouProvider.test.ts`×22、`unit/ytm/ytmProvider.test.ts`×20、`unit/onlineMusic/omni.test.ts`×16、`unit/spotify/spotifyProvider.test.ts`×5、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/ytm/ytmOmni.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×1、`unit/appleMusic/appleMusicPlaylistMutation.test.ts`×1、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/bodianReview.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1
- `search.searchSongs`（12 个文件 87 处）：`unit/onlineMusic/omni.test.ts`×48、`unit/onlineMusic/kugouProvider.test.ts`×11、`unit/spotify/spotifyProvider.test.ts`×7、`unit/onlineMusic/omniSearchCollections.test.ts`×6、`unit/ytm/ytmProvider.test.ts`×4、`unit/mod-system/foliumExperimental.test.ts`×3、`unit/onlineMusic/bodianProvider.test.ts`×2、`unit/onlineMusic/neteaseProvider.test.ts`×2、`unit/mod-system/foliumFaultNotice.test.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/qishui/capabilities.test.ts`×1
- `playback.getSongDetail`（7 个文件 29 处）：`unit/onlineMusic/omni.test.ts`×12、`unit/onlineMusic/qqProvider.test.ts`×12、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `playback.getAudioSource`（13 个文件 78 处）：`unit/onlineMusic/qqProvider.test.ts`×24、`unit/onlineMusic/kugouProvider.test.ts`×20、`unit/onlineMusic/omni.test.ts`×12、`unit/onlineMusic/neteaseProvider.test.ts`×6、`unit/ytm/ytmProvider.test.ts`×6、`unit/onlineMusic/bodianProvider.test.ts`×3、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/fnmusic/fnmusicProvider.test.ts`×1、`unit/mod-system/foliumExperimental.test.ts`×1、`unit/onlineMusic/omniAudioFailure.test.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `playback.audioQualityLevels`（5 个文件 8 处）：`unit/ytm/ytmUltra.test.ts`×4、`unit/fnmusic/fnmusicProvider.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/services/onlineAudioLevelCache.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1
- `playback.getAvailability`（8 个文件 18 处）：`unit/onlineMusic/neteaseProvider.test.ts`×6、`unit/qishui/capabilities.test.ts`×4、`unit/onlineMusic/bodianProvider.test.ts`×2、`unit/qishui/explore.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/providerRegistry.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/qishui/adapter.test.ts`×1
- `lyrics.getLyrics`（10 个文件 23 处）：`unit/ytm/ytmProvider.test.ts`×6、`unit/appleMusic/appleMusicProvider.test.ts`×3、`unit/mod-system/foliumExperimental.test.ts`×3、`unit/spotify/spotifyProvider.test.ts`×3、`unit/onlineMusic/kugouProvider.test.ts`×2、`unit/onlineMusic/omni.test.ts`×2、`unit/appleMusic/appleMusicRadio.test.ts`×1、`unit/onlineMusic/bodianProvider.test.ts`×1、`unit/onlineMusic/neteaseProvider.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1
- `auth.getLoginStatus`（12 个文件 79 处）：`unit/onlineMusic/accountRead.test.ts`×35、`unit/onlineMusic/qqProvider.test.ts`×14、`unit/onlineMusic/neteaseProvider.test.ts`×9、`unit/ytm/ytmUltra.test.ts`×5、`unit/fnmusic/fnmusicProvider.test.ts`×4、`unit/onlineMusic/kugouProvider.test.ts`×4、`unit/onlineMusic/neteaseAccountKept.test.ts`×2、`unit/ytm/ytmProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1、`unit/onlineMusic/qqSessionRefresh.test.ts`×1
- `auth.logout`（10 个文件 24 处）：`unit/onlineMusic/accountRead.test.ts`×6、`unit/onlineMusic/kugouQqSignOut.test.ts`×5、`unit/onlineMusic/qqProvider.test.ts`×3、`unit/onlineMusic/kugouProvider.test.ts`×2、`unit/ytm/ytmProvider.test.ts`×2、`unit/ytm/ytmUltra.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/neteaseAccountKept.test.ts`×1、`unit/onlineMusic/qqSessionRefresh.test.ts`×1
- `auth.startLogin`（9 个文件 23 处）：`unit/ytm/ytmProvider.test.ts`×8、`unit/onlineMusic/qqProvider.test.ts`×4、`unit/appleMusic/appleMusicProvider.test.ts`×3、`unit/onlineMusic/neteaseProvider.test.ts`×2、`unit/qishui/failure.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1、`unit/spotify/spotifySetup.test.ts`×1、`unit/ytm/ytmUltra.test.ts`×1
- `auth.createQr`（6 个文件 7 处）：`unit/onlineMusic/neteaseProvider.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1
- `auth.checkLogin`（8 个文件 33 处）：`unit/onlineMusic/qqProvider.test.ts`×13、`unit/ytm/ytmProvider.test.ts`×7、`unit/appleMusic/appleMusicProvider.test.ts`×4、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/onlineMusic/kugouProvider.test.ts`×2、`unit/ytm/ytmUltra.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1
- `auth.cancelLogin`（5 个文件 11 处）：`unit/ytm/ytmProvider.test.ts`×6、`unit/onlineMusic/qqProvider.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/appleMusic/appleMusicProvider.test.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1
- `auth.getLoginDiagnostics`（6 个文件 8 处）：`unit/onlineMusic/qqProvider.test.ts`×2、`unit/qishui/failure.test.ts`×2、`dev/probes/accountBehavior/fakeAuthProviders.ts`×1、`unit/login/loginDiagnosticReport.test.ts`×1、`unit/onlineMusic/qqQrDiagnostics.integration.test.ts`×1、`unit/qishui/adapter.test.ts`×1
- `library.getUserPlaylists`（13 个文件 64 处）：`unit/onlineMusic/accountRead.test.ts`×24、`unit/onlineMusic/qqProvider.test.ts`×8、`unit/onlineMusic/bodianLibrary.test.ts`×6、`unit/onlineMusic/omni.test.ts`×5、`unit/onlineMusic/kugouProvider.test.ts`×4、`unit/qishui/capabilities.test.ts`×4、`unit/ytm/ytmProvider.test.ts`×4、`unit/spotify/spotifyProvider.test.ts`×3、`unit/onlineMusic/omniLikedChecks.test.ts`×2、`unit/onlineMusic/bodianAlbumPaging.test.ts`×1、`unit/onlineMusic/neteaseProvider.test.ts`×1、`unit/onlineMusic/omniAccountMoments.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1
- `library.getLikedSongIds`（13 个文件 66 处）：`unit/onlineMusic/accountRead.test.ts`×21、`unit/onlineMusic/kugouProvider.test.ts`×11、`unit/onlineMusic/qqProvider.test.ts`×6、`unit/onlineMusic/omniAccountMoments.test.ts`×5、`unit/spotify/spotifyProvider.test.ts`×5、`unit/ytm/ytmProvider.test.ts`×5、`unit/onlineMusic/bodianLibrary.test.ts`×3、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/qishui/capabilities.test.ts`×3、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1、`unit/qishui/packagePaging.test.ts`×1
- `library.getLikedSongCount`（8 个文件 19 处）：`unit/onlineMusic/omniAccountMoments.test.ts`×4、`unit/spotify/spotifyProvider.test.ts`×4、`unit/onlineMusic/kugouProvider.test.ts`×3、`unit/onlineMusic/bodianLibrary.test.ts`×2、`unit/onlineMusic/neteaseProvider.test.ts`×2、`unit/onlineMusic/qqProvider.test.ts`×2、`unit/onlineMusic/accountRead.test.ts`×1、`unit/onlineMusic/omniLikedChecks.test.ts`×1
- `library.getUserAlbums`（5 个文件 12 处）：`unit/onlineMusic/qqProvider.test.ts`×6、`unit/onlineMusic/bodianAlbumPaging.test.ts`×2、`unit/onlineMusic/bodianLibrary.test.ts`×2、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1
- `catalog.getPlaylistTracks`（12 个文件 51 处）：`unit/onlineMusic/qqProvider.test.ts`×14、`unit/ytm/ytmProvider.test.ts`×11、`unit/spotify/spotifyProvider.test.ts`×5、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×3、`unit/gridView/bodianCollectionPaging.test.ts`×3、`unit/onlineMusic/bodianProvider.test.ts`×3、`unit/onlineMusic/kugouProvider.test.ts`×3、`unit/onlineMusic/omni.test.ts`×3、`unit/qishui/packagePaging.test.ts`×3、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`dev/probes/collectionGrid.probe.tsx`×1、`unit/onlineMusic/qqLists.test.ts`×1
- `catalog.getPlaylistDetail`（7 个文件 17 处）：`unit/onlineMusic/qqProvider.test.ts`×8、`unit/qishui/capabilities.test.ts`×3、`unit/ytm/ytmProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/bodianProvider.test.ts`×1、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/onlineMusic/qqLists.test.ts`×1
- `catalog.getAlbumTracks`（5 个文件 12 处）：`unit/onlineMusic/qqProvider.test.ts`×5、`unit/onlineMusic/kugouProvider.test.ts`×3、`unit/ytm/ytmProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1
- `catalog.getAlbumDetail`（7 个文件 23 处）：`unit/ytm/ytmProvider.test.ts`×9、`unit/onlineMusic/qqProvider.test.ts`×5、`unit/onlineMusic/neteaseProvider.test.ts`×4、`unit/onlineMusic/kugouProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/appleMusic/appleMusicCatalog.test.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1
- `catalog.getSubscriptionStatus`（6 个文件 14 处）：`unit/ytm/ytmProvider.test.ts`×8、`unit/onlineMusic/kugouProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1
- `recommendations.getDailySongs`（5 个文件 10 处）：`unit/onlineMusic/qqRecommendations.test.ts`×5、`unit/spotify/spotifyRecommendations.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1
- `recommendations.getPersonalFm`（11 个文件 26 处）：`unit/onlineMusic/qqGuessYouLike.test.ts`×10、`unit/onlineMusic/qqRecommendations.test.ts`×6、`unit/onlineMusic/kugouProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/bodianProvider.test.ts`×1、`unit/onlineMusic/omni.test.ts`×1、`unit/onlineMusic/qqTransport.test.ts`×1、`unit/qishui/fm.test.ts`×1、`unit/spotify/spotifyRecommendations.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1、`unit/ytm/ytmRecommendations.test.ts`×1
- `recommendations.getRecommendedCollections`（12 个文件 26 处）：`unit/onlineMusic/qqGuessYouLike.test.ts`×6、`unit/onlineMusic/qqRecommendations.test.ts`×5、`unit/onlineMusic/bodianProvider.test.ts`×3、`unit/onlineMusic/kugouProvider.test.ts`×3、`unit/ytm/ytmRecommendations.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/neteaseProvider.test.ts`×1、`unit/qishui/explore.test.ts`×1、`unit/qishui/fm.test.ts`×1、`unit/spotify/spotifyRecommendations.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1、`unit/ytm/ytmWebExplore.test.ts`×1
- `recommendations.dislikeSong`（6 个文件 13 处）：`unit/onlineMusic/qqRecommendations.test.ts`×8、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/qishui/packagePaging.test.ts`×1、`unit/spotify/spotifyRecommendations.test.ts`×1、`unit/ytm/ytmRecommendations.test.ts`×1
- `recommendations.getRecommendationPreferences`（5 个文件 40 处）：`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×14、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×13、`unit/onlineMusic/recommendationPreferences.test.ts`×11、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1
- `recommendations.saveRecommendationPreferences`（5 个文件 40 处）：`unit/recommendationPreferences/recommendationPreferencesPanel.test.ts`×14、`unit/recommendationPreferences/recommendationPreferencesStore.test.ts`×13、`unit/onlineMusic/recommendationPreferences.test.ts`×11、`unit/hooks/useCommandPaletteContext.test.ts`×1、`unit/recommendationPreferences/recommendationPreferencesEntries.test.ts`×1
- `explore.getFeed`（11 个文件 112 处）：`unit/onlineMusic/neteaseExplore.test.ts`×39、`unit/ytm/ytmProvider.test.ts`×33、`unit/onlineMusic/qqExplore.test.ts`×11、`unit/spotify/spotifyProvider.test.ts`×11、`unit/ytm/ytmWebExplore.test.ts`×8、`unit/qishui/explore.test.ts`×5、`dev/probes/exploreSurface.probe.tsx`×1、`unit/onlineMusic/neteaseExploreRefresh.test.ts`×1、`unit/onlineMusic/qqProvider.test.ts`×1、`unit/spotify/spotifyRecommendations.test.ts`×1、`unit/ytm/ytmRecommendations.test.ts`×1
- `explore.getSectionItems`（7 个文件 28 处）：`unit/onlineMusic/neteaseExplore.test.ts`×8、`unit/qishui/explore.test.ts`×6、`unit/spotify/spotifyProvider.test.ts`×5、`unit/onlineMusic/qqExplore.test.ts`×4、`unit/ytm/ytmProvider.test.ts`×3、`dev/probes/exploreSurface.probe.tsx`×1、`unit/onlineMusic/neteaseExploreRefresh.test.ts`×1
- `mutations.canAddToPlaylist`（5 个文件 6 处）：`unit/onlineMusic/omni.test.ts`×2、`unit/onlineMusic/kugouProvider.test.ts`×1、`unit/qishui/capabilities.test.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1、`unit/ytm/ytmProvider.test.ts`×1
- `mutations.likeSong`（11 个文件 48 处）：`unit/onlineMusic/kugouProvider.test.ts`×19、`unit/onlineMusic/qqMutations.test.ts`×8、`unit/onlineMusic/omni.test.ts`×4、`unit/ytm/ytmProvider.test.ts`×4、`unit/onlineMusic/accountRead.test.ts`×3、`unit/qishui/capabilities.test.ts`×3、`unit/qishui/packagePaging.test.ts`×2、`unit/spotify/spotifyProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/onlineMusic/bodianMutations.test.ts`×1、`unit/onlineMusic/omniLikePresses.test.ts`×1
- `mutations.updatePlaylistTracks`（10 个文件 38 处）：`unit/onlineMusic/qqMutations.test.ts`×9、`unit/onlineMusic/omni.test.ts`×8、`unit/onlineMusic/bodianMutations.test.ts`×5、`unit/ytm/ytmProvider.test.ts`×5、`unit/onlineMusic/neteaseProvider.test.ts`×3、`unit/qishui/capabilities.test.ts`×3、`unit/qishui/packagePaging.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/appleMusic/appleMusicLibrarySongs.test.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1
- `mutations.subscribeAlbum`（5 个文件 14 处）：`unit/ytm/ytmProvider.test.ts`×6、`unit/onlineMusic/qqMutations.test.ts`×4、`unit/onlineMusic/kugouProvider.test.ts`×2、`dev/probes/libraryBehavior/fakeProviders.ts`×1、`unit/spotify/spotifyProvider.test.ts`×1
