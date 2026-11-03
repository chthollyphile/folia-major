# `src/` 代码地图

这份文档只回答“功能应该先去哪里看”。先找第一入口，再沿一层 import/call chain 追实现；不要因为 `src/App.tsx` 是主入口就全文阅读它。

## 启动与渲染入口

```text
src/index.tsx
  -> 安装 Buffer 与 visualizer frame-rate limiter
  -> src/bootstrap.tsx
       -> index.css / i18n
       -> /obs、?remote=1 等特殊入口
       -> App.tsx
```

`src/bootstrap.tsx` 根据 URL 选择：

- 普通应用：`src/App.tsx`
- OBS 歌词：`components/obs/ObsBrowserSourceApp.tsx`
- OBS Now Playing：`components/obs/ObsNowPlayingSourceApp.tsx`
- OBS PlayerCap：`components/obs/ObsPlayerCapSourceApp.tsx`
- Remote：`components/remote/RemoteControlApp.tsx`

普通应用的主要装配关系：

```text
App.tsx
  -> AppShell（窗口 chrome + audio 节点）
  -> Home（GridViewOverlayHost + Grid3D）
  -> VisualizerRenderer（registry mode + background + harmony overlay）
  -> AppOverlays（搜索、浮动控制、debug）
  -> PlayerPanel（UnifiedPanel 的 app-level model）
  -> AppDialogs（设置、歌词匹配、替代歌曲、toast 等）
  -> CommandPalette / ThemeQuickEditorHost / UserGuideModal
```

`App.tsx` 是历史大型编排文件。新功能优先放到下列相邻目录，通过 model/builder、hook、store 或 service 接入，不要继续复制大段 JSX、请求和副作用。

## App-level 目录

| 功能 | 第一入口 | 继续看 |
| --- | --- | --- |
| 应用壳和窗口行为 | `components/app/AppShell.tsx` | `TitlebarDragZone.tsx`、`WindowControls.tsx` |
| 首页 | `components/app/Home.tsx` | `home/buildHomeModel.ts`、`library/app/GridViewOverlayHost.tsx` |
| Player panel | `components/app/PlayerPanel.tsx` | `player-panel/buildPlayerPanelModel.ts`、`createQueueMutations.ts` |
| overlays | `components/app/overlays/AppOverlays.tsx` | `buildAppOverlaysModel.ts`、`search/*` |
| dialogs | `components/app/dialogs/AppDialogs.tsx` | `buildAppDialogsModel.ts`、`buildSettingsDialogModel.ts` |
| Home 导航和 surface | `components/app/home/*` | `gridViewCollectionAdapters.ts`；本地 / Navidrome 首页在 `library/suites/grid/home/` |
| 定位正在播放的歌 | `components/app/playing-song-locator/playingSongLocator.ts` | 两个动作，各管一件事：歌单页自己的按钮（网格右下角、列表面板里）`locatePlayingSongOnPage` 只在这一页已有的卡片里找，按下就回答；播放页封面上的“播放自 …”、命令和控制槽 `locatePlayingSong` 回到队列开始的那张歌单。同目录：`usePlayingFromCollection.ts`、`GridLocateButton.tsx`。队列的来源和发给页面的询问存在 `stores/usePlayingSongLocatorStore.ts`；回答询问的是歌单页（`library/suites/grid/collection/GridView.tsx`），说明队列从哪里开始的是 `home/buildHomeModel.ts`。Navidrome 的专辑、歌单、随机歌曲、收藏歌曲的页面不自己读歌，歌由 `library/app/GridViewOverlayHost.tsx` 读好给它；读取失败时同一处用 `externalTracksFailed` 告诉页面，页面就回答“没读完”而不是“这里没有”，空页面写“加载失败”而不是“暂无内容”（Navidrome 的歌手页是另一个组件 `library/suites/grid/artist/ArtistGridView.tsx`，自己读，没有定位按钮）。拼贴（队列拼贴和探索拼贴，`components/app/lattice/`）右下角工具按钮上方是同一个 `GridLocateButton`：拼贴用自己的页面键（`lattice/wallLocate.ts` 的 `wallPageKey`）被问，命令 `lattice-focus-current`、拼贴上的正在播放卡片和底栏按的是同一个 `locatePlayingSongOnWall`；回答在 `lattice/useLatticePlaybackFocus.ts`：有这首歌的海报就放大并把镜头移过去，没有就回答“这里没有” |
| 首页“探索”分页 | `components/app/home/explore/ExploreSurface.tsx` | 页签本身（平台有推荐页、设置里开着才有）是 core 的 `library/core/home/homeSources.ts`，网格首页 `library/suites/grid/home/Grid3D.tsx` 在它上面挂这一页（bravais 暂时不显示这个页签，`library/suites/bravais/BravaisHome.tsx`）。同目录：界面各部分，怎么动都写在 `exploreMotion.ts`；属于整页而不属于某个条目的三件事各一个文件：垫在列表后面的那层光 `ExploreLight.tsx`、图片朝指针倾斜 `exploreTilt.ts`、正在播放的那首歌的标记和拍子 `ExplorePlaying.tsx`（后两个只写 CSS 变量，画法在 `index.css`）；应用自己的两栏 `ownSections.ts`（“最近播放”“再听一次”），它们读的播放记录 `recentPlays.ts` 和写记录的 `useRecentPlaysRecorder.ts`。平台推荐页的数据在 `stores/useExploreFeedStore.ts`（store 放 `src/stores/`，或在 `library/core/` 的功能文件夹里叫 `use*Store.ts`：`test/unit/stores/storeContract.test.ts` 只检查这两处的 store），它跨会话记住的东西在这个目录的 `exploreFeedMemory.ts`；各平台的实现在 `services/onlineMusic/<平台>/` |
| 播放恢复和 URL | `components/app/playback/restore/*` | `restorePlaybackSource.ts`、`createOnlineRecoveryController.ts` |
| 搜索 | `components/app/search/SearchWorkspace.tsx` | `SearchResultsList.tsx`、`searchTrackActions.ts` |
| app-level 导航 | `components/app/navigation/*` | `createLocalLibraryNavigation.ts`、`createPanelNavigation.ts` |
| 展示派生 | `components/app/presentation/*` | style、visualizer theme、player flags、debug snapshot |

## UI / 状态 / 数据层

### Components

- 基础/遗留展示组件：`src/components/*.tsx`，例如 `UnifiedPanel.tsx`、`FloatingPlayerControls.tsx`。
- 集合浏览（Library）：`src/library/`——`core/`（契约、纯变换、资源、状态、hooks）、`suites/grid/`（`Grid3D`、`GridView`、`GridMap`、`ArtistGridView`、hex 视口与卡片、打开转场）、`suites/tui/`、`app/`（集合宿主与端口）。
- 本地库实体编辑：`src/components/local-library-entity/*`。
- 命令面板：`src/components/command-palette/*`。
- 设置和业务弹窗：`src/components/modal/*`、`src/components/modal/settings/*`。
- 右侧 panel tabs：`src/components/panelTab/*`。
- 复用对话框、列表、选择器和 OBS URL 控件：`src/components/shared/*`。
- 外部显示/控制：`src/components/obs/*`、`src/components/remote/*`。

### Hooks and stores

- 播放桥接：`usePlaybackAudioBridge`、`usePlaybackTransportController`、`usePlaybackQueueController`、`usePlaybackInteractionBridge`、`usePlaybackUiEffects`、`usePlaybackVisualizerBridge`。
- 本地和在线库：`useLocalLibraryCatalog`、`useNeteaseLibrary`、`useAccountReads`、`useOnlineProviderPlatform`；在线账户的扫码登录、选平台、切换确认与登出在 Library Core 的账户 controller（`library/app/useLibraryAccountController`、`library/core/account/providerAccountController.service`），登录窗口在 `components/login/`（`LoginHost` 挂在 `App.tsx`，各处经 `loginWindowStore.ts` 的 `openLoginWindow` 打开）。
- 外部 surface：`useStagePlaybackController`、`useNowPlayingSource`、`usePlayerCapSource`、`useObsBrowserSourcePublisher`。
- 恢复、主题和窗口：`useSessionRestoreController`、`useThemeController`、`useAppPreferences`、Electron bridge hooks。
- 导航/搜索/集合：`useAppNavigation.ts`、`useSearchNavigationStore.ts`、`useCollectionNavigationStore.ts`。
- 设置按领域拆分：`useThemeSettingsStore.ts`、`useTypographySettingsStore.ts`、`useLyricSettingsStore.ts`、`useVisualizerSettingsStore.ts`、`useVisualizerAssetStore.ts`、`usePlayerChromeSettingsStore.ts`、`useHomeLayoutSettingsStore.ts`、`useAutomixSettingsStore.ts`、`useAudioSettingsStore.ts`、`useDesktopSettingsStore.ts`、`useStageSettingsStore.ts`、`useSleepTimerStore.ts`、`useSettingsModalStore.ts`。
- 账户/quick editor：`useOnlineProviderAccountStore.ts`、`useThemeQuickEditorStore.ts`。

### Services

- 在线歌曲公共边界：`services/onlineMusic/omni.ts`；provider adapter/transport 只在实现层使用，详见 `services/onlineMusic/README.md`。
- 本地库：`localLibraryCatalogService.ts`、`localLibraryCatalogInternals.ts`、`localLibraryImportCatalog.ts`、`localMusicService.ts`、`localPlaylistService.ts`。
- 本地实体：`localLibraryEntityMutations.ts`、`localLibraryEntityRepository.ts`。
- Navidrome：`navidromeService.ts`；它是独立 Subsonic 服务，不是 Omni provider。
- 播放：`onlinePlayback.ts`、`playbackAdapters.ts`、`prefetchService.ts`、`nowPlayingProvider.ts`、`playerCapProvider.ts`。
- 缓存/数据库：`db.ts`、`appDatabase.ts`、`repositories/*`、`coverCache.ts`、`audioCache.ts`、`binaryAssetStore.ts`。
- 主题：`themeCache.ts`、`themePreferences.ts`、`themeSanitizer.ts`、`visualizerImageAsset.ts`、Monet image services。
- 同步：`services/sync/*`；编排从 `syncCoordinator.ts` 开始，配置快照在 `settingsSnapshot.ts`。

## Lyrics and visualizer

- 解析真源：`utils/lyrics/parserCore.ts`；后台解析：`workers/lyricsParser.worker.ts`、`metadataParser.worker.ts`。
- 行时序/短行：`utils/lyrics/renderHints.ts`。
- CJK semantic、sticky punctuation、display units：`utils/lyrics/cjkSemanticLayout.ts`。
- grapheme timing：`utils/lyrics/graphemeTiming.ts`。
- 共享字体、颜色、播放身份：`utils/fontStacks.ts`、`components/visualizer/colorMix.ts`、`utils/appPlaybackGuards.ts`。
- Visualizer 共享入口、契约和运行时：`components/visualizer/VisualizerRenderer.tsx`、`definition.ts`、`registry.tsx`、`tuningRegistry.ts`、`tuningDefinition.ts`、`runtime.ts`、`VisualizerShell.tsx`。
- 模式清单与具体入口：`components/visualizer/<mode>/entry.tsx`；`components/visualizer/` 下每个带 `entry.tsx` 的目录就是一个模式，清单以目录为准，这里不抄。
- 背景 registry：`components/visualizer/backgrounds/registry.tsx`；`backgrounds/` 下每个带 `entry.tsx` 的目录就是一个背景。
- 模式设置：优先看各模式目录的 `tuning.ts` / `*SettingsPanel.tsx`，再看 `VisPlaygroundSettingsPanel.tsx`。

详细模式边界、性能约定和共享 props 以 [`components/visualizer/README.md`](components/visualizer/README.md) 与 `definition.ts` 为准；不要在 README 复制完整接口。

## Settings, i18n and types

- 设置总入口：`components/modal/SettingsModal.tsx`；十三个类别各一页，在 `components/modal/settings/pages/<Name>Page.tsx`（`Appearance`、`Player`、`Home`、`Playback`、`Lyrics`、`General`、`Interaction`、`Integration`、`Storage`、`Desktop`、`Graphics`、`Mods`、`Developer`，由 `pages/index.ts` 登记），帮助页是 `pages/HelpPage.tsx`；类别的分组和顺序在 `navigation/settingsNavModel.ts`，控件在 `kit/`，页面从窗口拿的东西在 `pages/settingsPageContext.ts`。
- 视觉配置 import/export：`components/modal/settings/pages/storage/visualConfigTransfer.ts` 的 `buildCurrentConfig`、`planConfigImport`、`applyImportedConfig`，画它的行在同目录的 `ConfigTransferRows.tsx`；编码在 `utils/appearanceCodec.ts` 的 `compressConfig`、`decompressConfig`。
- 命令注册：`components/command-palette/commandRegistry.ts`；上下文和命令类型在 `types.ts`。
- 本地化：`i18n/locales/en.ts`、`zh-CN.ts`、`in.ts`，配置在 `i18n/config.ts`。
- 共享产品类型：`types.ts`；领域类型在 `types/appPlayback.ts`、`localLibrary.ts`、`navidrome.ts`、`obsBrowserSource.ts`、`onlineMusic.ts`、`playerCap.ts`、`remoteControl.ts`、`videoExport.ts`、`webLyricSource.ts`。

## External and server boundaries

- Stage：`components/app/playback/useStagePlaybackController.ts`、`utils/appStageHelpers.ts`、`utils/stageClientDemo.ts`、`utils/stagePlayerSnapshot.ts`、`electron/stageApi.cjs`。
- Electron：`electron/main.cjs`、`preload.cjs`、`kugou/kugouApiBridge.cjs`、`updateChannels.cjs`、`windowPlaybackHandoff.cjs`。
- Web API handlers：`api/`（部署入口）与 `api-ts/`（TypeScript 源码）；主题/代理公共代码在 `shared/`。
- Sync Server：`sync-server/src/app.ts`（路由与协议）、`src/node.ts`、`src/cloudflare.ts`、`src/d1-emulator.ts`；Worker 包装在根 `worker/index.ts`。

## Where changes usually belong

1. 先用 `git ls-files` 验证路径，再用 `rg -n` 搜确切 symbol。
2. UI 结构改 `components`；app-level props/导航/展示派生改相邻 `components/app/*/build*.ts` 或 `create*.ts`。
3. 生命周期、副作用、用户动作编排改 `hooks`；跨组件状态改 `stores`。
4. 请求、缓存、解析、provider 和播放流程改 `services`；纯计算改 `utils`。
5. 在线歌曲先经过 `services/onlineMusic/omni.ts`；不要从组件直接调用 provider adapter。
6. visualizer 只消费解析后的 `LyricData` / `Line` / `Word`，不要把格式解析或 provider 逻辑塞进模式组件。
7. 新用户可见文案同步 `en.ts`、`zh-CN.ts`、`in.ts`；新增设置同时检查视觉导入导出和 command palette。
