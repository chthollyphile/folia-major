# src/mods

Folium 模组系统在窗口里的一半：契约（`folium/contract.ts` 是 client 入口的，`folium/mainContract.ts` 是 main 入口的，都只有类型）、把契约接到应用上的适配层（`folium/`）、加载和守着模组的运行时（`runtime/`）、模组面板（`manager/`）、模组设置的值（`params/`）、视频导出窗口的页面（`export/`）、让为 Folium 1.5 写的模组照旧能用的旧名字兼容层（`folium/deprecated/`，主进程那一半是 `electron/modSystem/deprecated.cjs`；两个文件头列了 Folium 2 时连同哪几处接入点一起删掉）。主进程那一半在 `electron/modSystem/`。写模组的人看 `mods/README.md` 和 `docs/folium/`。

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
| `src/services/onlineMusic/omni.ts` 的 `getRawRequestInfo`、`describeRawEndpoint`、`requestProviderRaw`，它剥凭据用的 `rawResponse.ts`；`src/types/onlineMusic.ts` 的 `OnlineRawRequestProvider`；平台的 `raw`（网易云：`netease/neteaseRaw.ts` 和 `netease.ts` 的 `requestNeteaseRoute`） | 不引用 `src/mods`；`folium/platformRaw.ts` 调 omni 的这三个方法 | 实验接口 `platform.raw`（Folium 1.7）：以登录的账号调平台后端原始接口的后备通道，只有它用。会话由平台的 provider 补上，哪些接口能调由平台自己的分类表定；去掉模组系统时这几处一起删 |
| `src/services/onlineMusic/omni.ts` 的 `getLyrics` 的 `extensionHooks` 选项，`searchSongs` / `searchProviderSongs` 的 `session`（`src/types/onlineMusic.ts` 的 `ProviderSearchContext`） | 不引用 `src/mods`；`runtime/omni/hostOmni.ts` 读歌词时传 `extensionHooks: false`，搜索时传 `folium:<模组 id>` | 只给 `folium.omni`（Folium 1.7）用：模组读到平台原样的歌词，不跑模组的 `omni.lyricsResolved` 钩子（模组在自己的钩子里再读会调到自己）；模组的搜索翻页另存一份，不重置也不挤掉界面的搜索。去掉模组系统时这两个参数可以留着不用 |
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
