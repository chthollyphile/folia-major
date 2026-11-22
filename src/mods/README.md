# src/mods

Folium 模组系统在窗口里的一半。主进程那一半在 `electron/modSystem/`。这份文件讲 Folium 2 下模组系统由哪些部分组成、各类模组怎么装怎么跑，
以及它和应用相连的接入点；写模组的人看 `mods/README.md`（Folium 1 的完整参考）、`docs/folium/`（`api.md` 是生成的接口一览，
`sources.md` 是音源模组的开发指南）。现行方案是 `dev/folium/folium-2-plan.md`，和这里对不上时以方案和代码为准。

## 目录

- `folium/`：契约与适配层。`contract.ts`（client 入口）、`mainContract.ts`（main 入口）只有类型，由 `npm run folium:types` 生成
  `mods/folium.d.ts`、`npm run folium:api` 生成 `docs/folium/api.md`；`folium/sources/` 是音源接口（`folium.sources`）的契约与校验；
  `folium/registries/` 把模组登记的东西接到应用上；`folium/deprecated/` 是让为 Folium 1.5 写的模组照旧能用的旧名字兼容层（主进程那一半是
  `electron/modSystem/deprecated.cjs`）。
- `runtime/`：加载和守着模组的运行时：client 的加载顺序（`clientLoader.ts`）、第一屏等多久（`mainWindowStart.ts`）、计时与出错隔离
  （`guard.ts`）、音源的开关与清除数据（`sourceSwitches.ts`），以及只在主窗口装的宿主层（`hostEvents.ts`、`hostAccount.ts`、`omni/`、
  `queue/`、`equalizer/`、`visualizer/` 等，是对应 `folium.*` 成员的来源）。
- `manager/`：「设置 → 模组」页与命令面板里的模组面板（总开关、模组列表、从 zip 安装、签名标签、调用统计、占用）。
- `params/`：模组设置的值；`export/`：视频导出窗口的页面；`ipc.ts`：窗口里唯一读 `window.electron.mods` 这座桥的地方；
  `types.ts`：桥上的类型；`useModsStore.ts`：模组列表的 store。

## 两个版本、两类模组

- **`folium: 1`**：为 Folium 1.x 写的模组照旧加载。接口冻结在 1.10（代码里是 `foliumShared.json` 的 `foliumOneVersion`），
  之后只修错不加成员；1.5 的旧名字和 `folium.internals` 照旧能用、照旧标废弃，`deprecated/` 里「Folium 2 删除」的那份清单
  改期到以后的 major（方案 §9）。
- **`folium: 2`**：清单多了 `sources`、`locales`、`assets`、`secrets`、`contexts`、`native`（方案 §5.1）。声明了 `sources` 的是
  **音源类模组**：它在 client 里 `folium.sources.register`，main 入口拿到音源专用的 `api`（`api.net`、`api.media`、`api.cache`、
  `api.legacy` 等，方案 §5.5）。音源类模组按类别豁免网络与存储的权限和限额、自成一组先于普通模组启动、只有自己变了才重载（方案 §5.2）。
  `mods/folium.d.ts` 的 Sources、Source main API 两节和清单的音源字段曾标「预览」（`foliumShared.json` 的 `sourcesPreview`），
  `edge` 合进 main 之前去掉了：现在和别的稳定接口一样只加不改，D513 照此检查。
- 普通模组（不声明 `sources` 的，不论 1 还是 2）的权限、限额、签名标签、启用确认和 Folium 1 一样。

## 模组从哪里来（层级）

`types.ts` 的 `ModTier`：

| 层级 | 在哪 | 怎么对待 |
| --- | --- | --- |
| `builtin` | 安装包的 `resources/builtin-mods/`（开发时是 `npm run sources:build` 出的 `dist-mods/`），内置音源都是（九家在线平台和默认停用的洛雪），源码在 `sources/<id>/` | 不受总开关影响，不弹启用确认，不算内容摘要也不验签（来源由安装包保证），默认启用（清单写了 `offByDefault` 的默认停用）；可以在「设置 → 音源」单个停用或只用于匹配 |
| `override` | 用户模组目录里同 id 的副本 | 官方签名校验通过、版本更高、用户确认过一次，才替代内置副本；否则继续跑内置的，「设置 → 音源」写明原因 |
| `user` | `userData/mods`（「从 zip 安装」装到这里） | 第三方模组：要总开关开着、用户确认过启用，内容变了要重新确认。安装包没带某家内置音源时，声明了 `sources[].claims` 的音源模组经确认可以接管那个短 id 和旧数据（方案 §5.1 合规预案）；接管副本的 `api.native` 用它自己目录里 `native/<名字>/<系统>/` 的原生件，不用应用带的 |
| `repo` | 源码目录的 `mods/`（只在开发版） | 示范模组；确认之后改文件不撤销确认 |
| `resources` | 安装包的 `resources/mods/` | 随应用发的普通模组 |

短音源 id（`netease`、`qq`……）只能由受信表 `electron/modSystem/builtinSources.cjs` 那一行认领的模组用：内置副本、验签通过的覆盖副本、
经确认的接管。第三方音源用 `folium.<模组 id>.<音源 id>`。签名在覆盖之外只贴标签（官方认证、先行测试、无签名、不匹配），
不决定能不能跑。

## 怎么安装

- **模组系统默认开启。** 没存过这个设置的 profile（全新安装、从没碰过开关的老用户）读到的是开；明确关过的保持关。总开关只管
  第三方模组；内置音源不受它影响。
- **默认只能装官方签名的音源模组。** 「设置 → 模组」的「从 zip 安装」和「设置 → 音源」的「从 zip 安装音源模组」（登录窗口的「安装音源模组」跳到后者；
  `npm run sources:pack -- <id>` 打出的 zip 就是这样装的包）在「社区模组」开关关着时只收官方签名校验通过的音源模组，别的包拒绝并说明去哪里打开开关；模组目录里已经有的
  非官方模组不加载，在列表里标明「需要打开社区模组」（只拦安装不拦加载的话，往目录里放个文件夹就绕过去了）。判断「官方签名」只用现有的
  签名校验与受信公钥表（`electron/modSystem/communityMods.cjs`：验签结果是官方认证、清单是音源模组），主进程是唯一依据。
  开发版源码目录的 `mods/`（`repo` 层）不受这个开关限制。
- **「社区模组」开关**放在模组设置页总开关下面，命令面板里也有一条；默认关，打开时确认一次（社区模组是第三方代码、能做什么），之后和
  Folium 1 的模组系统一样：任何 zip 都能装，启用时照旧逐个确认。升级前总开关明确开着的 profile，升级后社区模组开关视为开，装过的模组照常跑。
  开关改了之后主进程告诉每个跑着应用的窗口（主窗口和遥控窗口，`folia-mods:community-changed`），它们各自显示的开关不用等重启。
- 安装包的限制（`electron/modSystem/zipInstall.cjs`）：拒绝路径穿越与绝对路径；压缩包与解压后各不超过 96 MB，单文件不超过 64 MB，
  条目不超过 2000。装完差量重载，只重启变了的模组。
- 网页版没有模组运行时，没有安装入口；内置音源里能在网页用的由 `src/services/onlineMusic/web/` 直接注册（方案 §8）。

## 音源单独开关与数据

每个音源（内置的也一样）在「设置 → 音源」（`src/components/modal/settings/pages/SourcesPage.tsx`）有三种状态：启用、只用于匹配
（只有声明了匿名的跨来源歌词或元数据匹配的音源有）、停用，切换不用重启，状态存在主进程的 `mod-system` store（方案 §5.3）。全新 profile 的
开箱引导问一次用哪些平台，答完之前不运行任何音源模组。每行另有：

- **清除数据**：登出并删掉它的会话（受信表或 `claims` 认领的旧 store 键、分区、userData 目录）、`secrets`、页面存储、模组数据与缓存目录，
  主进程弹窗列出要删什么，确认后执行（`describeSourceData`、`clearSourceData`）。
- **占用**：按清除数据的同一批东西算，分数据和缓存（`getSourceStorageUsage`，目录在主进程异步走，页面先出来、占用后到；拿不到时不显示）。
- 清单声明了 `selfSignedUserServers` 的音源（飞牛）在这一行写明它会接受用户自己填的服务器的自签证书；第三方与覆盖副本在启用确认里列出。

## 接入点

应用和 `src/mods` 只在下面这些地方相连，各自写了用的是什么、为什么。加一个接入点时写进来；去掉模组系统时，要改的就是这些地方。

`src/mods/folium/` 反过来引用应用自己的模块（例如把模组的歌词动画放进 `@/components/visualizer/registry`，把模组的命令放进命令面板），那是适配层的本分，不列在这里。`runtime/` 里只在主窗口装的宿主层也一样：`hostEvents.ts` 读播放、视图等 store 发通知，`hostAccount.ts` 经 omni 读账号 store，是 `folium.account` 与 `account.changed` 的来源（Folium 1.7）；`runtime/omni/` 经 omni 读在线音源，是 `folium.omni` 的来源（Folium 1.7）；`runtime/queue/` 读写播放 store，是 `folium.playback.replaceQueue`、队列版本与撤销的来源（Folium 1.7）；`runtime/equalizer/` 读写音频设置 store，是 `folium.equalizer` 与 `equalizer.changed` 的来源，并按模组列表的启用状态暂停/恢复模组曲线（Folium 1.7），它读的模组列表（`runtime/clientLoader.ts` 的 `getFoliumModList` / `onFoliumModListChanged`）在模组系统内部，也不算接入点；`runtime/visualizer/` 读写歌词动画设置 store，是 `folium.visualizer` 与 `visualizer.*` 事件（`modeChanged`、`renderQualityChanged`、`tuningChanged`、`beatEffectsChanged`）的来源（Folium 1.8）；它读各样式 tuning.ts 声明的 `modKeys` 和各模式 entry 的 `beatEffects`。这里也不放一个把各个注册表一起导出的总入口文件：每个注册表模块一加载就建好自己的注册表，总入口会让每个引用它的地方都带上全部注册表，还可能把它们挪进更早加载的代码块。

### 有意留的接入点

| 在哪 | 用的是什么 | 为什么 |
| --- | --- | --- |
| `src/App.tsx` | `useFoliumHostBridge`（`runtime/hostBridge.ts`） | 一直把应用正在显示的歌、歌词、主题推给主进程；main 入口的 `api.runtime.getPlaybackSnapshot()` 和视频导出读它 |
| `src/App.tsx` | `useFoliumHostActions`（`runtime/hostActions.ts`） | 把应用自己的播放、点赞、提示等动作交给 `folium.playback` 和 `folium.ui` |
| `src/App.tsx` | `FoliumStageLayerSlot`（`folium/registries/stageLayers.tsx`），`app.overlay` | 盖在整个应用上面的模组图层 |
| `src/bootstrap.tsx` | `startFoliumForMainWindow`、`noteFoliumFirstScreenMounted`（`runtime/mainWindowStart.ts`） | 主窗口在第一屏之前启动模组的 client，最多等一段固定的时间：用户存下的模组歌词动画或背景，要等模组登记了才画得出来 |
| `src/components/modal/settings/pages/ModsPage.tsx` | `ModManager`、`ModManagerClasses`（`manager/`） | 设置里的模组页 |
| `src/components/modal/settings/pages/sources/useSourcesSettings.ts`（`SourcesPage.tsx` 的状态） | `getSourceStates`、`subscribeSourceStates`、`getSourceStorageUsage`、`assignSourceClaim`、`confirmModOverride`（`ipc.ts`），`switchSourceState`、`clearSourceData`（`runtime/sourceSwitches.ts`），`useModsStore` | 设置里的「音源」页（Folium 2.0 方案 §5.3）：每个音源的启用 / 只用于匹配 / 停用、音源模组的清除数据与占用，以及加载器留下的接管与覆盖提示（§5.1）。音源状态由主进程的模组系统保管，宿主自己注册的平台也在这张表里，所以去掉模组系统时这一页连同它的导航项一起删 |
| `src/components/command-palette/sourceSwitchCommandsInstaller.ts`（命令面板里逐个音源的启用 / 只用于匹配 / 停用） | `getSourceStates`、`subscribeSourceStates`（`ipc.ts`），`switchSourceState`（`runtime/sourceSwitches.ts`），`useModsStore` | 「设置 → 音源」的开关同时进命令面板（Folium 2.0 方案 §5.3）：按主进程的音源状态给每个音源生成它此刻能切到的状态的命令（`source-enable-<id>`、`source-matching-<id>`、`source-disable-<id>`），切换走和设置页同一条路。网页版没有音源状态，就没有这些命令；去掉模组系统时连同 `bootstrap.tsx` 里装它的那一行一起删 |
| `src/components/modal/playback-entry-view/sourcesOnboarding.ts`（首启引导「你用哪些平台听歌」那一页的状态） | `getSourceStates`、`invokeAnswerSourcesOnboarding`（`ipc.ts`），`stopPlaybackOfSources`（`runtime/sourceSwitches.ts`） | 全新安装的开箱引导问一次用哪些音源（Folium 2.0 方案 §5.3）：欠不欠这一页由主进程的模组系统记着（全新 profile 记成 pending），关掉引导时把勾选一次交回主进程写成三种状态。网页版没有主进程，永远不欠；去掉模组系统时这一页连同 `promptPages` 里的 `sources` 一起删 |
| `src/components/command-palette/surfaces/modsSurface.ts` | 用到时才加载 `manager/ModsPanelTab.tsx` | 命令面板里打开的模组面板 |
| `src/components/command-palette/globalShortcuts/useGlobalShortcuts.ts`、`src/components/modal/settings/pages/GlobalShortcutsGroup.tsx` | `useFoliumGlobalShortcutCommandIds`、`getFoliumGlobalShortcutCommandIds`、`useFoliumGlobalShortcutCommands`（`folium/registries/globalShortcutCommands.ts`） | 系统级全局快捷键里模组提供的命令（Folium 1.7 `globalShortcut`）：注册键的 hook 只注册此刻登记着的模组命令，设置页把它们列在播放命令后面，并说明绑着的模组命令为什么现在不起作用。按下时走命令面板里同一条命令（`commandPaletteSync.ts` 放进去的），所以执行不另接；去掉模组系统时这两处回到只有宿主播放命令 |
| `src/components/ProgressBar.tsx` | `FoliumProgressButtons`、`FoliumProgressLayers`、`useFoliumProgressContext`（`folium/registries/progress.tsx`） | 进度条两边的模组按钮和叠在轨道上的模组图层 |
| `src/components/UnifiedPanel.tsx` | `useFoliumPanelTabs`、`FoliumPanelTabBody`、`FOLIUM_PANEL_TAB_PREFIX`（`folium/registries/playerPanelTabs.tsx`） | 播放器面板里模组的标签页 |
| `src/components/visualizer/VisualizerBackdrop.tsx`、`VisualizerShell.tsx` | `FoliumStageLayerSlot`，`player.stage.back` 和 `player.stage.front` | 播放页歌词动画后面和前面的模组图层；预览里没有。在 `VisualizerRenderer` 里由 backdrop 画，换歌词样式时不重新挂载；shell 只在单独使用时画 |
| `src/components/app/home/FoliumHomePage.tsx`、`useFoliumHomeNavigation.ts` | `homeTabsRegistry` 与它的选择（`folium/registries/homeTabs.ts`）、`useFoliumPanelContext`（`folium/registries/useFoliumPanelContext.ts`） | 首页导航末尾模组的整页（`folium.registries.homeTabs`） |
| `src/components/visualizer/VisualizerShell.tsx` 等播放页控件 | `usePlayerOverlayReservation`（`src/hooks/usePlayerOverlayLayout.ts`），读的是 `src/services/playerOverlayLayout.ts` | 实验接口 `player.layout`：舞台上下文的 `getLayout()`，由 `folium/registries/stageRegistry.ts` 按模组的选用发给它的挂载 |
| `src/components/app/playback/bridges/useElectronPlaybackBridge.ts`、`src/services/remoteControlActions.ts`、`src/components/remote/RemoteSheet.tsx` | `folium/registries/remoteActions.ts` | 实验接口 `remote.actions`：模组加在遥控窗口「更多」里「模组」页的按钮，点下去在主窗口执行 |
| `src/vite-env.d.ts` | `src/mods/types.ts` 里的类型 | `window.electron.mods` 这座桥的类型 |
| `src/services/wholeQueueWrites.ts` | `noteWholeQueueWrite` / `wholeQueueWritesSoFar`：不引用 `src/mods`；`runtime/queue/` 的替换与撤销往里计数，队列控制器、库控制器与几处恢复读它。`reportYieldedQueue` / `setYieldedQueueListener`：会话恢复与窗口交接为整表写入让路时报告没写进去的那份队列，`runtime/queue/queueReplaceUndo.ts` 听它 | 整表写入（Folium 1.7 `replaceQueue` 和它的撤销）之后，等待中的播放、失败后的延后动作、FM 补歌、舞台编辑、会话恢复与窗口交接不把它盖回去；让路的恢复报告的队列是用户原本的队列，撤销替换时放回它，而不是替换那一刻 store 里的（启动时是空的）。去掉模组系统时可以留着：没有写入者时计数不变、报告没人听，宿主行为不变 |
| `src/stores/usePlaybackStore.ts` | `replacePlayQueue` | 替换与撤销一次写队列和私人 FM，订阅者只看到一次变化（Folium 1.7 `replaceQueue`） |
| `src/components/command-palette/commands/playbackCommands.ts` | `useFoliumQueueUndoStore`、`undoFoliumQueueReplace`（`runtime/queue/queueReplaceUndo.ts`） | 命令面板里的「撤销模组替换的队列」：提示条会被别的提示顶掉，这里是持久的入口。去掉模组系统时删这条命令 |
| `src/services/hostExtensionHooks.ts` | 不引用 `src/mods`；`runtime/hostEvents.ts` 和 `folium/experimental.ts` 往里装钩子 | 应用在歌词进来、一首歌开始放的地方调它；没装钩子时原样通过，应用不需要知道有模组。`folium.omni` 的读取绕过钩子（见下一行的 `extensionHooks`） |
| `src/services/onlineMusic/omni.ts` 的 `getRawRequestInfo`、`describeRawEndpoint`、`requestProviderRaw`，它剥凭据用的 `rawResponse.ts`；`src/types/onlineMusic.ts` 的 `OnlineRawRequestProvider`；平台的 `raw`（网易云：`sources/netease/core/neteaseRaw.ts` 和 `core/netease.ts` 的 `requestNeteaseRoute`） | 不引用 `src/mods`；`folium/platformRaw.ts` 调 omni 的这三个方法 | 实验接口 `platform.raw`（Folium 1.7）：以登录的账号调平台后端原始接口的后备通道，只有它用。会话由平台的 provider 补上，哪些接口能调由平台自己的分类表定；去掉模组系统时这几处一起删 |
| `src/services/onlineMusic/omni.ts` 的 `getLyrics` 的 `extensionHooks` 选项，`searchSongs` / `searchProviderSongs` 的 `session`（`src/types/onlineMusic.ts` 的 `ProviderSearchContext`） | 不引用 `src/mods`；`runtime/omni/hostOmni.ts` 读歌词时传 `extensionHooks: false`，搜索时传 `folium:<模组 id>` | 只给 `folium.omni`（Folium 1.7）用：模组读到平台原样的歌词，不跑模组的 `omni.lyricsResolved` 钩子（模组在自己的钩子里再读会调到自己）；模组的搜索翻页另存一份，不重置也不挤掉界面的搜索。去掉模组系统时这两个参数可以留着不用 |
| `src/services/onlineMusic/web/foliumWebSource.ts`（`web/<id>.ts` 都经它） | `registerFoliumSource`、`createFoliumPageStore`（`folium/registries/sources.ts`），`foliumModTextNamespace`（`folium/registries/sourceText.ts`），`createFoliumI18n`、`createFoliumSourceError`（`folium/sources/`），`FOLIUM_LYRICS_HELPERS`（`folium/sharedHelpers.ts`），`markFoliumSourceMod`（`runtime/guard.ts`） | 网页版没有模组运行时（Folium 2.0 方案 §8）：搬进 `sources/<id>/` 的平台由 `web/<id>.ts` 用它的 core 的 `createSource` 建出，经这里交给和桌面版音源模组同一个适配层注册，模组的文字也从这里装进 i18n。去掉模组系统时，网页版的这几家要换回宿主自己的 provider |
| `electron/main.cjs` | `createModSystem`（`electron/modSystem/modSystem.cjs`）、`MOD_PROTOCOL_PRIVILEGED_SCHEME` | 主进程那一半：开关、启动、IPC、`folia-mod://` 协议、退出时收拾 |
| `electron/preload.cjs` | `mods` 那一组方法 | 窗口到主进程的桥；窗口里只有 `src/mods/ipc.ts` 读它 |
| `mod-export.html`、`vite.config.ts` 的 `modExport` | `export/modExportPage.tsx` | 视频导出窗口的页面 |

### 内置功能用到的地方

这七处是应用自己的功能要读模组登记或留下的东西，不是给模组留的位置。

| 在哪 | 用的是什么 | 为什么 |
| --- | --- | --- |
| `src/components/visualizer/sonnet/VisualizerSonnet.tsx` | `useFoliumTunings('sonnet')`（`folium/registries/tunings.tsx`） | 商籁用模组给它的调参（`folium.registries.tunings`） |
| `src/components/visualizer/preview/LyricStylePicture.tsx` | `useFoliumTunings`、`useFoliumVisualizerSettings`（`folium/registries/visualizers.tsx`） | 歌词样式的预览图按模组的调参和设置来画，和播放页一样 |
| `src/components/visualizer/window/VisPlayground.tsx` | `visualizersRegistry`、`useFoliumRegistryEntries`（`runtime/registry.ts`） | 歌词动画窗口列出模组的歌词动画 |
| `src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx` | `FoliumTuningCards`、`tuningsRegistry`、`backgroundsRegistry`、`useFoliumRegistryEntries`、`useMissingFoliumSelections`（`runtime/missingEntries.ts`） | 歌词动画窗口的设置面板：模组的调参卡片、模组的背景，以及存着、但模组还没登记的选择 |
| `src/components/modal/settings/pages/storage/visualConfigTransfer.ts` | `snapshotFoliumParams`、`importFoliumParams`（`params/paramStore.ts`） | 视觉配置的导入导出带上模组设置的值 |
| `src/components/scenes/settings/SceneRow.tsx`、`SceneSettingsPanel.tsx`、`SceneWindow.tsx` | `FoliumParamFields`（`params/FoliumParamFields.tsx`）、`resolveFoliumLabel`、`mergeFoliumParamValues`（`params/params.ts`） | 场景清单的 `settings` 用 Folium 的设置表格式，场景设置借模组设置的表单来画、读值和取多语言名字。去掉模组系统时这三处要换成自己的表单 |
| `src/stores/useAudioSettingsStore.ts` 的 `audioEqualizerModCurve`、`audioEqualizerModCurveSuspended`、`audioEqualizerChangeOrigin` 与相关动作，面板的 `src/components/panelTab/equalizer/ModCurveNotice.tsx`，命令 `playback-sound-mod-curve-release` | 都不引用 `src/mods`，只读 store | 只给 `folium.equalizer`（Folium 1.7）用：模组施加的均衡器曲线是用户音效之上独立的一层，面板写明来源并能换回或存进自定义栏位。去掉模组系统时曲线永远是 null，提示与命令永远不出现，可以留着，也可以连同这三个字段和 `handleApplyAudioSoundPreset` 的 `keepEnabled` 一起删掉 |
