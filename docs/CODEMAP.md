# 代码地图

<!-- 这份文件由 `npm run codemap` 生成，不要手改。CI 会重新生成并比对。 -->

全部内容由 TypeScript 编译器和模块图推导，不是人工维护的清单。
想知道某个具体符号在哪，用 `node dev/mcp/ts-code-map/cli.mjs search '{"query":"..."}'`。

文件里所有的量都只给**数量级**（向下取整到 2 的幂，写作 `512+`），排序也按量级。
这是有意的：精确计数会让每个新文件、每条 import 都产生一次同步提交，而那些提交
没有一条说明结构变了。要精确数字就问 `cli.mjs`，它是按需查询、不进版本库的。

## 区域分布

| 区域 | 文件数量级 |
| --- | --- |
| components | 1024+ |
| test/dev | 1024+ |
| library | 256+ |
| services | 256+ |
| backend/electron | 128+ |
| utils | 128+ |
| hooks | 64+ |
| src (其他) | 64+ |
| 其他 | 64+ |
| stores | 32+ |
| types | 16+ |
| i18n | 4+ |
| workers | 4+ |

## 枢纽模块

被 32 个以上模块依赖的文件。改动它们波及面最大，读代码时也最值得先看。

| 被依赖量级 | 模块 |
| --- | --- |
| 1024+ | `src/types.ts` |
| 256+ | `src/types/onlineMusic.ts` |
| 128+ | `src/stores/usePlaybackStore.ts` |
| 128+ | `src/types/ponder.ts` |
| 128+ | `src/utils/appPlaybackGuards.ts` |
| 64+ | `src/components/command-palette/types.ts` |
| 64+ | `src/components/modal/settings/kit/index.ts` |
| 64+ | `src/i18n/config.ts` |
| 64+ | `src/library/core/suite/suite.contract.ts` |
| 64+ | `src/mods/folium/contract.ts` |
| 64+ | `src/services/db.ts` |
| 64+ | `src/services/onlineMusic/omni.ts` |
| 64+ | `src/stores/useAppViewStore.ts` |
| 64+ | `src/stores/useAudioSettingsStore.ts` |
| 64+ | `src/stores/useStatusMessageStore.ts` |
| 64+ | `src/utils/lyrics/renderHints.ts` |
| 32+ | `dev/probes/definition.ts` |
| 32+ | `src/components/modal/settings/kit/motion.ts` |
| 32+ | `src/components/visualizer/colorMix.ts` |
| 32+ | `src/components/visualizer/definition.ts` |
| 32+ | `src/components/visualizer/hanabi/types.ts` |
| 32+ | `src/components/visualizer/machi/engine/materials.ts` |
| 32+ | `src/components/visualizer/registry.tsx` |
| 32+ | `src/components/visualizer/tuningDefinition.ts` |
| 32+ | `src/components/wall/layout.ts` |
| 32+ | `src/components/wall/wallSlots.ts` |
| 32+ | `src/library/core/account/account.contract.ts` |
| 32+ | `src/library/core/collection/collection.contract.ts` |
| 32+ | `src/library/core/directory/directory.contract.ts` |
| 32+ | `src/library/core/home/homeModel.contract.ts` |
| 32+ | `src/library/suites/bravais/bravaisLayer.ts` |
| 32+ | `src/mods/types.ts` |
| 32+ | `src/services/baseThemes.ts` |
| 32+ | `src/services/onlineMusic/failure/onlineFailureCase.ts` |
| 32+ | `src/services/onlineMusic/providerRegistry.ts` |
| 32+ | `src/services/onlineMusic/songMetadata.ts` |
| 32+ | `src/stores/motionSignals.ts` |
| 32+ | `src/stores/useCollectionNavigationStore.ts` |
| 32+ | `src/stores/useOnlineProviderAccountStore.ts` |
| 32+ | `src/stores/usePlayerChromeSettingsStore.ts` |
| 32+ | `src/stores/useThemeSettingsStore.ts` |
| 32+ | `src/stores/useVisualizerSettingsStore.ts` |
| 32+ | `src/types/hifi.ts` |
| 32+ | `src/types/localLibrary.ts` |
| 32+ | `src/types/navidrome.ts` |
| 32+ | `src/utils/coverUrl.ts` |
| 32+ | `src/utils/fontStacks.ts` |
| 32+ | `src/utils/lyrics/graphemeTiming.ts` |
| 32+ | `src/utils/lyrics/parserCore.ts` |
| 32+ | `test/component/fixtures.ts` |

## 动态注册点

这些地方用 `import.meta.glob` 自动发现成员，**清单随目录变化，不要手写**。
以下是当前的完整展开：

### `dev/probes/registry.ts`

- `dev/probes/accountBehavior.probe.tsx`
- `dev/probes/activeGridMarker.probe.tsx`
- `dev/probes/artistEntrance.probe.tsx`
- `dev/probes/audioEffectGrid.probe.tsx`
- `dev/probes/automixTransitionSwitches.probe.tsx`
- `dev/probes/bravaisKinds.probe.tsx`
- `dev/probes/bravaisPerf.probe.tsx`
- `dev/probes/collectionGrid.probe.tsx`
- `dev/probes/collectionMorph.probe.tsx`
- `dev/probes/coverSizeAudit.probe.tsx`
- `dev/probes/exploreSurface.probe.tsx`
- `dev/probes/fmTab.probe.tsx`
- `dev/probes/foliumSelectField.probe.tsx`
- `dev/probes/globalLyricOffsetRuler.probe.tsx`
- `dev/probes/gridEntrancePerf.probe.tsx`
- `dev/probes/gridPanelToggle.probe.tsx`
- `dev/probes/homeBehavior.probe.tsx`
- `dev/probes/icuFoliaCompare.probe.tsx`
- `dev/probes/lattice.probe.tsx`
- `dev/probes/latticeExit.probe.tsx`
- `dev/probes/latticePerformance.probe.tsx`
- `dev/probes/latticeTitle.probe.tsx`
- `dev/probes/latticeTitleExpansion.probe.tsx`
- `dev/probes/libraryBehavior.probe.tsx`
- `dev/probes/localFolderIgnore.probe.tsx`
- `dev/probes/loginAccountTab.probe.tsx`
- `dev/probes/loginHome.probe.tsx`
- `dev/probes/loginWindow.probe.tsx`
- `dev/probes/lyricFilterModal.probe.tsx`
- `dev/probes/lyricMatchWindow.probe.tsx`
- `dev/probes/lyricSegmentationSurface.probe.tsx`
- `dev/probes/lyricStaffSection.probe.tsx`
- `dev/probes/modFaultNotice.probe.tsx`
- `dev/probes/monetPortraitImage.probe.tsx`
- `dev/probes/monetSubtitleDualRow.probe.tsx`
- `dev/probes/nativeDragGuard.probe.tsx`
- `dev/probes/nowPlayingToastTransitionBorder.probe.tsx`
- `dev/probes/pagePonder.probe.tsx`
- `dev/probes/pendoloSubtitleDualRow.probe.tsx`
- `dev/probes/playbackLyricsSettings.probe.tsx`
- `dev/probes/playerBarModButtons.probe.tsx`
- `dev/probes/playerBottomBar.probe.tsx`
- `dev/probes/playerLayout.probe.tsx`
- `dev/probes/ponderBravaisSeam.probe.tsx`
- `dev/probes/ponderHint.probe.tsx`
- `dev/probes/ponderPageSurfaces.probe.tsx`
- `dev/probes/remoteActions.probe.tsx`
- `dev/probes/settingsHelpActions.probe.tsx`
- `dev/probes/settingsNavigation.probe.tsx`
- `dev/probes/subtitleOverlayRows.probe.tsx`
- `dev/probes/themePark.probe.tsx`
- `dev/probes/trackTitleNavigator.probe.tsx`
- `dev/probes/visualizerMemory.probe.tsx`
- `dev/probes/wallToolsIsland.probe.tsx`
- `dev/probes/wallpaperDisplayRow.probe.tsx`
- `dev/probes/wallpaperEntryConfirm.probe.tsx`

### `src/components/ponder/PonderSurfaceContents.tsx`

- `src/components/ponder/surfaces/basics/desktopFeatures.surface.tsx`
- `src/components/ponder/surfaces/basics/onboarding.surface.tsx`
- `src/components/ponder/surfaces/basics/signIn.surface.tsx`
- `src/components/ponder/surfaces/command/commandWindow.surface.tsx`
- `src/components/ponder/surfaces/command/lyricExport.surface.tsx`
- `src/components/ponder/surfaces/command/queueCommand.surface.tsx`
- `src/components/ponder/surfaces/library/bravais.surface.tsx`
- `src/components/ponder/surfaces/library/gridPage.surface.tsx`
- `src/components/ponder/surfaces/library/gridView.surface.tsx`
- `src/components/ponder/surfaces/library/gridViewPage.surface.tsx`
- `src/components/ponder/surfaces/library/localLibrary.surface.tsx`
- `src/components/ponder/surfaces/panel/audioEqualizer.surface.tsx`
- `src/components/ponder/surfaces/panel/lyricMatch.surface.tsx`
- `src/components/ponder/surfaces/panel/sidePanel.surface.tsx`
- `src/components/ponder/surfaces/plain.surface.tsx`
- `src/components/ponder/surfaces/player/latticeChrome.surface.tsx`
- `src/components/ponder/surfaces/player/latticePage.surface.tsx`
- `src/components/ponder/surfaces/player/playerBar.surface.tsx`
- `src/components/ponder/surfaces/player/playerPage.surface.tsx`
- `src/components/ponder/surfaces/settings/appearanceSettings.surface.tsx`
- `src/components/ponder/surfaces/settings/commandSettings.surface.tsx`
- `src/components/ponder/surfaces/settings/controlBarSettings.surface.tsx`
- `src/components/ponder/surfaces/settings/importExport.surface.tsx`
- `src/components/ponder/surfaces/settings/playbackSettings.surface.tsx`
- `src/components/ponder/surfaces/settings/settingsPage.surface.tsx`
- `src/components/ponder/surfaces/settings/settingsSections.surface.tsx`
- `src/components/ponder/surfaces/studio/lyricStyle.surface.tsx`
- `src/components/ponder/surfaces/studio/themePark.surface.tsx`
- `src/components/ponder/surfaces/studio/visPlayground.surface.tsx`

### `src/components/ponder/ponderRegistry.ts`

- `src/components/ponder/targets/basics/foliaDesktop.target.ts`
- `src/components/ponder/targets/basics/foliaShortcuts.target.ts`
- `src/components/ponder/targets/basics/foliaTransport.target.ts`
- `src/components/ponder/targets/basics/helpPage.target.ts`
- `src/components/ponder/targets/basics/ponderBasics.target.ts`
- `src/components/ponder/targets/basics/signIn.target.ts`
- `src/components/ponder/targets/bravaisSeam.target.ts`
- `src/components/ponder/targets/bravaisWall.target.ts`
- `src/components/ponder/targets/command/commandPalette.target.ts`
- `src/components/ponder/targets/command/lyricExport.target.ts`
- `src/components/ponder/targets/command/queueCommandSurface.target.ts`
- `src/components/ponder/targets/library/gridActionButton.target.ts`
- `src/components/ponder/targets/library/gridPage.target.ts`
- `src/components/ponder/targets/library/gridViewEditMode.target.ts`
- `src/components/ponder/targets/library/gridViewPage.target.ts`
- `src/components/ponder/targets/library/localFolderActions.target.ts`
- `src/components/ponder/targets/library/localGridControls.target.ts`
- `src/components/ponder/targets/library/localGridMapDirectoryTree.target.ts`
- `src/components/ponder/targets/library/localGridMapPage.target.ts`
- `src/components/ponder/targets/library/localMetadataMatch.target.ts`
- `src/components/ponder/targets/library/localTrackSorting.target.ts`
- `src/components/ponder/targets/library/onlineCollectionActions.target.ts`
- `src/components/ponder/targets/panel/audioEqualizer.target.ts`
- `src/components/ponder/targets/panel/lyricMatch.target.ts`
- `src/components/ponder/targets/panel/panelAccountTab.target.ts`
- `src/components/ponder/targets/panel/panelControlsTab.target.ts`
- `src/components/ponder/targets/panel/panelCoverActions.target.ts`
- `src/components/ponder/targets/panel/panelCoverTab.target.ts`
- `src/components/ponder/targets/panel/panelQueueTab.target.ts`
- `src/components/ponder/targets/panel/panelSlide.target.ts`
- `src/components/ponder/targets/panel/panelSourceTab.target.ts`
- `src/components/ponder/targets/panel/sidePanel.target.ts`
- `src/components/ponder/targets/player/latticeChrome.target.ts`
- `src/components/ponder/targets/player/latticePage.target.ts`
- `src/components/ponder/targets/player/playerBar.target.ts`
- `src/components/ponder/targets/player/playerPage.target.ts`
- `src/components/ponder/targets/player/queueShuffle.target.ts`
- `src/components/ponder/targets/settings/customShortcutSettings.target.ts`
- `src/components/ponder/targets/settings/grid3dCardStyle.target.ts`
- `src/components/ponder/targets/settings/gridPaletteHotkey.target.ts`
- `src/components/ponder/targets/settings/gridViewCardSettings.target.ts`
- `src/components/ponder/targets/settings/importExportSettings.target.ts`
- `src/components/ponder/targets/settings/latticeStyleSettings.target.ts`
- `src/components/ponder/targets/settings/localLibraryWatch.target.ts`
- `src/components/ponder/targets/settings/lyricsAnimationSettings.target.ts`
- `src/components/ponder/targets/settings/lyricsSettings.target.ts`
- `src/components/ponder/targets/settings/pinnedCommands.target.ts`
- `src/components/ponder/targets/settings/queueSettings.target.ts`
- `src/components/ponder/targets/settings/replayGainSettings.target.ts`
- `src/components/ponder/targets/settings/settingsPage.target.ts`
- `src/components/ponder/targets/settings/themeSettings.target.ts`
- `src/components/ponder/targets/settings/transitionSettings.target.ts`
- `src/components/ponder/targets/studio/lyricStyle.target.ts`
- `src/components/ponder/targets/studio/themePark.target.ts`
- `src/components/ponder/targets/studio/visPlayground.target.ts`

### `src/components/visualizer/backgrounds/registry.tsx`

- `src/components/visualizer/backgrounds/common/entry.tsx`
- `src/components/visualizer/backgrounds/latent/entry.tsx`
- `src/components/visualizer/backgrounds/monet/entry.tsx`
- `src/components/visualizer/backgrounds/nomand/entry.tsx`
- `src/components/visualizer/backgrounds/sora/entry.tsx`
- `src/components/visualizer/backgrounds/url/entry.tsx`

### `src/components/visualizer/registry.tsx`

- `src/components/visualizer/cadenza/entry.tsx`
- `src/components/visualizer/cappella/entry.tsx`
- `src/components/visualizer/claddagh/entry.tsx`
- `src/components/visualizer/classic/entry.tsx`
- `src/components/visualizer/diorama/entry.tsx`
- `src/components/visualizer/fume/entry.tsx`
- `src/components/visualizer/hanabi/entry.tsx`
- `src/components/visualizer/lumiere/entry.tsx`
- `src/components/visualizer/machi/entry.tsx`
- `src/components/visualizer/monet/entry.tsx`
- `src/components/visualizer/nebbia/entry.tsx`
- `src/components/visualizer/partita/entry.tsx`
- `src/components/visualizer/pendolo/entry.tsx`
- `src/components/visualizer/sonnet/entry.tsx`
- `src/components/visualizer/still/entry.tsx`
- `src/components/visualizer/tempera/entry.tsx`
- `src/components/visualizer/tilt/entry.tsx`

### `src/components/visualizer/tuningRegistry.ts`

- `src/components/visualizer/backgrounds/latent/tuning.ts`
- `src/components/visualizer/backgrounds/monet/tuning.ts`
- `src/components/visualizer/backgrounds/nomand/tuning.ts`
- `src/components/visualizer/backgrounds/sora/tuning.ts`
- `src/components/visualizer/backgrounds/url/settings.ts`
- `src/components/visualizer/cadenza/tuning.ts`
- `src/components/visualizer/cappella/tuning.ts`
- `src/components/visualizer/claddagh/tuning.ts`
- `src/components/visualizer/classic/tuning.ts`
- `src/components/visualizer/diorama/tuning.ts`
- `src/components/visualizer/fume/tuning.ts`
- `src/components/visualizer/hanabi/tuning.ts`
- `src/components/visualizer/lumiere/tuning.ts`
- `src/components/visualizer/machi/tuning.ts`
- `src/components/visualizer/monet/tuning.ts`
- `src/components/visualizer/nebbia/tuning.ts`
- `src/components/visualizer/partita/tuning.ts`
- `src/components/visualizer/pendolo/tuning.ts`
- `src/components/visualizer/sonnet/tuning.ts`
- `src/components/visualizer/tempera/tuning.ts`
- `src/components/visualizer/tilt/tuning.ts`

### `src/library/registry.ts`

- `src/library/suites/bravais/entry.ts`
- `src/library/suites/grid/entry.ts`
- `src/library/suites/tui/entry.ts`

### `test/unit/visualizer/tuningBundleTransport.test.ts`

- `src/components/visualizer/cadenza/tuning.ts`
- `src/components/visualizer/cappella/tuning.ts`
- `src/components/visualizer/claddagh/tuning.ts`
- `src/components/visualizer/classic/tuning.ts`
- `src/components/visualizer/diorama/tuning.ts`
- `src/components/visualizer/fume/tuning.ts`
- `src/components/visualizer/hanabi/tuning.ts`
- `src/components/visualizer/lumiere/tuning.ts`
- `src/components/visualizer/machi/tuning.ts`
- `src/components/visualizer/monet/tuning.ts`
- `src/components/visualizer/nebbia/tuning.ts`
- `src/components/visualizer/partita/tuning.ts`
- `src/components/visualizer/pendolo/tuning.ts`
- `src/components/visualizer/sonnet/tuning.ts`
- `src/components/visualizer/tempera/tuning.ts`
- `src/components/visualizer/tilt/tuning.ts`

## 分层边界违规

规则是人定的（见 `codemap.mjs` 的 `BOUNDARY_RULES`），拿真实的值导入图去比对。
`import type` 不算——它在运行时不存在。

下面这些边的依赖方向本身就是错的：

- `src/stores/useVisualizerSettingsStore.ts` → `src/components/visualizer/registry.tsx`  —— store 不应依赖组件
- `src/utils/lyrics/lyricMatchSources.ts` → `src/stores/useOnlineProviderAccountStore.ts`  —— 纯变换不应依赖 UI 或状态

### 目录归属存疑

这些边命中了规则，但目标模块在运行时根本不含 UI（不传递依赖 react）。
依赖方向没问题，是文件住在了 UI 目录（`src/components/`、`src/library/` 的 suites / app）下面。修法是移动文件，不是改依赖。

- `src/services/obs/visualSettingsConfig.ts` → `src/components/visualizer/tuningRegistry.ts`
- `src/services/ponder/pagePonderTarget.ts` → `src/components/modal/settings/navigation/settingsAnchorModel.ts`
- `src/services/sync/settingsSnapshot.ts` → `src/components/visualizer/tuningRegistry.ts`
- `src/stores/useExploreFeedStore.ts` → `src/components/app/home/explore/exploreFeedMemory.ts`
- `src/stores/usePlaybackStore.ts` → `src/components/app/playback/createCoverUrlResolver.ts`
- `src/stores/useSettingsModalStore.ts` → `src/components/command-palette/pinnedCommandPreferences.ts`
- `src/stores/useVisualizerSettingsStore.ts` → `src/components/visualizer/tuningRegistry.ts`
- `src/utils/themeColorMath.ts` → `src/components/visualizer/colorMix.ts`

