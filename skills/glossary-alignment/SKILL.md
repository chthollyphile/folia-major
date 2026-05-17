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
  -> consumed in `src/components/Home.tsx`

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
  -> legacy implementation: `src/components/Home.tsx`

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

- “网易云歌单页”“歌单详情页”
  -> app-level overlay entry: `src/components/app/views/PlaylistView.tsx`
  -> legacy implementation: `src/components/PlaylistView.tsx`

- “网易云专辑页”“专辑详情页”
  -> app-level overlay entry: `src/components/app/views/AlbumView.tsx`
  -> legacy implementation: `src/components/AlbumView.tsx`

- “网易云歌手页”“歌手详情页”
  -> app-level overlay entry: `src/components/app/views/ArtistView.tsx`
  -> legacy implementation: `src/components/ArtistView.tsx`

### Search

- “搜索词”
  -> `searchQuery` in `src/stores/useSearchNavigationStore.ts`

- “搜索结果”
  -> `searchResults` in `src/stores/useSearchNavigationStore.ts`

- “搜索来源 tab”
  -> `searchSourceTab` in `src/stores/useSearchNavigationStore.ts`

- “搜索结果页面”
  -> app-level overlay assembly: `src/components/app/overlays/AppOverlays.tsx`
  -> legacy implementation: `src/components/SearchResultsOverlay.tsx`

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
  -> `src/components/modal/HelpModal.tsx`

- “本地歌词匹配弹窗”
  -> `src/components/modal/LyricMatchModal.tsx`

- “Navidrome 歌词匹配弹窗”
  -> `src/components/modal/NaviLyricMatchModal.tsx`

### Visualizer

- “歌词可视化”“全屏歌词层”“visualizer”
  -> `src/components/visualizer/*`

- “经典模式”“classic”
  -> `Visualizer.tsx`
  -> `VisualizerMode = 'classic'`

- “心象模式”"cadenza"
  -> `VisualizerCadenza.tsx`
  -> `VisualizerMode = 'cadenza'`

- “云阶模式”""partita"
  -> `VisualizerPartita.tsx`
  -> `VisualizerMode = 'partita'`

- “可视化模式状态”
  -> `visualizerMode` in `src/hooks/useAppPreferences.ts`
  -> related type in `src/types.ts`

### Data / Service

- “网易云接口层”
  -> `src/services/netease.ts`

- “Navidrome 接口层”
  -> `src/services/navidromeService.ts`

- “本地导入逻辑”“本地文件扫描”“重扫逻辑”
  -> `src/services/localMusicService.ts`

- “在线播放加载”
  -> `src/services/onlinePlayback.ts`

- “播放结构适配”
  -> `src/services/playbackAdapters.ts`

- “缓存数据库”“IndexedDB 层”
  -> `src/services/db.ts`

- “预取”
  -> `src/services/prefetchService.ts`

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
