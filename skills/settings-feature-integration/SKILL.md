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

接入点分在两个文件，别只看其中一个：

- UI 与装配：`src/components/modal/settings/AppearanceSettingsSubview.tsx`
  - 导出入口：`buildCurrentConfig`
  - 导入应用：`handleImportConfig`
- 编解码实现：`src/utils/appearanceCodec.ts`
  - 短码压缩：`compressConfig`
  - 短码解压：`decompressConfig`
  - JSON 白名单：`validKeys`（在 `decompressConfig` 内部）

subview 只是调用方；新增字段要同时改这两处，光改 subview 不会进短码。

新增 visualizer tuning（例如 `claddaghTuning`、`monetTuning`、`dioramaTuning`、`pendoloTuning`、`sonnetTuning` 等）或全局字重 `fontWeight` 时通常还要同步：

- `src/types.ts`：新增 tuning / 设置类型和默认值
- 对应领域的 `src/stores/use*SettingsStore.ts`（visualizer tuning 在 `useVisualizerSettingsStore`，字重/字体在 `useTypographySettingsStore`）：读取、持久化、setter、resetter、draft 逻辑；清空自定义字体栈时同步清空字重
- `src/utils/fontStacks.ts`：通过 `resolveThemeFontWeight(theme, modeFallback)` 在渲染与测量中统一解析
- `src/components/visualizer/definition.ts`：把 tuning 或资源 props 加到共享契约
- `src/components/visualizer/<mode>/entry.tsx`：通过 registry 挂载 renderer、设置面板和 reset
- `src/components/visualizer/VisPlayground.tsx` 或相邻设置面板：透传和编辑 tuning
- `src/i18n/locales/en.ts` / `src/i18n/locales/zh-CN.ts`：补设置文案

不要只把视觉设置写进 localStorage 或 store；如果用户会把它理解成“外观配置的一部分”，它就必须能随 shortcode / JSON 一起导入导出。

## Functional Settings Must Join Command Palette

功能性设置（如 Electron 更新通道 `updateChannel`选择、桌面端 Acrylic 背景确认防护、实验室设置）或可执行动作必须评估并注册到 command palette：

- 文件：按命令的 `group` 落到 `src/components/command-palette/commands/<group>Commands.ts`（`search` / `playback` / `settings` / `navigation` / `panel` / `visualizer`）。不要再往 `commandRegistry.ts` 里加命令，它只负责拼接和过滤。
- 构造入口：一律经 `src/components/command-palette/commandFactories.ts` 的 `defineCommand`；「调一个 context 方法后返回 true」用 `createToggleCommand`，其余优先复用 `createSettingsCommand`、`createPanelCommand`、`createHomeTabCommand`、`createVisualizerCommand`。
- 上下文：`CommandPaletteContext` 按 group 分成 `shared` / `search` / `playback` / `navigation` / `panel` / `settings` / `visualizer` 七个命名空间，命令归哪个 group 就先在同名命名空间里找依赖。需要新能力时同时改 `src/components/command-palette/types.ts` 和 `src/hooks/useCommandPaletteContext.ts`。
- 平台可见性：只在部分平台可用的功能写 `platform: ['electron' | 'win' | 'mac' | 'linux' | 'web']`，不要在过滤函数里加 id 判断。状态可见性用 `isAvailable`，两者职责分开。
- 面板内界面：需要在命令面板里直接出控件（滑块、图标网格等）时写 `surface`，组件用 `load: () => import(...)` 惰性加载，不要在 `CommandPalette.tsx` 里加 `activeCommand.id` 分支。参考 `surfaces/volumeSurface.ts` 与 `surfaces/pickerSurface.ts`。
- 复杂语法：需要 `--flag` / `@facet:value` 时声明 `syntax`，解析复用 `src/components/command-palette/syntax/`，不要另写正则。
- 执行模式：明确判断要不要给 `executeShortcut`。危险、不可撤销、要花钱或需要确认的操作不给；给了就必须与现有快捷键保持 prefix-free，冲突会在构建时抛错。
- 命令文案：同步 `src/i18n/locales/en.ts`、`zh-CN.ts` 和 `in.ts` 的 `commandPalette.commands.<id>`，缺任何一份都会让 `test/unit/command-palette/commandRegistryContract.test.ts` 失败。
- 关键词：至少包含英文、中文和常用拼音缩写，同样由上面的契约测试校验。
- 落地列表：命令是否出现在面板刚打开时的首屏，由 `commands/index.ts` 的 `DEFAULT_LANDING_COMMAND_IDS` 显式决定，不取决于它在数组里的位置。

当前同步服务已经有两类命令入口：`settings-r2-sync` 打开存储设置中的同步服务区域，`sync-now` 触发 AI 主题同步；新增同步动作时优先复用 `src/services/sync/syncCoordinator.ts`，不要在命令里直接发请求。

新增设置子视图时，至少添加一个能打开该子视图的 settings command；新增开关或动作时，添加能直接执行的命令，除非该操作危险、不可撤销或需要复杂确认（例如开启桌面端 Acrylic 效果需弹窗确认防护）。

例外：开发者设置子视图（`SettingsModal.tsx` 的 `developer` 导航项）刻意不提供命令入口，因此也不在 `SettingsSubviewId` 里。它面向的是排查问题时的手动操作，不属于日常功能性设置；`openSettings(tab, 'developer')` 不可用是预期行为，不要按上面这条补命令。

`isAvailable` 必须与设置 UI 用同一个判断，不要在命令里重新推导一遍能力检测。反例：`transition-performance-toggle` 曾只按 `platform: ['electron']` 过滤，而设置面板是按 `transitionCapabilities().stems` 置灰，命令因此能把开关持久化成面板不允许产生的状态。需要新的能力判断时，经 `buildCommandPaletteContext` 透出；结果会随运行时变化（例如模型下载完成）的，用函数而不是快照值。

## Settings UI Placement

设置 UI 采用分栏导航结构（`SettingsModal.tsx`），优先放在现有分区：

- 外观 / 视觉：`src/components/modal/settings/AppearanceSettingsSubview.tsx`
- 播放：`src/components/modal/settings/PlaybackSettingsSubview.tsx`
- 通用：`src/components/modal/settings/GeneralSettingsSubview.tsx`
- 集成：`src/components/modal/settings/IntegrationSettingsSubview.tsx`
- 存储：`src/components/modal/settings/StorageSettingsSection.tsx`
  缓存、同步服务配置、主题/视觉设置同步，以及 zip 导入导出动作。
- 桌面端：`src/components/modal/settings/DesktopSettingsSubview.tsx`
  包含更新通道选择（release / limo / cielo）和 Acrylic 背景开启确认弹窗。
- 实验室：`src/components/modal/settings/LabSettingsModal.tsx`
  包含固定顶部标题控件与返回按钮。
- 固定命令：`src/components/modal/settings/PinnedCommandSettings.tsx`
- visualizer 专属参数：优先放在模式相邻设置面板，再由 registry 的 `renderSettingsPanel` 挂回

不要把新设置继续堆回 `SettingsModal.tsx` 的大 JSX 分支；如果需要新区域，先按 `file-modularization` 拆成相邻子视图。

## Review Checklist

- 这个设置是视觉相关、功能性，还是两者都是？
- 视觉设置是否进入 `buildCurrentConfig`、`compressConfig`、`decompressConfig`、`validKeys` 和 `handleImportConfig`？
- 功能性设置或动作是否进入对应的 `commands/<group>Commands.ts`？
- 平台限定用了 `platform` 而不是 id 判断？需要界面的用了 `surface` 而不是外壳里的特例？
- 是否明确决定过要不要给 `executeShortcut`？
- 命令是否有 en / zh-CN / in 三份 i18n、中文关键词和拼音缩写？
- store、localStorage key、默认值、resetter、导入恢复是否一致？
- 同步相关设置是否同时接入 `sync/settingsSnapshot.ts`、`StorageSettingsSection.tsx` 和对应 command palette 命令？
- 新增用户可见文案是否同步中英文？
- 是否避免继续膨胀 `SettingsModal.tsx`、`VisPlayground.tsx` 或单个 visualizer 大文件？
