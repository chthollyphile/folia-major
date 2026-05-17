# `src/` Map

代码地图

## 1. Main Entry

- `App.tsx`
  前端总调度中心。
  统一三类来源：网易云 / 本地音乐 / Navidrome。
  负责播放状态、队列、歌词、封面、主题、会话恢复、全局弹层、主页与播放器切换。

- `index.tsx`
  React 入口。

- `index.css`
  全局样式和共享 CSS 变量。

## 2. Source Layout

```text
src/
├─ App.tsx
├─ index.tsx
├─ index.css
├─ README.md
├─ types.ts
├─ types/navidrome.ts
├─ components/
├─ hooks/
├─ services/
├─ utils/
├─ workers/
└─ i18n/
```

## 3. Module Boundaries

### Components

- `components/app/*`
  App 顶层装配目录。
  负责承接 `App.tsx` 直接挂载的入口组件、overlay 归口、dialog 归口，以及顶层视图包装层。

- `components/app/home/*` / `player-panel/*` / `overlays/*` / `dialogs/*`
  App 装配层的参数组装与功能邻近文件。
  负责用 `build*.ts` / `create*.ts` 聚合底层 hook / state / action，生成给顶层 app 组件消费的模型和动作。

- `components/app/navigation/*` / `playback/*` / `presentation/*`
  App 装配层的纯函数辅助目录。
  分别承接顶层导航辅助、播放装配辅助、展示派生计算，避免这些实现回流到 `App.tsx`。

- `components/Home.tsx`
  首页主入口。包含搜索、网易云入口、本地音乐入口、Navidrome 入口、帮助/设置弹窗。

- `components/PlaylistView.tsx` / `AlbumView.tsx` / `ArtistView.tsx`
  网易云详情页。

- `components/LocalMusicView.tsx`
  本地音乐总览页。负责文件夹/专辑/艺人/歌单视图切换和导入入口。

- `components/local/LocalPlaylistView.tsx`
  本地文件夹或本地歌单详情列表。

- `components/navidrome/NavidromeMusicView.tsx`
  Navidrome 总览页。

- `components/navidrome/NavidromeAlbumView.tsx`
  Navidrome 专辑详情。

- `components/UnifiedPanel.tsx`
  播放器右侧面板容器。根据当前歌曲来源切换不同 tab。

- `components/app/views/*`
  由 App 顶层 overlay 栈直接调度的视图包装层。
  当前用于 `PlaylistView`、`AlbumView`、`ArtistView` 的 app-level 入口。

- `components/panelTab/*`
  右侧面板各 tab 的具体实现。

- `components/modal/*`
  各类弹窗，尤其是：
  `HelpModal.tsx` 既是帮助弹窗，也是设置中心。

- `components/visualizer/*`
  歌词可视化层。
  根目录保留共享壳层、背景层、runtime、registry 和预览入口；
  `classic/Visualizer.tsx` / `cadenza/VisualizerCadenza.tsx` / `partita/VisualizerPartita.tsx` / `fume/VisualizerFume.tsx` 分别负责各模式实现。

### Hooks

- `hooks/useAppNavigation.ts`
  App 级导航状态。

- `hooks/useAppPreferences.ts`
  用户偏好，例如音质、白天模式、静态模式、音量、可视化模式。

- `hooks/useNeteaseLibrary.ts`
  网易云用户资料、歌单、喜欢列表、同步、退出登录。

- `hooks/useThemeController.ts`
  默认主题、AI 主题、自定义主题、明暗切换。

### Services

- `services/netease.ts`
  网易云 API 封装。

- `services/navidromeService.ts`
  Navidrome / Subsonic API 封装。

- `services/localMusicService.ts`
  本地音乐导入、重扫、删除、歌词匹配、文件句柄恢复、扫描事件。

- `services/onlinePlayback.ts`
  在线音频和歌词加载。

- `services/playbackAdapters.ts`
  把本地 / Navidrome 歌曲转成统一播放结构。

- `services/prefetchService.ts`
  队列邻近歌曲的预取。

- `services/db.ts`
  IndexedDB 封装。缓存、用户数据、本地歌曲、目录句柄、快照都在这里。

- `services/coverCache.ts` / `themeCache.ts`
  封面和主题缓存。

- `services/gemini.ts`
  AI 主题生成前端桥接。

### Utils / Workers

- `utils/lyrics/parserCore.ts`
  歌词解析真源。优先看它，不要从旧 wrapper 猜逻辑。

- `utils/lyrics/LyricParserFactory.ts`
  歌词解析统一入口，按来源分发到不同 adapter。

- `utils/lyrics/adapters/*`
  网易云 / 本地文件 / 嵌入歌词 / Navidrome 的来源适配层。

- `workers/lyricsParser.worker.ts`
  歌词解析 worker。

- `workers/metadataParser.worker.ts`
  音频元数据解析 worker。

- `utils/localMetadataWorkerClient.ts`
  metadata worker 客户端。

- `utils/colorExtractor.ts`
  封面取色。

### Types / i18n

- `types.ts`
  核心共享类型。先看它再改状态结构。

- `types/navidrome.ts`
  Navidrome 相关类型。

- `i18n/config.ts`
  国际化初始化。

- `i18n/locales/en.ts` / `zh-CN.ts`
  文案字典。

## 4. Where Changes Usually Belong

- 改页面布局或交互：`components/*`
- 改 App 顶层装配、overlay 归口、dialog 归口、参数组装：`components/app/*`
- 改跨页面状态或导航：`hooks/*`
- 改 API、缓存、导入、播放数据流：`services/*`
- 改解析、纯逻辑、格式转换：`utils/*`
- 改耗时解析：优先看 `workers/*`
- 改共享数据结构：先改 `types.ts`

## 5. High-Value Files

如果只读少数文件，优先按这个顺序：

1. `App.tsx`
2. `types.ts`
3. `components/Home.tsx`
4. `hooks/useAppNavigation.ts`
5. `services/localMusicService.ts`
6. `services/navidromeService.ts`
7. `services/onlinePlayback.ts`
8. `utils/lyrics/LyricParserFactory.ts`
9. `utils/lyrics/parserCore.ts`

## 6. Project-Specific Notes

- 这是统一播放模型，不要把网易云 / 本地 / Navidrome 分成三套播放器状态。
- `HelpModal.tsx` 是设置中心，不只是帮助说明。
- `UnifiedPanel.tsx` 通过 `panelTab/*` 组合，不要重新把面板逻辑塞回一个大组件。
- 不要在 `App.tsx` 里直接组装超长 props；优先放进 `components/app/*` 下与功能相邻的 `build*.ts` / `create*.ts`。
- 本地音乐导入是增量快照式，不是单次全量扫描。
- 歌词解析优先从 `parserCore.ts` 理解，不要从旧兼容层反推。
