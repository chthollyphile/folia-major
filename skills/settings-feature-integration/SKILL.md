---
name: settings-feature-integration
description: Use when adding, changing, refactoring, or reviewing user-facing settings in this repository, especially visual settings, appearance settings, visualizer tuning, background/theme/typography controls, playback/integration/storage/desktop/lab settings, or any setting that should be importable/exportable or invokable from the command palette.
---

# Settings Feature Integration

这个 skill 用于新增或调整设置功能时，避免设置只在 UI 上“看得到”，但没有接入备份、恢复、命令面板或统一入口。

## First Decision

先把设置分成两类：

- 视觉相关设置：影响主题、歌词动画、背景、透明度、字体、字号、visualizer 模式、visualizer tuning、封面/Monet 背景、预览表现。
- 功能性设置：影响播放行为、搜索/导航、集成、存储、桌面端、实验功能、面板行为，或本质上是一个可执行动作。

如果一个设置同时有视觉和功能属性，同时执行两类接入规则。

## Visual Settings Must Join Import / Export

视觉相关设置（例如主题、字重 `fontWeight`、歌词动画、背景、透明度、字号、visualizer tuning）必须接入外观页的视觉配置导入导出：

- 文件：`src/components/modal/settings/AppearanceSettingsSubview.tsx`
- 导出入口：`buildCurrentConfig`
- 短码压缩：`compressConfig`
- 短码解压：`decompressConfig`
- JSON 白名单：`validKeys`
- 导入应用：`handleImportConfig`

新增 visualizer tuning（例如 `claddaghTuning`、`monetTuning` 等）或全局字重 `fontWeight` 时通常还要同步：

- `src/types.ts`：新增 tuning / 设置类型和默认值
- `src/stores/useSettingsUiStore.ts`：读取、持久化、setter、resetter、draft 逻辑；清空自定义字体栈时同步清空字重
- `src/utils/fontStacks.ts`：通过 `resolveThemeFontWeight(theme, modeFallback)` 在渲染与测量中统一解析
- `src/components/visualizer/definition.ts`：把 tuning 或资源 props 加到共享契约
- `src/components/visualizer/<mode>/entry.tsx`：通过 registry 挂载 renderer、设置面板和 reset
- `src/components/visualizer/VisPlayground.tsx` 或相邻设置面板：透传和编辑 tuning
- `src/i18n/locales/en.ts` / `src/i18n/locales/zh-CN.ts`：补设置文案

不要只把视觉设置写进 localStorage 或 store；如果用户会把它理解成“外观配置的一部分”，它就必须能随 shortcode / JSON 一起导入导出。

## Functional Settings Must Join Command Palette

功能性设置（如 Electron 更新通道 `updateChannel`选择、桌面端 Acrylic 背景确认防护、实验室设置）或可执行动作必须评估并注册到 command palette：

- 文件：`src/components/command-palette/commandRegistry.ts`
- 命令类型：优先复用 `createSettingsCommand`、`createPanelCommand`、`createHomeTabCommand`、`createVisualizerCommand`
- 如果需要新上下文能力，先扩展 `src/components/command-palette/types.ts` 的 `CommandPaletteContext`
- 命令文案：同步 `src/i18n/locales/en.ts` 和 `src/i18n/locales/zh-CN.ts` 的 `commandPalette.commands`
- 关键词：至少包含英文、中文和常用拼音缩写

当前同步服务已经有两类命令入口：`settings-r2-sync` 打开存储设置中的同步服务区域，`sync-now` 触发 AI 主题同步；新增同步动作时优先复用 `src/services/sync/syncCoordinator.ts`，不要在命令里直接发请求。

新增设置子视图时，至少添加一个能打开该子视图的 settings command；新增开关或动作时，添加能直接执行的命令，除非该操作危险、不可撤销或需要复杂确认（例如开启桌面端 Acrylic 效果需弹窗确认防护）。

## Settings UI Placement

设置 UI 采用分栏导航结构（`SettingsModal.tsx`），优先放在现有分区：

- 外观 / 视觉：`src/components/modal/settings/AppearanceSettingsSubview.tsx`
- 播放：`src/components/modal/settings/PlaybackSettingsSubview.tsx`
- 集成：`src/components/modal/settings/IntegrationSettingsSubview.tsx`
- 存储：`src/components/modal/settings/StorageSettingsSection.tsx`
  缓存、同步服务配置、主题/视觉设置同步，以及 zip 导入导出动作。
- 桌面端：`src/components/modal/settings/DesktopSettingsSubview.tsx`
  包含更新通道选择（release / limo / cielo）和 Acrylic 背景开启确认弹窗。
- 实验室：`src/components/modal/settings/LabSettingsModal.tsx`
  包含固定顶部标题控件与返回按钮。
- visualizer 专属参数：优先放在模式相邻设置面板，再由 registry 的 `renderSettingsPanel` 挂回

不要把新设置继续堆回 `SettingsModal.tsx` 的大 JSX 分支；如果需要新区域，先按 `file-modularization` 拆成相邻子视图。

## Review Checklist

- 这个设置是视觉相关、功能性，还是两者都是？
- 视觉设置是否进入 `buildCurrentConfig`、`compressConfig`、`decompressConfig`、`validKeys` 和 `handleImportConfig`？
- 功能性设置或动作是否进入 `COMMAND_PALETTE_COMMANDS`？
- 命令是否有中英文 i18n、中文关键词和拼音缩写？
- store、localStorage key、默认值、resetter、导入恢复是否一致？
- 同步相关设置是否同时接入 `sync/settingsSnapshot.ts`、`StorageSettingsSection.tsx` 和对应 command palette 命令？
- 新增用户可见文案是否同步中英文？
- 是否避免继续膨胀 `SettingsModal.tsx`、`VisPlayground.tsx` 或单个 visualizer 大文件？
