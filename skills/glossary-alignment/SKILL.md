---
name: glossary-alignment
description: Use when the user refers to repository-specific spoken terms - home view, grid, player panel, local library, online provider, Stage, OBS, visualizer mode, queue, current song, search state, library suite and bravais wall terms (seam, spine, focus card, see-through windows) - and you need to turn that term into a name you can look up. Maps Chinese/English spoken terms to symbol or module names, not paths.
---

# Glossary Alignment

把口头术语换成**名字**，然后用 `ts-code-map` 的 `search` / `find_symbol` 解析成当前路径。

这里刻意不写路径。文件会改名、会移动、会拆目录，路径表撑不住；符号名和模块名稳定得多，
而且真过期时 `search` 会直接告诉你找不到，不会像旧路径那样把你引到一个不存在的地方。

**用法**：查表拿到名字 → `search` 或 `find_symbol` 拿到当前位置 → 再往下读。

## App / 全局状态

| 口头说法 | 名字 |
| --- | --- |
| 主入口 / 总装配 | `App`，区域边界看 `AppShell`、`Home`、`PlayerPanel`、`AppOverlays`、`AppDialogs` |
| 当前歌曲 / 播放队列 | `usePlaybackStore` 的 `currentSong` / `playQueue`（`App` 从这里读） |
| 状态提示 | `useStatusMessageStore`、`setStatusMessage` |
| home/player 切换 / 最后视图 | `useAppNavigation` |
| 搜索词 / 搜索结果 / 搜索来源 tab / 首页 tab | `useSearchNavigationStore` |
| 集合导航栈 / 当前集合 | `useCollectionNavigationStore` |
| 设置弹窗当前页 | `useSettingsModalStore`（只管 UI 状态，不存设置值） |
| 某一项具体设置的值 | 按领域找 `use*SettingsStore`：`useAudioSettingsStore`、`useLyricSettingsStore`、`useThemeSettingsStore`、`useTypographySettingsStore`、`useVisualizerSettingsStore`、`useDesktopSettingsStore`、`useInteractionSettingsStore` 等 |
| 主题快速编辑器 | `useThemeQuickEditorStore` |

## 首页 / 库

| 口头说法 | 名字 |
| --- | --- |
| 首页 / 网格首页 / 3D 首页 | `Home` → `buildHomeModel` / `useHomeModel` → `Grid3D` / `GridView` |
| 集合卡片 / 网格导航 / 六边形 viewport | `folia-grid` 目录 |
| 首页 collection adapter | `gridViewCollectionAdapters` |
| 本地库首页面 / 本地 3D 网格 | `LocalGrid3DView`、`localGrid3DModel` |
| Navidrome 首页面 | `NavidromeGrid3DView`、`useNavidromeGridLibrary` |
| 本地库扫描 / 索引 / 重扫 | `useLocalLibraryCatalog` → `localLibraryCatalogService`、`localMusicService`、`localLibraryIndex` |
| 本地文件夹 / 本地歌单 / 实体编辑 | `entityEditorModel`、`localPlaylistService` |
| 在线 provider 账号 / 登录 | `useOnlineProviderAccountStore`、`useOnlineProviderPlatform`；登录窗口 `LoginHost`（`App.tsx` 挂一次）、`openLoginWindow`（`loginWindowStore`）；账户 controller `useLibraryAccountController` |

## 资料库 suite / bravais 墙

资料库（Library）按 headless core 与 UI suite 分开：grid（默认、回退）、bravais（正式新 UI，「一面墙 + 一道缝」）、tui（开发验证）。
bravais 的口头说法大多来自它的设计稿（不在仓库里，常用的说法已收进下表）。

| 口头说法 | 名字 |
| --- | --- |
| 资料库界面 / UI suite / 换 suite | `useLibrarySuiteStore`（存的是选择）、`resolveActiveLibrarySuiteId` / `useActiveLibrarySuiteId`（生效的那套）、`chooseLibrarySuite` → `switchLibrarySuite`、设置节 `LibrarySuiteSection`；「是不是 bravais」用 `useIsBravaisLibraryActive` |
| 初始选择 / 回退 suite | `LIBRARY_SUITE_INITIAL_CHOICE`（开发阶段 bravais）、`DEFAULT_LIBRARY_SUITE_ID`（grid） |
| 舞台 / stage / 常驻墙 | `BravaisStage`；宿主侧 `LibrarySuiteStageSlot`、`resolveLibraryStage`、`LibrarySuiteStageProps` |
| 层 / 层描述 | `BravaisLayer`，由 surface 经 `useBravaisLayerRegistration` 推进 `bravaisStageStore` |
| 墙 / 磁贴 / 窗位以外的空画框 | `BravaisWall`、`BravaisTile`（种类 `BravaisTileKind`：content / wall / window） |
| 共享 wall 引擎 / 墙面几何 | `wall` 目录：`wallSlots`、`rankSlots`、`finiteWall`、`seamPlan`、`flipPlan`、`startTile`、`blockReservedSlots`、`WallTitle` |
| 块 / slot / rank（严格 rank） | `WallSlot`、`rankSlots`；12×8 块的模板 `blockTemplates` |
| 有限墙 / 有限拼贴 / 退化（过滤中） | `planFiniteWall`、`planBravaisFinite`；层的 `mode: 'finite'` |
| 无限墙 / 无限拼贴 / 循环偏移 | `getInfiniteSlotItem`、`getStartWrapOffset`；层的 `mode: 'infinite'` |
| 翻牌 | `planFlip`、`diffDisplays`、`resolveTileTransition`；磁贴只转内容层 |
| 起点磁贴 | `setBravaisPendingOrigin` / `takeBravaisPendingOrigin`、`recordPushOrigin`（`beforePush`）、`resolveStartSlotKey` |
| 聚焦卡 / 块内让位 | `useBravaisFocus`、`BravaisFocusCardBody`、`layoutFocusedBlock`（`blockReflows`）、`revealRect` |
| 缝 / 裂缝 | `BravaisSeam`、`useBravaisSeam`、`BravaisSeamContent`；开口目标 `resolveSeamTarget` / `resolveStageSeamTarget` |
| 信息条 / 书脊 / 折叠（缝的开口等级） | `BravaisSeamLevel` 的 `full` / `spine` / `hidden`，全局 store `useBravaisSeamStore`；外观动作 `bravais-seam-full` / `-seam-spine` / `-seam-hide` |
| 首页窄缝 / 缝里的搜索框 | `BravaisSeamHome`、`BravaisSeamSearch` |
| 缝只开在块边界 / 相机让位 / 边缘收起、就地重开 | `blockSeamPlan`、`getSeamGeometry`、`getSeamSplitOffsets`；外观动作 `bravais-seam-here` |
| 播放条安全区 | `useBravaisPlayerSafeArea` |
| 面板（列表面板 / 目录树面板） | `BravaisListPanel`、`BravaisDirectoryPanel`（`useBravaisDirectoryPanel`、`BravaisHomeDirectory`）；面板 history `openBravaisPanel` / `bravaisPanelHistory`（记录标记 `bravaisPanel`） |
| 批量模式 | 目录树面板开着时的首页本地层；core 侧 `useLibraryDirectorySelection` |
| 管理隐藏视图 | `useLibraryDirectoryVisibility`（`browse` / `manage` / `manage-hidden-only`） |
| 表单态（改名、删除确认、加入歌单） | `reduceBravaisForm`、`BravaisSeamFormView` |
| 缝里的账户入口（点了打开登录窗口） | `BravaisSeamAccountSwitcher`（`useBravaisHomeAccount`）；窗口本身 `src/components/login/LoginHost`，`openLoginWindow` |
| 移除的两段翻牌 | `detectRemovedEntries`、`maskRemovedEntries` |
| 整墙出场 / 入场（换页签、从搜索 / 播放页进出） | `planWallWave`、`BravaisEntrance`；换层种类 `resolveShiftKind`（push / back / replace / enter / exit） |
| 降低动态效果（bravais） | `resolveBravaisReducedTransitions` |
| 面包屑 / 跳层 | `BravaisSeamCrumbs`、`buildBravaisCrumbs`、`useBravaisPopTo`；契约 `onPopTo`、`trail`（`projectNavigationTrail`）；导航层 `popCollectionTo` |
| 紧邻往返折叠（N1）/ 去环 | `resolveCollectionPush`（push / back / noop）、`popCollectionLayer`、`findLayerBaseIndex` |
| 布局记忆 / 忘掉布局 | `readBravaisLayout` / `writeBravaisLayout`；manifest 的 `layout.forget` |
| 外观动作 / suite-chrome | manifest 的 `chromeActions`、`useLibrarySuiteChromeRegistration`、`useBravaisChromeActions`；命令 `bravais-<id>` |
| 透光 / 透光档位（实色 / 部分透明 / 全透明）/ 每块窗数 | `useLibraryWallLookStore`、`LibraryWallLook`、`LibraryWallLookSettings`、`useBravaisWallLook`；外观动作 `bravais-wall-look` |
| 叠页边 / 集合叠页边（集合磁贴右下错开的页边） | `bravaisTileForm` 的 `stack`、`.bravais-tile-face.is-stack`、根节点 `has-stack-edges`；设置 `useLibraryWallLookStore.collectionStackEdges` |
| Bravais 分组 / Bravais 墙面设置 | `BravaisSettingsSection`、锚点 `bravaisSettings`、命令 `settings-bravais` |
| 窗 | 保留位 `blockReservedSlots`、`resolveReservedPerBlock`；磁贴种类 `window` |
| 底板（按块 SVG） | `BravaisBlockPlates`、`useBravaisBlockPlates`、`bravaisBlockPlate`；让位逐帧重画 `useBravaisReflowPlate` |
| 遮挡播放页 / 实色档卸载 visualizer | `reportPlayerOcclusion`、`useLibraryPlayerOcclusionStore`、`shouldMountPlayerVisualizer` |
| 墙后的画面（透出的 visualizer 画不画歌词、模糊） | `reportPlayerBackdrop`、`selectLibraryPlayerBackdrop`、`playerVisualizerBackdrop` |
| 信息条样式 / 透明信息条（缝的材质、预设） | `seamStyle`、`seamClear`、`libraryWallSeamStyle`、`bravaisSeamLooks.css` |
| 队列墙 / Lattice | `Lattice`、`PosterWall`（独立的 app 视图，只和 bravais 共享 wall 引擎） |

## 面板 / 搜索 / 弹窗

| 口头说法 | 名字 |
| --- | --- |
| 搜索工作台 / 搜索结果页 | `SearchWorkspace` |
| 右侧播放器面板 / unified panel | 入口 `PlayerPanel` → `buildPlayerPanelModel`；旧实现仍在 `UnifiedPanel` |
| 封面 / 控制 / 队列 tab 等 | `panelTab` 目录下的 `*Tab` |
| overlay / dialog 总装配 | `AppOverlays` + `buildAppOverlaysModel`、`AppDialogs` + `buildAppDialogsModel` |
| 设置弹窗 | `SettingsModal`；外观导入导出在 `ConfigTransferRows`、`visualConfigTransfer` |
| 命令面板 | `commandRegistry`、`CommandPalette`、`useCommandPaletteContext` |
| 加入歌单 | `AddToPlaylistHost` |

## 播放 / 外部界面

| 口头说法 | 名字 |
| --- | --- |
| 播放 transport / queue / audio bridge | `usePlaybackTransportController`、`usePlaybackQueueController`、`usePlaybackAudioBridge`、`usePlaybackVisualizerBridge` |
| 在线播放 / 播放源适配 / 预取 | `onlinePlayback`、`playbackAdapters`、`prefetchService` |
| Stage 模式 / 外部播放器控制 | `useStagePlaybackController`、`appStageHelpers`、`stagePlayerSnapshot` |
| Now Playing / PlayerCap | `useNowPlayingSource`、`usePlayerCapSource`、`nowPlayingProvider`、`playerCapProvider` |
| OBS 浏览器源 | `useObsBrowserSourcePublisher`、`obsBrowserSource` |
| 远程控制 / 视频导出 | `useElectronVideoExportController`、`electronVideoExport` |

## 在线音乐

| 口头说法 | 名字 |
| --- | --- |
| 在线歌曲的一切（搜索/歌词/音频/歌单/账户） | `omni` —— 这是公共边界，普通调用只经过它 |
| 某个平台的 provider | `neteaseProvider`、`kugouProvider`、`qqProvider`、`bodianProvider`、`ytmProvider`、`spotifyProvider`；请求在各自的 `*Transport`（网易云是 `neteaseApi`）—— 实现边界，UI/hook/store 不应直连 |
| provider 注册 / 账号缓存 | `providerRegistry`（唯一的平台清单）、`providerAccountCache`、`providerStorage` |
| 探索页 | `ExploreSurface`、`useExploreFeedStore`；平台那边是 `*Explore`（`createNeteaseExplore` 等）和 `exploreReads` |
| Navidrome / Subsonic | `navidromeService` —— **不是** Omni provider |

## 歌词 / Visualizer

| 口头说法 | 名字 |
| --- | --- |
| 歌词解析 / 原始格式 | `parserCore` 和 `src/workers` 下的 parser worker；visualizer 不负责解析 |
| 短句 / render end / fast reveal | `renderHints` |
| CJK 语义分组 / sticky 标点 | `cjkSemanticLayout` |
| 逐字 / grapheme timing | `graphemeTiming` |
| visualizer 统一入口 / 背景 | `VisualizerRenderer`、`VisualizerBackgroundRenderer` |
| visualizer shared props / tuning | `tuningRegistry`，以及 visualizer 目录下的 `definition` |
| 某个模式 | 模式目录下的 `entry.tsx`；内建模式的 id 清单是 `BUILTIN_VISUALIZER_MODES`（registry 启动时和目录核对），别信文档里抄的列表 |
| 字体栈 / 颜色混合 | `fontStacks`、`colorMix` |

## 持久化 / 同步 / 部署

| 口头说法 | 名字 |
| --- | --- |
| 同步 / R2 / 主题 registry | `syncCoordinator`、`syncClient`、`syncRepository`、`settingsSnapshot`、`themeSyncRegistry` |
| IndexedDB / 各类缓存 | `appDatabase`、`binaryAssetStore`、`coverCache`、`themeCache` |
| Electron 主进程 / bridge | `electron/` 下的 `main.cjs`、`preload.cjs`、`stageApi.cjs`；各平台的桥 `kugouApiBridge`、`bodianApiBridge`、`ytmApiBridge`、`spotifyApiBridge` |
| Sync Server | `sync-server/src/` 下的 `app.ts`（路由/协议）、`node.ts`、`cloudflare.ts`、`d1-emulator.ts`；Worker 包装在 `worker/index.ts` |
| Docker Web stack | `deploy/docker/` |

## 名字对不上时的判断顺序

0. 说的是一个功能（某个平台、登录、探索页、某个歌词样式）→ 先找这个功能自己的目录，新代码按功能放在一起。
1. 带“页面 / 视图 / 弹窗 / tab” → 先看 `components/app/*`，再看具体展示组件。
2. 带“状态 / 导航 / 偏好 / 当前模式” → 先看 `hooks` 和 `stores`。
3. 带“模型 / 装配 / 派生” → 找相邻的 `build*` / `create*`。
4. 带“接口 / provider / 缓存 / 播放流程” → 先看 `services`；在线歌曲一律先看 `omni`。
5. 带“类型 / 枚举 / 共享结构” → 先看 `types`。
6. 以上都不中 → 直接 `search`，让它退回全文搜索。

## 容易搞错的几个

- 别把首页逻辑都归给 `Home`，`buildHomeModel`、collection adapters、导航 store 各有分工。
- 别把“右侧面板”只理解成某个 tab，入口是 `PlayerPanel` + `buildPlayerPanelModel`。
- 别把 Navidrome 当成 Omni provider，也别让普通在线调用绕开 `omni`。
- 别以为 `App.tsx` 里有 visualizer 模式的 switch，registry 从 `entry.tsx` 自动发现。
- 别把精确播放时间当 React state，连续值走 MotionValue / ref / canvas。
- 别找“统一的设置 store”，它已经按领域拆开了。
- 别把 bravais 的「面板」当成右侧播放器面板：前者是缝展开成的列表 / 目录树（`BravaisListPanel` / `BravaisDirectoryPanel`），后者是 `PlayerPanel`。
- 别把 bravais 的「过滤」和「全局搜索」混为一谈：过滤是命令面板内联框（`useGridCommandFilter`，会话里的过滤词），全局搜索提交后去 `SearchWorkspace`，离开墙。
- 别在 `useLibrarySuiteStore` 的原始值上判断「当前是哪套 suite」，它可能是本构建没有的 id；用 `resolveActiveLibrarySuiteId`。
