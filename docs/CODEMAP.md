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
| components | 512+ |
| test/dev | 512+ |
| services | 128+ |
| utils | 128+ |
| backend/electron | 64+ |
| hooks | 64+ |
| src (其他) | 32+ |
| stores | 32+ |
| 其他 | 32+ |
| types | 16+ |
| i18n | 4+ |
| workers | 2+ |

## 枢纽模块

被 32 个以上模块依赖的文件。改动它们波及面最大，读代码时也最值得先看。

| 被依赖量级 | 模块 |
| --- | --- |
| 512+ | `src/types.ts` |
| 64+ | `src/types/onlineMusic.ts` |
| 64+ | `src/types/ponder.ts` |
| 64+ | `src/utils/appPlaybackGuards.ts` |
| 32+ | `dev/probes/definition.ts` |
| 32+ | `src/components/command-palette/types.ts` |
| 32+ | `src/components/ponder/surfaces/ponderSurfaceGeometry.ts` |
| 32+ | `src/components/visualizer/colorMix.ts` |
| 32+ | `src/components/visualizer/definition.ts` |
| 32+ | `src/mods/folium/contract.ts` |
| 32+ | `src/services/db.ts` |
| 32+ | `src/services/onlineMusic/omni.ts` |
| 32+ | `src/services/onlineMusic/songMetadata.ts` |
| 32+ | `src/stores/useAppViewStore.ts` |
| 32+ | `src/stores/usePlaybackStore.ts` |
| 32+ | `src/stores/useStatusMessageStore.ts` |
| 32+ | `src/utils/fontStacks.ts` |
| 32+ | `src/utils/lyrics/parserCore.ts` |
| 32+ | `src/utils/lyrics/renderHints.ts` |

## 动态注册点

这些地方用 `import.meta.glob` 自动发现成员，**清单随目录变化，不要手写**。
以下是当前的完整展开：

### `dev/probes/registry.ts`

- `dev/probes/activeGridMarker.probe.tsx`
- `dev/probes/audioEffectGrid.probe.tsx`
- `dev/probes/automixModelReminder.probe.tsx`
- `dev/probes/automixModels.probe.tsx`
- `dev/probes/automixTransitionSwitches.probe.tsx`
- `dev/probes/collectionMorph.probe.tsx`
- `dev/probes/coverSizeAudit.probe.tsx`
- `dev/probes/fmTab.probe.tsx`
- `dev/probes/globalLyricOffsetRuler.probe.tsx`
- `dev/probes/gridEntrancePerf.probe.tsx`
- `dev/probes/gridPanelToggle.probe.tsx`
- `dev/probes/lattice.probe.tsx`
- `dev/probes/latticeExit.probe.tsx`
- `dev/probes/latticePerformance.probe.tsx`
- `dev/probes/latticeTitle.probe.tsx`
- `dev/probes/latticeTitleExpansion.probe.tsx`
- `dev/probes/localFolderIgnore.probe.tsx`
- `dev/probes/lyricFilterModal.probe.tsx`
- `dev/probes/lyricSegmentationSurface.probe.tsx`
- `dev/probes/lyricStaffSection.probe.tsx`
- `dev/probes/monetPortraitImage.probe.tsx`
- `dev/probes/monetSubtitleDualRow.probe.tsx`
- `dev/probes/nativeDragGuard.probe.tsx`
- `dev/probes/nowPlayingToastTransitionBorder.probe.tsx`
- `dev/probes/pendoloSubtitleDualRow.probe.tsx`
- `dev/probes/playbackLyricsSettings.probe.tsx`
- `dev/probes/playerBarModButtons.probe.tsx`
- `dev/probes/playerBottomBar.probe.tsx`
- `dev/probes/ponderHint.probe.tsx`
- `dev/probes/ponderPageSurfaces.probe.tsx`
- `dev/probes/providerConnect.probe.tsx`
- `dev/probes/settingsHelpActions.probe.tsx`
- `dev/probes/settingsNavigation.probe.tsx`
- `dev/probes/subtitleDualRow.probe.tsx`
- `dev/probes/themePark.probe.tsx`
- `dev/probes/trackTitleNavigator.probe.tsx`
- `dev/probes/visualizerMemory.probe.tsx`
- `dev/probes/wallpaperEntryConfirm.probe.tsx`

### `src/components/ponder/ponderRegistry.ts`

- `src/components/ponder/targets/audioEqualizer.target.ts`
- `src/components/ponder/targets/commandPalette.target.ts`
- `src/components/ponder/targets/customShortcutSettings.target.ts`
- `src/components/ponder/targets/foliaDesktop.target.ts`
- `src/components/ponder/targets/foliaShortcuts.target.ts`
- `src/components/ponder/targets/foliaTransport.target.ts`
- `src/components/ponder/targets/grid3dCardStyle.target.ts`
- `src/components/ponder/targets/gridActionButton.target.ts`
- `src/components/ponder/targets/gridPage.target.ts`
- `src/components/ponder/targets/gridPaletteHotkey.target.ts`
- `src/components/ponder/targets/gridViewCardSettings.target.ts`
- `src/components/ponder/targets/gridViewEditMode.target.ts`
- `src/components/ponder/targets/gridViewPage.target.ts`
- `src/components/ponder/targets/helpPage.target.ts`
- `src/components/ponder/targets/importExportSettings.target.ts`
- `src/components/ponder/targets/latticeChrome.target.ts`
- `src/components/ponder/targets/latticePage.target.ts`
- `src/components/ponder/targets/latticeStyleSettings.target.ts`
- `src/components/ponder/targets/localFolderActions.target.ts`
- `src/components/ponder/targets/localGridControls.target.ts`
- `src/components/ponder/targets/localGridMapDirectoryTree.target.ts`
- `src/components/ponder/targets/localGridMapPage.target.ts`
- `src/components/ponder/targets/localLibraryWatch.target.ts`
- `src/components/ponder/targets/localMetadataMatch.target.ts`
- `src/components/ponder/targets/localTrackSorting.target.ts`
- `src/components/ponder/targets/lyricExport.target.ts`
- `src/components/ponder/targets/lyricStyle.target.ts`
- `src/components/ponder/targets/lyricsAnimationSettings.target.ts`
- `src/components/ponder/targets/lyricsSettings.target.ts`
- `src/components/ponder/targets/onlineCollectionActions.target.ts`
- `src/components/ponder/targets/panelAccountTab.target.ts`
- `src/components/ponder/targets/panelControlsTab.target.ts`
- `src/components/ponder/targets/panelCoverActions.target.ts`
- `src/components/ponder/targets/panelCoverTab.target.ts`
- `src/components/ponder/targets/panelQueueTab.target.ts`
- `src/components/ponder/targets/panelSlide.target.ts`
- `src/components/ponder/targets/panelSourceTab.target.ts`
- `src/components/ponder/targets/pinnedCommands.target.ts`
- `src/components/ponder/targets/playerBar.target.ts`
- `src/components/ponder/targets/playerPage.target.ts`
- `src/components/ponder/targets/ponderBasics.target.ts`
- `src/components/ponder/targets/queueCommandSurface.target.ts`
- `src/components/ponder/targets/queueSettings.target.ts`
- `src/components/ponder/targets/queueShuffle.target.ts`
- `src/components/ponder/targets/replayGainSettings.target.ts`
- `src/components/ponder/targets/settingsPage.target.ts`
- `src/components/ponder/targets/sidePanel.target.ts`
- `src/components/ponder/targets/themePark.target.ts`
- `src/components/ponder/targets/themeSettings.target.ts`
- `src/components/ponder/targets/transitionSettings.target.ts`
- `src/components/ponder/targets/visPlayground.target.ts`

### `src/components/visualizer/backgrounds/registry.tsx`

- `src/components/visualizer/backgrounds/common/entry.tsx`
- `src/components/visualizer/backgrounds/latent/entry.tsx`
- `src/components/visualizer/backgrounds/monet/entry.tsx`
- `src/components/visualizer/backgrounds/nomand/entry.tsx`
- `src/components/visualizer/backgrounds/sora/entry.tsx`
- `src/components/visualizer/backgrounds/tide/entry.tsx`
- `src/components/visualizer/backgrounds/url/entry.tsx`

### `src/components/visualizer/registry.tsx`

- `src/components/visualizer/cadenza/entry.tsx`
- `src/components/visualizer/cappella/entry.tsx`
- `src/components/visualizer/claddagh/entry.tsx`
- `src/components/visualizer/classic/entry.tsx`
- `src/components/visualizer/diorama/entry.tsx`
- `src/components/visualizer/fume/entry.tsx`
- `src/components/visualizer/lumiere/entry.tsx`
- `src/components/visualizer/monet/entry.tsx`
- `src/components/visualizer/partita/entry.tsx`
- `src/components/visualizer/pendolo/entry.tsx`
- `src/components/visualizer/sonnet/entry.tsx`
- `src/components/visualizer/still/entry.tsx`
- `src/components/visualizer/tempera/entry.tsx`
- `src/components/visualizer/tilt/entry.tsx`

### `src/components/visualizer/tuningRegistry.ts`

- `src/components/visualizer/cadenza/tuning.ts`
- `src/components/visualizer/cappella/tuning.ts`
- `src/components/visualizer/claddagh/tuning.ts`
- `src/components/visualizer/classic/tuning.ts`
- `src/components/visualizer/diorama/tuning.ts`
- `src/components/visualizer/fume/tuning.ts`
- `src/components/visualizer/lumiere/tuning.ts`
- `src/components/visualizer/monet/tuning.ts`
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

### 目录归属存疑

这些边命中了规则，但目标模块在运行时根本不含 UI（不传递依赖 react）。
依赖方向没问题，是文件住在了 `src/components/` 下面。修法是移动文件，不是改依赖。

- `src/services/obs/visualSettingsConfig.ts` → `src/components/visualizer/tuningRegistry.ts`
- `src/services/ponder/pagePonderTarget.ts` → `src/components/modal/settings/navigation/settingsAnchorModel.ts`
- `src/services/sync/settingsSnapshot.ts` → `src/components/visualizer/tuningRegistry.ts`
- `src/stores/useCollectionNavigationStore.ts` → `src/components/app/home/gridViewCollectionAdapters.ts`
- `src/stores/usePlaybackStore.ts` → `src/components/app/playback/createCoverUrlResolver.ts`
- `src/stores/useSettingsModalStore.ts` → `src/components/command-palette/pinnedCommandPreferences.ts`
- `src/stores/visualizerSettingsPersistence.ts` → `src/components/visualizer/diorama/dioramaMoteField.ts`
- `src/utils/themeColorMath.ts` → `src/components/visualizer/colorMix.ts`

