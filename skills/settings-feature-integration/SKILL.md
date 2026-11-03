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

视觉相关设置（例如主题、字重 `fontWeight`、歌词动画、背景、透明度、字号、visualizer tuning）必须接入视觉配置导入导出（存储与备份页的“备份与导入”）：

接入点分在两个文件，别只看其中一个：

- UI：`src/components/modal/settings/pages/storage/ConfigTransferRows.tsx`；装配在同目录的 `visualConfigTransfer.ts`
  - 导出入口：`buildCurrentConfig`
  - 导入应用：`planConfigImport`、`applyImportedConfig`
- 编解码实现：`src/utils/appearanceCodec.ts`
  - 短码压缩：`compressConfig`
  - 短码解压：`decompressConfig`
  - JSON 白名单：`validKeys`（在 `decompressConfig` 内部）

subview 只是调用方；新增字段要同时改这两处，光改 subview 不会进短码。

例外：歌词动画样式自己的 tuning 不加字段，也不加短码。样式目录里有 `tuning.ts`，它的 tuning 就随 `visualizerTunings` 这一个字段（短码 `vt`）导出、导入、同步、进 OBS，读取方都优先用它。`classicTuning` 到 `lumiereTuning` 这 13 个单独字段和各自的短码是这个字段出现之前留下的，只为旧版本和旧文件保留；新样式不要照着加，`services/sync/*`、`services/obs/visualSettingsConfig.ts`、`utils/appearanceCodec.ts`、`utils/appearanceImportPlan.ts`、`pages/storage/visualConfigTransfer.ts`、`ImportConfirmDialog.tsx` 都不用动。`test/unit/visualizer/tuningBundleTransport.test.ts` 钉住这一点。背景的 tuning 还没有这样的字段，仍然逐个接入。

新增 visualizer tuning（例如 `claddaghTuning`、`monetTuning`、`dioramaTuning`、`pendoloTuning`、`sonnetTuning` 等）或全局字重 `fontWeight` 时通常还要同步（加一整个歌词动画样式的完整清单见 `src/components/visualizer/README.md` 的“加一个歌词动画样式”）：

- 类型和默认值：全局设置写在 `src/types.ts`。新歌词样式的 tuning 类型和默认值放在样式自己的目录里，和 `tuning.ts` 在一起；现有样式的写在 `src/types.ts`（`TiltTuning`、`DEFAULT_TILT_TUNING`），那是按功能放之前的放法
- 对应领域的 `src/stores/use*SettingsStore.ts`（字重/字体在 `useTypographySettingsStore`）：读取、持久化、setter、resetter；清空自定义字体栈时同步清空字重。歌词样式和背景的 tuning 例外：`useVisualizerSettingsStore` 和 `visualizerSettingsPersistence.ts` 不加任何一行，仓库字段和改、恢复默认两个动作由 `tuning.ts` 的声明生成
- `src/utils/fontStacks.ts`：通过 `resolveThemeFontWeight(theme, modeFallback)` 在渲染与测量中统一解析
- `src/components/visualizer/<mode>/tuning.ts`：用 `defineVisualizerTuning`（`tuningDefinition.ts`）写明 `mode`、`defaults`、store 里的三个字段名（`settingsKey`、`settingsSetterKey`、`settingsResetterKey`）和 `storage`（存储键 `key`、把存着的值读成合法设置的 `read`、把一次改动合到现有设置上的 `merge`），并用 `declare module` 把三个字段的类型加进 `VisualizerTuningSettings`。存储键一旦发布就不能改名；`test/unit/stores/storeContract.test.ts` 的键快照和 `test/unit/visualizer/storedSettingsPins.test.ts` 钉住已有的键和读写结果。背景写在 `backgrounds/<mode>/tuning.ts`，用 `defineBackgroundTuning`
- `src/components/visualizer/definition.ts`：不用动。设置面板拿到的是每个样式都一样的一组 props（`VisualizerSettingsPanelProps`：`tuning`、`onTuningChange`、`settings`、拖动开始和结束）；面板另外要的资源自己从对应仓库取。渲染器要的 tuning 也不用加名字：在 `entry.tsx` 里用自己 `tuning.ts` 的 `read(props.visualizerTunings)` 取，`tuningRegistry.ts` 的类型表也不用加
- `src/components/visualizer/<mode>/entry.tsx`：通过 registry 挂载 renderer 和设置面板（「默认」由歌词样式窗口按 `tuning.ts` 的声明处理，不用写 reset）
- `src/components/visualizer/window/VisPlayground.tsx` 和 `VisPlaygroundSettingsPanel.tsx`：歌词样式和背景的 tuning 不用动（草稿和保存是通用的，见 `window/useTuningDrafts.ts`）；窗口自己的设置（字号、字幕等）才在这里透传和编辑
- `src/i18n/locales/` 的 `en.ts`、`zh-CN.ts`、`in.ts`：补设置文案

不要只把视觉设置写进 localStorage 或 store；如果用户会把它理解成“外观配置的一部分”，它就必须能随 shortcode / JSON 一起导入导出。

已知例外（用户明确决定，不要按上面的规则补进导入导出）：

- bravais 资料库墙的「透光」偏好（`src/stores/useLibraryWallLookStore.ts` 的 `look` 与 `windowsPerBlock`，设置在「主页与歌单」页「Bravais 墙面」一组，`pages/BravaisWallGroup.tsx`）。它影响视觉，但用户决定不进外观配置的短码 / JSON（2026-10-06），store 头部的 `@note` 写明了这一点。它照常接命令面板（`library-wall-look-picker` / `library-wall-windows-picker`）与 bravais 的外观动作。同一 store 的集合叠页边开关 `collectionStackEdges`、信息条的材质 `seamClear` / `seamStyle` 与墙后画面的 `backdropLyrics` / `backdropBlur` **不在**这个例外里，照规则进了导入导出（`libraryWallStackEdges` / `libraryWallSeamClear` / `libraryWallSeamStyle` / `libraryWallBackdropLyrics` / `libraryWallBackdropBlur`）。
- 资料库界面（UI suite）的选择（`useLibrarySuiteStore`）是界面偏好，不是视觉调参，同样不进导入导出。

新增类似的例外时，必须是用户明确的决定，并在 store 或设置组件的注释里写明，防止后来者按规则补回去。

## Functional Settings Must Join Command Palette

功能性设置（如 Electron 更新通道 `updateChannel`选择、桌面端 Acrylic 背景确认防护、实验室设置）或可执行动作必须评估并注册到 command palette：

- 文件：按命令的 `group` 落到 `src/components/command-palette/commands/<group>Commands.ts`（`search` / `playback` / `settings` / `navigation` / `panel` / `visualizer` / `grid`）；自带界面或语法的单条命令有自己的文件（如 `queueCommand.ts`、`volumeCommand.ts`）。不要再往 `commandRegistry.ts` 里加命令，它只负责拼接和过滤。
- 构造入口：一律经 `src/components/command-palette/commandFactories.ts` 的 `defineCommand`；「调一个 context 方法后返回 true」用 `createToggleCommand`，其余优先复用 `createSettingsCommand`、`createPanelCommand`、`createHomeTabCommand`、`createVisualizerCommand`。切换到某个歌词动画样式或背景的那条命令不写在 `visualizerCommands.ts` 里：写在该模式 `entry.tsx` 的 `command`（title、description、keywords）里，命令清单按 registry 的顺序生成；小图标同理，写在 `entry.tsx` 的 `glyph` 里。
- 上下文：`CommandPaletteContext` 按 group 分成 `shared` / `search` / `playback` / `navigation` / `panel` / `settings` / `visualizer` 七个命名空间，命令归哪个 group 就先在同名命名空间里找依赖。需要新能力时同时改 `src/components/command-palette/types.ts` 和 `src/hooks/useCommandPaletteContext.ts`。
- 平台可见性：只在部分平台可用的功能写 `platform: ['electron' | 'win' | 'mac' | 'linux' | 'web']`，不要在过滤函数里加 id 判断。状态可见性用 `isAvailable`，两者职责分开。
- 面板内界面：需要在命令面板里直接出控件（滑块、图标网格等）时写 `surface`，组件用 `load: () => import(...)` 惰性加载，不要在 `CommandPalette.tsx` 里加 `activeCommand.id` 分支。参考 `surfaces/volumeSurface.ts` 与 `surfaces/pickerSurface.ts`。
- 复杂语法：需要 `--flag` / `@facet:value` 时声明 `syntax`，解析复用 `src/components/command-palette/syntax/`，不要另写正则。
- 执行模式：明确判断要不要给 `executeShortcut`。危险、不可撤销、要花钱或需要确认的操作不给；给了就必须与现有快捷键保持 prefix-free，冲突会在构建时抛错。
- 命令文案：同步 `src/i18n/locales/en.ts`、`zh-CN.ts` 和 `in.ts` 的 `commandPalette.commands.<id>`，缺任何一份都会让 `test/unit/command-palette/commandRegistryContract.test.ts` 失败。
- 关键词：写英文和中文。不要手写拼音：拼音在构建时从中文生成，手写的会让上面的契约测试失败；英文关键词也不要照抄某种语言的标题。契约测试还检查每条命令都能只用拉丁字母搜到。资料库 suite 的外观动作（manifest 的 `chromeActions`）只能声明在 `suites/<id>/entry.ts` 或同目录的 `chromeActions.ts`，拼音插件只扫这两种文件。
- 落地列表：命令是否出现在面板刚打开时的首屏，由 `commands/index.ts` 的 `DEFAULT_LANDING_COMMAND_IDS` 显式决定，不取决于它在数组里的位置。

当前同步服务已经有两类命令入口：`settings-r2-sync` 打开存储设置中的同步服务区域，`sync-now` 触发 AI 主题同步；新增同步动作时优先复用 `src/services/sync/syncCoordinator.ts`，不要在命令里直接发请求。

新增设置子视图时，至少添加一个能打开该子视图的 settings command；新增开关或动作时，添加能直接执行的命令，除非该操作危险、不可撤销或需要复杂确认（例如开启桌面端 Acrylic 效果需弹窗确认防护）。

例外：开发者设置子视图（`navigation/settingsNavModel.ts` 的 `developer` 分类）刻意不提供命令入口，因此也不在 `SettingsSubviewId` 里。它面向的是排查问题时的手动操作，不属于日常功能性设置；`openSettings(tab, 'developer')` 不可用是预期行为，不要按上面这条补命令。

`isAvailable` 必须与设置 UI 用同一个判断，不要在命令里重新推导一遍能力检测。反例：`transition-performance-toggle` 曾只按 `platform: ['electron']` 过滤，而设置面板是按 `transitionCapabilities().stems` 置灰，命令因此能把开关持久化成面板不允许产生的状态。需要新的能力判断时，经 `useCommandPaletteContext` 透出；结果会随运行时变化（例如模型下载完成）的，用函数而不是快照值。

## Settings UI Placement

设置窗口（`SettingsModal.tsx`）左边是分类列表，一个分类一页：分类在 `src/components/modal/settings/navigation/settingsNavModel.ts`，页文件是 `src/components/modal/settings/pages/<分类 id>Page.tsx`。优先放在现有分类：

- 每一页都是用共用控件（`src/components/modal/settings/kit`）画的。新设置在页文件里声明成一个选项，用 kit 的 `Row` 加控件画出来；页只从 `../kit` 引入。
  - 外观 `AppearancePage.tsx`、播放页 `PlayerPage.tsx`、主页与歌单 `HomePage.tsx`
    资料库界面（suite）的选择和 bravais 独有的设置（只在 bravais 是生效 suite 时有意义的，用户要求 2026-10-09）都在「主页与歌单」页：「Bravais 墙面」一组是 `pages/BravaisWallGroup.tsx`，组 id（锚点）`bravaisSettings`，带 `available`，只在 bravais 生效时画出、被搜到；锚点命令 `settings-bravais`。
  - 播放控制 `PlaybackPage.tsx`、歌词 `LyricsPage.tsx`
  - 通用 `GeneralPage.tsx`（语言、启动与窗口、思索教程提示、更新检查，含更新通道选择 realeco / limo / cielo）
  - 快捷操作 `InteractionPage.tsx`（固定命令、网格里的按钮和快捷键）
  - 连接与集成 `IntegrationPage.tsx`，几组的行在 `pages/integration/`（Navidrome、同步服务、舞台模式）；听歌打卡也在这一页
  - 存储与备份 `StoragePage.tsx`，几组的行在 `pages/storage/`（本地文件夹监视 `FolderWatchGroup.tsx`、备份与导入 `ConfigTransferRows.tsx`）
  - 桌面 `DesktopPage.tsx`（仅桌面端）
  - 性能与动效 `GraphicsPage.tsx`
    静态模式、主页动态背景、原生模糊（开启前弹窗确认）、帧率限制、Linux 发光修复和降低动态效果。性能取舍和渲染问题的绕行开关放这里。
  - 模组 `ModsPage.tsx`（仅桌面端）
    顶部是模组系统总开关，下方是模组列表；两者和命令面板的 `mods` surface 共用 `src/mods/manager/` 里的组件，改样式只改那一处。
  - 开发者 `DeveloperPage.tsx`（运行日志、内存监控）
- 一组设置的 id 写在页文件声明的那个组（`SettingsGroupDef`）上。命令和链接要落到的 id 登记在 `navigation/settingsAnchorModel.ts`，它说这个 id 在哪个分类的页上；一个 id 只在一页上声明。只有桌面端画的组或行标 `electronOnly`，只在部分机器上画的带 `available`（见 `kit/options.ts`），设置搜索据此不列出。
- visualizer 专属参数：优先放在模式相邻设置面板，再由 registry 的 `renderSettingsPanel` 挂回

不要把新设置继续堆回 `SettingsModal.tsx` 的大 JSX 分支；如果需要新区域，先按 `file-modularization` 拆成相邻子视图。

## Review Checklist

- 这个设置是视觉相关、功能性，还是两者都是？
- 视觉设置是否进入 `buildCurrentConfig`、`compressConfig`、`decompressConfig`、`validKeys`、`planConfigImport` 和 `applyImportedConfig`？（歌词动画样式的 tuning 除外，它随 `visualizerTunings` 走；用户明确决定的例外见上，例如 bravais 透光）
- 功能性设置或动作是否进入对应的 `commands/<group>Commands.ts`？
- 平台限定用了 `platform` 而不是 id 判断？需要界面的用了 `surface` 而不是外壳里的特例？
- 是否明确决定过要不要给 `executeShortcut`？
- 命令是否有 en / zh-CN / in 三份 i18n、中英文关键词（拼音由构建期生成，不手写）？
- store、localStorage key、默认值、resetter、导入恢复是否一致？
- 同步相关设置是否同时接入 `sync/settingsSnapshot.ts`、`pages/integration/SyncServerRows.tsx` 和对应 command palette 命令？
- 新增用户可见文案是否同步中英文？
- 是否避免继续膨胀 `SettingsModal.tsx`、`VisPlayground.tsx` 或单个 visualizer 大文件？
