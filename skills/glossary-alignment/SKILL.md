---
name: glossary-alignment
description: Use when the user refers to repository-specific spoken terms - home view, grid, player panel, local library, online provider, Stage, OBS, visualizer mode, queue, current song, search state - and you need to turn that term into a name you can look up. Maps Chinese/English spoken terms to symbol or module names, not paths.
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
| 当前歌曲 / 播放队列 / 状态提示 | `App` 里的 `currentSong` / `playQueue` / `statusMsg` |
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
| 在线 provider 账号 / 登录 | `useOnlineProviderAccountStore`、`useOnlineProvider*` hooks |

## 面板 / 搜索 / 弹窗

| 口头说法 | 名字 |
| --- | --- |
| 搜索工作台 / 搜索结果页 | `SearchWorkspace` |
| 右侧播放器面板 / unified panel | 入口 `PlayerPanel` → `buildPlayerPanelModel`；旧实现仍在 `UnifiedPanel` |
| 封面 / 控制 / 队列 tab 等 | `panelTab` 目录下的 `*Tab` |
| overlay / dialog 总装配 | `AppOverlays` + `buildAppOverlaysModel`、`AppDialogs` + `buildAppDialogsModel` |
| 设置弹窗 | `SettingsModal`；外观导入导出在 `AppearanceSettingsSubview` |
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
| 网易云 / 酷狗 provider | `neteaseProvider`、`kugouProvider`、`kugouTransport` —— 实现边界，UI/hook/store 不应直连 |
| provider 注册 / 账号缓存 | `providerRegistry`、`providerAccountCache`、`providerStorage` |
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
| 某个模式 | 模式目录下的 `entry.tsx`；模式清单直接看 `src/components/visualizer/` 下有哪些目录，别信写死的列表 |
| 字体栈 / 颜色混合 | `fontStacks`、`colorMix` |

## 持久化 / 同步 / 部署

| 口头说法 | 名字 |
| --- | --- |
| 同步 / R2 / 主题 registry | `syncCoordinator`、`syncClient`、`syncRepository`、`settingsSnapshot`、`themeSyncRegistry` |
| IndexedDB / 各类缓存 | `appDatabase`、`binaryAssetStore`、`coverCache`、`themeCache` |
| Electron 主进程 / bridge | `electron/` 下的 `main.cjs`、`preload.cjs`、`stageApi.cjs`、`kugouApiBridge.cjs` |
| Sync Server | `sync-server/src/` 下的 `app.ts`（路由/协议）、`node.ts`、`cloudflare.ts`、`d1-emulator.ts`；Worker 包装在 `worker/index.ts` |
| Docker Web stack | `deploy/docker/` |

## 名字对不上时的判断顺序

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
