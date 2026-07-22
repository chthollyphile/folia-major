---
name: glossary-alignment
description: Use when the user refers to repository-specific terms such as home view, panel, local library, Navidrome view, visualizer mode, queue, current song, search state, or other spoken component/state names and you need to map them quickly to the concrete files, hooks, stores, and code ownership in this project.
---

# Glossary Alignment

这个 skill 用于把口头术语快速映射到代码。

目标：

- 当开发者说“首页”“右侧面板”“本地库状态”“当前歌曲”“搜索状态”“心象模式”时，快速知道应该去看哪里
- 避免因为术语不统一，改错组件、状态层或 service

## When To Use

以下情况优先使用：

- 用户用自然语言描述界面或状态，而不是直接给文件名
- 需要快速定位“这个词在代码里归谁管”
- 需要判断某个名词属于组件、hook、store、service 还是共享类型
- 需要在多人交流时对齐术语

## Primary Mapping

### App / Global

- “主入口”“播放器主调度”“全局状态中心”
  -> `src/App.tsx`

- “当前歌曲”
  -> `currentSong` in `src/App.tsx`

- “播放队列”
  -> `playQueue` in `src/App.tsx`

- “状态提示”“顶部消息条”“toast 状态”
  -> `statusMsg` in `src/App.tsx`

### Navigation / View

- “首页视图”“当前首页 tab”“主页 tab”
  -> `homeViewTab` in `src/stores/useSearchNavigationStore.ts`
  -> consumed by `src/components/Grid3D.tsx` and `src/components/app/home/GridViewOverlayHost.tsx`

- “网格首页”“3D 首页”“集合网格”
  -> `src/components/Grid3D.tsx` / `src/components/GridView.tsx`
  -> collection adapters: `src/components/app/home/gridViewCollectionAdapters.ts`
  -> overlay host: `src/components/app/home/GridViewOverlayHost.tsx`

- “隐藏歌单”“歌单隐藏过滤”
  -> `isPlaylistHidden` / `hiddenPlaylistKeys` in `src/components/Grid3D.tsx`, `src/components/GridMap.tsx`, `src/components/folia-grid/DesktopGrid3DSurface.tsx`

- “文件夹排序”“本地排序策略”
  -> `localFolderSortStrategy` in `src/components/GridView.tsx`

- “当前 app 视图”“home/player 切换”
  -> `useAppNavigation` in `src/hooks/useAppNavigation.ts`
  -> persisted by `last_app_view`

- “本地库导航状态”
  -> `localMusicState` in `src/hooks/useAppNavigation.ts`
  -> passed through `App.tsx` to `Home.tsx` and `LocalMusicView.tsx`

- “Navidrome 待处理跳转”“待打开的 Navi 选择”
  -> `pendingNavidromeSelection` in `src/hooks/useAppNavigation.ts`

### Home / Library

- “首页”
  -> app-level entry: `src/components/app/Home.tsx`
  -> mounts `GridViewOverlayHost` and `Grid3D` directly; legacy carousel and single-view home components are fully removed.

- “首页模型”“Home 装配输入”
  -> `src/components/app/home/buildHomeModel.ts`

- “本地音乐页”“本地视图”
  -> `src/components/LocalMusicView.tsx`

- “本地文件夹/本地歌单详情页”
  -> `src/components/local/LocalPlaylistView.tsx`

- “Navidrome 页面”“Navi 页面”“Navi视图”
  -> `src/components/navidrome/NavidromeMusicView.tsx`

- “Navidrome 专辑页”
  -> `src/components/navidrome/NavidromeAlbumView.tsx`

- “网易云歌单页 / 专辑页 / 歌手页 / 详情集合”
  -> 统一由 `GridView.tsx` 集合导航栈与 `src/components/app/home/gridViewCollectionAdapters.ts` 接管

### Search

- “搜索词”
  -> `searchQuery` in `src/stores/useSearchNavigationStore.ts`

- “搜索结果”
  -> `searchResults` in `src/stores/useSearchNavigationStore.ts`

- “搜索来源 tab”
  -> `searchSourceTab` in `src/stores/useSearchNavigationStore.ts`

- “搜索结果页面”“搜索工作台”
  -> `src/components/app/search/SearchWorkspace.tsx`
  -> overlay assembly: `src/components/app/overlays/AppOverlays.tsx`

### Panel / Modal

- “右侧面板”“播放器面板”“unified panel”
  -> app-level entry: `src/components/app/PlayerPanel.tsx`
  -> legacy implementation: `src/components/UnifiedPanel.tsx`

- “面板模型”“PlayerPanel 装配输入”
  -> `src/components/app/player-panel/buildPlayerPanelModel.ts`

- “overlay 总装配”
  -> `src/components/app/overlays/AppOverlays.tsx`
  -> model builder: `src/components/app/overlays/buildAppOverlaysModel.ts`

- “dialog 总装配”
  -> `src/components/app/dialogs/AppDialogs.tsx`
  -> model builder: `src/components/app/dialogs/buildAppDialogsModel.ts`

- “封面 tab”
  -> `src/components/panelTab/CoverTab.tsx`

- “控制 tab”
  -> `src/components/panelTab/ControlsTab.tsx`

- “队列 tab”“播放列表 tab”
  -> `src/components/panelTab/QueueTab.tsx`

- “账号 tab”
  -> `src/components/panelTab/AccountTab.tsx`

- “本地 tab”
  -> `src/components/panelTab/LocalTab.tsx`

- “Navi tab”
  -> `src/components/panelTab/NaviTab.tsx`

- “FM tab”
  -> `src/components/panelTab/FmTab.tsx`

- “帮助弹窗”“设置弹窗”“选项中心”
  -> `src/components/modal/SettingsModal.tsx`
  -> settings subviews: `src/components/modal/settings/*`

- “命令面板”“command palette”“快捷命令”
  -> `src/components/command-palette/commandRegistry.ts`
  -> context type: `src/components/command-palette/types.ts`

- “外观设置”“视觉设置”“视觉配置导入导出”
  -> `src/components/modal/settings/AppearanceSettingsSubview.tsx`
  -> settings store: `src/stores/useSettingsUiStore.ts`

- “播放设置”“集成设置”“存储设置”“桌面端设置”“实验室设置”
  -> `src/components/modal/settings/PlaybackSettingsSubview.tsx`
  -> `src/components/modal/settings/IntegrationSettingsSubview.tsx`
  -> `src/components/modal/settings/StorageSettingsSection.tsx`
  -> `src/components/modal/settings/DesktopSettingsSubview.tsx`
  -> `src/components/modal/settings/LabSettingsModal.tsx`

- “本地歌词匹配弹窗”
  -> `src/components/modal/LyricMatchModal.tsx`

- “Navidrome 歌词匹配弹窗”
  -> `src/components/modal/NaviLyricMatchModal.tsx`

### Visualizer

- “歌词可视化”“全屏歌词层”“visualizer”
  -> `src/components/visualizer/*`

- “经典模式”“classic”
  -> `src/components/visualizer/classic/Visualizer.tsx`
  -> `VisualizerMode = 'classic'`

- “心象模式”“cadenza”
  -> `src/components/visualizer/cadenza/VisualizerCadenza.tsx`
  -> `VisualizerMode = 'cadenza'`

- “云阶模式”“partita”
  -> `src/components/visualizer/partita/VisualizerPartita.tsx`
  -> `VisualizerMode = 'partita'`

- “浮名模式”“fume”
  -> `src/components/visualizer/fume/VisualizerFume.tsx`
  -> `VisualizerMode = 'fume'`

- “群唱模式”“cappella”
  -> `src/components/visualizer/cappella/VisualizerCappella.tsx`
  -> `VisualizerMode = 'cappella'`

- “倾诉模式”“tilt”
  -> `src/components/visualizer/tilt/VisualizerTilt.tsx`
  -> `VisualizerMode = 'tilt'`

- “莫奈模式”“monet”
  -> `src/components/visualizer/monet/VisualizerMonet.tsx`
  -> `VisualizerMode = 'monet'`

- “回环模式”“claddagh”
  -> `src/components/visualizer/claddagh/VisualizerCladdagh.tsx`
  -> `VisualizerMode = 'claddagh'`
  -> tuning: `claddaghTuning` in `src/stores/useSettingsUiStore.ts`

- “漫游模式”“立影模式”“diorama”
  -> `src/components/visualizer/diorama/VisualizerDiorama.tsx`
  -> `VisualizerMode = 'diorama'`

- “通用背景 / 莫奈背景 / 隐现双着色器背景”
  -> `visualizerBackgroundMode` in `src/stores/useSettingsUiStore.ts`
  -> shell background registry: `src/components/visualizer/backgrounds/registry.tsx`

- “可视化模式状态”
  -> `visualizerMode` in `src/stores/useSettingsUiStore.ts`
  -> bridge hook: `src/hooks/useAppPreferences.ts`
  -> related type in `src/types.ts`

- “更新通道”“limo 通道”“cielo 通道”
  -> `electron/updateChannels.cjs` / `electron/main.cjs`

- “自定义字重”
  -> `resolveThemeFontWeight` in `src/utils/fontStacks.ts` / `useSettingsUiStore.ts`

- “Acrylic 确认弹窗”
  -> `src/components/modal/settings/DesktopSettingsSubview.tsx`

### Data / Service

- “网易云接口层”
  -> `src/services/netease.ts`

- “酷狗接口层 / 酷狗 Provider”
  -> `src/services/onlineMusic/kugouTransport.ts` / `kugouProvider.ts`

- “Navidrome 接口层”
  -> `src/services/navidromeService.ts`（已适配 Navidrome 0.63+ `/api/getLyrics` 歌词接口）

- “本地导入逻辑”“本地文件扫描”“重扫逻辑”
  -> `src/services/localMusicService.ts`

- “在线播放加载”
  -> `src/services/onlinePlayback.ts`

- “播放结构适配”
  -> `src/services/playbackAdapters.ts`

- “缓存数据库”“IndexedDB 层”
  -> `src/services/db.ts`
  -> dedicated theme sync registry: `theme_registry` store via `src/services/sync/themeSyncRegistry.ts`

- “预取”
  -> `src/services/prefetchService.ts`

- “同步服务”“云同步”“主题同步”
  -> configuration/status: `src/services/sync/syncConfig.ts`
  -> orchestration: `src/services/sync/syncCoordinator.ts`
  -> local/remote repository: `src/services/sync/syncRepository.ts`
  -> stable song fingerprints and local registry: `src/services/sync/syncFingerprint.ts` / `themeSyncRegistry.ts`
  -> settings UI: `src/components/modal/settings/StorageSettingsSection.tsx`
  -> command palette: `settings-r2-sync` / `sync-now` in `src/components/command-palette/commandRegistry.ts`

### Types / Shared Definitions

- “统一歌曲结构”
  -> `SongResult` / `UnifiedSong` in `src/types.ts`

- “本地歌曲结构”
  -> `LocalSong` in `src/types.ts`

- “Navidrome 类型”
  -> `src/types/navidrome.ts`

- “首页 tab 类型”
  -> `HomeViewTab` in `src/types.ts`

- “可视化模式类型”
  -> `VisualizerMode` in `src/types.ts`

## Fast Lookup Heuristics

- 术语里带“页面”“视图”“弹窗”“tab”
  -> 先看 `components/app/*` 是否已有 app-level 入口，再看 `components/*`

- 术语里带“状态”“导航”“当前模式”“偏好”
  -> 先看 `hooks/*` 或 `stores/*`

- 术语里带“模型”“装配”“入口透传”“顶层派生”
  -> 先看 `components/app/*/build*.ts` 或 `create*.ts`

- 术语里带“接口”“缓存”“导入”“播放流程”
  -> 先看 `services/*`

- 术语里带“类型”“模式枚举”“共享结构”
  -> 先看 `types.ts` 或 `types/navidrome.ts`

## Workflow

1. 先把口头术语归类为：组件 / 视图 / 状态 / store / service / type。
2. 用上面的 glossary 找到第一归属文件。
3. 再从该文件向上传导或向下调用追踪真实实现。
4. 如果术语和代码命名不一致，以真实代码为准，并在回答中直接说明映射关系。

## What To Avoid

- 把“首页状态”误认为只在 `Home.tsx` 内部
- 把“右侧面板”误认为单个 tab 文件
- 把“可视化模式”误认为只是组件名，而忽略 `VisualizerMode` 和 `useAppPreferences`
- 把“本地库状态”只看 `LocalMusicView.tsx`，忽略 `useAppNavigation.ts` 里的 `localMusicState`
