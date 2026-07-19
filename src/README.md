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
│  └─ sync/
├─ stores/
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

- `components/app/search/*`
  搜索工作台、虚拟化结果列表和搜索结果到 GridView 集合描述符的适配层。
  搜索结果保持高密度列表；歌手与专辑详情统一进入 GridView 集合导航栈。

- `components/app/navigation/*` / `playback/*` / `presentation/*`
  App 装配层的纯函数辅助目录。
  分别承接顶层导航辅助、播放装配辅助、展示派生计算，避免这些实现回流到 `App.tsx`。

- `components/app/Home.tsx`
  首页 app-level 入口。负责消费 `buildHomeModel.ts` 生成的模型，并统一进入 Grid3D/GridView 流程；`carousel` 首页布局已弃用，历史设置会迁移到 `grid`。

- `components/app/PlayerPanel.tsx`
  播放器右侧面板 app-level 入口。负责消费 `buildPlayerPanelModel.ts` 生成的模型，并转接到 `UnifiedPanel.tsx`。

- `components/UnifiedPanel.tsx`
  播放器右侧面板实现。根据当前歌曲来源切换不同 tab。

- `components/panelTab/*`
  右侧面板各 tab 的具体实现。

- `components/modal/*`
  各类弹窗，尤其是：
  `SettingsModal.tsx` 是全局设置中心和帮助入口；具体设置页已拆到 `components/modal/settings/*`。

- `components/command-palette/*`
  命令面板。`commandRegistry.ts` 统一注册搜索、设置入口、导航、右侧面板、播放、visualizer 和背景切换命令；新增功能性设置或可执行动作时必须同步这里和 i18n。

- `components/visualizer/*`
  歌词可视化层。
  根目录保留共享壳层、runtime、registry、视觉设置卡片和预览入口；
  `classic` / `cadenza` / `partita` / `fume` / `cappella` / `tilt` / `claddagh` / `monet` 子目录分别负责各模式实现。
  shell 背景按 `backgrounds/<mode>/` 组织，并由 `backgrounds/*/entry.tsx` 自动发现；当前支持通用、Monet、漫游像素画、隐现双着色器、URL 和 Sora 模式。

### Hooks

- `hooks/useAppNavigation.ts`
  App 级导航状态。

- `hooks/useAppPreferences.ts`
  用户偏好，例如音质、白天模式、静态模式、音量、可视化模式。

- `hooks/useNeteaseLibrary.ts`
  网易云账户缓存与同步兼容层；组件侧通过 Omni 账户摘要消费在线账户。

- `hooks/useKugouLibrary.ts`
  酷狗账户会话与收藏同步兼容层；与网易账户分别存储。

- `hooks/useThemeController.ts`
  默认主题、AI 主题、自定义主题、明暗切换。
  组件新增颜色时必须接入当前 `Theme` / `DualTheme` 流程，从已选 light / dark theme 动态派生，不能长期写死只适配单一明暗背景的固定色。

### Services

- `services/onlineMusic/omni.ts`
  普通在线数据的唯一公开入口。首页请求按 active provider 路由，已有歌曲和集合按自身 provider 路由；组件、hooks 和 stores 不应直连 provider registry 或具体 API。

- `services/onlineMusic/kugouTransport.ts`
  酷狗薄 transport。Electron 优先走 preload IPC，Web 仅在明确配置 `VITE_KUGOU_API_BASE` 时启用，运行中不会跨 transport 自动降级。

- `services/netease.ts`
  网易云原始 API 封装，仅由网易 provider 清洗后提供给 Omni。

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
  Dexie 存储兼容入口。保留既有缓存、用户数据、本地歌曲、目录句柄、快照和主题 registry API；类型化 schema 位于 `services/appDatabase.ts`，具体访问按 `services/repositories/*` 拆分。

- `services/localLibraryCatalogService.ts` / `localLibraryEntityRepository.ts`
  本地艺术家、专辑实体及歌曲 assignment 的事务入口。标签负责初始关联，目录只参与专辑解析；在线匹配、手动修改、恢复本地、合并和拆分都通过这里写入。

- `services/coverCache.ts` / `themeCache.ts`
  封面和主题缓存；`themeCache.ts` 通过稳定歌曲 fingerprint 与同步 registry 对接远端主题。

- `services/sync/*`
  用户自托管同步服务的配置、HTTP client、设置快照、主题 fingerprint、bucket diff、远端 repository、导入导出和 coordinator。
  `syncCoordinator.ts` 在 App 启动时同步主题；视觉设置和完整 sync library 的导入导出由存储设置页面触发。

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
  任何新增到 UI 上的用户可见文本都必须同步写入这两个字典，并通过 `react-i18next` 读取。

## 4. Where Changes Usually Belong

- 改页面布局或交互：`components/*`
- 改 App 顶层装配、overlay 归口、dialog 归口、参数组装：`components/app/*`
- 改设置 UI：优先看 `components/modal/settings/*`；不要继续把新设置堆进 `SettingsModal.tsx`
- 改可执行命令或功能性设置入口：`components/command-palette/commandRegistry.ts`
- 改跨页面状态或导航：`hooks/*`
- 改搜索状态：`stores/useSearchNavigationStore.ts`
- 改 GridView 集合栈和来源返回语义：`stores/useCollectionNavigationStore.ts`
- 改共享偏好、visualizer tuning、设置持久化：`stores/useSettingsUiStore.ts`
- 改 API、缓存、导入、播放数据流：`services/*`
- 改解析、纯逻辑、格式转换：`utils/*`
- 改耗时解析：优先看 `workers/*`
- 改共享数据结构：先改 `types.ts`

## 5. High-Value Files

如果只读少数文件，优先按这个顺序：

1. `App.tsx`
2. `types.ts`
3. `components/app/Home.tsx`
4. `hooks/useAppNavigation.ts`
5. `services/localMusicService.ts`
6. `services/navidromeService.ts`
7. `services/onlinePlayback.ts`
8. `utils/lyrics/LyricParserFactory.ts`
9. `utils/lyrics/parserCore.ts`
10. `stores/useSettingsUiStore.ts`
11. `components/command-palette/commandRegistry.ts`
12. `services/sync/syncCoordinator.ts`
13. `services/sync/themeSyncRegistry.ts`

## 6. Project-Specific Notes

- 这是统一播放模型，不要把网易云 / 本地 / Navidrome 分成三套播放器状态。
- 主播放队列支持网易云 / 本地 / Navidrome 混合排列；队列去重、定位和切歌必须使用来源感知的稳定歌曲键，不能只比较数字 `id`。混合队列暂不支持直接保存为单一来源歌单。
- `SettingsModal.tsx` 是设置中心，不只是帮助说明。
- 新增设置时先判断是否适用 `settings-feature-integration`：视觉相关设置必须接入视觉配置导入导出；功能性设置或可执行动作必须接入 command palette。
- `PlayerPanel.tsx` 是当前 app-level 面板入口，`UnifiedPanel.tsx` 是 legacy 实现；不要重新把面板逻辑塞回单个大组件。
- 不要在 `App.tsx` 里直接组装超长 props；优先放进 `components/app/*` 下与功能相邻的 `build*.ts` / `create*.ts`。
- 本地音乐导入是增量快照式，不是单次全量扫描。
- 本地曲库数据库已由 Dexie 全面管理，并保留原生 IndexedDB v6 数据兼容。艺术家/专辑 UUID 与显示名称、文件路径和在线来源 ID 相互独立；GridView 按 assignment 中的实体 UUID 导航。
- 主题同步 registry 已从 legacy localStorage 迁移到 IndexedDB 的 `theme_registry` store；首次读取时会做一次性迁移，不要在业务组件里直接维护 registry。
- 同步服务的主题同步与视觉设置同步是两个动作：`sync-now` 只同步 AI 主题；完整视觉设置的拉取/推送和 zip library 导入导出位于 `StorageSettingsSection.tsx`。
- 歌词解析优先从 `parserCore.ts` 理解，不要从旧兼容层反推。
- 不要用高频 `useState`、store setter 或 reducer 追踪当前精确播放时间来驱动每帧动画；连续时间优先走 `MotionValue`、CSS / Framer Motion、canvas draw loop 或 `useRef`，React state 只承载当前行、模式、可见段落等离散状态。
- 新增 UI 文案必须补 `src/i18n/locales/en.ts` 和 `src/i18n/locales/zh-CN.ts`。
- 新增组件颜色必须从 dual theme 的 light / dark 配色中动态派生，并验证明暗模式下的可读对比。
