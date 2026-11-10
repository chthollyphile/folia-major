# Ponder 中文文案与组件 / 场景对照

> 这份文档大半是从代码生成的，供查对用，不要在这里改文案：下一次生成会盖掉。生成的部分：第 1 节的「中文文案」一栏、第 2 节的表、第 3 节的原表、第 6 节的表；命令是 `node dev/ponder/copy-doc.mjs`（在仓库根目录运行；加 `--check` 只检查、不写）。要改文案，改 `src/i18n/locales/zh-CN.ts`（`en.ts`、`in.ts` 同步改），再运行这条命令。手写的部分：这段话、第 1 节的 key 和文件两栏、第 4、5 节。

## 1. 入口、设置与命令面板文案

| Key | 中文文案 | 对应组件 / 场景 |
| --- | --- | --- |
| `help.ponder` | 思索帮助页 | src/components/modal/settings/pages/HelpPage.tsx |
| `help.ponderDescription` | 了解 Folia 的基本操作与运行逻辑 | src/components/modal/settings/pages/HelpPage.tsx |
| `options.ponderHints` | 思索教程提示 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderHintsDesc` | 指针停在可教学的控件上时提示长按 G。 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderHintsAlways` | 始终显示 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderHintsUnseen` | 仅未看过的区域 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderHintsOff` | 关闭 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderTouchButton` | 触屏思索按钮 | src/components/modal/settings/pages/GeneralPage.tsx |
| `options.ponderTouchButtonDesc` | 触屏设备右上角的灯泡。 | src/components/modal/settings/pages/GeneralPage.tsx |
| `commandPalette.commands.settings-ponder-hints.title` | 思索教程提示 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.settings-ponder-hints.description` | 设置长按 G 的提示什么时候出现 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-always.title` | 思索提示：始终显示 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-always.description` | 所有可教学的控件都提示长按 G | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-unseen.title` | 思索提示：仅未看过的区域 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-unseen.description` | 某个控件的教程看过之后就不再提示它 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-off.title` | 思索提示：关闭 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-hints-off.description` | 不再显示长按 G 的提示 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-touch-button-toggle.title` | 触屏思索按钮 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-touch-button-toggle.description` | 显示或隐藏触屏右上角那颗灯泡 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-current-page.title` | 思索当前页面 | src/components/command-palette/commands/settingsCommands.ts |
| `commandPalette.commands.ponder-current-page.description` | 打开当前页面的交互式介绍 | src/components/command-palette/commands/settingsCommands.ts |

## 2. 教程目标、对应组件和场景

一条教程是 targets/ 下的一个文件：声明标题、摘要、章节、字幕和锚点。手画界面按 surfaceKind 由 surfaces/ 下的 *.surface.tsx 各自声明，PonderSurfaceContents.tsx 把它们收齐。

| 目标 ID | 目标标题 key | 类别 | 目标定义文件 | 悬停入口（hoverSelector） | 手画界面文件（surfaceKind） | 场景 ID |
| --- | --- | --- | --- | --- | --- | --- |
| `audio-equalizer` | `ponder.targets.audioEqualizer` | playback | `src/components/ponder/targets/panel/audioEqualizer.target.ts` | `[data-ponder="audio-equalizer"]` | src/components/ponder/surfaces/panel/audioEqualizer.surface.tsx（audio-equalizer） | `audio-equalizer-presets`<br>`audio-equalizer-silent-write`<br>`audio-equalizer-effects` |
| `bravais-seam` | `ponder.targets.bravaisSeam` | browsing | `src/components/ponder/targets/bravaisSeam.target.ts` | `[data-bravais-seam], [data-bravais-seam-tab]` | src/components/ponder/surfaces/library/bravais.surface.tsx（bravais-seam-strip、bravais-seam-home） | `bravais-seam-levels`<br>`bravais-seam-collection`<br>`bravais-seam-home-navigation`<br>`bravais-seam-home-dock`<br>`bravais-seam-filter`<br>`bravais-seam-tools` |
| `bravais-wall` | `ponder.targets.bravaisWall` | browsing | `src/components/ponder/targets/bravaisWall.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/library/bravais.surface.tsx（bravais-wall） | `bravais-wall-structure`<br>`bravais-wall-pan`<br>`bravais-wall-tiles`<br>`bravais-wall-open`<br>`bravais-wall-focus`<br>`bravais-wall-look` |
| `command-palette` | `ponder.targets.commandPalette` | basics | `src/components/ponder/targets/command/commandPalette.target.ts` | `[data-testid="command-palette-panel"]` | src/components/ponder/surfaces/command/commandWindow.surface.tsx（palette） | `command-palette-search`<br>`command-palette-argument`<br>`command-palette-execute-mode` |
| `custom-shortcut-settings` | `ponder.targets.customShortcutSettings` | basics | `src/components/ponder/targets/settings/customShortcutSettings.target.ts` | `[data-settings-row="customShortcut"]` | src/components/ponder/surfaces/settings/commandSettings.surface.tsx（custom-shortcut-settings） | `custom-shortcut-key`<br>`custom-shortcut-command` |
| `folia-desktop` | `ponder.targets.foliaDesktop` | desktop | `src/components/ponder/targets/basics/foliaDesktop.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/basics/desktopFeatures.surface.tsx（desktop-features） | `folia-desktop-wallpaper`<br>`folia-desktop-tray`<br>`folia-desktop-remote` |
| `folia-shortcuts` | `ponder.targets.foliaShortcuts` | basics | `src/components/ponder/targets/basics/foliaShortcuts.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/command/commandWindow.surface.tsx（palette） | `help-page-shortcuts` |
| `folia-transport` | `ponder.targets.foliaTransport` | playback | `src/components/ponder/targets/basics/foliaTransport.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/player/playerPage.surface.tsx（player-page） | `help-page-transport` |
| `grid-action-button` | `ponder.targets.gridActionButton` | browsing | `src/components/ponder/targets/library/gridActionButton.target.ts` | `[data-testid="grid-list-search-button"]` | src/components/ponder/surfaces/library/gridView.surface.tsx（grid-action-button） | `grid-action-button-list`<br>`grid-action-button-slide` |
| `grid-page` | `ponder.targets.gridPage` | browsing | `src/components/ponder/targets/library/gridPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/library/gridPage.surface.tsx（grid-page） | `grid-page-structure`<br>`grid-page-tabs`<br>`grid-page-cards`<br>`grid-page-map`<br>`grid-page-search`<br>`grid-page-keyboard` |
| `grid-palette-hotkey` | `ponder.targets.gridPaletteHotkey` | browsing | `src/components/ponder/targets/settings/gridPaletteHotkey.target.ts` | `[data-settings-row="gridPaletteHotkey"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（grid-hotkey-settings） | `grid-palette-hotkey-owner` |
| `grid-view-card-settings` | `ponder.targets.gridViewCardSettings` | appearance | `src/components/ponder/targets/settings/gridViewCardSettings.target.ts` | `[data-settings-anchor="gridViewCardSettings"]` | src/components/ponder/surfaces/settings/appearanceSettings.surface.tsx（grid-view-card-settings） | `grid-view-card-cover`<br>`grid-view-card-falloff` |
| `grid-view-edit-mode` | `ponder.targets.gridViewEditMode` | browsing | `src/components/ponder/targets/library/gridViewEditMode.target.ts` | `[data-ponder="grid-view-edit-mode"]` | src/components/ponder/surfaces/library/gridView.surface.tsx（grid-view-cards） | `grid-view-edit-mode-cards`<br>`grid-view-edit-mode-rename` |
| `grid-view-page` | `ponder.targets.gridViewPage` | browsing | `src/components/ponder/targets/library/gridViewPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/library/gridViewPage.surface.tsx（grid-view-page） | `grid-view-page-structure`<br>`grid-view-page-navigation`<br>`grid-view-page-info`<br>`grid-view-page-filter`<br>`grid-view-page-activate` |
| `grid3d-card-style` | `ponder.targets.grid3dCardStyle` | appearance | `src/components/ponder/targets/settings/grid3dCardStyle.target.ts` | `[data-settings-row="grid3dCardStyle"]` | src/components/ponder/surfaces/settings/appearanceSettings.surface.tsx（grid3d-card-style） | `grid3d-card-style-options` |
| `help-page` | `ponder.targets.helpPage` | basics | `src/components/ponder/targets/basics/helpPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/basics/onboarding.surface.tsx（ponder-onboarding）<br>src/components/ponder/surfaces/command/commandWindow.surface.tsx（palette、volume）<br>src/components/ponder/surfaces/command/queueCommand.surface.tsx（queue-command）<br>src/components/ponder/surfaces/library/gridViewPage.surface.tsx（grid-view-page） | `help-page-overview`<br>`help-page-command-palette`<br>`help-page-command-examples`<br>`help-page-docs` |
| `import-export-settings` | `ponder.targets.importExportSettings` | appearance | `src/components/ponder/targets/settings/importExportSettings.target.ts` | `[data-settings-anchor="importExportTitle"]` | src/components/ponder/surfaces/settings/importExport.surface.tsx（import-export-settings） | `import-export-scope`<br>`import-export-export`<br>`import-export-confirm` |
| `lattice-chrome` | `ponder.targets.latticeChrome` | playback | `src/components/ponder/targets/player/latticeChrome.target.ts` | `[data-ponder="lattice-chrome"]` | src/components/ponder/surfaces/player/latticeChrome.surface.tsx（lattice-chrome） | `lattice-chrome-layout`<br>`lattice-chrome-shared-slots`<br>`lattice-chrome-bottom-bar` |
| `lattice-page` | `ponder.targets.latticePage` | playback | `src/components/ponder/targets/player/latticePage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/player/latticePage.surface.tsx（lattice-page） | `lattice-page-structure`<br>`lattice-page-navigation`<br>`lattice-page-poster`<br>`lattice-page-tools`<br>`lattice-page-keyboard` |
| `lattice-style-settings` | `ponder.targets.latticeStyleSettings` | appearance | `src/components/ponder/targets/settings/latticeStyleSettings.target.ts` | `[data-settings-row="latticeSettings"]` | src/components/ponder/surfaces/settings/appearanceSettings.surface.tsx（lattice-style-settings） | `lattice-style-tint`<br>`lattice-style-custom-color` |
| `local-folder-actions` | `ponder.targets.localFolderActions` | browsing | `src/components/ponder/targets/library/localFolderActions.target.ts` | `[data-ponder="local-folder-actions"]` | src/components/ponder/surfaces/library/gridView.surface.tsx（local-folder-actions） | `local-folder-actions-list`<br>`local-folder-actions-maintenance`<br>`local-folder-actions-delete` |
| `local-grid-controls` | `ponder.targets.localGridControls` | browsing | `src/components/ponder/targets/library/localGridControls.target.ts` | `[data-ponder="local-grid-controls"]` | src/components/ponder/surfaces/library/localLibrary.surface.tsx（local-grid-controls） | `local-grid-controls-sources`<br>`local-grid-controls-maintenance` |
| `local-grid-map-directory-tree` | `ponder.targets.localGridMapDirectoryTree` | browsing | `src/components/ponder/targets/library/localGridMapDirectoryTree.target.ts` | `[data-ponder="local-grid-map-directory-tree"]` | src/components/ponder/surfaces/library/localLibrary.surface.tsx（local-grid-map） | `local-grid-map-directory-hierarchy`<br>`local-grid-map-directory-selection` |
| `local-grid-map-page` | `ponder.targets.localGridMapPage` | browsing | `src/components/ponder/targets/library/localGridMapPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/library/localLibrary.surface.tsx（local-grid-map） | `local-grid-map-structure`<br>`local-grid-map-batch`<br>`local-grid-map-filter` |
| `local-library-watch` | `ponder.targets.localLibraryWatch` | browsing | `src/components/ponder/targets/settings/localLibraryWatch.target.ts` | `[data-settings-anchor="localLibraryWatch"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（library-watch-settings） | `local-library-watch-roots` |
| `local-metadata-match` | `ponder.targets.localMetadataMatch` | browsing | `src/components/ponder/targets/library/localMetadataMatch.target.ts` | `[data-ponder="local-metadata-match"]` | src/components/ponder/surfaces/library/gridView.surface.tsx（grid-view-cards） | `local-metadata-match-reveal` |
| `local-track-sorting` | `ponder.targets.localTrackSorting` | browsing | `src/components/ponder/targets/library/localTrackSorting.target.ts` | `[data-ponder="local-track-sorting"]` | src/components/ponder/surfaces/library/gridView.surface.tsx（local-track-list） | `local-track-sorting-fields` |
| `lyric-export` | `ponder.targets.lyricExport` | playback | `src/components/ponder/targets/command/lyricExport.target.ts` | `[data-ponder="lyric-export-surface"], [data-ponder-lyric-export-settings-entry]` | src/components/ponder/surfaces/command/lyricExport.surface.tsx（lyric-export） | `lyric-export-scope`<br>`lyric-export-formats` |
| `lyric-match` | `ponder.targets.lyricMatch` | playback | `src/components/ponder/targets/panel/lyricMatch.target.ts` | `[data-ponder="lyric-match"]` | src/components/ponder/surfaces/panel/lyricMatch.surface.tsx（lyric-match） | `lyric-match-search`<br>`lyric-match-pick`<br>`lyric-match-local` |
| `lyric-style` | `ponder.targets.lyricStyle` | appearance | `src/components/ponder/targets/studio/lyricStyle.target.ts` | `[data-ponder="lyric-style"]` | src/components/ponder/surfaces/studio/lyricStyle.surface.tsx（lyric-style） | `lyric-style-per-style`<br>`lyric-style-monet`<br>`lyric-style-combine`<br>`lyric-style-subtitle` |
| `lyrics-animation-settings` | `ponder.targets.lyricsAnimationSettings` | appearance | `src/components/ponder/targets/settings/lyricsAnimationSettings.target.ts` | `[data-settings-anchor="lyricsRenderer"]` | src/components/ponder/surfaces/settings/settingsSections.surface.tsx（lyrics-animation-settings） | `lyrics-animation-entry` |
| `lyrics-settings` | `ponder.targets.lyricsSettings` | playback | `src/components/ponder/targets/settings/lyricsSettings.target.ts` | `[data-settings-anchor="lyrics"], [data-settings-anchor="lyricAdjust"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（lyrics-source-settings） | `lyrics-settings-source`<br>`lyrics-settings-offset` |
| `online-collection-actions` | `ponder.targets.onlineCollectionActions` | browsing | `src/components/ponder/targets/library/onlineCollectionActions.target.ts` | `[data-ponder="online-collection-actions"]` | src/components/ponder/surfaces/library/localLibrary.surface.tsx（online-collection-actions） | `online-collection-actions-common`<br>`online-collection-actions-provider` |
| `panel-account-tab` | `ponder.targets.panelAccountTab` | playback | `src/components/ponder/targets/panel/panelAccountTab.target.ts` | `[data-ponder-panel-tab-button="account"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-account-tab` |
| `panel-controls-tab` | `ponder.targets.panelControlsTab` | playback | `src/components/ponder/targets/panel/panelControlsTab.target.ts` | `[data-ponder-panel-tab-button="controls"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-controls-tab`<br>`panel-controls-tab-mode-list` |
| `panel-cover-actions` | `ponder.targets.panelCoverActions` | playback | `src/components/ponder/targets/panel/panelCoverActions.target.ts` | `[data-ponder-panel-artwork]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-cover-actions-reveal`<br>`panel-cover-actions-right` |
| `panel-cover-tab` | `ponder.targets.panelCoverTab` | playback | `src/components/ponder/targets/panel/panelCoverTab.target.ts` | `[data-ponder-panel-tab-button="cover"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-cover-tab` |
| `panel-queue-tab` | `ponder.targets.panelQueueTab` | playback | `src/components/ponder/targets/panel/panelQueueTab.target.ts` | `[data-ponder-panel-tab-button="queue"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-queue-tab`<br>`panel-queue-tab-radio` |
| `panel-slide` | `ponder.targets.panelSlide` | playback | `src/components/ponder/targets/panel/panelSlide.target.ts` | `[data-testid="panel-toggle"]` | src/components/ponder/surfaces/command/commandWindow.surface.tsx（palette） | `panel-slide-to-palette`<br>`panel-slide-edge-hotspot`<br>`panel-slide-keyboard` |
| `panel-source-tab` | `ponder.targets.panelSourceTab` | playback | `src/components/ponder/targets/panel/panelSourceTab.target.ts` | `[data-ponder-panel-tab-button="local"], [data-ponder-panel-tab-button="navi"], [data-ponder-panel-tab-button="onlineLyrics"], [data-ponder-panel-source-lyrics-file], [data-ponder="lyric-file-dialog"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `panel-source-tab-where`<br>`panel-source-tab-contents`<br>`panel-source-tab-export` |
| `pinned-commands` | `ponder.targets.pinnedCommands` | basics | `src/components/ponder/targets/settings/pinnedCommands.target.ts` | `[data-settings-row="pinnedCommandSlots"]` | src/components/ponder/surfaces/settings/commandSettings.surface.tsx（pinned-commands-settings） | `pinned-commands-slots`<br>`pinned-commands-vs-recent` |
| `player-bar` | `ponder.targets.playerBar` | playback | `src/components/ponder/targets/player/playerBar.target.ts` | `[data-ponder="player-bar"]` | src/components/ponder/surfaces/player/playerBar.surface.tsx（player-bar）<br>src/components/ponder/surfaces/settings/controlBarSettings.surface.tsx（bottom-ui-settings、picker）<br>src/components/ponder/surfaces/command/commandWindow.surface.tsx（queue、volume） | `player-bar-basics`<br>`player-bar-height`<br>`player-bar-slots`<br>`player-bar-shuffle`<br>`player-bar-volume` |
| `player-page` | `ponder.targets.playerPage` | playback | `src/components/ponder/targets/player/playerPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/player/playerPage.surface.tsx（player-page） | `player-page-layout`<br>`player-page-open-palette`<br>`player-page-run-commands`<br>`player-page-shuffle` |
| `ponder-basics` | `ponder.targets.ponderBasics` | basics | `src/components/ponder/targets/basics/ponderBasics.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/basics/onboarding.surface.tsx（ponder-onboarding）<br>src/components/ponder/surfaces/settings/settingsPage.surface.tsx（settings-page） | `help-page-ponder`<br>`help-page-whole-page`<br>`help-page-hint-settings` |
| `queue-command-surface` | `ponder.targets.queueCommandSurface` | playback | `src/components/ponder/targets/command/queueCommandSurface.target.ts` | `[data-testid="command-palette-queue-view"]` | src/components/ponder/surfaces/command/queueCommand.surface.tsx（queue-command） | `queue-command-facets`<br>`queue-command-batch` |
| `queue-settings` | `ponder.targets.queueSettings` | playback | `src/components/ponder/targets/settings/queueSettings.target.ts` | `[data-settings-row="queueDefaultBehavior"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（queue-settings） | `queue-settings-behavior` |
| `queue-shuffle` | `ponder.targets.queueShuffle` | playback | `src/components/ponder/targets/player/queueShuffle.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/player/playerBar.surface.tsx（player-bar）<br>src/components/ponder/surfaces/command/commandWindow.surface.tsx（queue）<br>src/components/ponder/surfaces/player/playerPage.surface.tsx（player-page）<br>src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel）<br>src/components/ponder/surfaces/settings/commandSettings.surface.tsx（pinned-commands-settings） | `queue-shuffle-no-mode`<br>`queue-shuffle-command`<br>`queue-shuffle-slot`<br>`queue-shuffle-panel`<br>`queue-shuffle-pinned` |
| `replay-gain-settings` | `ponder.targets.replayGainSettings` | playback | `src/components/ponder/targets/settings/replayGainSettings.target.ts` | `[data-settings-row="replayGainSettings"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（replay-gain-settings） | `replay-gain-modes`<br>`replay-gain-mirrored` |
| `settings-page` | `ponder.targets.settingsPage` | basics | `src/components/ponder/targets/settings/settingsPage.target.ts` | 没有悬停入口（页面级，或只从全部教程进入） | src/components/ponder/surfaces/settings/settingsPage.surface.tsx（settings-page）<br>src/components/ponder/surfaces/command/commandWindow.surface.tsx（palette） | `settings-page-overview`<br>`settings-page-direct-navigation` |
| `side-panel` | `ponder.targets.sidePanel` | playback | `src/components/ponder/targets/panel/sidePanel.target.ts` | `[data-testid="unified-panel-surface"]` | src/components/ponder/surfaces/panel/sidePanel.surface.tsx（side-panel） | `side-panel-structure`<br>`side-panel-tabs` |
| `sign-in` | `ponder.targets.signIn` | basics | `src/components/ponder/targets/basics/signIn.target.ts` | `[data-testid="online-provider-switcher"], [data-ponder="sign-in"]` | src/components/ponder/surfaces/basics/signIn.surface.tsx（sign-in） | `sign-in-entries`<br>`sign-in-window`<br>`sign-in-account` |
| `theme-park` | `ponder.targets.themePark` | appearance | `src/components/ponder/targets/studio/themePark.target.ts` | `[data-ponder="theme-park"]` | src/components/ponder/surfaces/studio/themePark.surface.tsx（theme-park） | `theme-park-target`<br>`theme-park-colors`<br>`theme-park-saving` |
| `theme-settings` | `ponder.targets.themeSettings` | appearance | `src/components/ponder/targets/settings/themeSettings.target.ts` | `[data-settings-anchor="themePresets"]` | src/components/ponder/surfaces/settings/settingsSections.surface.tsx（theme-settings） | `theme-settings-presets`<br>`theme-settings-source`<br>`theme-settings-auto` |
| `transition-settings` | `ponder.targets.transitionSettings` | appearance | `src/components/ponder/targets/settings/transitionSettings.target.ts` | `[data-settings-anchor="transitionSettings"]` | src/components/ponder/surfaces/settings/playbackSettings.surface.tsx（transition-settings） | `transition-settings-enable`<br>`transition-settings-fallback` |
| `vis-playground` | `ponder.targets.visPlayground` | appearance | `src/components/ponder/targets/studio/visPlayground.target.ts` | `[data-ponder="vis-playground"]` | src/components/ponder/surfaces/studio/visPlayground.surface.tsx（vis-playground） | `vis-playground-layout`<br>`vis-playground-hotspots`<br>`vis-playground-common`<br>`vis-playground-visuals`<br>`vis-playground-subtitle` |

## 3. Ponder 文案原表

下面是当前 zh-CN.ts 中 ponder 对象的完整内容。这里的 key 与源码保持一致，目标 / 场景的具体对应关系见第 2 节；如果要批量改稿，直接在这段里搜索 key 最方便。

```ts
  "ponder": {
    "openPage": "思索当前页面",
    "componentsOnPage": "本页可单独思索的组件",
    "navigation": {
      "title": "思索 · 全部教程",
      "all": "全部教程",
      "unseen": "未看过",
      "search": "搜索教程",
      "empty": "没有匹配的教程",
      "seen": "已看过"
    },
    "summaries": {
      "bravais_seam": "墙中间那道缝：三档开合、首页的页签与工具格、过滤和搜索的区别。",
      "queue_shuffle": "Folia 没有随机播放模式，而是打乱队列；以及打乱队列的四个入口。",
      "audio_equalizer": "十段均衡和效果链；拖动推子会改写自定义槽。",
      "vis_playground": "预览上的三块隐藏点击区。",
      "lyric_style": "每种样式的专属设置、莫奈部件的隐藏、背景搭配和通用副字幕。",
      "theme_park": "配色编辑窗口，以及保存条件。",
      "custom_shortcut_settings": "Alt + 字母，以及可选命令范围。",
      "pinned_commands": "固定按钮和最近使用列表不是一回事。",
      "replay_gain_settings": "和来源页上那个三选一是同一个值。",
      "import_export_settings": "只导出外观，导入前会确认。",
      "command_palette": "搜出来、带参数、冒号进执行模式。",
      "folia_desktop": "壁纸模式、系统托盘和遥控窗口。",
      "folia_shortcuts": "K、P、B、G 四个组合分别通往哪。",
      "folia_transport": "系统媒体键在后台直接可用，应用里还有 Space 和 {{mod}}+←/→。",
      "grid3d_card_style": "首页海报墙用纯图片封面还是拍立得卡片。",
      "grid_action_button": "右下角按钮：点击开列表，左滑做第二个动作。",
      "grid_page": "海报墙怎么组织，怎么移动、打开和搜索。",
      "grid_view_card_settings": "网格卡片的封面形状，以及离中心越远衰减多少。",
      "grid_view_edit_mode": "进去之后卡片会变，以及改名什么时候才算数。",
      "grid_view_page": "集合页的结构、拖动与键盘移动、筛选。",
      "help_page": "思索、命令面板、常用操作示例和官方文档。",
      "lattice_chrome": "展开的海报底下那条控制，中间两颗和底栏共用。",
      "lattice_page": "把整条播放队列铺成一面海报墙。",
      "bravais_wall": "无限墙怎么拖、翻牌换层、认出磁贴的种类、聚焦卡，以及透光与进 Lattice。",
      "lattice_style_settings": "暗角，以及层层解锁的海报叠色。",
      "local_folder_actions": "重扫、整理歌曲信息，以及那颗会删东西的红按钮。",
      "local_grid_controls": "切换本地文件夹、专辑、艺术家与歌单，并导入或刷新曲库。",
      "online_collection_actions": "当前在线或服务器集合可执行的操作。",
      "local_grid_map_page": "本地曲库地图、批量选择，以及对所含曲目的操作。",
      "local_grid_map_directory_tree": "选择整个目录子树、仅直属曲目，并维护导入根目录。",
      "local_metadata_match": "三重条件才出现的那颗铅笔。",
      "local_track_sorting": "只有本地文件夹能排序，选择跨会话保留。",
      "lyrics_animation_settings": "设置里换歌词样式的入口在哪，点开是什么。",
      "panel_account_tab": "当前来源的登录、默认音质和同步。",
      "panel_controls_tab": "音量，循环、智能过渡、音频效果器三格，以及歌词样式和背景两行。",
      "panel_cover_actions": "封面页上喜欢、加入歌单、回到来处、首页和设置这一行。",
      "panel_cover_tab": "当前这首歌的歌名、歌手、专辑，点一下能做什么。",
      "panel_queue_tab": "队列列表：行内动作、打乱、铺成海报墙。",
      "queue_command_surface": "@ 收窄范围，-- 对筛出来的那些整批下手。",
      "transition_settings": "淡化还是自动混音，以及为什么选了可能没生效。",
      "local_library_watch": "监视列表里那个警告图标意味着什么。",
      "queue_settings": "「加入播放队列」到底加到哪儿，全应用一起变。",
      "lyrics_settings": "自动择优会盖掉手动选的来源，两个偏移量会相加。",
      "grid_palette_hotkey": "网格页上按 S 是打开命令窗口还是进筛选框。",
      "panel_slide": "那颗按钮还能往左滑，打开的是命令窗口。",
      "panel_source_tab": "跟着来源走的那一页：歌词来源、时间轴偏移、音频增益。",
      "lyric_export": "把本机缓存的歌词批量导成 .fia 和增强型 LRC，打成一个 zip。",
      "player_bar": "整条胶囊上有什么，以及右边那两个可换的位置。",
      "player_page": "播放页上有什么、各在哪，以及随机播放怎么做。",
      "ponder_basics": "悬停出提示、长按 G、整页 Ctrl+G，以及怎么把提示关掉。",
      "settings_page": "设置怎么分组，以及从命令窗口直接跳过去。",
      "side_panel": "面板分几段、怎么换页。",
      "theme_settings": "预设、自定义配色从哪来，以及配色什么时候自己变。",
      "sign_in": "主页的登录按钮和右下角那一枚开的是同一个窗口。",
      "lyric_match": "给一首歌手动挑一份歌词：换来源、搜索、先看再保存。"
    },
    "categories": {
      "basics": "上手",
      "playback": "播放与控制",
      "browsing": "浏览与曲库",
      "appearance": "外观与样式",
      "desktop": "桌面端"
    },
    "noComponentsOnPage": "本页暂时没有单独的组件教程。",
    "onboarding": {
      "title": "认识思索模式",
      "description": "按住 Ctrl + G，等进度走满，打开当前页面介绍。",
      "touchDescription": "现在点下面的按钮，打开当前页面的介绍。",
      "shortcut": "按住 Ctrl + G",
      "required": "完成一次页面思索后才能继续。"
    },
    "allChaptersDone": "全部章节都看完了。",
    "nextChapter": "下一章",
    "nextChapterAuto": "即将进入下一章",
    "title": "思索",
    "hintCapsulePage": "思索本页",
    "hintCapsuleHold": "进入思索",
    "sceneCounter": "{{current}} / {{total}}",
    "playPause": "播放或暂停",
    "replay": "从头重播",
    "seekKeyframe": "跳到第 {{index}} 个关键帧",
    "prevKeyframe": "上一关键帧",
    "nextKeyframe": "下一关键帧",
    "legend": {
      "keyframe": "关键帧",
      "chapter": "章节",
      "pause": "暂停",
      "exit": "退出"
    },
    "actions": {
      "openAudioEqualizer": "打开音频效果",
      "openCustomShortcut": "打开自定义快捷键",
      "openPinnedCommands": "打开快捷命令",
      "openReplayGain": "打开 ReplayGain 模式",
      "openImportExport": "打开备份与导入",
      "openBottomUiSettings": "打开控制栏设置",
      "openLyricsAnimation": "打开歌词动画设置",
      "openLyricStyleSettings": "打开歌词样式设置",
      "openBackgroundSettings": "打开背景设置",
      "openSubtitleSettings": "打开字幕设置",
      "openThemePresets": "打开主题设置",
      "openSlotPicker": "去挑按钮",
      "openDocs": "打开文档",
      "openPonderHints": "去设置里调",
      "openWallpaperMode": "打开壁纸模式设置",
      "openTraySettings": "打开桌面窗口行为",
      "openTransitionSettings": "打开过渡设置",
      "openLibraryWatch": "打开文件夹监视",
      "openQueueSettings": "打开播放行为设置",
      "openLyricsSettings": "打开歌词设置",
      "openGridPaletteHotkey": "去改这个开关",
      "openGridActionButton": "去改滑动目标",
      "openGrid3dCardStyle": "打开歌单卡片样式",
      "openGridViewCard": "打开网格卡片设置",
      "openBravaisSettings": "打开 Bravais 墙面设置",
      "openLatticeSettings": "打开播放页视图设置"
    },
    "anchors": {
      "bravaisSeam": {
        "collectionPage": "集合页",
        "strip": "完整信息条",
        "crumbs": "返回与面包屑",
        "title": "标题区域",
        "about": "说明",
        "actions": "播放与收藏",
        "list": "列表",
        "more": "⋯ 更多",
        "menuFold": "折叠信息条",
        "spine": "书脊",
        "spineTitle": "竖排标题",
        "edgeTab": "侧边标签",
        "panel": "列表面板",
        "hoverRow": "悬停的一行",
        "linkedTile": "墙上同一首",
        "homePage": "首页",
        "homeSeam": "首页窄缝",
        "tabs": "一级页签",
        "tabLocal": "本地",
        "sections": "二级切换",
        "shortcuts": "直达入口",
        "account": "账户入口",
        "tools": "工具格",
        "searchTool": "搜索在线平台",
        "homeMore": "⋯",
        "menuPopup": "⋯ 菜单",
        "stageRow": "舞台",
        "filter": "过滤输入位",
        "wall": "墙",
        "searchSeam": "搜索",
        "searchBox": "搜索框",
        "toolsButton": "墙面工具",
        "toolsPanel": "工具面板",
        "toolsQuick": "一次性动作",
        "toolsVolume": "音量",
        "toolsAppearance": "墙面外观"
      },
      "audioEqualizer": {
        "panel": "音频效果器",
        "enable": "总开关",
        "presets": "内置预设",
        "customSlots": "自定义 1 / 自定义 2",
        "reset": "清空这个槽",
        "bands": "十段推子",
        "bandFader": "其中一根",
        "effects": "效果链",
        "noiseBadge": "会加噪"
      },
      "lyricStyle": {
        "panel": "歌词样式",
        "preview": "实时预览",
        "settingsPanel": "设置栏",
        "tabs": "四页",
        "rows": "当前样式的设置",
        "rowTwo": "第二行",
        "rowFive": "第五行",
        "subtitle": "通用副字幕",
        "monetDescription": "歌曲描述",
        "monetHanger": "拖拽调整按钮",
        "monetAudio": "音频图案",
        "backgroundPictures": "背景类型",
        "subtitleFont": "字幕字体"
      },
      "visPlayground": {
        "sectionReset": "默认",
        "rows": "这一页的控件",
        "rowOne": "第一行",
        "rowTwo": "第二行",
        "rowThree": "第三行",
        "rowFour": "第四行",
        "rowFive": "第五行",
        "panel": "歌词样式",
        "header": "标题栏",
        "preview": "实时预览",
        "hotspotBackground": "背景那一块",
        "hotspotVisualizer": "歌词动画那一块",
        "hotspotSubtitle": "字幕那一块",
        "pause": "暂停预览",
        "settingsPanel": "设置栏",
        "tabs": "四页",
        "tabCommon": "通用",
        "shelf": "样式",
        "backgroundPictures": "背景类型",
        "subtitleFont": "字幕字体"
      },
      "themePark": {
        "panel": "Theme Park",
        "header": "标题栏",
        "targetToggle": "在编辑哪一份",
        "reset": "重置",
        "save": "保存",
        "preview": "实时预览",
        "editorPanel": "编辑栏",
        "tabs": "四页",
        "tabDetails": "信息那一页",
        "modeToggle": "亮 / 暗",
        "colorRows": "四种颜色",
        "picker": "取色器",
        "hex": "HEX",
        "recommended": "推荐色"
      },
      "customShortcut": {
        "panel": "设置 · 自定义快捷键",
        "capAlt": "Alt（固定）",
        "capKey": "你按的那颗字母",
        "clear": "清除",
        "command": "要运行的命令",
        "commandList": "在哪儿都成立的命令",
        "rejection": "被退回的原因"
      },
      "pinnedCommands": {
        "panel": "设置 · 快捷命令",
        "slotFirst": "槽位 1",
        "slotSecond": "槽位 2",
        "slotThird": "槽位 3",
        "palette": "命令窗口",
        "paletteList": "会随使用重排的列表",
        "pinnedRow": "固定的那三颗"
      },
      "replayGain": {
        "panel": "设置 · ReplayGain 模式",
        "modeOff": "关闭",
        "modeTrack": "按单曲",
        "modeAlbum": "按专辑",
        "panelTab": "控制面板 · 来源页",
        "panelSummary": "这首歌的增益标签",
        "panelModes": "同样那三个模式"
      },
      "importExport": {
        "panel": "设置 · 备份与导入",
        "copy": "这一组做什么",
        "themeChips": "带哪个主题",
        "textarea": "配置文本",
        "exportButtons": "复制出去",
        "importButton": "导入",
        "dialog": "确认导入",
        "dialogGroups": "按组列出的改动",
        "dialogDerived": "你没挑、却会被改掉的"
      },
      "pages": {
        "grid": "海报墙",
        "gridView": "集合网格",
        "player": "播放器",
        "lattice": "Lattice",
        "help": "帮助",
        "settings": "设置",
        "commandPalette": "命令面板"
      },
      "playerPage": {
        "lyrics": "歌词与可视化",
        "bar": "底部控制条",
        "toggle": "侧边手柄",
        "track": "隐藏的滑轨",
        "panel": "控制面板",
        "palette": "命令窗口"
      },
      "commandPalette": {
        "input": "输入行",
        "results": "结果列表",
        "firstResult": "当前结果"
      },
      "latticeChrome": {
        "card": "展开的海报",
        "chrome": "播放控制条",
        "play": "播放 / 暂停",
        "prev": "上一首",
        "slotPrimary": "第一个槽位",
        "slotSecondary": "第二个槽位",
        "next": "下一首",
        "time": "时间",
        "openPlayer": "回到播放页",
        "progress": "进度条",
        "bottomBar": "底部控制条"
      },
      "bravaisWall": {
        "page": "Bravais 墙",
        "wall": "磁贴墙",
        "seam": "信息条",
        "seamTab": "另一个页签",
        "song": "歌曲",
        "collection": "集合",
        "artist": "歌手",
        "special": "特殊集合",
        "fm": "私人 FM",
        "origin": "被点的集合",
        "focusSong": "一首歌",
        "block": "它所在的那一块",
        "focusCard": "聚焦卡",
        "focusPlay": "立即播放",
        "focusQueue": "加入队列",
        "focusEnter": "进入播放视图",
        "window": "窗",
        "tools": "墙面工具",
        "toolsPanel": "工具面板",
        "toolsLattice": "前往 Lattice",
        "toolsLook": "透光"
      },
      "transition": {
        "panel": "设置 · 过渡",
        "enable": "过渡总开关",
        "crossfade": "Folia Crossfade",
        "automix": "Folia Automix",
        "badge": "运行状态",
        "detail": "当前模式的参数",
        "notice": "缺条件时的提示"
      },
      "libraryWatch": {
        "panel": "设置 · 本地文件夹监视",
        "enable": "自动扫描",
        "roots": "监视中的文件夹",
        "recheck": "重新检查文件夹"
      },
      "queueSettings": {
        "panel": "设置 · 播放行为",
        "append": "追加到末尾",
        "next": "追加到下一首"
      },
      "lyricsSource": {
        "panel": "设置 · 歌词",
        "autoBest": "自动使用最佳歌词",
        "priorityLocal": "本地优先",
        "priorityOnline": "在线优先",
        "globalOffset": "全局时间偏移"
      },
      "gridHotkey": {
        "panel": "设置 · 海报墙",
        "toggle": "海报墙上用 S 键打开命令窗口"
      },
      "lyricExport": {
        "panel": "导出歌词缓存",
        "card": "导出选项",
        "scope": "导出范围",
        "formats": "导出格式",
        "names": "文件命名",
        "run": "开始导出"
      },
      "queueCommand": {
        "panel": "队列窗口",
        "input": "输入行",
        "suggestions": "歌手 / 专辑建议",
        "rows": "匹配到的歌曲",
        "preview": "批量操作预览"
      },
      "desktop": {
        "page": "桌面",
        "mainWindow": "主窗口",
        "trayIcon": "托盘图标",
        "trayMenu": "托盘菜单",
        "remoteWindow": "遥控窗口"
      },
      "onboarding": {
        "page": "一页界面",
        "component": "指针停着的那个组件",
        "capsule": "悬停提示",
        "touchBulb": "触屏上的思索按钮"
      },
      "gridActionButton": {
        "page": "集合页",
        "button": "右下角那颗按钮",
        "track": "隐藏的滑轨",
        "list": "曲目列表",
        "slideTarget": "本页筛选"
      },
      "gridViewCards": {
        "page": "集合页网格",
        "cards": "歌曲卡片",
        "card": "当前卡片",
        "title": "歌名",
        "pencil": "手动匹配",
        "actions": "播放与加入队列",
        "remove": "移除"
      },
      "localFolderActions": {
        "panel": "来源专属动作",
        "playAll": "全部播放",
        "reimport": "重新导入",
        "organize": "整理歌曲信息",
        "remove": "从曲库移除"
      },
      "localGridControls": {
        "panel": "本地曲库控制区",
        "tabs": "本地集合类型",
        "folders": "文件夹",
        "playlists": "本地歌单",
        "imports": "导入文件",
        "refresh": "刷新曲库",
        "playlistImport": "导入歌单"
      },
      "onlineCollectionActions": {
        "panel": "在线集合操作",
        "playAll": "全部播放",
        "addQueue": "加入队列",
        "addPlaylist": "加入歌单",
        "providerAction": "来源专属操作",
        "destructiveAction": "删除或移除"
      },
      "localGridMap": {
        "page": "本地集合地图",
        "back": "返回 Grid3D",
        "title": "批量选择面板开关",
        "cards": "本地集合",
        "panel": "批量选择面板",
        "tree": "目录树",
        "row": "目录及其子目录",
        "checkbox": "选择状态",
        "expand": "展开目录",
        "rootActions": "根目录维护操作",
        "actions": "操作所选曲目"
      },
      "localTrackList": {
        "panel": "曲目列表",
        "direction": "升序 / 降序",
        "sortMenu": "排序方式",
        "menu": "排序菜单"
      },
      "grid3dCardStyle": {
        "panel": "设置 · 歌单卡片样式",
        "image": "纯图片封面",
        "card": "拍立得卡片"
      },
      "gridViewCard": {
        "panel": "设置 · 网格卡片",
        "fullBleed": "全画幅封面",
        "square": "正方形卡片",
        "minScale": "卡片最小尺寸",
        "minOpacity": "卡片最小透明度",
        "reset": "恢复默认衰减"
      },
      "latticeStyle": {
        "panel": "设置 · 播放页 · 视图",
        "vignette": "边缘暗角",
        "tint": "海报聚焦叠色",
        "customColor": "强制使用自定义颜色",
        "picker": "取色器",
        "intensity": "叠色强度"
      },
      "lyricsAnimation": {
        "panel": "设置 · 歌词动画",
        "entry": "歌词动画样式",
      },
      "themeSettings": {
        "panel": "设置 · 主题",
        "themePark": "打开 Theme Park",
        "presetDefault": "内置预设",
        "presetCustom": "自定义配色",
        "source": "主题生成来源",
        "followSystem": "明暗模式",
        "preferCustom": "优先使用自定义主题",
        "autoSwitch": "主题自动切换"
      },
      "sidePanel": {
        "queueShuffle": "打乱队列",
        "modeRow": "歌词样式那一行",
        "modeName": "中间那颗按钮",
        "modeList": "全部样式",
        "modeListFooter": "更多设置",
        "fmMode": "电台模式",
        "fmTransport": "上一首 / 播放 / 下一首",
        "panel": "控制面板",
        "cover": "当前封面",
        "tabs": "标签页",
        "body": "当前标签页内容",
        "sourceInfo": "来源信息",
        "sourceGain": "音频增益",
        "sourceLyrics": "歌词",
        "sourceOffset": "时间轴偏移",
        "sourceLyricsFile": "导入 / 导出歌词",
        "sourceFileDialog": "歌词文件窗口",
        "coverSettings": "打开设置",
        "coverHome": "回到首页",
        "coverPlaylist": "加入歌单",
        "credits": "歌名、歌手、专辑",
        "header": "这首歌",
        "coverActions": "这一行动作",
        "coverLike": "喜欢",
        "coverSource": "播放自",
        "fmDiscard": "丢弃",
        "fmLike": "喜欢"
      },
      "playerBar": {
        "play": "播放 / 暂停",
        "title": "曲目标题",
        "progress": "进度条",
        "primarySlot": "第一个槽位",
        "secondarySlot": "第二个槽位",
        "bar": "底部控制条",
        "slots": "两个槽位",
        "bottomUiSettings": "设置 · 控制栏",
        "picker": "设置里的选择器",
        "queue": "播放队列",
        "volumeSurface": "音量面板"
      },
      "panelSlide": {
        "toggle": "面板开关",
        "track": "隐藏的滑轨",
        "threshold": "触发线",
        "palette": "命令面板"
      },
      "grid": {
        "help": "Folia 与帮助入口",
        "tabs": "内容来源页签",
        "search": "歌曲搜索",
        "map": "全部集合地图",
        "sourceActions": "来源专属操作",
        "shelf": "3D 海报轨道",
        "focusedCard": "当前海报",
        "focusedCopy": "当前集合信息"
      },
      "lattice": {
        "back": "返回",
        "wall": "播放队列海报墙",
        "poster": "队列海报",
        "expanded": "展开的歌曲",
        "chrome": "播放控制",
        "tools": "Lattice 工具",
        "toolsPanel": "工具面板"
      },
      "gridView": {
        "back": "返回上一级",
        "title": "集合标题与信息开关",
        "cards": "蜂窝歌曲网格",
        "card": "当前歌曲卡片",
        "info": "集合信息与批量操作",
        "filter": "本页筛选"
      },
      "signIn": {
        "page": "主页",
        "homeButton": "登录",
        "pill": "切换在线音乐平台",
        "window": "登录窗口",
        "platforms": "平台",
        "tile": "二维码",
        "steps": "步骤",
        "account": "账号",
        "actions": "切换与退出",
        "signedInRow": "已登录的平台"
      },
      "lyricMatch": {
        "window": "匹配歌词",
        "header": "正在匹配的歌",
        "sources": "歌词来源",
        "search": "搜索",
        "results": "搜索结果",
        "chosen": "选中的这一条",
        "lyrics": "歌词预览",
        "save": "保存",
        "switches": "封面、元数据、歌词",
        "noMatch": "不使用在线数据"
      }
    },
    "targets": {
      "bravaisSeam": "Bravais 信息条",
      "queueShuffle": "随机播放在哪",
      "audioEqualizer": "音频效果器窗口",
      "visPlayground": "歌词样式窗口",
      "lyricStyle": "歌词样式",
      "themePark": "Theme Park",
      "customShortcutSettings": "自定义快捷键",
      "pinnedCommands": "快捷命令",
      "replayGainSettings": "音频增益（ReplayGain）",
      "importExportSettings": "备份与导入",
      "playerBar": "底部控制条",
      "panelSlide": "侧边面板开关",
      "gridPage": "海报墙页面",
      "gridViewPage": "集合网格页面",
      "playerPage": "播放器页面",
      "commandPalette": "命令窗口",
      "latticeChrome": "展开海报的播放控制",
      "lyricsAnimationSettings": "歌词动画设置",
      "themeSettings": "主题与歌曲主题",
      "sidePanel": "右侧控制面板",
      "gridActionButton": "海报墙操作按钮",
      "gridViewEditMode": "集合页编辑模式",
      "localFolderActions": "本地集合的操作",
      "localMetadataMatch": "手动匹配歌曲信息",
      "localTrackSorting": "本地曲目排序",
      "localGridControls": "本地曲库分类与导入",
      "onlineCollectionActions": "在线集合操作",
      "localGridMapPage": "本地 GridMap",
      "localGridMapDirectoryTree": "GridMap 目录树",
      "grid3dCardStyle": "歌单卡片样式",
      "gridViewCardSettings": "网格卡片设置",
      "latticeStyleSettings": "拼贴墙外观",
      "panelCoverActions": "封面下面那一行按钮",
      "panelCoverTab": "面板 · 封面页",
      "panelSourceTab": "面板 · 来源页",
      "lyricExport": "歌词导出",
      "panelControlsTab": "面板 · 控制页",
      "panelQueueTab": "面板 · 播放列表页",
      "panelAccountTab": "面板 · 账户页",
      "latticePage": "Lattice 页面",
      "bravaisWall": "Bravais 墙",
      "helpPage": "认识 Folia",
      "ponderBasics": "思索怎么用",
      "foliaTransport": "播放控制与媒体键",
      "foliaShortcuts": "常用快捷键",
      "foliaDesktop": "桌面端独有功能",
      "queueCommandSurface": "队列窗口",
      "transitionSettings": "过渡与自动混音",
      "localLibraryWatch": "本地文件夹监视",
      "queueSettings": "加入队列的默认行为",
      "lyricsSettings": "歌词来源与偏移",
      "gridPaletteHotkey": "网格上的 S 键",
      "settingsPage": "设置页面",
      "signIn": "登录在线音乐平台",
      "lyricMatch": "匹配歌词窗口"
    },
    "scenes": {
      "bravaisSeamLevels": "三档：完整、书脊、折叠",
      "bravaisSeamCollection": "集合与歌手页的信息条",
      "bravaisSeamHomeNavigation": "首页：页签、二级切换与直达",
      "bravaisSeamHomeDock": "账户入口与工具格",
      "bravaisSeamFilter": "过滤当前页，和搜索不是一回事",
      "bravaisSeamTools": "右下角的墙面工具",
      "queueShuffleNoMode": "没有随机模式，只有打乱队列",
      "queueShuffleCommand": "用命令打乱",
      "queueShuffleSlot": "放进控制条按钮",
      "queueShufflePanel": "队列面板上的按钮",
      "queueShufflePinned": "固定在命令窗口底部",
      "visPlaygroundCommon": "四页各管什么，以及「通用」里有什么",
      "visPlaygroundVisuals": "样式与背景",
      "visPlaygroundSubtitle": "字幕",
      "lyricStylePerStyle": "每种样式有自己的设置",
      "lyricStyleMonet": "莫奈：隐藏右侧部件",
      "lyricStyleCombine": "背景和歌词样式各选各的",
      "lyricStyleSubtitle": "通用底部副字幕",
      "sidePanelControlsModeList": "全部样式藏在中间那颗按钮后面",
      "sidePanelQueueRadio": "私人 FM 下这一格是电台",
      "audioEqualizerPresets": "总开关、预设，和你自己的两个槽",
      "audioEqualizerSilentWrite": "拖一下就覆写一个槽",
      "audioEqualizerEffects": "底下那条效果链",
      "visPlaygroundLayout": "左边是真的在跑的预览",
      "visPlaygroundHotspots": "三块你看不见的区域",
      "visPlaygroundSections": "右栏那四页",
      "themeParkTarget": "你在编辑哪一份主题",
      "themeParkColors": "亮和暗是两份配色",
      "themeParkSaving": "保存为什么按不动",
      "customShortcutKey": "Alt 是印死的，你挑的是字母",
      "customShortcutCommand": "这份列表为什么更短",
      "pinnedCommandsSlots": "三个槽位",
      "pinnedCommandsVsRecent": "固定不等于「最近用过」",
      "replayGainModes": "三个模式",
      "replayGainMirrored": "同一个值，两处入口",
      "importExportScope": "它到底带走了什么",
      "importExportExport": "导出",
      "importExportConfirm": "导入会先问过你",
      "gridPageOverview": "海报墙如何组织",
      "gridPageNavigation": "移动、打开与搜索",
      "gridPageStructure": "页头的每个入口",
      "gridPageTabs": "切换来源与专属操作",
      "gridPageCards": "移动焦点并打开集合",
      "gridPageMap": "用地图总览全部集合",
      "gridPageSearch": "搜索歌曲而不是筛选海报",
      "gridPageKeyboard": "Grid3D 的全部页面快捷键",
      "gridViewPageOverview": "进入一个集合以后",
      "gridViewPageActions": "操作歌曲卡片",
      "gridViewPageStructure": "集合页的完整结构",
      "gridViewPageNavigation": "拖动与键盘移动",
      "gridViewPageInfo": "集合信息和批量操作",
      "gridViewPageFilter": "筛选当前集合",
      "gridViewPageActivate": "打开或播放卡片",
      "playerPageLayout": "页面上有什么、各在哪",
      "playerPageOpenPalette": "叫出命令窗口",
      "playerPageRunCommands": "在命令窗口里执行",
      "playerPageShuffle": "常见问题：怎么随机播放",
      "commandPaletteSearch": "搜出来，回车执行",
      "commandPaletteArgument": "给命令带参数",
      "commandPaletteExecuteMode": "冒号进执行模式",
      "latticeChromeLayout": "这条控制条上有什么",
      "latticeChromeSharedSlots": "中间两个和底栏是同一份",
      "latticeChromeBottomBar": "卡片看不见时底栏顶上来",
      "sidePanelCoverTab": "封面页",
      "sidePanelControlsTab": "控制页",
      "sidePanelQueueTab": "播放列表页",
      "sidePanelAccountTab": "账户页",
      "lyricsAnimationEntry": "换歌词动画在哪儿换",
      "themeSettingsPresets": "预设与自定义",
      "themeSettingsSource": "配色从哪来",
      "themeSettingsAuto": "配色什么时候自己变",
      "gridActionButtonList": "点一下开曲目列表",
      "gridActionButtonSlide": "往左滑是第二个动作",
      "gridViewEditModeCards": "进去之后卡片变成什么样",
      "gridViewEditModeRename": "改名什么时候才算数",
      "localFolderActionsList": "这一列有什么取决于你打开的是什么",
      "localFolderActionsMaintenance": "重扫与整理歌曲信息",
      "localFolderActionsDelete": "红色那颗会删东西",
      "localMetadataMatchReveal": "三重条件才出现的一颗铅笔",
      "localTrackSortingFields": "只有本地文件夹能排序",
      "localGridControlsSources": "文件夹、专辑、艺术家与本地歌单",
      "localGridControlsMaintenance": "导入与刷新本地曲库",
      "onlineCollectionActionsCommon": "在线集合共用的操作",
      "onlineCollectionActionsProvider": "操作取决于当前来源",
      "localGridMapStructure": "本地集合地图",
      "localGridMapBatch": "选择集合并操作其中曲目",
      "localGridMapFilter": "筛选与返回",
      "localGridMapDirectoryHierarchy": "目录层级",
      "localGridMapDirectorySelection": "选择子树或仅直属曲目",
      "grid3dCardStyleOptions": "两种卡片长什么样",
      "gridViewCardCover": "封面怎么占这张卡",
      "gridViewCardFalloff": "离中心越远，衰减到多少",
      "latticeStyleTint": "暗角与海报叠色",
      "latticeStyleCustomColor": "换成一个固定颜色",
      "panelSourceTabWhere": "这一格什么时候才在",
      "panelSourceTabContents": "歌词、时间轴与增益",
      "panelSourceTabExport": "导入与导出歌词文件",
      "lyricExportScope": "导出哪些、哪一份",
      "lyricExportFormats": "两种格式与文件名",
      "panelCoverActionsReveal": "这首歌的三个动作",
      "panelCoverActionsRight": "右端：首页和设置",
      "sidePanelStructure": "面板里有什么",
      "sidePanelTabs": "换标签页",
      "latticePageOverview": "Lattice 如何组织",
      "latticePageStructure": "队列墙、返回与工具",
      "latticePageNavigation": "在无限墙上移动焦点",
      "latticePagePoster": "展开海报并控制播放",
      "latticePageTools": "定位、队列与灯光",
      "latticePageKeyboard": "Lattice 的完整键盘操作",
      "bravaisWallStructure": "一面墙，一道缝",
      "bravaisWallPan": "拖动与滚轮",
      "bravaisWallTiles": "认出磁贴的种类",
      "bravaisWallOpen": "翻牌换层",
      "bravaisWallFocus": "聚焦卡",
      "bravaisWallLook": "透光与 Lattice",
      "helpPageOverview": "思索复杂操作和组件",
      "helpPageCommandPalette": "命令面板",
      "helpPageCommandExamples": "常用操作示例",
      "foliaDesktopWallpaper": "壁纸模式",
      "foliaDesktopTray": "系统托盘",
      "foliaDesktopRemote": "遥控窗口",
      "transitionSettingsEnable": "总开关与两种模式",
      "transitionSettingsFallback": "选了不等于在跑",
      "localLibraryWatchRoots": "监视列表与失效的那一行",
      "queueSettingsBehavior": "加到末尾还是加到下一首",
      "lyricsSettingsSource": "歌词从哪来",
      "lyricsSettingsOffset": "两个偏移量",
      "gridPaletteHotkeyOwner": "网格上的 S 归谁",
      "queueCommandFacets": "@ 把范围收窄",
      "queueCommandBatch": "-- 对筛出来的全部下手",
      "helpPagePonder": "你已经在思索里了",
      "helpPageWholePage": "整页的教程，以及触屏怎么办",
      "helpPageTransport": "不用切回来也能控制播放",
      "helpPageShortcuts": "四个最常用的快捷键",
      "helpPageDocs": "官方文档",
      "helpPageHintSettings": "看够了就把提示关掉",
      "settingsPageOverview": "设置按用途分组",
      "settingsPageDirectNavigation": "从命令直接跳转",
      "playerBarBasics": "这条胶囊上有什么",
      "playerBarHeight": "整条的高度可以改",
      "playerBarSlots": "右边两个位置可以换",
      "playerBarShuffle": "随机只洗一次牌",
      "playerBarVolume": "音量在命令面板里",
      "panelSlideToPalette": "滑动打开命令面板",
      "panelSlideEdgeHotspot": "从边缘唤出手柄",
      "panelSlideKeyboard": "用键盘打开",
      "signInEntries": "两个入口",
      "signInWindow": "选平台，再登录",
      "signInAccount": "登录之后",
      "lyricMatchSearch": "换来源，重新搜",
      "lyricMatchPick": "挑一条，先看歌词",
      "lyricMatchLocal": "本地歌曲多出来的三个开关"
    },
    "captions": {
      "bravaisSeam": {
        "levelsIntro": "信息条是墙中间裂开的那道缝，这一层的标题、说明和操作都在里面。它有三档：完整、书脊、折叠。",
        "levelsSpine": "点标题区域（引号连同竖排大标题）收成窄窄的书脊，两边的墙跟着合拢；在书脊上点竖排标题，又展开回完整信息条。",
        "levelsFold": "要整条让开，点「⋯ 更多」的最后一项「折叠信息条」。书脊顶上那颗向中间合拢的图标也是折叠。",
        "levelsHidden": "折叠之后墙合成一整面，侧边只留一枚竖排标签，写着这一层的标题。点它回到折叠前那一档。",
        "levelsGlobal": "档位是全局的：收起之后再进别的歌单，信息条照样收着。窗口窄于 900px 时默认是书脊；三档在命令面板里也各有一条命令。",
        "collectionCrumbs": "最上面是 ‹ 返回和面包屑：书库 › 歌手 › 专辑……点哪一项就退回哪一层，中间层多了会折成「…」。下面那道下划线是当前页过滤。",
        "collectionAbout": "大标题下面是这一层的说明：歌单简介、专辑介绍。歌手页这一块是头像、名字和简介，排得像书勒口上的作者简介。正文长了会截断，点一下展开。",
        "collectionActions": "播放全部、加入队列，行尾的星标是收藏（能收藏的集合才有）。歌手页上这两颗只管热门歌曲。",
        "collectionList": "「列表」把信息条加宽成歌曲列表，面包屑多出一级「列表」。悬停一行，墙上同一首的磁贴跟着亮起；单击转到它，双击播放。返回先关列表。",
        "homeTabs": "首页的信息条是一道窄缝：最上面是「书库」和折叠，下面竖排着一级页签——歌单、电台、专辑、本地、Navidrome。",
        "homeFlip": "换页签时整条信息条翻一次，墙也整面换成那一页的内容。键盘上 F6 / Shift + F6 轮换页签。",
        "homeSections": "本地和 Navidrome 多一列二级切换（文件夹、专辑、艺术家、歌单……）。只有选中的那项竖着写出名字，其余只留图标，悬停看全名。切换只换墙上的内容，不进新的一层。",
        "homeShortcuts": "下面那几列竖排小字是直达入口：我喜欢的音乐、私人 FM、全部歌曲……点它和点墙上那张卡一样，私人 FM 直接开播。地方不够时，它们挪进「⋯」。",
        "dockAccount": "工具格正上方是账户入口：登录了是头像和昵称，没登录时是「连接在线平台」。点它打开登录窗口，换平台、登录、退出都在里面。",
        "dockTools": "最底下四格：搜索在线平台、设置、队列拼贴（进入 Lattice）和「⋯」。",
        "dockMenu": "其余的都在「⋯」里：这一页签的项在前（过滤当前页、目录、管理隐藏、导入……），分隔线之后是「回到播放页」这类去处。",
        "dockStage": "开着舞台模式时，工具格最上面多一整行「舞台」，点它打开舞台播放器。",
        "filterType": "想在这面墙里找东西，直接在墙上打字：信息条里冒出一道过滤输入位，墙收成以信息条为中心、只剩匹配项的一小片。",
        "filterKeys": "过滤不联网，只收窄眼前这面墙。Esc 有词先清空，再按一次结束输入；↓ 或 Enter 把焦点交给墙上第一张。",
        "filterSearch": "放大镜才是搜索在线平台（首页上也可以按 /）：整条信息条换成带框的搜索框，提交之后去搜索页看结果。",
        "toolsQuick": "右下角那颗是墙面工具。顶上一排图标是一次性动作：定位正在播放、打乱队列、为当前歌曲生成主题、播放队列、前往 Lattice、前往播放页；指针停在图标上能看到名字和快捷键。",
        "toolsVolume": "中间是音量，和播放条上的是同一份；点左边的图标静音。",
        "toolsAppearance": "最下面是墙面外观：透光在三档之间轮换，还有海报叠色和开灯 / 关灯。向左滑这颗按钮，直接打开命令面板。"
      },
      "queueShuffle": {
        "noMode": "Folia 不提供传统的随机播放模式，循环按钮也不会切到随机。想随机听，就打乱当前队列。",
        "once": "打乱是一次操作：当前队列原地洗一次牌，之后按新顺序播放。想换个顺序，再打乱一次。",
        "command": "最快的是命令：命令窗口关着、焦点不在输入框时按冒号进入执行模式，再按 r。也可以在命令窗口里搜「打乱队列」。",
        "slot": "常用的话，在设置 · 播放页的「进度条右侧按钮」里选「随机队列」，控制条上就多一颗打乱按钮。",
        "panel": "右侧控制面板的队列页，顶部最右那颗按钮也会打乱队列。",
        "pinSlot": "在设置 · 快捷操作的「快捷命令」里，把「打乱队列」放进任意一个槽位。",
        "pinRow": "它会一直显示在命令窗口底部，打开窗口点一下就行。"
      },
      "audioEqualizer": {
        "enable": "控制页「音频效果器」那一格打开这个窗口。右上角这颗开关管整条处理链；关闭后设置保留，但不再生效。",
        "presets": "这一排前六个是内置预设。每一个同时带着一条均衡曲线和一整套效果链，所以点一下是两样一起换。它们不可编辑。",
        "slots": "同一排里紧跟着的两颗是你自己的：自定义 1 和自定义 2，各存着一条曲线加一套链。",
        "bands": "「频段增益」是十根竖推子，左端 31 Hz 到右端 16 kHz，每根 ±12 dB；一条曲线连着十个把手。",
        "silent": "内置预设不可编辑；拖动推子会切到一个自定义槽并写入新值：正选着某个自定义槽就写进它，否则写进「自定义 1」。重要设置请先切到「自定义 2」。",
        "reset": "清空当前自定义槽，恢复平直曲线和中性效果。内置预设不能编辑，所以选中时按钮是灰的。",
        "effects": "「效果链」在频段之后处理，一共九项：低频截止、高频截止、饱和失真、比特降质、抖晃、黑胶噪声、立体声宽度、空间混响、动态压缩。它们和推子写进同一个自定义槽。",
        "noise": "名字旁边带「噪声」徽章的两项（比特降质、黑胶噪声）自己会加入噪声；徽章不代表它当前已经打开。"
      },
      "lyricStyle": {
        "perStyleOwn": "每种歌词样式都有一组专属设置，只对这个样式生效。右边这一页就是当前样式的那一组。",
        "perStyleSwitch": "换一种样式，预览和这一页设置一起整页换掉。不同样式的设置互不相通；旧样式调好的值会保留，换回去时还在。",
        "perStyleWhere": "在控制页点歌词样式那一行中间，弹出的那一格图底部的「更多设置」会直接打开这一页；也可以用下方按钮。",
        "monetIntro": "莫奈样式：左边歌词，右边肖像。最常见的问题是右边这几样东西怎么关。它们都在莫奈自己的设置里。",
        "monetDescription": "左下的文字是歌曲描述。关闭「显示歌曲描述」即可隐藏。",
        "monetHanger": "肖像上方的圆钮是拖拽调整按钮，用来挪动肖像。位置调好后，在「拖拽调整按钮」里把它隐藏。",
        "monetAudio": "肖像下方是音频图案。在「音频图案」里可以隐藏它，「频谱样式」可以在柱状和线条之间切换。",
        "monetBare": "三项都关掉后，画面只剩歌词和肖像。这些开关只属于莫奈，换到别的样式时不会出现。",
        "combineTwo": "背景和歌词样式是两个独立的选择。控制页里它们是上下两行：「歌词样式」和「背景类型」，各切各的。",
        "combineBackground": "只换背景：歌词样式不动。背景自己的参数在歌词样式窗口的「背景」页。",
        "combineStyle": "再只换歌词样式：刚选的背景留着。任意背景都能配任意歌词样式；只有「静止」样式不渲染背景。",
        "subtitleShared": "多数歌词样式在底部共用这一条副字幕。莫奈、时计和静止把翻译排进自己的版面，不用这一条。",
        "subtitleContent": "它的设置在歌词样式窗口的「字幕」页，对所有使用它的样式一起生效。第二行选择显示翻译、罗马音、罗马音加翻译两行，或不显示。",
        "subtitleBlur": "关闭「非翻译歌词添加模糊效果」，副字幕就不再模糊。",
        "subtitleFont": "关闭「字幕继承歌词字体」后，可以给字幕单独设置字体和字重；「字幕缩放」单独调整字号，随时可用。"
      },
      "visPlayground": {
        "preview": "歌词样式窗口：左边是实时预览，右边是设置栏。预览用的是真实渲染器，改动马上显示。",
        "pause": "预览右上角那颗按钮把画面停在当前这一帧，再点一下继续。调那种只闪一下的效果时用得上，也让预览在你读字的时候不再吃算力。",
        "invisible": "预览上有三块隐藏点击区，没有边框、底色或标签。",
        "three": "指针扫过去它们才显形：顶上一条是背景，中间一大块是歌词动画，底下一条是字幕。",
        "jumps": "点其中一块，右边设置栏就跳到对应那一页。这是这一屏里最快的走法 —— 指着画面上你想改的那部分，而不是去读标签的名字。",
        "four": "设置栏一共四页：歌词动画、背景、通用、字幕。热区指向的就是其中三页，所以标签和画面是同一份清单的两个入口。",
        "common": "只有一个例外：「通用」没有自己的热区，因为它不是画面的一部分 —— 它装的是作用于整屏的那些。那一页只能从这排标签进。",
        "fonts": "「通用」设置歌词字体、字号和字重。字重默认自动，也可手动指定。",
        "previewText": "第一行挑的是预览唱什么。想看看这套字撑不撑得住长句、或者别的文字系统，换一段示例比等一首真歌放到那儿要快。",
        "sectionReset": "标签那一行右端的「默认」只退当前这一页。它不是整个窗口的复位 —— 你在别的页上调过的东西不会被它带走。",
        "animation": "歌词样式在预览下面这一架图里选，点一张就换。样式比一章能讲完的多，值得你自己翻一遍，所以这里不把清单念一遍。",
        "perMode": "「歌词动画」页是当前样式自己的参数；换样式，这一页也跟着换。",
        "background": "「背景」页是同一套做法：先在这一格图里挑背景，再调这个背景。它和歌词样式是两层，各挑各的，任意组合都成立。",
        "subtitleContent": "字幕第二行可选：翻译、罗马音、罗马音在上翻译在下的两行，或不显示。莫奈、时计和静止选两行时只显示翻译。",
        "subtitleLegibility": "下面三行管字幕看不看得清：「字幕透明度」「字幕背景」，以及「非翻译歌词添加模糊效果」。",
        "subtitleFont": "字幕默认跟随歌词字体。关闭后，字幕自己的字体和字重设置才会出现；「字幕缩放」一直都在。"
      },
      "themePark": {
        "which": "标题旁边这一对切换当前编辑的主题：这首歌的 AI 主题，或你保存的自定义主题。两边草稿互不影响，保存只作用于当前选中的那一份。",
        "reset": "重置丢掉的是你这一次改的东西，把草稿退回刚打开时的样子。它不碰已经保存下来的那一份。",
        "twoSides": "亮色和暗色分别保存。切换这一项后，下面的颜色、取色器和 HEX 输入框都会跟着切换。",
        "fourColors": "每面有背景、主文本、强调色和辅助色四种颜色。点一格，它就进到下方的取色器；取色器顶上那行字写着这种颜色用在哪里。",
        "recommended": "最底下「推荐色」那排圆色块里，有几枚是从当前封面算出来的，其余是这套主题自己的颜色。点一枚直接填进正在选中的那一种。",
        "blocked": "保存有时是灰的，而你正看着的这一页上没有任何地方说明原因。原因是主题要有名字，而且亮暗两面都要有，才存得下去。",
        "nameLivesHere": "主题名称和描述在「信息」页；名称没填时，这个标签旁边有一个小圆点。保存按钮点不了，先去那里填写名称。",
        "applies": "保存自定义主题后，应用会立即切换到它。"
      },
      "customShortcut": {
        "alt": "左边固定为 Alt，右边录入字母。只支持 Alt + 字母。",
        "capture": "点第二颗键帽开始录入，下次按下的字母会绑定。修饰键忽略，按 Esc 取消。",
        "taken": "已被占用的字母不能绑定，红字会说明原因。S、Ctrl+K 和其他命令的快捷键都算占用。",
        "clear": "录上之后键帽旁边会多一颗小小的 ✕，按它就把绑定清掉；在你重新录一颗之前，这条快捷键什么都不运行。",
        "filtered": "下拉框只列出可在所有页面使用的命令；依赖特定页面或面板的命令不会出现。",
        "goesQuiet": "快捷键执行时还会再次检查条件。命令失效或按键被占用时，它不会改做别的事，只会失效。"
      },
      "pinnedCommands": {
        "slots": "三个下拉槽按顺序显示在命令窗口下方，默认是上一首、下一首和队列。",
        "unique": "同一命令只能放一个槽位；空槽保留空位，三个都空时整排隐藏。",
        "where": "这三个下拉配出来的东西长在这儿：命令窗口下面一排三颗固定按钮，位置永远不变。点一下就执行，不用打字也不用翻。",
        "recent": "上面的列表和固定按钮是两套机制。列表按最近使用情况重排，固定按钮始终保持原位。",
        "empty": "所以两者各管各的用处：列表应付你临时要用的东西，那三颗应付你希望每次都在同一个位置的东西。"
      },
      "replayGain": {
        "off": "关闭后不使用文件里的 ReplayGain 标签，每首歌按原始音量播放。",
        "trackAlbum": "按单曲会让不同歌曲的响度更接近；按专辑会保留专辑内部的强弱变化。两种模式都只改播放音量，不改文件。",
        "sameValue": "控制面板来源页的三个按钮与这里共用同一个 ReplayGain 设置，改一处会同步另一处。",
        "summary": "来源页还会显示这首歌自带的单曲和专辑增益值；没有标签时写着「未检测到 ReplayGain」。"
      },
      "importExport": {
        "scope": "导出外观设置：主题、歌词动画、渲染参数、字幕、字体、背景和卡片。",
        "notBackup": "它只备份外观：主题、歌词动画、渲染参数、字幕、字体、背景和卡片。歌单、曲库、播放设置、快捷键和账号不在里面。",
        "themeChoice": "导出前选择是否带主题：AI 主题、自定义主题，或不包含主题。只想分享视觉设置时选「不包含主题」。",
        "clipboard": "两个按钮都是复制：一个复制短码，一个复制可读 JSON。两者都是完整配置。",
        "paste": "导入走的是同一个框的反方向：把别人那串码粘进来，右边那颗导入就亮了。",
        "plan": "导入前会按组列出变更，并显示修改前后的值。每一项都可以单独取消。",
        "derived": "有些改动不会写在配置里，但会随导入发生：例如切到自定义主题、删除已上传字体。它们不能单独取消，只能取消对应的主改动。"
      },
      "onboarding": {
        "overviewCtrlG": "第一步：在任何页面按下 Ctrl + G，就能打开这一页的思索。",
        "overviewWholePage": "思索会一步一步讲解当前页面：上面有什么，各在哪里，可以怎么操作。你现在看的就是一段思索。",
        "overviewHover": "第二步：有些按钮和组件比较复杂。把指针停在上面，旁边会出现思索提示。",
        "overviewHold": "第三步：看到提示后，按住 G 不放。进度走满后，会打开这个组件的思索；提前松手则取消。",
        "overviewSettings": "不需要这些提示时，可以在设置中关闭。点下方按钮可直接打开设置。",
        "overviewCommandPalette": "在任何界面，按 Ctrl + K 呼出命令面板。命令面板是应用的主要操作方式。使用命令面板可以在任何页面进行常用功能调整。",
        "overviewExampleVolume": "例如在任何地方调节音量。",
        "overviewExampleQueue": "或者拉起队列搜索。",
        "overviewExampleFilter": "或者直接对当前歌单进行二次检索，然后送入播放队列。",
        "overviewDocs": "更多功能和说明，请查看官方文档站点了解。",
        "here": "这是当前页面的思索教程，不是视频。进度条可拖，方向键切换关键帧，Space 暂停，Esc 退出。",
        "hover": "悬停在按钮或组件上会出现提示。按住 G，进度走满后打开对应教程。",
        "hold": "按住不放，进度走满后打开教程；提前松手会取消。",
        "wholePage": "不想找组件也行：在任意页面上按住 Ctrl + G，打开的是整页的教程 —— 这一页上有什么、各在哪、能怎么操作。",
        "touchBulb": "触屏没有悬停，所以用右上角灯泡打开本页教程。它出现几秒后会收起，点右上角可再次唤出。鼠标看不到它是正常的。",
        "mediaKeys": "Windows 用 SMTC，Linux 用 MPRIS；系统媒体键和媒体浮窗都可控制或显示当前歌曲。",
        "inAppTransport": "Space 播放/暂停，{{mod}} + ←/→ 切歌；播放页 ←/→ 快退或快进 5 秒。更多操作用命令窗口。",
        "shortcutK": "{{mod}} + K 打开命令窗口，功能和设置都可直接搜索。",
        "shortcutP": "{{mod}} + P 打开播放队列；输入行可筛选，也支持 @artist: 等条件。",
        "shortcutB": "{{mod}} + B 打开 Lattice；已在 Lattice 时返回。",
        "shortcutG": "Ctrl + G 就是刚才那一下：打开当前页面的思索教程。任何时候迷路了，先按它。",
        "hintSettings": "可在设置 · 通用关闭思索提示，或只提示未看过的区域。下方按钮可直接打开设置。",
        "docs": "这四章只是入门。命令、快捷键、在线来源、本地曲库、可视化和主题见文档站。"
      },
      "pages": {
        "grid": "这是浏览用的海报墙：搜索和歌单导航在卡片上方，选中一张卡片就会进入它的歌曲列表。",
        "gridNavigation": "滚动、滑动或用方向键在卡片间移动，然后选中当前卡片进入其中。",
        "gridSearch": "网格处于当前页面时直接输入文字即可筛选本页内容；按 Esc 关闭筛选。",
        "gridHelp": "左侧齿轮打开帮助页；有新版本时，更新提示也会出现在这里。Help 内仍可打开版本更新说明和本页 Ponder。",
        "gridTabs": "中间页签切换歌单、电台、专辑、本地库、Navidrome 与 Stage。Lattice 图标只在已有播放队列时出现。",
        "gridSearchBox": "右侧是跨当前来源的歌曲搜索。输入后按 Enter 会进入搜索工作台；它不会筛选下方的集合海报。",
        "gridTabResult": "切换页签后，下方 3D 轨道会换成该来源的集合，并记住各来源最后聚焦的位置。",
        "gridSourceActions": "这一组只在当前来源需要时出现，例如本地库的导入、刷新和播放列表导入，或服务器库的重新加载。",
        "gridCardMove": "拖动、滚轮或左右方向键移动轨道。点非中央海报只会把它移到中央，不会立刻打开。",
        "gridCardOpen": "再次点击中央海报，或按 Enter，才进入集合 GridView；底部文字始终描述当前中央海报。",
        "gridMap": "点顶部「全部」打开 GridMap 查看所有集合；{{mod}} + F 或直接输入可筛选集合。",
        "gridSearchResult": "提交右上角搜索后会打开独立搜索工作台，结果按歌曲列出，可播放、打开艺人/专辑或加入队列。",
        "gridCardKeys": "← / → 切换中央海报，Enter 打开当前集合；滚轮和水平拖动执行同样的焦点移动。",
        "gridPageKeys": "Tab / Shift + Tab 切换页签；{{mod}} + K 命令；{{mod}} + B 进 Lattice（需有队列）；Ctrl + G 本页 Ponder。",
        "gridView": "集合网格展示刚才打开的卡片所包含的歌曲、专辑或艺人。返回时会回到上一级，并保留原来的位置。",
        "gridViewActions": "选中卡片可以播放或继续进入。页面操作区还会按集合能力提供全部播放、加入队列、编辑等动作。",
        "gridViewBack": "左上角返回按钮退出当前集合，并清理这次进入使用的导航记录。Esc 在没有更内层状态时也会返回。",
        "gridViewTitle": "中央标题显示集合名称和说明。有信息面板的集合可点击标题，展开或收起左侧详情。",
        "gridViewCards": "歌曲以可拖动的蜂窝网格铺开；这不是规则行列列表，卡片位置会围绕当前焦点重新组织。",
        "gridViewPan": "在空白处拖动整片蜂窝网格；触摸屏同样可拖。卡片内的按钮和艺人/专辑链接不会误触发平移。",
        "gridViewFocus": "方向键按空间方向寻找相邻卡片并把它带入焦点；当前焦点也会被记住，返回后不会跳回开头。",
        "gridViewInfo": "点击标题打开信息面板：封面、创建者和说明在上方，全部播放、加入队列以及编辑、重扫、导出等来源专属动作在下方。",
        "gridViewFilter": "{{mod}} + F 或直接输入打开筛选；--play 播放结果，--add 加入队列；Esc 清空并关闭。",
        "gridViewActivate": "点卡片只会把它移到中央；播放用卡片上的播放键，旁边是加入队列。编辑模式下改为右上角的移除按钮。",
        "gridViewKeys": "Enter 激活当前卡片；Esc 依次关闭内层状态、清除焦点，最后返回上一级。",
        "playerLayout": "播放页全屏显示歌词和可视化；入口只有底部控制条、右侧手柄和展开后的面板。",
        "playerLyrics": "中间这块是歌词与可视化。它不是控件：点它等于点背景，只切换控制条的显隐，不会暂停。",
        "playerBarWhere": "控制条浮在屏幕底部正中，不贴边。左端是播放/暂停，中间是歌名和进度条，右端两个位置放什么由你决定。",
        "playerToggleWhere": "侧边手柄贴在屏幕右缘，底边和控制条对齐。它是一颗圆按钮，按一下展开右侧控制面板。",
        "playerPanelWhere": "面板从手柄上方展开，贴着右侧。打开时是这首歌的封面页，最底下一排是封面、控制、播放列表、账户等标签页。",
        "playerPaletteSlide": "手柄背后还藏着一条向左的滑轨。按住手柄往左拖，越过判定线再松手，打开的是命令窗口，不是面板。",
        "playerPaletteOpened": "命令窗口从屏幕上方落下，水平居中。Folia 把「找功能」这件事全部收在这里。",
        "playerPaletteOtherWays": "{{mod}} + K 可随时打开命令窗口。播放页焦点不在输入框时，按 S 也可以；触屏先点右缘唤出手柄。",
        "playerCommandFilter": "窗口开着就直接打字，它按名字、别名和关键词一起筛。↑↓ 选，Enter 执行 —— 不必先想清楚这条命令归在哪一类。",
        "playerCommandArgument": "需要参数的命令不会立刻跑。打完命令名按空格，它收成输入行里的一枚标签，光标留在后面等你补参数，补完再 Enter。",
        "playerExecuteCloseFirst": "执行模式要在命令窗口关闭时进入。先按 Esc 关掉窗口：窗口开着时按冒号，只会把冒号打进输入框。",
        "playerExecuteMode": "回到播放页，焦点不在输入框时按冒号，命令窗口会直接以执行模式打开。进入后按 r/v/o/h 执行命令。",
        "playerShuffleNoSwitch": "Folia 没有常驻的随机播放开关；它是一次操作，按下后会打乱当前队列。",
        "playerShuffleHow": "播放页按冒号进入执行模式，再按 r 打乱队列；再次执行可换顺序。",
        "playerShuffleSlot": "如果你常用它，把「随机队列」放进控制条右边那两个位置之一，以后按一下就行。",
        "lattice": "Lattice 把整条播放队列铺成一面海报墙。你可以在墙上移动查看队列，并选中海报来操作那首歌。从探索页打开时，铺开的是探索页的专辑、歌单、歌手和歌曲。",
        "latticeWall": "Lattice 将队列铺成不规则海报墙，同一首歌可重复出现；当前歌曲显示编号和状态。",
        "latticeBack": "左上角返回；{{mod}} + B 关闭 Lattice。Esc 先收起展开内容或清除焦点，再按一次返回。",
        "latticePan": "在墙面拖动或滚轮平移相机，海报会随视口动态出现；拖动结束后的惯性不会改变播放队列顺序。",
        "latticeFocusKeys": "方向键从视口中央选择最近海报，再按空间方向移动焦点，并自动平移相机让目标可见。",
        "latticePosterOpen": "点击或按 Enter 展开海报。当前歌曲展开后显示同步歌词；其他歌曲展开后显示标题与播放入口，队列本身不会被重排。",
        "latticeChrome": "展开海报显示播放、额外槽位、时间、进度和返回 Player；触屏点海报，键盘按 Space 显示或隐藏控制条。",
        "latticeTools": "右下角工具和资料库墙是同一套：顶上一排图标是聚焦当前歌曲、打乱队列、生成主题、播放队列、回到主页和前往播放页，下面是音量、切歌时自动跟随、灯光开关与快捷键说明；向左滑这个按钮会打开命令面板。",
        "latticeLights": "灯光关闭后海报退暗，只保留必要层次；这是显示设置，不会暂停播放或修改队列。",
        "latticePosterKeys": "收起时 Enter/Space 展开；展开后 Enter 播放/暂停，Space 显示控制，Esc 收起。",
        "latticePageKeys": ": + C 当前歌曲；{{mod}} + P 队列；{{mod}} + B 返回；{{mod}} + K 命令；方向键移动。",
        "help": "Folia 分开处理浏览、播放、命令和设置。Ctrl+G 说明当前页面，有特殊操作的组件也有独立教程。",
        "helpCommands": "{{mod}} + K 可以搜索全部命令和设置。对于藏得较深的选项，直接搜名称通常比记住它在哪一级更快。",
        "helpOperatingModel": "网格选歌，Player 或 Lattice 播放；底部控制条负责播放，帮助和设置覆盖当前页面。",
        "settings": "左侧按界面、音乐、应用和高级分组列出类别；右侧显示当前类别里的具体设置。",
        "settingsDirectNavigation": "不必逐层翻找：在命令面板搜索设置名称，Folia 会直接打开对应分组并滚到准确位置。"
      },
      "playerBar": {
        "basicsAutoExpand": "暂停且不在首页时，控制条会自动展开。恢复播放或回到首页后，它会收起。",
        "basicsIntro": "播放控制只有这一条胶囊；上一首、下一首、随机、循环和音量都不常驻。",
        "basicsPlay": "整条上唯一永远在的按钮是播放 / 暂停。宽屏时它在最左端；窄到一行放不下时，它落到第二行正中，两个槽位分列两侧。",
        "basicsTitle": "悬停歌名，两侧会显示上一首和下一首；点箭头切歌。",
        "basicsProgress": "进度条就地拖动或点击跳转。点胶囊其他任何地方不是暂停，而是进入播放页；在 Lattice 上则是把视野拉回当前这首。",
        "basicsSlots": "剩下的功能都归右边这两个位置。十个动作里你挑两个放上去，别的一律不在条上 —— 这就是这里没有一排固定按钮的原因。",
        "basicsCollapsed": "移开指针，整条收回成一根进度条。你平时看到的是这个形态，需要控制时靠近它就会展开。",
        "heightIntro": "这条控制条离屏幕底边有多远是可以改的，各页面的歌曲卡片和侧边面板会跟着一起动。",
        "heightSettings": "入口在设置 → 播放页 → 控制栏。滑杆调整高度，「在播放页拖动调整」允许直接拖动控制条；命令窗口也能打开同一设置。",
        "heightDrag": "进了拖动调整之后，按住胶囊任意位置上下拖。松手即生效，而且会被记住。",
        "slotsIntro": "进度条右边这两个按钮不是固定的，两个位置各自独立。",
        "slotsWhere": "在设置里挑：循环、随机、喜爱、队列、音量、睡眠定时等十个动作里任选，选完立刻生效。",
        "shuffleIntro": "这个随机和别处的不一样 —— 它不是一个开着就一直生效的模式。",
        "shuffleOnce": "按一下，Folia 把当前队列原地洗一次牌，洗完这个顺序就定下来了。想换个顺序就再按一次。",
        "volumeIntro": "底部控制条上没有常驻的音量滑块。",
        "volumeOpens": "按这里打开的是命令面板里的音量面板，不是就地弹一个小滑块。"
      },
      "commandPalette": {
        "type": "命令是搜出来的，不是翻出来的。窗口一开就打字，它按名字、别名和关键词一起筛；记不住全名，记得一半也找得到。",
        "run": "↑↓ 在结果里移动，Enter 执行当前这条。最近用过的会排在前面，常用的那几条越用越靠上。",
        "pill": "需要参数的命令：输入命令名后按空格，命令会收成标签，继续输入参数。",
        "flags": "带标志的命令在你输入 -- 时会把自己的选项列出来。不必记有哪些标志，输入两个减号就是在问它。",
        "executeEnter": "窗口关闭且焦点不在输入框时，按冒号进入执行模式；窗口打开时，冒号只输入到查询框。",
        "executeKeys": "进去之后一个键就是一条命令：r 打乱队列、v 音量、o 设置、h 帮助。这些键互不构成前缀，所以按完立即执行。"
      },
      "latticeChrome": {
        "intro": "在墙上展开一张海报，它底部会长出一条播放控制。这条只属于展开的那张卡，收起来就没有了。",
        "playAndSeek": "最左边是播放 / 暂停：这张卡不是当前歌曲时，按它是从这首开始播。底下那条进度条可以直接拖动跳转。",
        "openPlayer": "右端那个斜箭头回到播放页。海报上的其它位置是选中和展开，只有这里会离开 Lattice。",
        "ends": "中间四个按钮，两端固定是上一首和下一首 —— 这两个位置不可配置。",
        "sharedSlots": "中间那两个不是另一套按钮，就是底部控制条右边那两个槽位的同一份：同一个动作、同一个图标、同一套可用性判断。",
        "swap": "所以在设置里把底栏的槽位换掉，这里也跟着变 —— 不需要、也没有第二个地方再配一遍。",
        "onlyWhenVisible": "这条控制条只在展开的海报上。海报没展开，或者展开的那张被滚出了视口，它就不在屏幕上。",
        "barShows": "这时候底部控制条会自己顶上来：正在播的那首海报一离开视口，它就出现；滚回去看得见了，它又收起。播放控制不会真的消失。"
      },
      "bravaisWall": {
        "intro": "Bravais 把资料库铺成一面墙：歌单、专辑、歌手和歌曲都是墙上的磁贴。打开、返回、过滤都不翻页，只是给墙上的位置换内容。",
        "seam": "中间裂开的那道缝是信息条，页签、标题、过滤和各种操作都在里面，它另有一篇教程。",
        "entrance": "换首页页签、换来源，或者从别处回到资料库时，整面墙先抬起退场，再从左上角一波一波落回新内容。",
        "pan": "按住墙面拖动，松手后会顺着速度再滑一段；横着拖时，缝跟着墙一起走。首页和普通打开的集合是无限墙，内容不够就循环铺开，往哪边都拖不到头。",
        "wheel": "鼠标滚轮也是平移：每一格平滑地滑过去，连着滚会叠成一段；按住 Shift 滚是横向。触控板不做平滑，直接跟手。",
        "finite": "在信息条里过滤时，墙会收成有限墙：结果不再循环重复，拖到尽头就停住。清空过滤后，墙再翻回无限墙。",
        "song": "歌曲是满版海报，左上角是它的序号。",
        "collection": "专辑、歌单和文件夹的右下角露出一叠错开的页边，标签写成「种类 · 曲目数」，点开是一张曲目表。页边可以在设置里关掉。",
        "artist": "歌手是双色调人像，名字更大，没有副标题。",
        "artistHover": "指针停上去，或者键盘焦点落到它上面时，人像会恢复原来的颜色。",
        "special": "我喜欢的音乐、私人 FM、全部歌曲这类特殊卡片，标签换成强调色底，前面加一个小图标。私人 FM 是电台，点了直接开始播放，不会打开新的一层。",
        "open": "点一张集合不会跳到新页面：被点的那张原地变成新层的第 1 首（集合封面通常就是第一首的封面），其余位置从它开始，一圈圈翻成新内容。",
        "openSeam": "缝不会合上，里面的内容翻成这个集合的信息条。",
        "back": "返回时（信息条里的 ‹、Esc 或浏览器后退），墙从缝开始往两边翻回上一层，键盘焦点落回当初点的那张。",
        "expand": "点一首歌不会马上播放，它会在原地展开成一张大卡。让位只发生在它所在的那一块里，块外的磁贴一动不动。",
        "queue": "「加入队列」把这首加进播放队列，之后显示「✓ 已在队列」。",
        "play": "播放键才会开始播放。播放之后去哪里，由设置里的「播放后进入的视图」决定：可视化播放页、Lattice，或者留在原处。",
        "current": "正在播放的那张卡上，播放键变成暂停 / 继续，旁边多出一个「进入」按钮，去播放页或 Lattice。",
        "keep": "从播放页或 Lattice 回来，或者返回到这一层时，正在播放的那首会自己重新展开。按 Esc 或点空白墙面收起之后，就不再保持。",
        "keyboard": "用键盘也行：方向键移动焦点，Enter 展开，再按一次 Enter 播放，Shift + Enter 加入队列，Esc 逐级收起。",
        "tools": "右下角是墙面工具：顶上一排是一次性的动作，中间是音量，下面是墙面外观。",
        "windows": "「透光」在三档之间轮换。部分透明时，每一块里固定有几格是窗，透出下面的可视化。内容不会被窗盖住，只是跳过窗位往后排。",
        "clear": "全透明时，所有磁贴都是窗，只留下标题；展开的聚焦卡照常显示封面。",
        "solid": "再点一次回到实色。实色和 Lattice 一致：墙完全盖住播放页，可视化也不在后台渲染。",
        "lattice": "顶上的「Lattice」（{{mod}} + B）把整面墙换成播放队列：缝合上、窗关上，磁贴从起点向外翻成 Lattice 的海报。回来时反过来，正在播放的那首随缝张开一起展开。"
      },
      "sidePanel": {
        "controlsSteppers": "这两行选的是歌词样式和背景类型。两端那对箭头一次只换到相邻的一个 —— 十来个样式排着，这么翻要翻很久。",
        "controlsModeList": "点中间那一块，弹出一格图，直接点想要的那一张。",
        "controlsModeListFooter": "这一格图最底下那一条不是又一张图 ——「更多设置」打开的是这一行对应的完整设置，调参就在那儿。",
        "queueRadio": "私人 FM 播放时，这一页会变成电台面板，不再显示队列。",
        "queueRadioMode": "顶上那颗按钮写的是你现在在哪个电台模式；点它打开的是命令窗口里的模式选择器，和命令面板给的是同一个。",
        "queueRadioActions": "这一行两端是丢弃和喜欢。丢弃后服务不会再播放这首，电台会继续下一首。",
        "cover": "面板打开时是封面页：这首歌的大封面，下面是歌名、歌手和专辑，再下面一行是它的几个动作。",
        "tabs": "最底下一排是标签页：封面、控制、播放列表、账户；这首歌有来源信息时，封面后面多一个来源页，就是这里的第二格。装了带页面的模组，后面还会多出它的页。",
        "body": "换到别的页，顶上那首歌收成一行，点它回到封面页；中间是这一页的内容。内容有多高面板就有多高，标签那一排一直在底边。",
        "cycle": "不必去点那一排小格子。面板开着时按 Tab，就在标签页之间往后循环一格。",
        "cycleReverse": "Shift + Tab 往回一格。循环只在当前真的有的那几页之间走 —— 来源不同，页数也不同。",
        "sourceTab": "本地、Navidrome 或在线来源的歌曲才有这一页，标签上写的是本地、Navidrome 或歌词；没有来源信息时只有四个标签。",
        "sourceInfo": "最底下是这首歌的来历：本地歌曲是文件名、大小和码率，Navidrome 是 Song ID；在线歌曲没有这一块。",
        "sourceGain": "音频增益就是 ReplayGain，可选关闭、单曲或专辑。名字下面那行小字是这首歌自带的单曲和专辑增益值；没有标签时写着「未检测到 ReplayGain」。",
        "sourceLyrics": "歌词这一行右端是这首歌现有的几种歌词，点一段就换；只有一种时只写着它的名字。",
        "sourceOffset": "时间轴偏移按 250ms 调整，也可以直接输入。它只对当前播放生效；设置里的全局偏移会与它相加。",
        "sourceLyricsFile": "「导入 / 导出歌词」这颗把两件事合在一个窗口里，点开再选。它左边的「在线匹配」打开匹配歌词的窗口。",
        "sourceExportFormats": "窗口上面是导入，接受 lrc、vtt、ttml、qrc、yrc、krc、txt 和 Folia 导出的 .fia；Navidrome 的歌曲不能导入，窗口里只有导出。中间两块把这一首导成文件：.fia 保留逐字时间轴、翻译、背景和声和你保存的分词，能原样导回来；.lrc 是增强型 LRC，别的播放器也能读，但这些 Folia 专有的信息会丢掉。",
        "sourceExportBatch": "最底下一行是批量导出：它会打开命令面板里的导出页，一次导出本机缓存的所有歌词。设置 · 存储与备份「缓存详情」里「歌词」那一行也有同一个入口。",
        "coverTab": "封面页就是这首歌：大封面，下面是歌名、歌手和专辑，再下面一行动作。这一页没有别的内容。",
        "coverTabDetail": "点击歌手或专辑可进入对应集合。点击歌名复制歌曲信息，按住 Ctrl 点击可打开来源页面。",
        "controlsTab": "控制页最上面是音量一行，下面三格是循环、智能过渡和音频效果器：前两格点一下就开关，第三格打开一个窗口。",
        "controlsTabDetail": "再往下是歌词样式、背景类型两行和「播放页透明背景」开关，最下面两行是主题：来源、当前主题、生成 AI 主题和明暗。音频增益与歌词偏移在来源页。",
        "queueTab": "播放列表页是当前播放队列的完整列表，顶上一行写着队列里有多少首。",
        "queueTabDetail": "点击歌曲即可播放；悬停后可移到下一首、移到队尾或移除。顶部按钮可打开 Lattice 或打乱队列。这里不能拖动排序。",
        "accountTab": "账户页管的是当前音乐来源那一侧的事。",
        "accountTabDetail": "账户页显示登录状态、默认音质和「同步数据」。没登录时，这里是一颗「去主页登录」。"
      },
      "transition": {
        "enable": "这一组管的是两首歌之间怎么接上。最上面是总开关 —— 它和控制页里「智能过渡」那一格是同一个值，两处改的是同一件事。",
        "modes": "「过渡模式」有两段：Folia Crossfade 淡化切换歌曲，Folia Automix 分析音频后选择接点。",
        "badge": "两段左边那一小块字是运行状态：「完全体」或「兼容模式」表示自动混音正在运行；「已退回淡化」表示条件不足，系统改用淡化。",
        "notice": "自动混音需要歌曲缓存；提示右端的「开启歌曲缓存」可以就地打开它。"
      },
      "libraryWatch": {
        "enable": "打开后，Folia 会监视已导入的本地文件夹并自动增量扫描。",
        "roots": "开关底下才展开这张列表，一行一个被监视的根文件夹，下面那行小字是它的真实路径。",
        "warning": "眼睛表示监视正常；黄色三角表示路径或权限有问题，文件夹已停止自动扫描。",
        "recheck": "看到三角就按右边这颗「重新检查文件夹」，它会重新挂一遍所有导入过的文件夹。旁边那行小字是上一次自动扫描的时间。"
      },
      "queueSettings": {
        "append": "这一行的两段决定「加入播放队列」到底加到哪儿。默认是追加到末尾，先听完手上排着的。",
        "next": "选择后，新歌曲会插到当前歌曲后面。这个设置会影响卡片、队列行和命令窗口里的所有加入队列入口。"
      },
      "lyricsSource": {
        "autoBest": "「自动使用最佳歌词」会从网易云、AMLLDB、QQ 和酷狗匹配歌词，并可能覆盖来源页的手动选择。手动选择没有生效时，先检查这里。",
        "priority": "「本地歌曲歌词优先级」这一行的两段决定本地和在线的歌词谁优先。本地文件自带的歌词和在线检索到的同时存在时，按这里说的来。",
        "globalOffset": "「全局时间偏移」点进去是一整屏的标尺，调的是所有歌的歌词整体提前或延后多少 —— 一般用来补声卡或蓝牙的固定延迟。",
        "offsetSum": "来源页偏移只对当前歌曲有效，全局偏移长期生效；两者会相加。"
      },
      "gridHotkey": {
        "off": "在海报墙和集合页，按字母直接筛选；默认按 S 也是筛选，不会打开命令窗口。",
        "on": "打开后，S 用于打开命令窗口，其他字母仍用于筛选。"
      },
      "lyricExport": {
        "whatItIs": "这一页把本机已有的歌词打成一个 zip，不联网下载新的歌词。",
        "effective": "在线缓存是播放过的在线歌曲，导出的是播放时实际显示的版本，你导入或手动匹配的优先。本地曲库只导出在线匹配到的歌词：文件按音频文件名命名，按原目录结构放在 zip 的 local 文件夹里，解压到曲库所在的上一级目录，就会落在每首歌旁边。纯音乐和没有歌词的歌曲会跳过，并写进 manifest.json。",
        "formats": ".fia 无损，可以直接导回 Folia；LRC 通用，但会丢掉背景和声和分词。两种都勾上，zip 里就是两个文件夹。",
        "names": "在线歌词缓存本身不带歌名。播放过的歌会顺手记下歌名，这是第一来源；没有的再从本机缓存过的歌单和队列里找，最后才联网问音乐平台，查到的结果会记下来，下次不用再问。关掉联网，查不到歌名的歌曲就以 ID 命名。",
        "running": "开始后这里显示进度，按钮变成取消。关掉命令面板也等于取消：导出不会在后台继续跑。"
      },
      "queueCommand": {
        "whatItIs": "{{mod}} + P 打开队列窗口。输入即可筛选，↑↓选择，Enter 播放。",
        "atSign": "输入 @ 可筛选队列中的歌手或专辑；后面会显示各项包含的歌曲数。",
        "narrowed": "选中后会收成输入行标签，列表只显示该项的歌曲。",
        "flags": "输入 -- 可查看批量操作：--remove 移除，--next 移到下一首，--end 移到队尾。",
        "scope": "它操作的是筛选出的全部歌曲，不是高亮行。预览会显示“将影响 N 首”。",
        "guards": "没有搜索词或 @ 筛选时拒绝执行，避免清空队列；正在播放的歌曲会排除。"
      },
      "desktop": {
        "windowNormal": "桌面版多出三项功能：窗口层级、系统托盘和遥控窗口。先从普通主窗口开始。",
        "wallpaper": "壁纸模式会把窗口放到桌面底层，歌词铺在桌面上；键盘在此模式下不可用。",
        "wallpaperExit": "所以退出壁纸模式不能靠点窗口。走托盘菜单里的「壁纸模式」，或者在命令窗口里搜同一条命令。",
        "trayIcon": "托盘图标位于任务栏角落。最小化到托盘后，主窗口不在任务栏，但播放和媒体键仍正常。",
        "trayMenu": "托盘菜单可在不打开主窗口的情况下显示/隐藏窗口、打开遥控窗口、设置透明和置顶等。壁纸模式下，托盘是退出入口。",
        "remote": "遥控窗口可从命令窗口或托盘打开；主窗口最小化或进入壁纸模式时仍可使用。",
        "remoteChrome": "遥控窗口有自己的置顶、透明、点击穿透、任务栏图标和自动隐藏设置，与主窗口互不影响。"
      },
      "gridActionButton": {
        "tap": "集合页和海报墙右下角都有这颗按钮。点一下，曲目列表从右边切进来 —— 这是它的第一个动作。",
        "list": "列表里一行一首，点哪首播哪首。本地文件夹的列表顶上还多两颗排序控件。",
        "track": "它背后还藏着一条向左的滑轨，平时看不见 —— 和播放页右缘那颗手柄是同一个手势。按住按钮往左拖。",
        "slideTarget": "松手后打开本页筛选，也可在设置 · 快捷操作中改为命令窗口。"
      },
      "gridViewEdit": {
        "normalCard": "常态下卡片底部有两颗：左边圆的是播放，右边那颗是把这首加进队列。点卡片本身不播放，只是把它移到中央。",
        "editCard": "编辑模式下按钮移到右上角的红叉，点击立即移除歌曲，不会弹确认框。",
        "rename": "本地和 Navidrome 歌单的改名会在退出编辑模式时提交；中途按 Esc 或关闭页面会丢失改动。",
        "onlinePlaylist": "在线的自有歌单走的是另一条路：它是就地编辑，改一下算一下，没有「退出时提交」这个步骤。同一颗按钮，两种来源两种行为。"
      },
      "localFolderActions": {
        "conditional": "操作栏随本地集合类型变化：文件夹可重扫和整理歌曲信息，本地歌单可导出，本地专辑或艺术家可编辑实体。",
        "playAll": "最上面两颗任何集合都有：全部播放和加入队列。页面上开着筛选时，它们作用于筛出来的那些，按钮文字会写出条数。",
        "reimport": "重新导入会增量扫描文件夹：新增、更新和移除分别处理，不会重建已有记录。",
        "organize": "「整理歌曲信息」打开的是这个文件夹的批量改 tag 面板 —— 一次处理整个文件夹，不是一首一首改。",
        "remove": "最下面这颗红的把这个文件夹从曲库里移除。它不删磁盘上的文件，但曲库里这些歌的记录、以及它们在歌单里的位置都会跟着没。",
        "confirm": "删除前会确认；根文件夹和子文件夹的影响范围不同，确认框会说明。"
      },
      "localGridControls": {
        "sources": "这一排在本地曲库内部切换文件夹、专辑、艺术家和本地歌单。它换的是 Grid3D 轨道里的集合类型，不是切换在线音乐来源。",
        "foldersAndPlaylists": "「文件夹」保留导入时的目录结构；「歌单」是 Folia 保存在本地的歌单，和在线歌单、Navidrome 歌单彼此独立。",
        "imports": "「导入文件夹」从目录加入音乐；「导入歌单」读取 M3U/M3U8，并用 Folia 能解析到的曲目建立本地歌单。",
        "refresh": "「刷新」重新扫描已经导入的根目录，找出新增、变化和丢失的文件；它不会再复制一份曲库。"
      },
      "onlineCollectionActions": {
        "common": "在线与服务器集合都提供「播放全部」和「加入播放队列」。本页有筛选时，两颗按钮只处理筛选结果，并在文字里显示条数。",
        "provider": "其余按钮由当前来源和集合类型决定：Navidrome 可能提供服务器歌单操作，在线专辑或歌单可能提供收藏、取消收藏或推荐管理。本地文件重扫和标签整理不会出现在这里。",
        "destructive": "只有当前来源支持修改且这个集合允许操作时，才会显示删除或移除。它修改的是远端或服务器集合，不会删除本地音频文件。"
      },
      "localGridMap": {
        "page": "这是本地曲库的 GridMap。它把当前分类里的文件夹、专辑、艺术家或本地歌单铺成一张蜂窝地图，而不是只看 Grid3D 的单条轨道。",
        "cards": "拖动或滚轮可在地图上移动。点一张卡会回到 Grid3D 并聚焦它；激活卡片则直接进入该集合。",
        "openPanel": "文件夹、专辑和艺术家地图可点击中央标题打开批量选择：文件夹显示目录树，专辑和艺术家显示扁平列表；本地歌单地图只提供浏览。",
        "batchActions": "面板会把选中的集合换算成曲目。可以播放、加入队列、建立本地歌单；在文件夹地图里还可移除选中的曲库记录。",
        "filter": "{{mod}} + F 或直接输入可筛选地图。批量选择与目录树会跟随筛选后的卡片，所以操作只作用于当前可见的选择。",
        "back": "返回会关闭 GridMap，回到进入前的本地 Grid3D 分类和焦点位置。"
      },
      "localGridMapDirectory": {
        "hierarchy": "这里按导入时的目录重建层级。缩进代表嵌套；只有单个子目录的长链会压缩显示，分叉点和直接包含歌曲的目录仍会单独列出。",
        "expand": "箭头只展开或收起子目录，不会改变选择。标题栏里的加宽按钮能给较深的路径更多横向空间。",
        "selection": "有子目录的文件夹会在三种状态间循环：整个子树、全部不选、只选这个目录直属的曲目。叶子目录只有全选与不选。数量以当前筛选后的地图为准。",
        "rootActions": "导入根目录还带维护操作：重扫该根目录、恢复被忽略的目录，或从曲库移除根目录。移除曲库记录不会删除磁盘上的音频文件。"
      },
      "localMetadata": {
        "conditions": "手动匹配只在当前卡片是本地歌曲、且指针停在歌名上时显示。",
        "pencil": "满足之后它浮在歌名右端，只有 65% 不透明度。点开是手动匹配面板，重新给这首歌挑一份正确的标题、歌手和专辑。"
      },
      "localTrackSorting": {
        "whereOnly": "排序控件只对本地文件夹显示；其他来源的顺序由来源决定。",
        "fields": "排序方式三选一：文件名、文件修改时间、专辑内音轨号。选好之后存在本地，换一个文件夹进去还是这个排法。",
        "direction": "左边那颗切升序和降序，和排序方式各自独立。"
      },
      "gridStyle": {
        "grid3dImage": "「纯图片封面」让整张卡就是一张封面，歌单名压在封面底部的渐变里。",
        "grid3dCard": "「拍立得卡片」是默认的样子：封面缩到上半部，下面留一条边写名称；封面不裁切，但每屏能放的卡片更少。",
        "fullBleed": "全画幅封面让集合页封面铺满卡片，歌名和歌手显示在渐变遮罩上。",
        "squareCard": "只有打开全画幅封面后才会显示「正方形卡片」。打开后卡片等宽等高，方形封面不会被裁切。",
        "minScale": "这条滑杆设置外围卡片的最小缩放比例。调高更易辨认，调低纵深感更强。",
        "minOpacity": "同理，这条是「最多淡到多少」。两条一起决定了这片网格看起来是平铺的还是有纵深的。",
        "falloffReset": "调乱了按这颗恢复默认衰减。它只复位那两条滑杆，封面形状那两个开关不受影响。",
        "latticeVignette": "「边缘暗角」在队列拼贴页面四周压一层淡淡的暗，把视线收到中间的海报上。它只是显示效果，不影响队列本身。",
        "latticeTint": "「海报聚焦叠色」会让播放中、聚焦和悬停的海报更醒目。关闭后，叠色强度和自定义颜色那几行也会隐藏。",
        "latticeIntensity": "打开之后下面才有「叠色强度」。它是百分比：调到 0 等于没叠色，调高普通海报越暗、正在播的那张越突出。",
        "latticeCustomColor": "默认的叠色是从当前主题算出来的渐变，会跟着换主题一起变。打开「强制使用自定义颜色」就把它钉死成一个颜色，主题怎么换都不动。",
        "latticePicker": "开了它，下面才出现取色器。拖动时海报墙实时跟着变，松手才真正存下来。"
      },
      "panelCoverActions": {
        "appear": "封面页上，歌名下面这一行一直在：左边是这首歌的几个动作，右端是回到首页和设置。换到别的页，这一行收起来，只在顶上留一颗喜欢。",
        "settings": "齿轮打开设置。按下去面板会先收起来，再把设置窗口铺上来。",
        "home": "右端的房子回到首页的海报墙，面板会先收起。播放不会中断。",
        "addToPlaylist": "星形那颗把当前这首加进歌单。只有当前来源支持歌单时它才在；加不了的时候它是灰的，指针停上去会写明原因。",

        "like": "心形是喜欢这首歌。当前来源做不了这件事时它是灰的，指针停上去会写明原因。",
        "playingFrom": "队列是从某张歌单或专辑开始播的，这里就多一枚写着它名字的按钮：点一下回到那一页，并找到这首歌。队列换成别的歌之后它就不在了。"
      },
      "lyricsAnimation": {
        "where": "设置 · 外观最上面这一行「歌词动画样式」是换歌词样式的入口，右端写着现在用的是哪一个。",
        "playground": "点开是歌词样式窗口。左边那一大块是实时预览，放的就是播放页真正会渲染出来的样子；右边那条窄栏才是设置。",
        "playgroundSections": "样式在预览下面那一架图里选。右栏分为歌词动画、背景、通用、字幕四页，「歌词动画」页是所选样式的参数。",
      },
      "themeSettings": {
        "presetDefault": "「配色主题预设」左边一段是内置的「墨染 / 素白」，跟着明暗模式在深色和浅色之间自动换。",
        "presetCustom": "右边一段是自定义配色。还没有自定义主题时它是灰的、按不动；有了之后选中它，播放页、卡片和面板都会换成这套颜色。",
        "source": "「主题生成来源」在下面「歌曲主题」那一组：AI 推断或封面取色。没有配置 API Key 时，这一行下面会多出一句提示和一颗去配置的按钮。",
        "themePark": "「打开 Theme Park」这一行打开配色编辑窗口，左侧是实时预览。",
        "themeParkTabs": "右栏有配色、信息、内容、AI 四页。配色页分别保存亮暗两套颜色；AI 页复制提示词，再把 AI 写回的 JSON 导入草稿。",
        "followSystem": "「明暗模式」有三段：浅色、深色、跟随系统。选跟随系统，应用按系统的设置自动切换明暗。",
        "preferCustom": "「优先使用自定义主题」打开之后，主题自动切换会被关掉 —— 两者是互斥的。这就是开了它以后换歌颜色不再变的原因。",
        "autoSwitch": "「主题自动切换」会在播放有缓存主题的歌曲时应用它；打开它下面缩进的那一行，没有缓存的歌曲也会自动生成主题。"
      },
      "panelSlide": {
        "grabbed": "按住这个按钮不放，它背后的滑轨就亮起来了。",
        "intro": "这个按钮底下藏着一条滑轨。按住它，滑轨就会显出来。",
        "threshold": "往左拖。36 像素就够了 —— 到 44 像素按钮便不再跟手。",
        "outcome": "越过那条线松手，命令面板就打开了。",
        "hotspotIntro": "触屏上没有悬停这回事，所以屏幕边缘本身就是入口。",
        "hotspotRevealed": "在右边缘附近点一下，手柄会自己出来。",
        "keyboardIntro": "也可以完全不用指针。",
        "keyboardOutcome": "直接按 {{mod}} + K，打开的是同一个窗口。"
      },
      "signIn": {
        "homeButton": "没有人登录时，主页中间有一颗「登录」按钮。它打开登录窗口，平台在窗口里选。",
        "pill": "右下角这一枚一直都在。点左边的头像或平台记号，打开同一个窗口，停在正在用的平台上；右边的箭头返回播放器。",
        "platforms": "左边一列是全部平台。已经登录的那一行右端有头像；灰着的行不能选，悬停会写原因。",
        "code": "选中一个平台，右边就是它的登录方式。多数是一张二维码，用那个平台的手机应用扫；有的要先选方式，有的点一下按钮去浏览器里登录。",
        "steps": "右下角这一串小图标是登录走到哪一步：二维码、手机上确认、读到账号。",
        "account": "已经登录的平台，这里是它的账号。「退出登录」只退这一个平台。",
        "switch": "几个平台可以同时登录着。选中的不是正在用的那一个时，多出一颗切换按钮，把它换成正在用的平台；右下角那一枚跟着换。"
      },
      "lyricMatch": {
        "where": "面板来源页的「在线匹配」打开这个窗口。标题下面写着正在给哪一首歌找歌词。",
        "sources": "这一排是歌词来源。点另一个，就在那个来源里再找一遍。",
        "search": "窗口打开时已经搜过一遍。结果不对，就改这里的字再搜。",
        "results": "每一条是一首找到的歌：歌名、歌手和专辑。歌名旁边的百分数是它和这首歌有多像。",
        "preview": "点一条，右边换成它的封面和名字，下面是它的歌词，跟着正在播放的位置走；角上标着这份歌词带不带逐字、翻译和罗马音。",
        "save": "「保存」把选中的这一条用到这首歌上；「取消」什么都不改。",
        "switches": "给本地文件匹配时，封面下面多三个开关：「封面」「元数据」「歌词」。亮着的那一项用选中的这一条，关掉的保持文件自己的。",
        "noMatch": "左下角的「不使用在线数据」让这首歌只用文件自己的信息。"
      }
    }
  }
```

## 4. 修改时的定位速查

- 改入口卡片标题和说明：第 1 节，settings/pages/HelpPage.tsx。
- 改教程目标和章节归属：第 2 节，再回到对应的 targets/<那一屏>/*.target.ts。
- 改通用提示、导航、章节控制和退出文案：第 3 节中的 navigation、onboarding、legend 及顶层 key；组件主要在 PonderNavigationPage.tsx、PonderHost.tsx、PonderChrome.tsx、PonderCaptionBlock.tsx、PonderNextChapterCue.tsx。
- 改教程长段说明：第 3 节中的 captions；实际渲染组件是 PonderCaptionBlock.tsx（画面下方固定的那一块）。
- 改合成界面上显示的区域名：第 3 节中的 anchors；区域声明在目标文件。名字只在字幕讲到那个区域时出现，画在聚焦框的标签上（PonderFocusFrame.tsx）。

## 5. 源码入口

- 语言文件：src/i18n/locales/zh-CN.ts
- 目标注册表：src/components/ponder/ponderRegistry.ts
- 教程目标定义：src/components/ponder/targets/<那一屏>/*.target.ts
- 教程挂载与交互：src/components/ponder/PonderHost.tsx、src/components/ponder/PonderStage.tsx
- 手画界面：src/components/ponder/surfaces/<那一屏>/*.surface.tsx 各自声明，尺寸在旁边的 *.geometry.ts；src/components/ponder/PonderSurfaceContents.tsx 把它们收齐

## 6. 每条字幕对应的组件与场景

这张表把第 3 节中的字幕正文连回实际目标脚本；指向区域是手画界面里的锚点，对应的区域标签同时列出。

当前语言文件里有 152 个章节 key、382 个字幕 key；目标脚本直接引用的是 146 个章节和 372 个字幕。第 3 节保留全部原文，下面的映射表只列脚本当前直接引用的文案。

| 目标 ID | 场景 ID | 场景标题 | 字幕 key | 中文文案 | 指向区域 | 区域 label key |
| --- | --- | --- | --- | --- | --- | --- |
| `audio-equalizer` | `audio-equalizer-presets` | 总开关、预设，和你自己的两个槽 | `ponder.captions.audioEqualizer.enable` | 控制页「音频效果器」那一格打开这个窗口。右上角这颗开关管整条处理链；关闭后设置保留，但不再生效。 | enable：总开关 | `ponder.anchors.audioEqualizer.enable` |
| `audio-equalizer` | `audio-equalizer-presets` | 总开关、预设，和你自己的两个槽 | `ponder.captions.audioEqualizer.presets` | 这一排前六个是内置预设。每一个同时带着一条均衡曲线和一整套效果链，所以点一下是两样一起换。它们不可编辑。 | presets：内置预设 | `ponder.anchors.audioEqualizer.presets` |
| `audio-equalizer` | `audio-equalizer-presets` | 总开关、预设，和你自己的两个槽 | `ponder.captions.audioEqualizer.slots` | 同一排里紧跟着的两颗是你自己的：自定义 1 和自定义 2，各存着一条曲线加一套链。 | customSlots：自定义 1 / 自定义 2 | `ponder.anchors.audioEqualizer.customSlots` |
| `audio-equalizer` | `audio-equalizer-silent-write` | 拖一下就覆写一个槽 | `ponder.captions.audioEqualizer.bands` | 「频段增益」是十根竖推子，左端 31 Hz 到右端 16 kHz，每根 ±12 dB；一条曲线连着十个把手。 | bands：十段推子 | `ponder.anchors.audioEqualizer.bands` |
| `audio-equalizer` | `audio-equalizer-silent-write` | 拖一下就覆写一个槽 | `ponder.captions.audioEqualizer.silent` | 内置预设不可编辑；拖动推子会切到一个自定义槽并写入新值：正选着某个自定义槽就写进它，否则写进「自定义 1」。重要设置请先切到「自定义 2」。 | customSlots：自定义 1 / 自定义 2 | `ponder.anchors.audioEqualizer.customSlots` |
| `audio-equalizer` | `audio-equalizer-silent-write` | 拖一下就覆写一个槽 | `ponder.captions.audioEqualizer.reset` | 清空当前自定义槽，恢复平直曲线和中性效果。内置预设不能编辑，所以选中时按钮是灰的。 | reset：清空这个槽 | `ponder.anchors.audioEqualizer.reset` |
| `audio-equalizer` | `audio-equalizer-effects` | 底下那条效果链 | `ponder.captions.audioEqualizer.effects` | 「效果链」在频段之后处理，一共九项：低频截止、高频截止、饱和失真、比特降质、抖晃、黑胶噪声、立体声宽度、空间混响、动态压缩。它们和推子写进同一个自定义槽。 | effects：效果链 | `ponder.anchors.audioEqualizer.effects` |
| `audio-equalizer` | `audio-equalizer-effects` | 底下那条效果链 | `ponder.captions.audioEqualizer.noise` | 名字旁边带「噪声」徽章的两项（比特降质、黑胶噪声）自己会加入噪声；徽章不代表它当前已经打开。 | noiseBadge：会加噪 | `ponder.anchors.audioEqualizer.noiseBadge` |
| `bravais-seam` | `bravais-seam-levels` | 三档：完整、书脊、折叠 | `ponder.captions.bravaisSeam.levelsIntro` | 信息条是墙中间裂开的那道缝，这一层的标题、说明和操作都在里面。它有三档：完整、书脊、折叠。 | strip：完整信息条 | `ponder.anchors.bravaisSeam.strip` |
| `bravais-seam` | `bravais-seam-levels` | 三档：完整、书脊、折叠 | `ponder.captions.bravaisSeam.levelsSpine` | 点标题区域（引号连同竖排大标题）收成窄窄的书脊，两边的墙跟着合拢；在书脊上点竖排标题，又展开回完整信息条。 | spineTitle：竖排标题 | `ponder.anchors.bravaisSeam.spineTitle` |
| `bravais-seam` | `bravais-seam-levels` | 三档：完整、书脊、折叠 | `ponder.captions.bravaisSeam.levelsFold` | 要整条让开，点「⋯ 更多」的最后一项「折叠信息条」。书脊顶上那颗向中间合拢的图标也是折叠。 | menuFold：折叠信息条 | `ponder.anchors.bravaisSeam.menuFold` |
| `bravais-seam` | `bravais-seam-levels` | 三档：完整、书脊、折叠 | `ponder.captions.bravaisSeam.levelsHidden` | 折叠之后墙合成一整面，侧边只留一枚竖排标签，写着这一层的标题。点它回到折叠前那一档。 | edgeTab：侧边标签 | `ponder.anchors.bravaisSeam.edgeTab` |
| `bravais-seam` | `bravais-seam-levels` | 三档：完整、书脊、折叠 | `ponder.captions.bravaisSeam.levelsGlobal` | 档位是全局的：收起之后再进别的歌单，信息条照样收着。窗口窄于 900px 时默认是书脊；三档在命令面板里也各有一条命令。 | — | — |
| `bravais-seam` | `bravais-seam-collection` | 集合与歌手页的信息条 | `ponder.captions.bravaisSeam.collectionCrumbs` | 最上面是 ‹ 返回和面包屑：书库 › 歌手 › 专辑……点哪一项就退回哪一层，中间层多了会折成「…」。下面那道下划线是当前页过滤。 | crumbs：返回与面包屑 | `ponder.anchors.bravaisSeam.crumbs` |
| `bravais-seam` | `bravais-seam-collection` | 集合与歌手页的信息条 | `ponder.captions.bravaisSeam.collectionAbout` | 大标题下面是这一层的说明：歌单简介、专辑介绍。歌手页这一块是头像、名字和简介，排得像书勒口上的作者简介。正文长了会截断，点一下展开。 | about：说明 | `ponder.anchors.bravaisSeam.about` |
| `bravais-seam` | `bravais-seam-collection` | 集合与歌手页的信息条 | `ponder.captions.bravaisSeam.collectionActions` | 播放全部、加入队列，行尾的星标是收藏（能收藏的集合才有）。歌手页上这两颗只管热门歌曲。 | actions：播放与收藏 | `ponder.anchors.bravaisSeam.actions` |
| `bravais-seam` | `bravais-seam-collection` | 集合与歌手页的信息条 | `ponder.captions.bravaisSeam.collectionList` | 「列表」把信息条加宽成歌曲列表，面包屑多出一级「列表」。悬停一行，墙上同一首的磁贴跟着亮起；单击转到它，双击播放。返回先关列表。 | linkedTile：墙上同一首 | `ponder.anchors.bravaisSeam.linkedTile` |
| `bravais-seam` | `bravais-seam-home-navigation` | 首页：页签、二级切换与直达 | `ponder.captions.bravaisSeam.homeTabs` | 首页的信息条是一道窄缝：最上面是「书库」和折叠，下面竖排着一级页签——歌单、电台、专辑、本地、Navidrome。 | tabs：一级页签 | `ponder.anchors.bravaisSeam.tabs` |
| `bravais-seam` | `bravais-seam-home-navigation` | 首页：页签、二级切换与直达 | `ponder.captions.bravaisSeam.homeFlip` | 换页签时整条信息条翻一次，墙也整面换成那一页的内容。键盘上 F6 / Shift + F6 轮换页签。 | tabLocal：本地 | `ponder.anchors.bravaisSeam.tabLocal` |
| `bravais-seam` | `bravais-seam-home-navigation` | 首页：页签、二级切换与直达 | `ponder.captions.bravaisSeam.homeSections` | 本地和 Navidrome 多一列二级切换（文件夹、专辑、艺术家、歌单……）。只有选中的那项竖着写出名字，其余只留图标，悬停看全名。切换只换墙上的内容，不进新的一层。 | sections：二级切换 | `ponder.anchors.bravaisSeam.sections` |
| `bravais-seam` | `bravais-seam-home-navigation` | 首页：页签、二级切换与直达 | `ponder.captions.bravaisSeam.homeShortcuts` | 下面那几列竖排小字是直达入口：我喜欢的音乐、私人 FM、全部歌曲……点它和点墙上那张卡一样，私人 FM 直接开播。地方不够时，它们挪进「⋯」。 | shortcuts：直达入口 | `ponder.anchors.bravaisSeam.shortcuts` |
| `bravais-seam` | `bravais-seam-home-dock` | 账户入口与工具格 | `ponder.captions.bravaisSeam.dockAccount` | 工具格正上方是账户入口：登录了是头像和昵称，没登录时是「连接在线平台」。点它打开登录窗口，换平台、登录、退出都在里面。 | account：账户入口 | `ponder.anchors.bravaisSeam.account` |
| `bravais-seam` | `bravais-seam-home-dock` | 账户入口与工具格 | `ponder.captions.bravaisSeam.dockTools` | 最底下四格：搜索在线平台、设置、队列拼贴（进入 Lattice）和「⋯」。 | tools：工具格 | `ponder.anchors.bravaisSeam.tools` |
| `bravais-seam` | `bravais-seam-home-dock` | 账户入口与工具格 | `ponder.captions.bravaisSeam.dockMenu` | 其余的都在「⋯」里：这一页签的项在前（过滤当前页、目录、管理隐藏、导入……），分隔线之后是「回到播放页」这类去处。 | menuPopup：⋯ 菜单 | `ponder.anchors.bravaisSeam.menuPopup` |
| `bravais-seam` | `bravais-seam-home-dock` | 账户入口与工具格 | `ponder.captions.bravaisSeam.dockStage` | 开着舞台模式时，工具格最上面多一整行「舞台」，点它打开舞台播放器。 | stageRow：舞台 | `ponder.anchors.bravaisSeam.stageRow` |
| `bravais-seam` | `bravais-seam-filter` | 过滤当前页，和搜索不是一回事 | `ponder.captions.bravaisSeam.filterType` | 想在这面墙里找东西，直接在墙上打字：信息条里冒出一道过滤输入位，墙收成以信息条为中心、只剩匹配项的一小片。 | filter：过滤输入位 | `ponder.anchors.bravaisSeam.filter` |
| `bravais-seam` | `bravais-seam-filter` | 过滤当前页，和搜索不是一回事 | `ponder.captions.bravaisSeam.filterKeys` | 过滤不联网，只收窄眼前这面墙。Esc 有词先清空，再按一次结束输入；↓ 或 Enter 把焦点交给墙上第一张。 | filter：过滤输入位 | `ponder.anchors.bravaisSeam.filter` |
| `bravais-seam` | `bravais-seam-filter` | 过滤当前页，和搜索不是一回事 | `ponder.captions.bravaisSeam.filterSearch` | 放大镜才是搜索在线平台（首页上也可以按 /）：整条信息条换成带框的搜索框，提交之后去搜索页看结果。 | searchBox：搜索框 | `ponder.anchors.bravaisSeam.searchBox` |
| `bravais-seam` | `bravais-seam-tools` | 右下角的墙面工具 | `ponder.captions.bravaisSeam.toolsQuick` | 右下角那颗是墙面工具。顶上一排图标是一次性动作：定位正在播放、打乱队列、为当前歌曲生成主题、播放队列、前往 Lattice、前往播放页；指针停在图标上能看到名字和快捷键。 | toolsQuick：一次性动作 | `ponder.anchors.bravaisSeam.toolsQuick` |
| `bravais-seam` | `bravais-seam-tools` | 右下角的墙面工具 | `ponder.captions.bravaisSeam.toolsVolume` | 中间是音量，和播放条上的是同一份；点左边的图标静音。 | toolsVolume：音量 | `ponder.anchors.bravaisSeam.toolsVolume` |
| `bravais-seam` | `bravais-seam-tools` | 右下角的墙面工具 | `ponder.captions.bravaisSeam.toolsAppearance` | 最下面是墙面外观：透光在三档之间轮换，还有海报叠色和开灯 / 关灯。向左滑这颗按钮，直接打开命令面板。 | toolsAppearance：墙面外观 | `ponder.anchors.bravaisSeam.toolsAppearance` |
| `bravais-wall` | `bravais-wall-structure` | 一面墙，一道缝 | `ponder.captions.bravaisWall.intro` | Bravais 把资料库铺成一面墙：歌单、专辑、歌手和歌曲都是墙上的磁贴。打开、返回、过滤都不翻页，只是给墙上的位置换内容。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-structure` | 一面墙，一道缝 | `ponder.captions.bravaisWall.seam` | 中间裂开的那道缝是信息条，页签、标题、过滤和各种操作都在里面，它另有一篇教程。 | seam：信息条 | `ponder.anchors.bravaisWall.seam` |
| `bravais-wall` | `bravais-wall-structure` | 一面墙，一道缝 | `ponder.captions.bravaisWall.entrance` | 换首页页签、换来源，或者从别处回到资料库时，整面墙先抬起退场，再从左上角一波一波落回新内容。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-pan` | 拖动与滚轮 | `ponder.captions.bravaisWall.pan` | 按住墙面拖动，松手后会顺着速度再滑一段；横着拖时，缝跟着墙一起走。首页和普通打开的集合是无限墙，内容不够就循环铺开，往哪边都拖不到头。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-pan` | 拖动与滚轮 | `ponder.captions.bravaisWall.wheel` | 鼠标滚轮也是平移：每一格平滑地滑过去，连着滚会叠成一段；按住 Shift 滚是横向。触控板不做平滑，直接跟手。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-pan` | 拖动与滚轮 | `ponder.captions.bravaisWall.finite` | 在信息条里过滤时，墙会收成有限墙：结果不再循环重复，拖到尽头就停住。清空过滤后，墙再翻回无限墙。 | pannedSeam：信息条 | `ponder.anchors.bravaisWall.seam` |
| `bravais-wall` | `bravais-wall-tiles` | 认出磁贴的种类 | `ponder.captions.bravaisWall.song` | 歌曲是满版海报，左上角是它的序号。 | song：歌曲 | `ponder.anchors.bravaisWall.song` |
| `bravais-wall` | `bravais-wall-tiles` | 认出磁贴的种类 | `ponder.captions.bravaisWall.collection` | 专辑、歌单和文件夹的右下角露出一叠错开的页边，标签写成「种类 · 曲目数」，点开是一张曲目表。页边可以在设置里关掉。 | collection：集合 | `ponder.anchors.bravaisWall.collection` |
| `bravais-wall` | `bravais-wall-tiles` | 认出磁贴的种类 | `ponder.captions.bravaisWall.artist` | 歌手是双色调人像，名字更大，没有副标题。 | artist：歌手 | `ponder.anchors.bravaisWall.artist` |
| `bravais-wall` | `bravais-wall-tiles` | 认出磁贴的种类 | `ponder.captions.bravaisWall.artistHover` | 指针停上去，或者键盘焦点落到它上面时，人像会恢复原来的颜色。 | artist：歌手 | `ponder.anchors.bravaisWall.artist` |
| `bravais-wall` | `bravais-wall-tiles` | 认出磁贴的种类 | `ponder.captions.bravaisWall.special` | 我喜欢的音乐、私人 FM、全部歌曲这类特殊卡片，标签换成强调色底，前面加一个小图标。私人 FM 是电台，点了直接开始播放，不会打开新的一层。 | special：特殊集合 | `ponder.anchors.bravaisWall.special` |
| `bravais-wall` | `bravais-wall-open` | 翻牌换层 | `ponder.captions.bravaisWall.open` | 点一张集合不会跳到新页面：被点的那张原地变成新层的第 1 首（集合封面通常就是第一首的封面），其余位置从它开始，一圈圈翻成新内容。 | origin：被点的集合 | `ponder.anchors.bravaisWall.origin` |
| `bravais-wall` | `bravais-wall-open` | 翻牌换层 | `ponder.captions.bravaisWall.openSeam` | 缝不会合上，里面的内容翻成这个集合的信息条。 | seam：信息条 | `ponder.anchors.bravaisWall.seam` |
| `bravais-wall` | `bravais-wall-open` | 翻牌换层 | `ponder.captions.bravaisWall.back` | 返回时（信息条里的 ‹、Esc 或浏览器后退），墙从缝开始往两边翻回上一层，键盘焦点落回当初点的那张。 | origin：被点的集合 | `ponder.anchors.bravaisWall.origin` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.expand` | 点一首歌不会马上播放，它会在原地展开成一张大卡。让位只发生在它所在的那一块里，块外的磁贴一动不动。 | focusCard：聚焦卡 | `ponder.anchors.bravaisWall.focusCard` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.queue` | 「加入队列」把这首加进播放队列，之后显示「✓ 已在队列」。 | focusQueue：加入队列 | `ponder.anchors.bravaisWall.focusQueue` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.play` | 播放键才会开始播放。播放之后去哪里，由设置里的「播放后进入的视图」决定：可视化播放页、Lattice，或者留在原处。 | focusPlay：立即播放 | `ponder.anchors.bravaisWall.focusPlay` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.current` | 正在播放的那张卡上，播放键变成暂停 / 继续，旁边多出一个「进入」按钮，去播放页或 Lattice。 | focusEnter：进入播放视图 | `ponder.anchors.bravaisWall.focusEnter` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.keep` | 从播放页或 Lattice 回来，或者返回到这一层时，正在播放的那首会自己重新展开。按 Esc 或点空白墙面收起之后，就不再保持。 | focusCard：聚焦卡 | `ponder.anchors.bravaisWall.focusCard` |
| `bravais-wall` | `bravais-wall-focus` | 聚焦卡 | `ponder.captions.bravaisWall.keyboard` | 用键盘也行：方向键移动焦点，Enter 展开，再按一次 Enter 播放，Shift + Enter 加入队列，Esc 逐级收起。 | focusCard：聚焦卡 | `ponder.anchors.bravaisWall.focusCard` |
| `bravais-wall` | `bravais-wall-look` | 透光与 Lattice | `ponder.captions.bravaisWall.tools` | 右下角是墙面工具：顶上一排是一次性的动作，中间是音量，下面是墙面外观。 | toolsPanel：工具面板 | `ponder.anchors.bravaisWall.toolsPanel` |
| `bravais-wall` | `bravais-wall-look` | 透光与 Lattice | `ponder.captions.bravaisWall.windows` | 「透光」在三档之间轮换。部分透明时，每一块里固定有几格是窗，透出下面的可视化。内容不会被窗盖住，只是跳过窗位往后排。 | window：窗 | `ponder.anchors.bravaisWall.window` |
| `bravais-wall` | `bravais-wall-look` | 透光与 Lattice | `ponder.captions.bravaisWall.clear` | 全透明时，所有磁贴都是窗，只留下标题；展开的聚焦卡照常显示封面。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-look` | 透光与 Lattice | `ponder.captions.bravaisWall.solid` | 再点一次回到实色。实色和 Lattice 一致：墙完全盖住播放页，可视化也不在后台渲染。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `bravais-wall` | `bravais-wall-look` | 透光与 Lattice | `ponder.captions.bravaisWall.lattice` | 顶上的「Lattice」（{{mod}} + B）把整面墙换成播放队列：缝合上、窗关上，磁贴从起点向外翻成 Lattice 的海报。回来时反过来，正在播放的那首随缝张开一起展开。 | wall：磁贴墙 | `ponder.anchors.bravaisWall.wall` |
| `command-palette` | `command-palette-search` | 搜出来，回车执行 | `ponder.captions.commandPalette.type` | 命令是搜出来的，不是翻出来的。窗口一开就打字，它按名字、别名和关键词一起筛；记不住全名，记得一半也找得到。 | input：输入行 | `ponder.anchors.commandPalette.input` |
| `command-palette` | `command-palette-search` | 搜出来，回车执行 | `ponder.captions.commandPalette.run` | ↑↓ 在结果里移动，Enter 执行当前这条。最近用过的会排在前面，常用的那几条越用越靠上。 | firstResult：当前结果 | `ponder.anchors.commandPalette.firstResult` |
| `command-palette` | `command-palette-argument` | 给命令带参数 | `ponder.captions.commandPalette.pill` | 需要参数的命令：输入命令名后按空格，命令会收成标签，继续输入参数。 | input：输入行 | `ponder.anchors.commandPalette.input` |
| `command-palette` | `command-palette-argument` | 给命令带参数 | `ponder.captions.commandPalette.flags` | 带标志的命令在你输入 -- 时会把自己的选项列出来。不必记有哪些标志，输入两个减号就是在问它。 | results：结果列表 | `ponder.anchors.commandPalette.results` |
| `command-palette` | `command-palette-execute-mode` | 冒号进执行模式 | `ponder.captions.commandPalette.executeEnter` | 窗口关闭且焦点不在输入框时，按冒号进入执行模式；窗口打开时，冒号只输入到查询框。 | input：输入行 | `ponder.anchors.commandPalette.input` |
| `command-palette` | `command-palette-execute-mode` | 冒号进执行模式 | `ponder.captions.commandPalette.executeKeys` | 进去之后一个键就是一条命令：r 打乱队列、v 音量、o 设置、h 帮助。这些键互不构成前缀，所以按完立即执行。 | results：结果列表 | `ponder.anchors.commandPalette.results` |
| `custom-shortcut-settings` | `custom-shortcut-key` | Alt 是印死的，你挑的是字母 | `ponder.captions.customShortcut.alt` | 左边固定为 Alt，右边录入字母。只支持 Alt + 字母。 | capAlt：Alt（固定） | `ponder.anchors.customShortcut.capAlt` |
| `custom-shortcut-settings` | `custom-shortcut-key` | Alt 是印死的，你挑的是字母 | `ponder.captions.customShortcut.capture` | 点第二颗键帽开始录入，下次按下的字母会绑定。修饰键忽略，按 Esc 取消。 | capKey：你按的那颗字母 | `ponder.anchors.customShortcut.capKey` |
| `custom-shortcut-settings` | `custom-shortcut-key` | Alt 是印死的，你挑的是字母 | `ponder.captions.customShortcut.taken` | 已被占用的字母不能绑定，红字会说明原因。S、Ctrl+K 和其他命令的快捷键都算占用。 | rejection：被退回的原因 | `ponder.anchors.customShortcut.rejection` |
| `custom-shortcut-settings` | `custom-shortcut-key` | Alt 是印死的，你挑的是字母 | `ponder.captions.customShortcut.clear` | 录上之后键帽旁边会多一颗小小的 ✕，按它就把绑定清掉；在你重新录一颗之前，这条快捷键什么都不运行。 | clear：清除 | `ponder.anchors.customShortcut.clear` |
| `custom-shortcut-settings` | `custom-shortcut-command` | 这份列表为什么更短 | `ponder.captions.customShortcut.filtered` | 下拉框只列出可在所有页面使用的命令；依赖特定页面或面板的命令不会出现。 | commandList：在哪儿都成立的命令 | `ponder.anchors.customShortcut.commandList` |
| `custom-shortcut-settings` | `custom-shortcut-command` | 这份列表为什么更短 | `ponder.captions.customShortcut.goesQuiet` | 快捷键执行时还会再次检查条件。命令失效或按键被占用时，它不会改做别的事，只会失效。 | commandList：在哪儿都成立的命令 | `ponder.anchors.customShortcut.commandList` |
| `folia-desktop` | `folia-desktop-wallpaper` | 壁纸模式 | `ponder.captions.desktop.windowNormal` | 桌面版多出三项功能：窗口层级、系统托盘和遥控窗口。先从普通主窗口开始。 | mainWindow：主窗口 | `ponder.anchors.desktop.mainWindow` |
| `folia-desktop` | `folia-desktop-wallpaper` | 壁纸模式 | `ponder.captions.desktop.wallpaper` | 壁纸模式会把窗口放到桌面底层，歌词铺在桌面上；键盘在此模式下不可用。 | page：桌面 | `ponder.anchors.desktop.page` |
| `folia-desktop` | `folia-desktop-wallpaper` | 壁纸模式 | `ponder.captions.desktop.wallpaperExit` | 所以退出壁纸模式不能靠点窗口。走托盘菜单里的「壁纸模式」，或者在命令窗口里搜同一条命令。 | trayIcon：托盘图标 | `ponder.anchors.desktop.trayIcon` |
| `folia-desktop` | `folia-desktop-tray` | 系统托盘 | `ponder.captions.desktop.trayIcon` | 托盘图标位于任务栏角落。最小化到托盘后，主窗口不在任务栏，但播放和媒体键仍正常。 | trayIcon：托盘图标 | `ponder.anchors.desktop.trayIcon` |
| `folia-desktop` | `folia-desktop-tray` | 系统托盘 | `ponder.captions.desktop.trayMenu` | 托盘菜单可在不打开主窗口的情况下显示/隐藏窗口、打开遥控窗口、设置透明和置顶等。壁纸模式下，托盘是退出入口。 | trayMenu：托盘菜单 | `ponder.anchors.desktop.trayMenu` |
| `folia-desktop` | `folia-desktop-remote` | 遥控窗口 | `ponder.captions.desktop.remote` | 遥控窗口可从命令窗口或托盘打开；主窗口最小化或进入壁纸模式时仍可使用。 | remoteWindow：遥控窗口 | `ponder.anchors.desktop.remoteWindow` |
| `folia-desktop` | `folia-desktop-remote` | 遥控窗口 | `ponder.captions.desktop.remoteChrome` | 遥控窗口有自己的置顶、透明、点击穿透、任务栏图标和自动隐藏设置，与主窗口互不影响。 | remoteWindow：遥控窗口 | `ponder.anchors.desktop.remoteWindow` |
| `folia-shortcuts` | `help-page-shortcuts` | 四个最常用的快捷键 | `ponder.captions.onboarding.shortcutK` | {{mod}} + K 打开命令窗口，功能和设置都可直接搜索。 | page：命令面板 | `ponder.anchors.pages.commandPalette` |
| `folia-shortcuts` | `help-page-shortcuts` | 四个最常用的快捷键 | `ponder.captions.onboarding.shortcutP` | {{mod}} + P 打开播放队列；输入行可筛选，也支持 @artist: 等条件。 | page：命令面板 | `ponder.anchors.pages.commandPalette` |
| `folia-shortcuts` | `help-page-shortcuts` | 四个最常用的快捷键 | `ponder.captions.onboarding.shortcutB` | {{mod}} + B 打开 Lattice；已在 Lattice 时返回。 | page：命令面板 | `ponder.anchors.pages.commandPalette` |
| `folia-shortcuts` | `help-page-shortcuts` | 四个最常用的快捷键 | `ponder.captions.onboarding.shortcutG` | Ctrl + G 就是刚才那一下：打开当前页面的思索教程。任何时候迷路了，先按它。 | page：命令面板 | `ponder.anchors.pages.commandPalette` |
| `folia-transport` | `help-page-transport` | 不用切回来也能控制播放 | `ponder.captions.onboarding.mediaKeys` | Windows 用 SMTC，Linux 用 MPRIS；系统媒体键和媒体浮窗都可控制或显示当前歌曲。 | page：播放器 | `ponder.anchors.pages.player` |
| `folia-transport` | `help-page-transport` | 不用切回来也能控制播放 | `ponder.captions.onboarding.inAppTransport` | Space 播放/暂停，{{mod}} + ←/→ 切歌；播放页 ←/→ 快退或快进 5 秒。更多操作用命令窗口。 | page：播放器 | `ponder.anchors.pages.player` |
| `grid-action-button` | `grid-action-button-list` | 点一下开曲目列表 | `ponder.captions.gridActionButton.tap` | 集合页和海报墙右下角都有这颗按钮。点一下，曲目列表从右边切进来 —— 这是它的第一个动作。 | button：右下角那颗按钮 | `ponder.anchors.gridActionButton.button` |
| `grid-action-button` | `grid-action-button-list` | 点一下开曲目列表 | `ponder.captions.gridActionButton.list` | 列表里一行一首，点哪首播哪首。本地文件夹的列表顶上还多两颗排序控件。 | listPanel：曲目列表 | `ponder.anchors.gridActionButton.list` |
| `grid-action-button` | `grid-action-button-slide` | 往左滑是第二个动作 | `ponder.captions.gridActionButton.track` | 它背后还藏着一条向左的滑轨，平时看不见 —— 和播放页右缘那颗手柄是同一个手势。按住按钮往左拖。 | track：隐藏的滑轨 | `ponder.anchors.gridActionButton.track` |
| `grid-action-button` | `grid-action-button-slide` | 往左滑是第二个动作 | `ponder.captions.gridActionButton.slideTarget` | 松手后打开本页筛选，也可在设置 · 快捷操作中改为命令窗口。 | filterBar：本页筛选 | `ponder.anchors.gridActionButton.slideTarget` |
| `grid-page` | `grid-page-structure` | 页头的每个入口 | `ponder.captions.pages.gridHelp` | 左侧齿轮打开帮助页；有新版本时，更新提示也会出现在这里。Help 内仍可打开版本更新说明和本页 Ponder。 | help：Folia 与帮助入口 | `ponder.anchors.grid.help` |
| `grid-page` | `grid-page-structure` | 页头的每个入口 | `ponder.captions.pages.gridTabs` | 中间页签切换歌单、电台、专辑、本地库、Navidrome 与 Stage。Lattice 图标只在已有播放队列时出现。 | tabs：内容来源页签 | `ponder.anchors.grid.tabs` |
| `grid-page` | `grid-page-structure` | 页头的每个入口 | `ponder.captions.pages.gridSearchBox` | 右侧是跨当前来源的歌曲搜索。输入后按 Enter 会进入搜索工作台；它不会筛选下方的集合海报。 | search：歌曲搜索 | `ponder.anchors.grid.search` |
| `grid-page` | `grid-page-tabs` | 切换来源与专属操作 | `ponder.captions.pages.gridTabResult` | 切换页签后，下方 3D 轨道会换成该来源的集合，并记住各来源最后聚焦的位置。 | tabs：内容来源页签 | `ponder.anchors.grid.tabs` |
| `grid-page` | `grid-page-tabs` | 切换来源与专属操作 | `ponder.captions.pages.gridSourceActions` | 这一组只在当前来源需要时出现，例如本地库的导入、刷新和播放列表导入，或服务器库的重新加载。 | sourceActions：来源专属操作 | `ponder.anchors.grid.sourceActions` |
| `grid-page` | `grid-page-cards` | 移动焦点并打开集合 | `ponder.captions.pages.gridCardMove` | 拖动、滚轮或左右方向键移动轨道。点非中央海报只会把它移到中央，不会立刻打开。 | shelf：3D 海报轨道 | `ponder.anchors.grid.shelf` |
| `grid-page` | `grid-page-cards` | 移动焦点并打开集合 | `ponder.captions.pages.gridCardOpen` | 再次点击中央海报，或按 Enter，才进入集合 GridView；底部文字始终描述当前中央海报。 | focusedCard：当前海报 | `ponder.anchors.grid.focusedCard` |
| `grid-page` | `grid-page-map` | 用地图总览全部集合 | `ponder.captions.pages.gridMap` | 点顶部「全部」打开 GridMap 查看所有集合；{{mod}} + F 或直接输入可筛选集合。 | map：全部集合地图 | `ponder.anchors.grid.map` |
| `grid-page` | `grid-page-search` | 搜索歌曲而不是筛选海报 | `ponder.captions.pages.gridSearchResult` | 提交右上角搜索后会打开独立搜索工作台，结果按歌曲列出，可播放、打开艺人/专辑或加入队列。 | search：歌曲搜索 | `ponder.anchors.grid.search` |
| `grid-page` | `grid-page-keyboard` | Grid3D 的全部页面快捷键 | `ponder.captions.pages.gridCardKeys` | ← / → 切换中央海报，Enter 打开当前集合；滚轮和水平拖动执行同样的焦点移动。 | shelf：3D 海报轨道 | `ponder.anchors.grid.shelf` |
| `grid-page` | `grid-page-keyboard` | Grid3D 的全部页面快捷键 | `ponder.captions.pages.gridPageKeys` | Tab / Shift + Tab 切换页签；{{mod}} + K 命令；{{mod}} + B 进 Lattice（需有队列）；Ctrl + G 本页 Ponder。 | page：海报墙 | `ponder.anchors.pages.grid` |
| `grid-palette-hotkey` | `grid-palette-hotkey-owner` | 网格上的 S 归谁 | `ponder.captions.gridHotkey.off` | 在海报墙和集合页，按字母直接筛选；默认按 S 也是筛选，不会打开命令窗口。 | toggle：海报墙上用 S 键打开命令窗口 | `ponder.anchors.gridHotkey.toggle` |
| `grid-palette-hotkey` | `grid-palette-hotkey-owner` | 网格上的 S 归谁 | `ponder.captions.gridHotkey.on` | 打开后，S 用于打开命令窗口，其他字母仍用于筛选。 | toggle：海报墙上用 S 键打开命令窗口 | `ponder.anchors.gridHotkey.toggle` |
| `grid-view-card-settings` | `grid-view-card-cover` | 封面怎么占这张卡 | `ponder.captions.gridStyle.fullBleed` | 全画幅封面让集合页封面铺满卡片，歌名和歌手显示在渐变遮罩上。 | fullBleed：全画幅封面 | `ponder.anchors.gridViewCard.fullBleed` |
| `grid-view-card-settings` | `grid-view-card-cover` | 封面怎么占这张卡 | `ponder.captions.gridStyle.squareCard` | 只有打开全画幅封面后才会显示「正方形卡片」。打开后卡片等宽等高，方形封面不会被裁切。 | square：正方形卡片 | `ponder.anchors.gridViewCard.square` |
| `grid-view-card-settings` | `grid-view-card-falloff` | 离中心越远，衰减到多少 | `ponder.captions.gridStyle.minScale` | 这条滑杆设置外围卡片的最小缩放比例。调高更易辨认，调低纵深感更强。 | minScale：卡片最小尺寸 | `ponder.anchors.gridViewCard.minScale` |
| `grid-view-card-settings` | `grid-view-card-falloff` | 离中心越远，衰减到多少 | `ponder.captions.gridStyle.minOpacity` | 同理，这条是「最多淡到多少」。两条一起决定了这片网格看起来是平铺的还是有纵深的。 | minOpacity：卡片最小透明度 | `ponder.anchors.gridViewCard.minOpacity` |
| `grid-view-card-settings` | `grid-view-card-falloff` | 离中心越远，衰减到多少 | `ponder.captions.gridStyle.falloffReset` | 调乱了按这颗恢复默认衰减。它只复位那两条滑杆，封面形状那两个开关不受影响。 | reset：恢复默认衰减 | `ponder.anchors.gridViewCard.reset` |
| `grid-view-edit-mode` | `grid-view-edit-mode-cards` | 进去之后卡片变成什么样 | `ponder.captions.gridViewEdit.normalCard` | 常态下卡片底部有两颗：左边圆的是播放，右边那颗是把这首加进队列。点卡片本身不播放，只是把它移到中央。 | actions：播放与加入队列 | `ponder.anchors.gridViewCards.actions` |
| `grid-view-edit-mode` | `grid-view-edit-mode-cards` | 进去之后卡片变成什么样 | `ponder.captions.gridViewEdit.editCard` | 编辑模式下按钮移到右上角的红叉，点击立即移除歌曲，不会弹确认框。 | removeBadge：移除 | `ponder.anchors.gridViewCards.remove` |
| `grid-view-edit-mode` | `grid-view-edit-mode-rename` | 改名什么时候才算数 | `ponder.captions.gridViewEdit.rename` | 本地和 Navidrome 歌单的改名会在退出编辑模式时提交；中途按 Esc 或关闭页面会丢失改动。 | page：集合页网格 | `ponder.anchors.gridViewCards.page` |
| `grid-view-edit-mode` | `grid-view-edit-mode-rename` | 改名什么时候才算数 | `ponder.captions.gridViewEdit.onlinePlaylist` | 在线的自有歌单走的是另一条路：它是就地编辑，改一下算一下，没有「退出时提交」这个步骤。同一颗按钮，两种来源两种行为。 | cards：歌曲卡片 | `ponder.anchors.gridViewCards.cards` |
| `grid-view-page` | `grid-view-page-structure` | 集合页的完整结构 | `ponder.captions.pages.gridViewBack` | 左上角返回按钮退出当前集合，并清理这次进入使用的导航记录。Esc 在没有更内层状态时也会返回。 | back：返回上一级 | `ponder.anchors.gridView.back` |
| `grid-view-page` | `grid-view-page-structure` | 集合页的完整结构 | `ponder.captions.pages.gridViewTitle` | 中央标题显示集合名称和说明。有信息面板的集合可点击标题，展开或收起左侧详情。 | title：集合标题与信息开关 | `ponder.anchors.gridView.title` |
| `grid-view-page` | `grid-view-page-structure` | 集合页的完整结构 | `ponder.captions.pages.gridViewCards` | 歌曲以可拖动的蜂窝网格铺开；这不是规则行列列表，卡片位置会围绕当前焦点重新组织。 | cards：蜂窝歌曲网格 | `ponder.anchors.gridView.cards` |
| `grid-view-page` | `grid-view-page-navigation` | 拖动与键盘移动 | `ponder.captions.pages.gridViewPan` | 在空白处拖动整片蜂窝网格；触摸屏同样可拖。卡片内的按钮和艺人/专辑链接不会误触发平移。 | cards：蜂窝歌曲网格 | `ponder.anchors.gridView.cards` |
| `grid-view-page` | `grid-view-page-navigation` | 拖动与键盘移动 | `ponder.captions.pages.gridViewFocus` | 方向键按空间方向寻找相邻卡片并把它带入焦点；当前焦点也会被记住，返回后不会跳回开头。 | card：当前歌曲卡片 | `ponder.anchors.gridView.card` |
| `grid-view-page` | `grid-view-page-info` | 集合信息和批量操作 | `ponder.captions.pages.gridViewInfo` | 点击标题打开信息面板：封面、创建者和说明在上方，全部播放、加入队列以及编辑、重扫、导出等来源专属动作在下方。 | info：集合信息与批量操作 | `ponder.anchors.gridView.info` |
| `grid-view-page` | `grid-view-page-filter` | 筛选当前集合 | `ponder.captions.pages.gridViewFilter` | {{mod}} + F 或直接输入打开筛选；--play 播放结果，--add 加入队列；Esc 清空并关闭。 | filter：本页筛选 | `ponder.anchors.gridView.filter` |
| `grid-view-page` | `grid-view-page-activate` | 打开或播放卡片 | `ponder.captions.pages.gridViewActivate` | 点卡片只会把它移到中央；播放用卡片上的播放键，旁边是加入队列。编辑模式下改为右上角的移除按钮。 | card：当前歌曲卡片 | `ponder.anchors.gridView.card` |
| `grid-view-page` | `grid-view-page-activate` | 打开或播放卡片 | `ponder.captions.pages.gridViewKeys` | Enter 激活当前卡片；Esc 依次关闭内层状态、清除焦点，最后返回上一级。 | card：当前歌曲卡片 | `ponder.anchors.gridView.card` |
| `grid3d-card-style` | `grid3d-card-style-options` | 两种卡片长什么样 | `ponder.captions.gridStyle.grid3dImage` | 「纯图片封面」让整张卡就是一张封面，歌单名压在封面底部的渐变里。 | optionImage：纯图片封面 | `ponder.anchors.grid3dCardStyle.image` |
| `grid3d-card-style` | `grid3d-card-style-options` | 两种卡片长什么样 | `ponder.captions.gridStyle.grid3dCard` | 「拍立得卡片」是默认的样子：封面缩到上半部，下面留一条边写名称；封面不裁切，但每屏能放的卡片更少。 | optionCard：拍立得卡片 | `ponder.anchors.grid3dCardStyle.card` |
| `help-page` | `help-page-overview` | 思索复杂操作和组件 | `ponder.captions.onboarding.overviewCtrlG` | 第一步：在任何页面按下 Ctrl + G，就能打开这一页的思索。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `help-page` | `help-page-overview` | 思索复杂操作和组件 | `ponder.captions.onboarding.overviewWholePage` | 思索会一步一步讲解当前页面：上面有什么，各在哪里，可以怎么操作。你现在看的就是一段思索。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `help-page` | `help-page-overview` | 思索复杂操作和组件 | `ponder.captions.onboarding.overviewHover` | 第二步：有些按钮和组件比较复杂。把指针停在上面，旁边会出现思索提示。 | capsule：悬停提示 | `ponder.anchors.onboarding.capsule` |
| `help-page` | `help-page-overview` | 思索复杂操作和组件 | `ponder.captions.onboarding.overviewHold` | 第三步：看到提示后，按住 G 不放。进度走满后，会打开这个组件的思索；提前松手则取消。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `help-page` | `help-page-overview` | 思索复杂操作和组件 | `ponder.captions.onboarding.overviewSettings` | 不需要这些提示时，可以在设置中关闭。点下方按钮可直接打开设置。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `help-page` | `help-page-command-palette` | 命令面板 | `ponder.captions.onboarding.overviewCommandPalette` | 在任何界面，按 Ctrl + K 呼出命令面板。命令面板是应用的主要操作方式。使用命令面板可以在任何页面进行常用功能调整。 | input：输入行 | `ponder.anchors.commandPalette.input` |
| `help-page` | `help-page-command-examples` | 常用操作示例 | `ponder.captions.onboarding.overviewExampleVolume` | 例如在任何地方调节音量。 | volume：音量面板 | `ponder.anchors.playerBar.volumeSurface` |
| `help-page` | `help-page-command-examples` | 常用操作示例 | `ponder.captions.onboarding.overviewExampleQueue` | 或者拉起队列搜索。 | queueSearch：队列窗口 | `ponder.anchors.queueCommand.panel` |
| `help-page` | `help-page-command-examples` | 常用操作示例 | `ponder.captions.onboarding.overviewExampleFilter` | 或者直接对当前歌单进行二次检索，然后送入播放队列。 | playlistFilter：集合网格 | `ponder.anchors.pages.gridView` |
| `help-page` | `help-page-docs` | 官方文档 | `ponder.captions.onboarding.overviewDocs` | 更多功能和说明，请查看官方文档站点了解。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `import-export-settings` | `import-export-scope` | 它到底带走了什么 | `ponder.captions.importExport.scope` | 导出外观设置：主题、歌词动画、渲染参数、字幕、字体、背景和卡片。 | copy：这一组做什么 | `ponder.anchors.importExport.copy` |
| `import-export-settings` | `import-export-scope` | 它到底带走了什么 | `ponder.captions.importExport.notBackup` | 它只备份外观：主题、歌词动画、渲染参数、字幕、字体、背景和卡片。歌单、曲库、播放设置、快捷键和账号不在里面。 | panel：设置 · 备份与导入 | `ponder.anchors.importExport.panel` |
| `import-export-settings` | `import-export-export` | 导出 | `ponder.captions.importExport.themeChoice` | 导出前选择是否带主题：AI 主题、自定义主题，或不包含主题。只想分享视觉设置时选「不包含主题」。 | themeChips：带哪个主题 | `ponder.anchors.importExport.themeChips` |
| `import-export-settings` | `import-export-export` | 导出 | `ponder.captions.importExport.clipboard` | 两个按钮都是复制：一个复制短码，一个复制可读 JSON。两者都是完整配置。 | exportButtons：复制出去 | `ponder.anchors.importExport.exportButtons` |
| `import-export-settings` | `import-export-export` | 导出 | `ponder.captions.importExport.paste` | 导入走的是同一个框的反方向：把别人那串码粘进来，右边那颗导入就亮了。 | textarea：配置文本 | `ponder.anchors.importExport.textarea` |
| `import-export-settings` | `import-export-confirm` | 导入会先问过你 | `ponder.captions.importExport.plan` | 导入前会按组列出变更，并显示修改前后的值。每一项都可以单独取消。 | dialogGroups：按组列出的改动 | `ponder.anchors.importExport.dialogGroups` |
| `import-export-settings` | `import-export-confirm` | 导入会先问过你 | `ponder.captions.importExport.derived` | 有些改动不会写在配置里，但会随导入发生：例如切到自定义主题、删除已上传字体。它们不能单独取消，只能取消对应的主改动。 | dialogDerived：你没挑、却会被改掉的 | `ponder.anchors.importExport.dialogDerived` |
| `lattice-chrome` | `lattice-chrome-layout` | 这条控制条上有什么 | `ponder.captions.latticeChrome.intro` | 在墙上展开一张海报，它底部会长出一条播放控制。这条只属于展开的那张卡，收起来就没有了。 | chrome：播放控制条 | `ponder.anchors.latticeChrome.chrome` |
| `lattice-chrome` | `lattice-chrome-layout` | 这条控制条上有什么 | `ponder.captions.latticeChrome.playAndSeek` | 最左边是播放 / 暂停：这张卡不是当前歌曲时，按它是从这首开始播。底下那条进度条可以直接拖动跳转。 | play：播放 / 暂停 | `ponder.anchors.latticeChrome.play` |
| `lattice-chrome` | `lattice-chrome-layout` | 这条控制条上有什么 | `ponder.captions.latticeChrome.openPlayer` | 右端那个斜箭头回到播放页。海报上的其它位置是选中和展开，只有这里会离开 Lattice。 | openPlayer：回到播放页 | `ponder.anchors.latticeChrome.openPlayer` |
| `lattice-chrome` | `lattice-chrome-shared-slots` | 中间两个和底栏是同一份 | `ponder.captions.latticeChrome.ends` | 中间四个按钮，两端固定是上一首和下一首 —— 这两个位置不可配置。 | prev：上一首 | `ponder.anchors.latticeChrome.prev` |
| `lattice-chrome` | `lattice-chrome-shared-slots` | 中间两个和底栏是同一份 | `ponder.captions.latticeChrome.sharedSlots` | 中间那两个不是另一套按钮，就是底部控制条右边那两个槽位的同一份：同一个动作、同一个图标、同一套可用性判断。 | slotPrimary：第一个槽位 | `ponder.anchors.latticeChrome.slotPrimary` |
| `lattice-chrome` | `lattice-chrome-shared-slots` | 中间两个和底栏是同一份 | `ponder.captions.latticeChrome.swap` | 所以在设置里把底栏的槽位换掉，这里也跟着变 —— 不需要、也没有第二个地方再配一遍。 | slotPrimary：第一个槽位 | `ponder.anchors.latticeChrome.slotPrimary` |
| `lattice-chrome` | `lattice-chrome-bottom-bar` | 卡片看不见时底栏顶上来 | `ponder.captions.latticeChrome.onlyWhenVisible` | 这条控制条只在展开的海报上。海报没展开，或者展开的那张被滚出了视口，它就不在屏幕上。 | chrome：播放控制条 | `ponder.anchors.latticeChrome.chrome` |
| `lattice-chrome` | `lattice-chrome-bottom-bar` | 卡片看不见时底栏顶上来 | `ponder.captions.latticeChrome.barShows` | 这时候底部控制条会自己顶上来：正在播的那首海报一离开视口，它就出现；滚回去看得见了，它又收起。播放控制不会真的消失。 | bottomBar：底部控制条 | `ponder.anchors.latticeChrome.bottomBar` |
| `lattice-page` | `lattice-page-structure` | 队列墙、返回与工具 | `ponder.captions.pages.latticeWall` | Lattice 将队列铺成不规则海报墙，同一首歌可重复出现；当前歌曲显示编号和状态。 | wall：播放队列海报墙 | `ponder.anchors.lattice.wall` |
| `lattice-page` | `lattice-page-structure` | 队列墙、返回与工具 | `ponder.captions.pages.latticeBack` | 左上角返回；{{mod}} + B 关闭 Lattice。Esc 先收起展开内容或清除焦点，再按一次返回。 | back：返回 | `ponder.anchors.lattice.back` |
| `lattice-page` | `lattice-page-navigation` | 在无限墙上移动焦点 | `ponder.captions.pages.latticePan` | 在墙面拖动或滚轮平移相机，海报会随视口动态出现；拖动结束后的惯性不会改变播放队列顺序。 | wall：播放队列海报墙 | `ponder.anchors.lattice.wall` |
| `lattice-page` | `lattice-page-navigation` | 在无限墙上移动焦点 | `ponder.captions.pages.latticeFocusKeys` | 方向键从视口中央选择最近海报，再按空间方向移动焦点，并自动平移相机让目标可见。 | pannedPoster：队列海报 | `ponder.anchors.lattice.poster` |
| `lattice-page` | `lattice-page-poster` | 展开海报并控制播放 | `ponder.captions.pages.latticePosterOpen` | 点击或按 Enter 展开海报。当前歌曲展开后显示同步歌词；其他歌曲展开后显示标题与播放入口，队列本身不会被重排。 | expanded：展开的歌曲 | `ponder.anchors.lattice.expanded` |
| `lattice-page` | `lattice-page-poster` | 展开海报并控制播放 | `ponder.captions.pages.latticeChrome` | 展开海报显示播放、额外槽位、时间、进度和返回 Player；触屏点海报，键盘按 Space 显示或隐藏控制条。 | chrome：播放控制 | `ponder.anchors.lattice.chrome` |
| `lattice-page` | `lattice-page-tools` | 定位、队列与灯光 | `ponder.captions.pages.latticeTools` | 右下角工具和资料库墙是同一套：顶上一排图标是聚焦当前歌曲、打乱队列、生成主题、播放队列、回到主页和前往播放页，下面是音量、切歌时自动跟随、灯光开关与快捷键说明；向左滑这个按钮会打开命令面板。 | toolsPanel：工具面板 | `ponder.anchors.lattice.toolsPanel` |
| `lattice-page` | `lattice-page-tools` | 定位、队列与灯光 | `ponder.captions.pages.latticeLights` | 灯光关闭后海报退暗，只保留必要层次；这是显示设置，不会暂停播放或修改队列。 | wall：播放队列海报墙 | `ponder.anchors.lattice.wall` |
| `lattice-page` | `lattice-page-keyboard` | Lattice 的完整键盘操作 | `ponder.captions.pages.latticePosterKeys` | 收起时 Enter/Space 展开；展开后 Enter 播放/暂停，Space 显示控制，Esc 收起。 | poster：队列海报 | `ponder.anchors.lattice.poster` |
| `lattice-page` | `lattice-page-keyboard` | Lattice 的完整键盘操作 | `ponder.captions.pages.latticePageKeys` | : + C 当前歌曲；{{mod}} + P 队列；{{mod}} + B 返回；{{mod}} + K 命令；方向键移动。 | page：Lattice | `ponder.anchors.pages.lattice` |
| `lattice-style-settings` | `lattice-style-tint` | 暗角与海报叠色 | `ponder.captions.gridStyle.latticeVignette` | 「边缘暗角」在队列拼贴页面四周压一层淡淡的暗，把视线收到中间的海报上。它只是显示效果，不影响队列本身。 | vignette：边缘暗角 | `ponder.anchors.latticeStyle.vignette` |
| `lattice-style-settings` | `lattice-style-tint` | 暗角与海报叠色 | `ponder.captions.gridStyle.latticeTint` | 「海报聚焦叠色」会让播放中、聚焦和悬停的海报更醒目。关闭后，叠色强度和自定义颜色那几行也会隐藏。 | tint：海报聚焦叠色 | `ponder.anchors.latticeStyle.tint` |
| `lattice-style-settings` | `lattice-style-tint` | 暗角与海报叠色 | `ponder.captions.gridStyle.latticeIntensity` | 打开之后下面才有「叠色强度」。它是百分比：调到 0 等于没叠色，调高普通海报越暗、正在播的那张越突出。 | intensity：叠色强度 | `ponder.anchors.latticeStyle.intensity` |
| `lattice-style-settings` | `lattice-style-custom-color` | 换成一个固定颜色 | `ponder.captions.gridStyle.latticeCustomColor` | 默认的叠色是从当前主题算出来的渐变，会跟着换主题一起变。打开「强制使用自定义颜色」就把它钉死成一个颜色，主题怎么换都不动。 | customColor：强制使用自定义颜色 | `ponder.anchors.latticeStyle.customColor` |
| `lattice-style-settings` | `lattice-style-custom-color` | 换成一个固定颜色 | `ponder.captions.gridStyle.latticePicker` | 开了它，下面才出现取色器。拖动时海报墙实时跟着变，松手才真正存下来。 | picker：取色器 | `ponder.anchors.latticeStyle.picker` |
| `local-folder-actions` | `local-folder-actions-list` | 这一列有什么取决于你打开的是什么 | `ponder.captions.localFolderActions.conditional` | 操作栏随本地集合类型变化：文件夹可重扫和整理歌曲信息，本地歌单可导出，本地专辑或艺术家可编辑实体。 | panel：来源专属动作 | `ponder.anchors.localFolderActions.panel` |
| `local-folder-actions` | `local-folder-actions-list` | 这一列有什么取决于你打开的是什么 | `ponder.captions.localFolderActions.playAll` | 最上面两颗任何集合都有：全部播放和加入队列。页面上开着筛选时，它们作用于筛出来的那些，按钮文字会写出条数。 | playAll：全部播放 | `ponder.anchors.localFolderActions.playAll` |
| `local-folder-actions` | `local-folder-actions-maintenance` | 重扫与整理歌曲信息 | `ponder.captions.localFolderActions.reimport` | 重新导入会增量扫描文件夹：新增、更新和移除分别处理，不会重建已有记录。 | reimport：重新导入 | `ponder.anchors.localFolderActions.reimport` |
| `local-folder-actions` | `local-folder-actions-maintenance` | 重扫与整理歌曲信息 | `ponder.captions.localFolderActions.organize` | 「整理歌曲信息」打开的是这个文件夹的批量改 tag 面板 —— 一次处理整个文件夹，不是一首一首改。 | organize：整理歌曲信息 | `ponder.anchors.localFolderActions.organize` |
| `local-folder-actions` | `local-folder-actions-delete` | 红色那颗会删东西 | `ponder.captions.localFolderActions.remove` | 最下面这颗红的把这个文件夹从曲库里移除。它不删磁盘上的文件，但曲库里这些歌的记录、以及它们在歌单里的位置都会跟着没。 | remove：从曲库移除 | `ponder.anchors.localFolderActions.remove` |
| `local-folder-actions` | `local-folder-actions-delete` | 红色那颗会删东西 | `ponder.captions.localFolderActions.confirm` | 删除前会确认；根文件夹和子文件夹的影响范围不同，确认框会说明。 | panel：来源专属动作 | `ponder.anchors.localFolderActions.panel` |
| `local-grid-controls` | `local-grid-controls-sources` | 文件夹、专辑、艺术家与本地歌单 | `ponder.captions.localGridControls.sources` | 这一排在本地曲库内部切换文件夹、专辑、艺术家和本地歌单。它换的是 Grid3D 轨道里的集合类型，不是切换在线音乐来源。 | tabs：本地集合类型 | `ponder.anchors.localGridControls.tabs` |
| `local-grid-controls` | `local-grid-controls-sources` | 文件夹、专辑、艺术家与本地歌单 | `ponder.captions.localGridControls.foldersAndPlaylists` | 「文件夹」保留导入时的目录结构；「歌单」是 Folia 保存在本地的歌单，和在线歌单、Navidrome 歌单彼此独立。 | playlists：本地歌单 | `ponder.anchors.localGridControls.playlists` |
| `local-grid-controls` | `local-grid-controls-maintenance` | 导入与刷新本地曲库 | `ponder.captions.localGridControls.imports` | 「导入文件夹」从目录加入音乐；「导入歌单」读取 M3U/M3U8，并用 Folia 能解析到的曲目建立本地歌单。 | imports：导入文件 | `ponder.anchors.localGridControls.imports` |
| `local-grid-controls` | `local-grid-controls-maintenance` | 导入与刷新本地曲库 | `ponder.captions.localGridControls.refresh` | 「刷新」重新扫描已经导入的根目录，找出新增、变化和丢失的文件；它不会再复制一份曲库。 | refresh：刷新曲库 | `ponder.anchors.localGridControls.refresh` |
| `local-grid-map-directory-tree` | `local-grid-map-directory-hierarchy` | 目录层级 | `ponder.captions.localGridMapDirectory.hierarchy` | 这里按导入时的目录重建层级。缩进代表嵌套；只有单个子目录的长链会压缩显示，分叉点和直接包含歌曲的目录仍会单独列出。 | tree：目录树 | `ponder.anchors.localGridMap.tree` |
| `local-grid-map-directory-tree` | `local-grid-map-directory-hierarchy` | 目录层级 | `ponder.captions.localGridMapDirectory.expand` | 箭头只展开或收起子目录，不会改变选择。标题栏里的加宽按钮能给较深的路径更多横向空间。 | expand：展开目录 | `ponder.anchors.localGridMap.expand` |
| `local-grid-map-directory-tree` | `local-grid-map-directory-selection` | 选择子树或仅直属曲目 | `ponder.captions.localGridMapDirectory.selection` | 有子目录的文件夹会在三种状态间循环：整个子树、全部不选、只选这个目录直属的曲目。叶子目录只有全选与不选。数量以当前筛选后的地图为准。 | checkbox：选择状态 | `ponder.anchors.localGridMap.checkbox` |
| `local-grid-map-directory-tree` | `local-grid-map-directory-selection` | 选择子树或仅直属曲目 | `ponder.captions.localGridMapDirectory.rootActions` | 导入根目录还带维护操作：重扫该根目录、恢复被忽略的目录，或从曲库移除根目录。移除曲库记录不会删除磁盘上的音频文件。 | rootActions：根目录维护操作 | `ponder.anchors.localGridMap.rootActions` |
| `local-grid-map-page` | `local-grid-map-structure` | 本地集合地图 | `ponder.captions.localGridMap.page` | 这是本地曲库的 GridMap。它把当前分类里的文件夹、专辑、艺术家或本地歌单铺成一张蜂窝地图，而不是只看 Grid3D 的单条轨道。 | cards：本地集合 | `ponder.anchors.localGridMap.cards` |
| `local-grid-map-page` | `local-grid-map-structure` | 本地集合地图 | `ponder.captions.localGridMap.cards` | 拖动或滚轮可在地图上移动。点一张卡会回到 Grid3D 并聚焦它；激活卡片则直接进入该集合。 | cards：本地集合 | `ponder.anchors.localGridMap.cards` |
| `local-grid-map-page` | `local-grid-map-batch` | 选择集合并操作其中曲目 | `ponder.captions.localGridMap.openPanel` | 文件夹、专辑和艺术家地图可点击中央标题打开批量选择：文件夹显示目录树，专辑和艺术家显示扁平列表；本地歌单地图只提供浏览。 | panel：批量选择面板 | `ponder.anchors.localGridMap.panel` |
| `local-grid-map-page` | `local-grid-map-batch` | 选择集合并操作其中曲目 | `ponder.captions.localGridMap.batchActions` | 面板会把选中的集合换算成曲目。可以播放、加入队列、建立本地歌单；在文件夹地图里还可移除选中的曲库记录。 | actions：操作所选曲目 | `ponder.anchors.localGridMap.actions` |
| `local-grid-map-page` | `local-grid-map-filter` | 筛选与返回 | `ponder.captions.localGridMap.filter` | {{mod}} + F 或直接输入可筛选地图。批量选择与目录树会跟随筛选后的卡片，所以操作只作用于当前可见的选择。 | cards：本地集合 | `ponder.anchors.localGridMap.cards` |
| `local-grid-map-page` | `local-grid-map-filter` | 筛选与返回 | `ponder.captions.localGridMap.back` | 返回会关闭 GridMap，回到进入前的本地 Grid3D 分类和焦点位置。 | back：返回 Grid3D | `ponder.anchors.localGridMap.back` |
| `local-library-watch` | `local-library-watch-roots` | 监视列表与失效的那一行 | `ponder.captions.libraryWatch.enable` | 打开后，Folia 会监视已导入的本地文件夹并自动增量扫描。 | enable：自动扫描 | `ponder.anchors.libraryWatch.enable` |
| `local-library-watch` | `local-library-watch-roots` | 监视列表与失效的那一行 | `ponder.captions.libraryWatch.roots` | 开关底下才展开这张列表，一行一个被监视的根文件夹，下面那行小字是它的真实路径。 | roots：监视中的文件夹 | `ponder.anchors.libraryWatch.roots` |
| `local-library-watch` | `local-library-watch-roots` | 监视列表与失效的那一行 | `ponder.captions.libraryWatch.warning` | 眼睛表示监视正常；黄色三角表示路径或权限有问题，文件夹已停止自动扫描。 | roots：监视中的文件夹 | `ponder.anchors.libraryWatch.roots` |
| `local-library-watch` | `local-library-watch-roots` | 监视列表与失效的那一行 | `ponder.captions.libraryWatch.recheck` | 看到三角就按右边这颗「重新检查文件夹」，它会重新挂一遍所有导入过的文件夹。旁边那行小字是上一次自动扫描的时间。 | recheck：重新检查文件夹 | `ponder.anchors.libraryWatch.recheck` |
| `local-metadata-match` | `local-metadata-match-reveal` | 三重条件才出现的一颗铅笔 | `ponder.captions.localMetadata.conditions` | 手动匹配只在当前卡片是本地歌曲、且指针停在歌名上时显示。 | card：当前卡片 | `ponder.anchors.gridViewCards.card` |
| `local-metadata-match` | `local-metadata-match-reveal` | 三重条件才出现的一颗铅笔 | `ponder.captions.localMetadata.pencil` | 满足之后它浮在歌名右端，只有 65% 不透明度。点开是手动匹配面板，重新给这首歌挑一份正确的标题、歌手和专辑。 | pencil：手动匹配 | `ponder.anchors.gridViewCards.pencil` |
| `local-track-sorting` | `local-track-sorting-fields` | 只有本地文件夹能排序 | `ponder.captions.localTrackSorting.whereOnly` | 排序控件只对本地文件夹显示；其他来源的顺序由来源决定。 | sortMenu：排序方式 | `ponder.anchors.localTrackList.sortMenu` |
| `local-track-sorting` | `local-track-sorting-fields` | 只有本地文件夹能排序 | `ponder.captions.localTrackSorting.fields` | 排序方式三选一：文件名、文件修改时间、专辑内音轨号。选好之后存在本地，换一个文件夹进去还是这个排法。 | menu：排序菜单 | `ponder.anchors.localTrackList.menu` |
| `local-track-sorting` | `local-track-sorting-fields` | 只有本地文件夹能排序 | `ponder.captions.localTrackSorting.direction` | 左边那颗切升序和降序，和排序方式各自独立。 | direction：升序 / 降序 | `ponder.anchors.localTrackList.direction` |
| `lyric-export` | `lyric-export-scope` | 导出哪些、哪一份 | `ponder.captions.lyricExport.whatItIs` | 这一页把本机已有的歌词打成一个 zip，不联网下载新的歌词。 | card：导出选项 | `ponder.anchors.lyricExport.card` |
| `lyric-export` | `lyric-export-scope` | 导出哪些、哪一份 | `ponder.captions.lyricExport.effective` | 在线缓存是播放过的在线歌曲，导出的是播放时实际显示的版本，你导入或手动匹配的优先。本地曲库只导出在线匹配到的歌词：文件按音频文件名命名，按原目录结构放在 zip 的 local 文件夹里，解压到曲库所在的上一级目录，就会落在每首歌旁边。纯音乐和没有歌词的歌曲会跳过，并写进 manifest.json。 | scope：导出范围 | `ponder.anchors.lyricExport.scope` |
| `lyric-export` | `lyric-export-formats` | 两种格式与文件名 | `ponder.captions.lyricExport.formats` | .fia 无损，可以直接导回 Folia；LRC 通用，但会丢掉背景和声和分词。两种都勾上，zip 里就是两个文件夹。 | formats：导出格式 | `ponder.anchors.lyricExport.formats` |
| `lyric-export` | `lyric-export-formats` | 两种格式与文件名 | `ponder.captions.lyricExport.names` | 在线歌词缓存本身不带歌名。播放过的歌会顺手记下歌名，这是第一来源；没有的再从本机缓存过的歌单和队列里找，最后才联网问音乐平台，查到的结果会记下来，下次不用再问。关掉联网，查不到歌名的歌曲就以 ID 命名。 | names：文件命名 | `ponder.anchors.lyricExport.names` |
| `lyric-export` | `lyric-export-formats` | 两种格式与文件名 | `ponder.captions.lyricExport.running` | 开始后这里显示进度，按钮变成取消。关掉命令面板也等于取消：导出不会在后台继续跑。 | run：开始导出 | `ponder.anchors.lyricExport.run` |
| `lyric-match` | `lyric-match-search` | 换来源，重新搜 | `ponder.captions.lyricMatch.where` | 面板来源页的「在线匹配」打开这个窗口。标题下面写着正在给哪一首歌找歌词。 | header：正在匹配的歌 | `ponder.anchors.lyricMatch.header` |
| `lyric-match` | `lyric-match-search` | 换来源，重新搜 | `ponder.captions.lyricMatch.sources` | 这一排是歌词来源。点另一个，就在那个来源里再找一遍。 | sources：歌词来源 | `ponder.anchors.lyricMatch.sources` |
| `lyric-match` | `lyric-match-search` | 换来源，重新搜 | `ponder.captions.lyricMatch.search` | 窗口打开时已经搜过一遍。结果不对，就改这里的字再搜。 | search：搜索 | `ponder.anchors.lyricMatch.search` |
| `lyric-match` | `lyric-match-pick` | 挑一条，先看歌词 | `ponder.captions.lyricMatch.results` | 每一条是一首找到的歌：歌名、歌手和专辑。歌名旁边的百分数是它和这首歌有多像。 | results：搜索结果 | `ponder.anchors.lyricMatch.results` |
| `lyric-match` | `lyric-match-pick` | 挑一条，先看歌词 | `ponder.captions.lyricMatch.preview` | 点一条，右边换成它的封面和名字，下面是它的歌词，跟着正在播放的位置走；角上标着这份歌词带不带逐字、翻译和罗马音。 | lyrics：歌词预览 | `ponder.anchors.lyricMatch.lyrics` |
| `lyric-match` | `lyric-match-pick` | 挑一条，先看歌词 | `ponder.captions.lyricMatch.save` | 「保存」把选中的这一条用到这首歌上；「取消」什么都不改。 | save：保存 | `ponder.anchors.lyricMatch.save` |
| `lyric-match` | `lyric-match-local` | 本地歌曲多出来的三个开关 | `ponder.captions.lyricMatch.switches` | 给本地文件匹配时，封面下面多三个开关：「封面」「元数据」「歌词」。亮着的那一项用选中的这一条，关掉的保持文件自己的。 | switches：封面、元数据、歌词 | `ponder.anchors.lyricMatch.switches` |
| `lyric-match` | `lyric-match-local` | 本地歌曲多出来的三个开关 | `ponder.captions.lyricMatch.noMatch` | 左下角的「不使用在线数据」让这首歌只用文件自己的信息。 | noMatch：不使用在线数据 | `ponder.anchors.lyricMatch.noMatch` |
| `lyric-style` | `lyric-style-per-style` | 每种样式有自己的设置 | `ponder.captions.lyricStyle.perStyleOwn` | 每种歌词样式都有一组专属设置，只对这个样式生效。右边这一页就是当前样式的那一组。 | rows：当前样式的设置 | `ponder.anchors.lyricStyle.rows` |
| `lyric-style` | `lyric-style-per-style` | 每种样式有自己的设置 | `ponder.captions.lyricStyle.perStyleSwitch` | 换一种样式，预览和这一页设置一起整页换掉。不同样式的设置互不相通；旧样式调好的值会保留，换回去时还在。 | rows：当前样式的设置 | `ponder.anchors.lyricStyle.rows` |
| `lyric-style` | `lyric-style-per-style` | 每种样式有自己的设置 | `ponder.captions.lyricStyle.perStyleWhere` | 在控制页点歌词样式那一行中间，弹出的那一格图底部的「更多设置」会直接打开这一页；也可以用下方按钮。 | tabs：四页 | `ponder.anchors.lyricStyle.tabs` |
| `lyric-style` | `lyric-style-monet` | 莫奈：隐藏右侧部件 | `ponder.captions.lyricStyle.monetIntro` | 莫奈样式：左边歌词，右边肖像。最常见的问题是右边这几样东西怎么关。它们都在莫奈自己的设置里。 | preview：实时预览 | `ponder.anchors.lyricStyle.preview` |
| `lyric-style` | `lyric-style-monet` | 莫奈：隐藏右侧部件 | `ponder.captions.lyricStyle.monetDescription` | 左下的文字是歌曲描述。关闭「显示歌曲描述」即可隐藏。 | monetDescription：歌曲描述 | `ponder.anchors.lyricStyle.monetDescription` |
| `lyric-style` | `lyric-style-monet` | 莫奈：隐藏右侧部件 | `ponder.captions.lyricStyle.monetHanger` | 肖像上方的圆钮是拖拽调整按钮，用来挪动肖像。位置调好后，在「拖拽调整按钮」里把它隐藏。 | monetHanger：拖拽调整按钮 | `ponder.anchors.lyricStyle.monetHanger` |
| `lyric-style` | `lyric-style-monet` | 莫奈：隐藏右侧部件 | `ponder.captions.lyricStyle.monetAudio` | 肖像下方是音频图案。在「音频图案」里可以隐藏它，「频谱样式」可以在柱状和线条之间切换。 | monetAudio：音频图案 | `ponder.anchors.lyricStyle.monetAudio` |
| `lyric-style` | `lyric-style-monet` | 莫奈：隐藏右侧部件 | `ponder.captions.lyricStyle.monetBare` | 三项都关掉后，画面只剩歌词和肖像。这些开关只属于莫奈，换到别的样式时不会出现。 | preview：实时预览 | `ponder.anchors.lyricStyle.preview` |
| `lyric-style` | `lyric-style-combine` | 背景和歌词样式各选各的 | `ponder.captions.lyricStyle.combineTwo` | 背景和歌词样式是两个独立的选择。控制页里它们是上下两行：「歌词样式」和「背景类型」，各切各的。 | preview：实时预览 | `ponder.anchors.lyricStyle.preview` |
| `lyric-style` | `lyric-style-combine` | 背景和歌词样式各选各的 | `ponder.captions.lyricStyle.combineBackground` | 只换背景：歌词样式不动。背景自己的参数在歌词样式窗口的「背景」页。 | backgroundPictures：背景类型 | `ponder.anchors.lyricStyle.backgroundPictures` |
| `lyric-style` | `lyric-style-combine` | 背景和歌词样式各选各的 | `ponder.captions.lyricStyle.combineStyle` | 再只换歌词样式：刚选的背景留着。任意背景都能配任意歌词样式；只有「静止」样式不渲染背景。 | preview：实时预览 | `ponder.anchors.lyricStyle.preview` |
| `lyric-style` | `lyric-style-subtitle` | 通用底部副字幕 | `ponder.captions.lyricStyle.subtitleShared` | 多数歌词样式在底部共用这一条副字幕。莫奈、时计和静止把翻译排进自己的版面，不用这一条。 | subtitle：通用副字幕 | `ponder.anchors.lyricStyle.subtitle` |
| `lyric-style` | `lyric-style-subtitle` | 通用底部副字幕 | `ponder.captions.lyricStyle.subtitleContent` | 它的设置在歌词样式窗口的「字幕」页，对所有使用它的样式一起生效。第二行选择显示翻译、罗马音、罗马音加翻译两行，或不显示。 | subtitleContent：第二行 | `ponder.anchors.lyricStyle.rowTwo` |
| `lyric-style` | `lyric-style-subtitle` | 通用底部副字幕 | `ponder.captions.lyricStyle.subtitleBlur` | 关闭「非翻译歌词添加模糊效果」，副字幕就不再模糊。 | subtitleBlur：第五行 | `ponder.anchors.lyricStyle.rowFive` |
| `lyric-style` | `lyric-style-subtitle` | 通用底部副字幕 | `ponder.captions.lyricStyle.subtitleFont` | 关闭「字幕继承歌词字体」后，可以给字幕单独设置字体和字重；「字幕缩放」单独调整字号，随时可用。 | subtitleFollowsFont：字幕字体 | `ponder.anchors.lyricStyle.subtitleFont` |
| `lyrics-animation-settings` | `lyrics-animation-entry` | 换歌词动画在哪儿换 | `ponder.captions.lyricsAnimation.where` | 设置 · 外观最上面这一行「歌词动画样式」是换歌词样式的入口，右端写着现在用的是哪一个。 | entry：歌词动画样式 | `ponder.anchors.lyricsAnimation.entry` |
| `lyrics-animation-settings` | `lyrics-animation-entry` | 换歌词动画在哪儿换 | `ponder.captions.lyricsAnimation.playground` | 点开是歌词样式窗口。左边那一大块是实时预览，放的就是播放页真正会渲染出来的样子；右边那条窄栏才是设置。 | panel：设置 · 歌词动画 | `ponder.anchors.lyricsAnimation.panel` |
| `lyrics-animation-settings` | `lyrics-animation-entry` | 换歌词动画在哪儿换 | `ponder.captions.lyricsAnimation.playgroundSections` | 样式在预览下面那一架图里选。右栏分为歌词动画、背景、通用、字幕四页，「歌词动画」页是所选样式的参数。 | panel：设置 · 歌词动画 | `ponder.anchors.lyricsAnimation.panel` |
| `lyrics-settings` | `lyrics-settings-source` | 歌词从哪来 | `ponder.captions.lyricsSource.autoBest` | 「自动使用最佳歌词」会从网易云、AMLLDB、QQ 和酷狗匹配歌词，并可能覆盖来源页的手动选择。手动选择没有生效时，先检查这里。 | autoBest：自动使用最佳歌词 | `ponder.anchors.lyricsSource.autoBest` |
| `lyrics-settings` | `lyrics-settings-source` | 歌词从哪来 | `ponder.captions.lyricsSource.priority` | 「本地歌曲歌词优先级」这一行的两段决定本地和在线的歌词谁优先。本地文件自带的歌词和在线检索到的同时存在时，按这里说的来。 | priorityLocal：本地优先 | `ponder.anchors.lyricsSource.priorityLocal` |
| `lyrics-settings` | `lyrics-settings-offset` | 两个偏移量 | `ponder.captions.lyricsSource.globalOffset` | 「全局时间偏移」点进去是一整屏的标尺，调的是所有歌的歌词整体提前或延后多少 —— 一般用来补声卡或蓝牙的固定延迟。 | globalOffset：全局时间偏移 | `ponder.anchors.lyricsSource.globalOffset` |
| `lyrics-settings` | `lyrics-settings-offset` | 两个偏移量 | `ponder.captions.lyricsSource.offsetSum` | 来源页偏移只对当前歌曲有效，全局偏移长期生效；两者会相加。 | globalOffset：全局时间偏移 | `ponder.anchors.lyricsSource.globalOffset` |
| `online-collection-actions` | `online-collection-actions-common` | 在线集合共用的操作 | `ponder.captions.onlineCollectionActions.common` | 在线与服务器集合都提供「播放全部」和「加入播放队列」。本页有筛选时，两颗按钮只处理筛选结果，并在文字里显示条数。 | playAll：全部播放 | `ponder.anchors.onlineCollectionActions.playAll` |
| `online-collection-actions` | `online-collection-actions-provider` | 操作取决于当前来源 | `ponder.captions.onlineCollectionActions.provider` | 其余按钮由当前来源和集合类型决定：Navidrome 可能提供服务器歌单操作，在线专辑或歌单可能提供收藏、取消收藏或推荐管理。本地文件重扫和标签整理不会出现在这里。 | providerAction：来源专属操作 | `ponder.anchors.onlineCollectionActions.providerAction` |
| `online-collection-actions` | `online-collection-actions-provider` | 操作取决于当前来源 | `ponder.captions.onlineCollectionActions.destructive` | 只有当前来源支持修改且这个集合允许操作时，才会显示删除或移除。它修改的是远端或服务器集合，不会删除本地音频文件。 | destructiveAction：删除或移除 | `ponder.anchors.onlineCollectionActions.destructiveAction` |
| `panel-account-tab` | `panel-account-tab` | 账户页 | `ponder.captions.sidePanel.accountTab` | 账户页管的是当前音乐来源那一侧的事。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-account-tab` | `panel-account-tab` | 账户页 | `ponder.captions.sidePanel.accountTabDetail` | 账户页显示登录状态、默认音质和「同步数据」。没登录时，这里是一颗「去主页登录」。 | body：当前标签页内容 | `ponder.anchors.sidePanel.body` |
| `panel-controls-tab` | `panel-controls-tab` | 控制页 | `ponder.captions.sidePanel.controlsTab` | 控制页最上面是音量一行，下面三格是循环、智能过渡和音频效果器：前两格点一下就开关，第三格打开一个窗口。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-controls-tab` | `panel-controls-tab` | 控制页 | `ponder.captions.sidePanel.controlsTabDetail` | 再往下是歌词样式、背景类型两行和「播放页透明背景」开关，最下面两行是主题：来源、当前主题、生成 AI 主题和明暗。音频增益与歌词偏移在来源页。 | body：当前标签页内容 | `ponder.anchors.sidePanel.body` |
| `panel-controls-tab` | `panel-controls-tab-mode-list` | 全部样式藏在中间那颗按钮后面 | `ponder.captions.sidePanel.controlsSteppers` | 这两行选的是歌词样式和背景类型。两端那对箭头一次只换到相邻的一个 —— 十来个样式排着，这么翻要翻很久。 | modeRow：歌词样式那一行 | `ponder.anchors.sidePanel.modeRow` |
| `panel-controls-tab` | `panel-controls-tab-mode-list` | 全部样式藏在中间那颗按钮后面 | `ponder.captions.sidePanel.controlsModeList` | 点中间那一块，弹出一格图，直接点想要的那一张。 | modeList：全部样式 | `ponder.anchors.sidePanel.modeList` |
| `panel-controls-tab` | `panel-controls-tab-mode-list` | 全部样式藏在中间那颗按钮后面 | `ponder.captions.sidePanel.controlsModeListFooter` | 这一格图最底下那一条不是又一张图 ——「更多设置」打开的是这一行对应的完整设置，调参就在那儿。 | modeListFooter：更多设置 | `ponder.anchors.sidePanel.modeListFooter` |
| `panel-cover-actions` | `panel-cover-actions-reveal` | 这首歌的三个动作 | `ponder.captions.panelCoverActions.appear` | 封面页上，歌名下面这一行一直在：左边是这首歌的几个动作，右端是回到首页和设置。换到别的页，这一行收起来，只在顶上留一颗喜欢。 | coverActions：这一行动作 | `ponder.anchors.sidePanel.coverActions` |
| `panel-cover-actions` | `panel-cover-actions-reveal` | 这首歌的三个动作 | `ponder.captions.panelCoverActions.like` | 心形是喜欢这首歌。当前来源做不了这件事时它是灰的，指针停上去会写明原因。 | coverLike：喜欢 | `ponder.anchors.sidePanel.coverLike` |
| `panel-cover-actions` | `panel-cover-actions-reveal` | 这首歌的三个动作 | `ponder.captions.panelCoverActions.addToPlaylist` | 星形那颗把当前这首加进歌单。只有当前来源支持歌单时它才在；加不了的时候它是灰的，指针停上去会写明原因。 | coverPlaylist：加入歌单 | `ponder.anchors.sidePanel.coverPlaylist` |
| `panel-cover-actions` | `panel-cover-actions-reveal` | 这首歌的三个动作 | `ponder.captions.panelCoverActions.playingFrom` | 队列是从某张歌单或专辑开始播的，这里就多一枚写着它名字的按钮：点一下回到那一页，并找到这首歌。队列换成别的歌之后它就不在了。 | coverSource：播放自 | `ponder.anchors.sidePanel.coverSource` |
| `panel-cover-actions` | `panel-cover-actions-right` | 右端：首页和设置 | `ponder.captions.panelCoverActions.home` | 右端的房子回到首页的海报墙，面板会先收起。播放不会中断。 | coverHome：回到首页 | `ponder.anchors.sidePanel.coverHome` |
| `panel-cover-actions` | `panel-cover-actions-right` | 右端：首页和设置 | `ponder.captions.panelCoverActions.settings` | 齿轮打开设置。按下去面板会先收起来，再把设置窗口铺上来。 | coverSettings：打开设置 | `ponder.anchors.sidePanel.coverSettings` |
| `panel-cover-tab` | `panel-cover-tab` | 封面页 | `ponder.captions.sidePanel.coverTab` | 封面页就是这首歌：大封面，下面是歌名、歌手和专辑，再下面一行动作。这一页没有别的内容。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-cover-tab` | `panel-cover-tab` | 封面页 | `ponder.captions.sidePanel.coverTabDetail` | 点击歌手或专辑可进入对应集合。点击歌名复制歌曲信息，按住 Ctrl 点击可打开来源页面。 | credits：歌名、歌手、专辑 | `ponder.anchors.sidePanel.credits` |
| `panel-queue-tab` | `panel-queue-tab` | 播放列表页 | `ponder.captions.sidePanel.queueTab` | 播放列表页是当前播放队列的完整列表，顶上一行写着队列里有多少首。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-queue-tab` | `panel-queue-tab` | 播放列表页 | `ponder.captions.sidePanel.queueTabDetail` | 点击歌曲即可播放；悬停后可移到下一首、移到队尾或移除。顶部按钮可打开 Lattice 或打乱队列。这里不能拖动排序。 | body：当前标签页内容 | `ponder.anchors.sidePanel.body` |
| `panel-queue-tab` | `panel-queue-tab-radio` | 私人 FM 下这一格是电台 | `ponder.captions.sidePanel.queueRadio` | 私人 FM 播放时，这一页会变成电台面板，不再显示队列。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-queue-tab` | `panel-queue-tab-radio` | 私人 FM 下这一格是电台 | `ponder.captions.sidePanel.queueRadioMode` | 顶上那颗按钮写的是你现在在哪个电台模式；点它打开的是命令窗口里的模式选择器，和命令面板给的是同一个。 | fmMode：电台模式 | `ponder.anchors.sidePanel.fmMode` |
| `panel-queue-tab` | `panel-queue-tab-radio` | 私人 FM 下这一格是电台 | `ponder.captions.sidePanel.queueRadioActions` | 这一行两端是丢弃和喜欢。丢弃后服务不会再播放这首，电台会继续下一首。 | fmDiscard：丢弃 | `ponder.anchors.sidePanel.fmDiscard` |
| `panel-slide` | `panel-slide-to-palette` | 滑动打开命令面板 | `ponder.captions.panelSlide.intro` | 这个按钮底下藏着一条滑轨。按住它，滑轨就会显出来。 | track：隐藏的滑轨 | `ponder.anchors.panelSlide.track` |
| `panel-slide` | `panel-slide-to-palette` | 滑动打开命令面板 | `ponder.captions.panelSlide.grabbed` | 按住这个按钮不放，它背后的滑轨就亮起来了。 | toggle：面板开关 | `ponder.anchors.panelSlide.toggle` |
| `panel-slide` | `panel-slide-to-palette` | 滑动打开命令面板 | `ponder.captions.panelSlide.threshold` | 往左拖。36 像素就够了 —— 到 44 像素按钮便不再跟手。 | threshold | — |
| `panel-slide` | `panel-slide-to-palette` | 滑动打开命令面板 | `ponder.captions.panelSlide.outcome` | 越过那条线松手，命令面板就打开了。 | palette：命令面板 | `ponder.anchors.panelSlide.palette` |
| `panel-slide` | `panel-slide-edge-hotspot` | 从边缘唤出手柄 | `ponder.captions.panelSlide.hotspotIntro` | 触屏上没有悬停这回事，所以屏幕边缘本身就是入口。 | toggle：面板开关 | `ponder.anchors.panelSlide.toggle` |
| `panel-slide` | `panel-slide-edge-hotspot` | 从边缘唤出手柄 | `ponder.captions.panelSlide.hotspotRevealed` | 在右边缘附近点一下，手柄会自己出来。 | track：隐藏的滑轨 | `ponder.anchors.panelSlide.track` |
| `panel-slide` | `panel-slide-keyboard` | 用键盘打开 | `ponder.captions.panelSlide.keyboardIntro` | 也可以完全不用指针。 | — | — |
| `panel-slide` | `panel-slide-keyboard` | 用键盘打开 | `ponder.captions.panelSlide.keyboardOutcome` | 直接按 {{mod}} + K，打开的是同一个窗口。 | palette：命令面板 | `ponder.anchors.panelSlide.palette` |
| `panel-source-tab` | `panel-source-tab-where` | 这一格什么时候才在 | `ponder.captions.sidePanel.sourceTab` | 本地、Navidrome 或在线来源的歌曲才有这一页，标签上写的是本地、Navidrome 或歌词；没有来源信息时只有四个标签。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `panel-source-tab` | `panel-source-tab-where` | 这一格什么时候才在 | `ponder.captions.sidePanel.sourceInfo` | 最底下是这首歌的来历：本地歌曲是文件名、大小和码率，Navidrome 是 Song ID；在线歌曲没有这一块。 | sourceInfo：来源信息 | `ponder.anchors.sidePanel.sourceInfo` |
| `panel-source-tab` | `panel-source-tab-contents` | 歌词、时间轴与增益 | `ponder.captions.sidePanel.sourceLyrics` | 歌词这一行右端是这首歌现有的几种歌词，点一段就换；只有一种时只写着它的名字。 | sourceLyrics：歌词 | `ponder.anchors.sidePanel.sourceLyrics` |
| `panel-source-tab` | `panel-source-tab-contents` | 歌词、时间轴与增益 | `ponder.captions.sidePanel.sourceOffset` | 时间轴偏移按 250ms 调整，也可以直接输入。它只对当前播放生效；设置里的全局偏移会与它相加。 | sourceOffset：时间轴偏移 | `ponder.anchors.sidePanel.sourceOffset` |
| `panel-source-tab` | `panel-source-tab-contents` | 歌词、时间轴与增益 | `ponder.captions.sidePanel.sourceGain` | 音频增益就是 ReplayGain，可选关闭、单曲或专辑。名字下面那行小字是这首歌自带的单曲和专辑增益值；没有标签时写着「未检测到 ReplayGain」。 | sourceGain：音频增益 | `ponder.anchors.sidePanel.sourceGain` |
| `panel-source-tab` | `panel-source-tab-export` | 导入与导出歌词文件 | `ponder.captions.sidePanel.sourceLyricsFile` | 「导入 / 导出歌词」这颗把两件事合在一个窗口里，点开再选。它左边的「在线匹配」打开匹配歌词的窗口。 | sourceLyricsFile：导入 / 导出歌词 | `ponder.anchors.sidePanel.sourceLyricsFile` |
| `panel-source-tab` | `panel-source-tab-export` | 导入与导出歌词文件 | `ponder.captions.sidePanel.sourceExportFormats` | 窗口上面是导入，接受 lrc、vtt、ttml、qrc、yrc、krc、txt 和 Folia 导出的 .fia；Navidrome 的歌曲不能导入，窗口里只有导出。中间两块把这一首导成文件：.fia 保留逐字时间轴、翻译、背景和声和你保存的分词，能原样导回来；.lrc 是增强型 LRC，别的播放器也能读，但这些 Folia 专有的信息会丢掉。 | sourceFileDialog：歌词文件窗口 | `ponder.anchors.sidePanel.sourceFileDialog` |
| `panel-source-tab` | `panel-source-tab-export` | 导入与导出歌词文件 | `ponder.captions.sidePanel.sourceExportBatch` | 最底下一行是批量导出：它会打开命令面板里的导出页，一次导出本机缓存的所有歌词。设置 · 存储与备份「缓存详情」里「歌词」那一行也有同一个入口。 | sourceFileDialog：歌词文件窗口 | `ponder.anchors.sidePanel.sourceFileDialog` |
| `pinned-commands` | `pinned-commands-slots` | 三个槽位 | `ponder.captions.pinnedCommands.slots` | 三个下拉槽按顺序显示在命令窗口下方，默认是上一首、下一首和队列。 | slotSecond：槽位 2 | `ponder.anchors.pinnedCommands.slotSecond` |
| `pinned-commands` | `pinned-commands-slots` | 三个槽位 | `ponder.captions.pinnedCommands.unique` | 同一命令只能放一个槽位；空槽保留空位，三个都空时整排隐藏。 | slotThird：槽位 3 | `ponder.anchors.pinnedCommands.slotThird` |
| `pinned-commands` | `pinned-commands-vs-recent` | 固定不等于「最近用过」 | `ponder.captions.pinnedCommands.where` | 这三个下拉配出来的东西长在这儿：命令窗口下面一排三颗固定按钮，位置永远不变。点一下就执行，不用打字也不用翻。 | pinnedRow：固定的那三颗 | `ponder.anchors.pinnedCommands.pinnedRow` |
| `pinned-commands` | `pinned-commands-vs-recent` | 固定不等于「最近用过」 | `ponder.captions.pinnedCommands.recent` | 上面的列表和固定按钮是两套机制。列表按最近使用情况重排，固定按钮始终保持原位。 | paletteList：会随使用重排的列表 | `ponder.anchors.pinnedCommands.paletteList` |
| `pinned-commands` | `pinned-commands-vs-recent` | 固定不等于「最近用过」 | `ponder.captions.pinnedCommands.empty` | 所以两者各管各的用处：列表应付你临时要用的东西，那三颗应付你希望每次都在同一个位置的东西。 | pinnedRow：固定的那三颗 | `ponder.anchors.pinnedCommands.pinnedRow` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsIntro` | 播放控制只有这一条胶囊；上一首、下一首、随机、循环和音量都不常驻。 | bar：底部控制条 | `ponder.anchors.playerBar.bar` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsPlay` | 整条上唯一永远在的按钮是播放 / 暂停。宽屏时它在最左端；窄到一行放不下时，它落到第二行正中，两个槽位分列两侧。 | play：播放 / 暂停 | `ponder.anchors.playerBar.play` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsTitle` | 悬停歌名，两侧会显示上一首和下一首；点箭头切歌。 | title：曲目标题 | `ponder.anchors.playerBar.title` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsProgress` | 进度条就地拖动或点击跳转。点胶囊其他任何地方不是暂停，而是进入播放页；在 Lattice 上则是把视野拉回当前这首。 | progress：进度条 | `ponder.anchors.playerBar.progress` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsSlots` | 剩下的功能都归右边这两个位置。十个动作里你挑两个放上去，别的一律不在条上 —— 这就是这里没有一排固定按钮的原因。 | slots：两个槽位 | `ponder.anchors.playerBar.slots` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsCollapsed` | 移开指针，整条收回成一根进度条。你平时看到的是这个形态，需要控制时靠近它就会展开。 | bar：底部控制条 | `ponder.anchors.playerBar.bar` |
| `player-bar` | `player-bar-basics` | 这条胶囊上有什么 | `ponder.captions.playerBar.basicsAutoExpand` | 暂停且不在首页时，控制条会自动展开。恢复播放或回到首页后，它会收起。 | bar：底部控制条 | `ponder.anchors.playerBar.bar` |
| `player-bar` | `player-bar-height` | 整条的高度可以改 | `ponder.captions.playerBar.heightIntro` | 这条控制条离屏幕底边有多远是可以改的，各页面的歌曲卡片和侧边面板会跟着一起动。 | bar：底部控制条 | `ponder.anchors.playerBar.bar` |
| `player-bar` | `player-bar-height` | 整条的高度可以改 | `ponder.captions.playerBar.heightSettings` | 入口在设置 → 播放页 → 控制栏。滑杆调整高度，「在播放页拖动调整」允许直接拖动控制条；命令窗口也能打开同一设置。 | settings：设置 · 控制栏 | `ponder.anchors.playerBar.bottomUiSettings` |
| `player-bar` | `player-bar-height` | 整条的高度可以改 | `ponder.captions.playerBar.heightDrag` | 进了拖动调整之后，按住胶囊任意位置上下拖。松手即生效，而且会被记住。 | raised | — |
| `player-bar` | `player-bar-slots` | 右边两个位置可以换 | `ponder.captions.playerBar.slotsIntro` | 进度条右边这两个按钮不是固定的，两个位置各自独立。 | slots：两个槽位 | `ponder.anchors.playerBar.slots` |
| `player-bar` | `player-bar-slots` | 右边两个位置可以换 | `ponder.captions.playerBar.slotsWhere` | 在设置里挑：循环、随机、喜爱、队列、音量、睡眠定时等十个动作里任选，选完立刻生效。 | picker：设置里的选择器 | `ponder.anchors.playerBar.picker` |
| `player-bar` | `player-bar-shuffle` | 随机只洗一次牌 | `ponder.captions.playerBar.shuffleIntro` | 这个随机和别处的不一样 —— 它不是一个开着就一直生效的模式。 | primarySlot：第一个槽位 | `ponder.anchors.playerBar.primarySlot` |
| `player-bar` | `player-bar-shuffle` | 随机只洗一次牌 | `ponder.captions.playerBar.shuffleOnce` | 按一下，Folia 把当前队列原地洗一次牌，洗完这个顺序就定下来了。想换个顺序就再按一次。 | queue：播放队列 | `ponder.anchors.playerBar.queue` |
| `player-bar` | `player-bar-volume` | 音量在命令面板里 | `ponder.captions.playerBar.volumeIntro` | 底部控制条上没有常驻的音量滑块。 | primarySlot：第一个槽位 | `ponder.anchors.playerBar.primarySlot` |
| `player-bar` | `player-bar-volume` | 音量在命令面板里 | `ponder.captions.playerBar.volumeOpens` | 按这里打开的是命令面板里的音量面板，不是就地弹一个小滑块。 | volumeSurface：音量面板 | `ponder.anchors.playerBar.volumeSurface` |
| `player-page` | `player-page-layout` | 页面上有什么、各在哪 | `ponder.captions.pages.playerLayout` | 播放页全屏显示歌词和可视化；入口只有底部控制条、右侧手柄和展开后的面板。 | page：播放器 | `ponder.anchors.pages.player` |
| `player-page` | `player-page-layout` | 页面上有什么、各在哪 | `ponder.captions.pages.playerLyrics` | 中间这块是歌词与可视化。它不是控件：点它等于点背景，只切换控制条的显隐，不会暂停。 | lyrics：歌词与可视化 | `ponder.anchors.playerPage.lyrics` |
| `player-page` | `player-page-layout` | 页面上有什么、各在哪 | `ponder.captions.pages.playerBarWhere` | 控制条浮在屏幕底部正中，不贴边。左端是播放/暂停，中间是歌名和进度条，右端两个位置放什么由你决定。 | bar：底部控制条 | `ponder.anchors.playerPage.bar` |
| `player-page` | `player-page-layout` | 页面上有什么、各在哪 | `ponder.captions.pages.playerToggleWhere` | 侧边手柄贴在屏幕右缘，底边和控制条对齐。它是一颗圆按钮，按一下展开右侧控制面板。 | toggle：侧边手柄 | `ponder.anchors.playerPage.toggle` |
| `player-page` | `player-page-layout` | 页面上有什么、各在哪 | `ponder.captions.pages.playerPanelWhere` | 面板从手柄上方展开，贴着右侧。打开时是这首歌的封面页，最底下一排是封面、控制、播放列表、账户等标签页。 | panel：控制面板 | `ponder.anchors.playerPage.panel` |
| `player-page` | `player-page-open-palette` | 叫出命令窗口 | `ponder.captions.pages.playerPaletteSlide` | 手柄背后还藏着一条向左的滑轨。按住手柄往左拖，越过判定线再松手，打开的是命令窗口，不是面板。 | track：隐藏的滑轨 | `ponder.anchors.playerPage.track` |
| `player-page` | `player-page-open-palette` | 叫出命令窗口 | `ponder.captions.pages.playerPaletteOpened` | 命令窗口从屏幕上方落下，水平居中。Folia 把「找功能」这件事全部收在这里。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-open-palette` | 叫出命令窗口 | `ponder.captions.pages.playerPaletteOtherWays` | {{mod}} + K 可随时打开命令窗口。播放页焦点不在输入框时，按 S 也可以；触屏先点右缘唤出手柄。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-run-commands` | 在命令窗口里执行 | `ponder.captions.pages.playerCommandFilter` | 窗口开着就直接打字，它按名字、别名和关键词一起筛。↑↓ 选，Enter 执行 —— 不必先想清楚这条命令归在哪一类。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-run-commands` | 在命令窗口里执行 | `ponder.captions.pages.playerCommandArgument` | 需要参数的命令不会立刻跑。打完命令名按空格，它收成输入行里的一枚标签，光标留在后面等你补参数，补完再 Enter。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-run-commands` | 在命令窗口里执行 | `ponder.captions.pages.playerExecuteCloseFirst` | 执行模式要在命令窗口关闭时进入。先按 Esc 关掉窗口：窗口开着时按冒号，只会把冒号打进输入框。 | bar：底部控制条 | `ponder.anchors.playerPage.bar` |
| `player-page` | `player-page-run-commands` | 在命令窗口里执行 | `ponder.captions.pages.playerExecuteMode` | 回到播放页，焦点不在输入框时按冒号，命令窗口会直接以执行模式打开。进入后按 r/v/o/h 执行命令。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-shuffle` | 常见问题：怎么随机播放 | `ponder.captions.pages.playerShuffleNoSwitch` | Folia 没有常驻的随机播放开关；它是一次操作，按下后会打乱当前队列。 | bar：底部控制条 | `ponder.anchors.playerPage.bar` |
| `player-page` | `player-page-shuffle` | 常见问题：怎么随机播放 | `ponder.captions.pages.playerShuffleHow` | 播放页按冒号进入执行模式，再按 r 打乱队列；再次执行可换顺序。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `player-page` | `player-page-shuffle` | 常见问题：怎么随机播放 | `ponder.captions.pages.playerShuffleSlot` | 如果你常用它，把「随机队列」放进控制条右边那两个位置之一，以后按一下就行。 | bar：底部控制条 | `ponder.anchors.playerPage.bar` |
| `ponder-basics` | `help-page-ponder` | 你已经在思索里了 | `ponder.captions.onboarding.here` | 这是当前页面的思索教程，不是视频。进度条可拖，方向键切换关键帧，Space 暂停，Esc 退出。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `ponder-basics` | `help-page-ponder` | 你已经在思索里了 | `ponder.captions.onboarding.hover` | 悬停在按钮或组件上会出现提示。按住 G，进度走满后打开对应教程。 | capsule：悬停提示 | `ponder.anchors.onboarding.capsule` |
| `ponder-basics` | `help-page-ponder` | 你已经在思索里了 | `ponder.captions.onboarding.hold` | 按住不放，进度走满后打开教程；提前松手会取消。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `ponder-basics` | `help-page-whole-page` | 整页的教程，以及触屏怎么办 | `ponder.captions.onboarding.wholePage` | 不想找组件也行：在任意页面上按住 Ctrl + G，打开的是整页的教程 —— 这一页上有什么、各在哪、能怎么操作。 | page：一页界面 | `ponder.anchors.onboarding.page` |
| `ponder-basics` | `help-page-whole-page` | 整页的教程，以及触屏怎么办 | `ponder.captions.onboarding.touchBulb` | 触屏没有悬停，所以用右上角灯泡打开本页教程。它出现几秒后会收起，点右上角可再次唤出。鼠标看不到它是正常的。 | touchBulb：触屏上的思索按钮 | `ponder.anchors.onboarding.touchBulb` |
| `ponder-basics` | `help-page-hint-settings` | 看够了就把提示关掉 | `ponder.captions.onboarding.hintSettings` | 可在设置 · 通用关闭思索提示，或只提示未看过的区域。下方按钮可直接打开设置。 | page：设置 | `ponder.anchors.pages.settings` |
| `queue-command-surface` | `queue-command-facets` | @ 把范围收窄 | `ponder.captions.queueCommand.whatItIs` | {{mod}} + P 打开队列窗口。输入即可筛选，↑↓选择，Enter 播放。 | input：输入行 | `ponder.anchors.queueCommand.input` |
| `queue-command-surface` | `queue-command-facets` | @ 把范围收窄 | `ponder.captions.queueCommand.atSign` | 输入 @ 可筛选队列中的歌手或专辑；后面会显示各项包含的歌曲数。 | suggestions：歌手 / 专辑建议 | `ponder.anchors.queueCommand.suggestions` |
| `queue-command-surface` | `queue-command-facets` | @ 把范围收窄 | `ponder.captions.queueCommand.narrowed` | 选中后会收成输入行标签，列表只显示该项的歌曲。 | input：输入行 | `ponder.anchors.queueCommand.input` |
| `queue-command-surface` | `queue-command-batch` | -- 对筛出来的全部下手 | `ponder.captions.queueCommand.flags` | 输入 -- 可查看批量操作：--remove 移除，--next 移到下一首，--end 移到队尾。 | input：输入行 | `ponder.anchors.queueCommand.input` |
| `queue-command-surface` | `queue-command-batch` | -- 对筛出来的全部下手 | `ponder.captions.queueCommand.scope` | 它操作的是筛选出的全部歌曲，不是高亮行。预览会显示“将影响 N 首”。 | preview：批量操作预览 | `ponder.anchors.queueCommand.preview` |
| `queue-command-surface` | `queue-command-batch` | -- 对筛出来的全部下手 | `ponder.captions.queueCommand.guards` | 没有搜索词或 @ 筛选时拒绝执行，避免清空队列；正在播放的歌曲会排除。 | preview：批量操作预览 | `ponder.anchors.queueCommand.preview` |
| `queue-settings` | `queue-settings-behavior` | 加到末尾还是加到下一首 | `ponder.captions.queueSettings.append` | 这一行的两段决定「加入播放队列」到底加到哪儿。默认是追加到末尾，先听完手上排着的。 | append：追加到末尾 | `ponder.anchors.queueSettings.append` |
| `queue-settings` | `queue-settings-behavior` | 加到末尾还是加到下一首 | `ponder.captions.queueSettings.next` | 选择后，新歌曲会插到当前歌曲后面。这个设置会影响卡片、队列行和命令窗口里的所有加入队列入口。 | next：追加到下一首 | `ponder.anchors.queueSettings.next` |
| `queue-shuffle` | `queue-shuffle-no-mode` | 没有随机模式，只有打乱队列 | `ponder.captions.queueShuffle.noMode` | Folia 不提供传统的随机播放模式，循环按钮也不会切到随机。想随机听，就打乱当前队列。 | primarySlot：第一个槽位 | `ponder.anchors.playerBar.primarySlot` |
| `queue-shuffle` | `queue-shuffle-no-mode` | 没有随机模式，只有打乱队列 | `ponder.captions.queueShuffle.once` | 打乱是一次操作：当前队列原地洗一次牌，之后按新顺序播放。想换个顺序，再打乱一次。 | queue：播放队列 | `ponder.anchors.playerBar.queue` |
| `queue-shuffle` | `queue-shuffle-command` | 用命令打乱 | `ponder.captions.queueShuffle.command` | 最快的是命令：命令窗口关着、焦点不在输入框时按冒号进入执行模式，再按 r。也可以在命令窗口里搜「打乱队列」。 | palette：命令窗口 | `ponder.anchors.playerPage.palette` |
| `queue-shuffle` | `queue-shuffle-slot` | 放进控制条按钮 | `ponder.captions.queueShuffle.slot` | 常用的话，在设置 · 播放页的「进度条右侧按钮」里选「随机队列」，控制条上就多一颗打乱按钮。 | primarySlot：第一个槽位 | `ponder.anchors.playerBar.primarySlot` |
| `queue-shuffle` | `queue-shuffle-panel` | 队列面板上的按钮 | `ponder.captions.queueShuffle.panel` | 右侧控制面板的队列页，顶部最右那颗按钮也会打乱队列。 | queueShuffle：打乱队列 | `ponder.anchors.sidePanel.queueShuffle` |
| `queue-shuffle` | `queue-shuffle-pinned` | 固定在命令窗口底部 | `ponder.captions.queueShuffle.pinSlot` | 在设置 · 快捷操作的「快捷命令」里，把「打乱队列」放进任意一个槽位。 | slotThird：槽位 3 | `ponder.anchors.pinnedCommands.slotThird` |
| `queue-shuffle` | `queue-shuffle-pinned` | 固定在命令窗口底部 | `ponder.captions.queueShuffle.pinRow` | 它会一直显示在命令窗口底部，打开窗口点一下就行。 | pinnedRow：固定的那三颗 | `ponder.anchors.pinnedCommands.pinnedRow` |
| `replay-gain-settings` | `replay-gain-modes` | 三个模式 | `ponder.captions.replayGain.off` | 关闭后不使用文件里的 ReplayGain 标签，每首歌按原始音量播放。 | modeOff：关闭 | `ponder.anchors.replayGain.modeOff` |
| `replay-gain-settings` | `replay-gain-modes` | 三个模式 | `ponder.captions.replayGain.trackAlbum` | 按单曲会让不同歌曲的响度更接近；按专辑会保留专辑内部的强弱变化。两种模式都只改播放音量，不改文件。 | modeAlbum：按专辑 | `ponder.anchors.replayGain.modeAlbum` |
| `replay-gain-settings` | `replay-gain-mirrored` | 同一个值，两处入口 | `ponder.captions.replayGain.sameValue` | 控制面板来源页的三个按钮与这里共用同一个 ReplayGain 设置，改一处会同步另一处。 | panelModes：同样那三个模式 | `ponder.anchors.replayGain.panelModes` |
| `replay-gain-settings` | `replay-gain-mirrored` | 同一个值，两处入口 | `ponder.captions.replayGain.summary` | 来源页还会显示这首歌自带的单曲和专辑增益值；没有标签时写着「未检测到 ReplayGain」。 | panelSummary：这首歌的增益标签 | `ponder.anchors.replayGain.panelSummary` |
| `settings-page` | `settings-page-overview` | 设置按用途分组 | `ponder.captions.pages.settings` | 左侧按界面、音乐、应用和高级分组列出类别；右侧显示当前类别里的具体设置。 | page：设置 | `ponder.anchors.pages.settings` |
| `settings-page` | `settings-page-direct-navigation` | 从命令直接跳转 | `ponder.captions.pages.settingsDirectNavigation` | 不必逐层翻找：在命令面板搜索设置名称，Folia 会直接打开对应分组并滚到准确位置。 | palette：命令面板 | `ponder.anchors.pages.commandPalette` |
| `side-panel` | `side-panel-structure` | 面板里有什么 | `ponder.captions.sidePanel.cover` | 面板打开时是封面页：这首歌的大封面，下面是歌名、歌手和专辑，再下面一行是它的几个动作。 | cover：当前封面 | `ponder.anchors.sidePanel.cover` |
| `side-panel` | `side-panel-structure` | 面板里有什么 | `ponder.captions.sidePanel.tabs` | 最底下一排是标签页：封面、控制、播放列表、账户；这首歌有来源信息时，封面后面多一个来源页，就是这里的第二格。装了带页面的模组，后面还会多出它的页。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `side-panel` | `side-panel-structure` | 面板里有什么 | `ponder.captions.sidePanel.body` | 换到别的页，顶上那首歌收成一行，点它回到封面页；中间是这一页的内容。内容有多高面板就有多高，标签那一排一直在底边。 | body：当前标签页内容 | `ponder.anchors.sidePanel.body` |
| `side-panel` | `side-panel-tabs` | 换标签页 | `ponder.captions.sidePanel.cycle` | 不必去点那一排小格子。面板开着时按 Tab，就在标签页之间往后循环一格。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `side-panel` | `side-panel-tabs` | 换标签页 | `ponder.captions.sidePanel.cycleReverse` | Shift + Tab 往回一格。循环只在当前真的有的那几页之间走 —— 来源不同，页数也不同。 | tabs：标签页 | `ponder.anchors.sidePanel.tabs` |
| `sign-in` | `sign-in-entries` | 两个入口 | `ponder.captions.signIn.homeButton` | 没有人登录时，主页中间有一颗「登录」按钮。它打开登录窗口，平台在窗口里选。 | homeButton：登录 | `ponder.anchors.signIn.homeButton` |
| `sign-in` | `sign-in-entries` | 两个入口 | `ponder.captions.signIn.pill` | 右下角这一枚一直都在。点左边的头像或平台记号，打开同一个窗口，停在正在用的平台上；右边的箭头返回播放器。 | pill：切换在线音乐平台 | `ponder.anchors.signIn.pill` |
| `sign-in` | `sign-in-window` | 选平台，再登录 | `ponder.captions.signIn.platforms` | 左边一列是全部平台。已经登录的那一行右端有头像；灰着的行不能选，悬停会写原因。 | platforms：平台 | `ponder.anchors.signIn.platforms` |
| `sign-in` | `sign-in-window` | 选平台，再登录 | `ponder.captions.signIn.code` | 选中一个平台，右边就是它的登录方式。多数是一张二维码，用那个平台的手机应用扫；有的要先选方式，有的点一下按钮去浏览器里登录。 | tile：二维码 | `ponder.anchors.signIn.tile` |
| `sign-in` | `sign-in-window` | 选平台，再登录 | `ponder.captions.signIn.steps` | 右下角这一串小图标是登录走到哪一步：二维码、手机上确认、读到账号。 | steps：步骤 | `ponder.anchors.signIn.steps` |
| `sign-in` | `sign-in-account` | 登录之后 | `ponder.captions.signIn.account` | 已经登录的平台，这里是它的账号。「退出登录」只退这一个平台。 | account：账号 | `ponder.anchors.signIn.account` |
| `sign-in` | `sign-in-account` | 登录之后 | `ponder.captions.signIn.switch` | 几个平台可以同时登录着。选中的不是正在用的那一个时，多出一颗切换按钮，把它换成正在用的平台；右下角那一枚跟着换。 | actions：切换与退出 | `ponder.anchors.signIn.actions` |
| `theme-park` | `theme-park-target` | 你在编辑哪一份主题 | `ponder.captions.themePark.which` | 标题旁边这一对切换当前编辑的主题：这首歌的 AI 主题，或你保存的自定义主题。两边草稿互不影响，保存只作用于当前选中的那一份。 | targetToggle：在编辑哪一份 | `ponder.anchors.themePark.targetToggle` |
| `theme-park` | `theme-park-target` | 你在编辑哪一份主题 | `ponder.captions.themePark.reset` | 重置丢掉的是你这一次改的东西，把草稿退回刚打开时的样子。它不碰已经保存下来的那一份。 | reset：重置 | `ponder.anchors.themePark.reset` |
| `theme-park` | `theme-park-colors` | 亮和暗是两份配色 | `ponder.captions.themePark.twoSides` | 亮色和暗色分别保存。切换这一项后，下面的颜色、取色器和 HEX 输入框都会跟着切换。 | modeToggle：亮 / 暗 | `ponder.anchors.themePark.modeToggle` |
| `theme-park` | `theme-park-colors` | 亮和暗是两份配色 | `ponder.captions.themePark.fourColors` | 每面有背景、主文本、强调色和辅助色四种颜色。点一格，它就进到下方的取色器；取色器顶上那行字写着这种颜色用在哪里。 | colorWells：四种颜色 | `ponder.anchors.themePark.colorRows` |
| `theme-park` | `theme-park-colors` | 亮和暗是两份配色 | `ponder.captions.themePark.recommended` | 最底下「推荐色」那排圆色块里，有几枚是从当前封面算出来的，其余是这套主题自己的颜色。点一枚直接填进正在选中的那一种。 | recommended：推荐色 | `ponder.anchors.themePark.recommended` |
| `theme-park` | `theme-park-saving` | 保存为什么按不动 | `ponder.captions.themePark.blocked` | 保存有时是灰的，而你正看着的这一页上没有任何地方说明原因。原因是主题要有名字，而且亮暗两面都要有，才存得下去。 | save：保存 | `ponder.anchors.themePark.save` |
| `theme-park` | `theme-park-saving` | 保存为什么按不动 | `ponder.captions.themePark.nameLivesHere` | 主题名称和描述在「信息」页；名称没填时，这个标签旁边有一个小圆点。保存按钮点不了，先去那里填写名称。 | tabDetails：信息那一页 | `ponder.anchors.themePark.tabDetails` |
| `theme-park` | `theme-park-saving` | 保存为什么按不动 | `ponder.captions.themePark.applies` | 保存自定义主题后，应用会立即切换到它。 | save：保存 | `ponder.anchors.themePark.save` |
| `theme-settings` | `theme-settings-presets` | 预设与自定义 | `ponder.captions.themeSettings.presetDefault` | 「配色主题预设」左边一段是内置的「墨染 / 素白」，跟着明暗模式在深色和浅色之间自动换。 | presetDefault：内置预设 | `ponder.anchors.themeSettings.presetDefault` |
| `theme-settings` | `theme-settings-presets` | 预设与自定义 | `ponder.captions.themeSettings.presetCustom` | 右边一段是自定义配色。还没有自定义主题时它是灰的、按不动；有了之后选中它，播放页、卡片和面板都会换成这套颜色。 | presetCustom：自定义配色 | `ponder.anchors.themeSettings.presetCustom` |
| `theme-settings` | `theme-settings-source` | 配色从哪来 | `ponder.captions.themeSettings.source` | 「主题生成来源」在下面「歌曲主题」那一组：AI 推断或封面取色。没有配置 API Key 时，这一行下面会多出一句提示和一颗去配置的按钮。 | source：主题生成来源 | `ponder.anchors.themeSettings.source` |
| `theme-settings` | `theme-settings-source` | 配色从哪来 | `ponder.captions.themeSettings.themePark` | 「打开 Theme Park」这一行打开配色编辑窗口，左侧是实时预览。 | panel：设置 · 主题 | `ponder.anchors.themeSettings.panel` |
| `theme-settings` | `theme-settings-source` | 配色从哪来 | `ponder.captions.themeSettings.themeParkTabs` | 右栏有配色、信息、内容、AI 四页。配色页分别保存亮暗两套颜色；AI 页复制提示词，再把 AI 写回的 JSON 导入草稿。 | panel：设置 · 主题 | `ponder.anchors.themeSettings.panel` |
| `theme-settings` | `theme-settings-auto` | 配色什么时候自己变 | `ponder.captions.themeSettings.followSystem` | 「明暗模式」有三段：浅色、深色、跟随系统。选跟随系统，应用按系统的设置自动切换明暗。 | brightness：明暗模式 | `ponder.anchors.themeSettings.followSystem` |
| `theme-settings` | `theme-settings-auto` | 配色什么时候自己变 | `ponder.captions.themeSettings.autoSwitch` | 「主题自动切换」会在播放有缓存主题的歌曲时应用它；打开它下面缩进的那一行，没有缓存的歌曲也会自动生成主题。 | autoSwitch：主题自动切换 | `ponder.anchors.themeSettings.autoSwitch` |
| `theme-settings` | `theme-settings-auto` | 配色什么时候自己变 | `ponder.captions.themeSettings.preferCustom` | 「优先使用自定义主题」打开之后，主题自动切换会被关掉 —— 两者是互斥的。这就是开了它以后换歌颜色不再变的原因。 | preferCustom：优先使用自定义主题 | `ponder.anchors.themeSettings.preferCustom` |
| `transition-settings` | `transition-settings-enable` | 总开关与两种模式 | `ponder.captions.transition.enable` | 这一组管的是两首歌之间怎么接上。最上面是总开关 —— 它和控制页里「智能过渡」那一格是同一个值，两处改的是同一件事。 | enable：过渡总开关 | `ponder.anchors.transition.enable` |
| `transition-settings` | `transition-settings-enable` | 总开关与两种模式 | `ponder.captions.transition.modes` | 「过渡模式」有两段：Folia Crossfade 淡化切换歌曲，Folia Automix 分析音频后选择接点。 | automix：Folia Automix | `ponder.anchors.transition.automix` |
| `transition-settings` | `transition-settings-fallback` | 选了不等于在跑 | `ponder.captions.transition.badge` | 两段左边那一小块字是运行状态：「完全体」或「兼容模式」表示自动混音正在运行；「已退回淡化」表示条件不足，系统改用淡化。 | badge：运行状态 | `ponder.anchors.transition.badge` |
| `transition-settings` | `transition-settings-fallback` | 选了不等于在跑 | `ponder.captions.transition.notice` | 自动混音需要歌曲缓存；提示右端的「开启歌曲缓存」可以就地打开它。 | notice：缺条件时的提示 | `ponder.anchors.transition.notice` |
| `vis-playground` | `vis-playground-layout` | 左边是真的在跑的预览 | `ponder.captions.visPlayground.preview` | 歌词样式窗口：左边是实时预览，右边是设置栏。预览用的是真实渲染器，改动马上显示。 | preview：实时预览 | `ponder.anchors.visPlayground.preview` |
| `vis-playground` | `vis-playground-layout` | 左边是真的在跑的预览 | `ponder.captions.visPlayground.pause` | 预览右上角那颗按钮把画面停在当前这一帧，再点一下继续。调那种只闪一下的效果时用得上，也让预览在你读字的时候不再吃算力。 | pause：暂停预览 | `ponder.anchors.visPlayground.pause` |
| `vis-playground` | `vis-playground-hotspots` | 三块你看不见的区域 | `ponder.captions.visPlayground.invisible` | 预览上有三块隐藏点击区，没有边框、底色或标签。 | preview：实时预览 | `ponder.anchors.visPlayground.preview` |
| `vis-playground` | `vis-playground-hotspots` | 三块你看不见的区域 | `ponder.captions.visPlayground.three` | 指针扫过去它们才显形：顶上一条是背景，中间一大块是歌词动画，底下一条是字幕。 | hotspotVisualizer：歌词动画那一块 | `ponder.anchors.visPlayground.hotspotVisualizer` |
| `vis-playground` | `vis-playground-hotspots` | 三块你看不见的区域 | `ponder.captions.visPlayground.jumps` | 点其中一块，右边设置栏就跳到对应那一页。这是这一屏里最快的走法 —— 指着画面上你想改的那部分，而不是去读标签的名字。 | tabs：四页 | `ponder.anchors.visPlayground.tabs` |
| `vis-playground` | `vis-playground-common` | 四页各管什么，以及「通用」里有什么 | `ponder.captions.visPlayground.four` | 设置栏一共四页：歌词动画、背景、通用、字幕。热区指向的就是其中三页，所以标签和画面是同一份清单的两个入口。 | tabs：四页 | `ponder.anchors.visPlayground.tabs` |
| `vis-playground` | `vis-playground-common` | 四页各管什么，以及「通用」里有什么 | `ponder.captions.visPlayground.common` | 只有一个例外：「通用」没有自己的热区，因为它不是画面的一部分 —— 它装的是作用于整屏的那些。那一页只能从这排标签进。 | tabCommon：通用 | `ponder.anchors.visPlayground.tabCommon` |
| `vis-playground` | `vis-playground-common` | 四页各管什么，以及「通用」里有什么 | `ponder.captions.visPlayground.fonts` | 「通用」设置歌词字体、字号和字重。字重默认自动，也可手动指定。 | rowTwo：第二行 | `ponder.anchors.visPlayground.rowTwo` |
| `vis-playground` | `vis-playground-common` | 四页各管什么，以及「通用」里有什么 | `ponder.captions.visPlayground.previewText` | 第一行挑的是预览唱什么。想看看这套字撑不撑得住长句、或者别的文字系统，换一段示例比等一首真歌放到那儿要快。 | rowOne：第一行 | `ponder.anchors.visPlayground.rowOne` |
| `vis-playground` | `vis-playground-common` | 四页各管什么，以及「通用」里有什么 | `ponder.captions.visPlayground.sectionReset` | 标签那一行右端的「默认」只退当前这一页。它不是整个窗口的复位 —— 你在别的页上调过的东西不会被它带走。 | sectionReset：默认 | `ponder.anchors.visPlayground.sectionReset` |
| `vis-playground` | `vis-playground-visuals` | 样式与背景 | `ponder.captions.visPlayground.animation` | 歌词样式在预览下面这一架图里选，点一张就换。样式比一章能讲完的多，值得你自己翻一遍，所以这里不把清单念一遍。 | shelf：样式 | `ponder.anchors.visPlayground.shelf` |
| `vis-playground` | `vis-playground-visuals` | 样式与背景 | `ponder.captions.visPlayground.perMode` | 「歌词动画」页是当前样式自己的参数；换样式，这一页也跟着换。 | rows：这一页的控件 | `ponder.anchors.visPlayground.rows` |
| `vis-playground` | `vis-playground-visuals` | 样式与背景 | `ponder.captions.visPlayground.background` | 「背景」页是同一套做法：先在这一格图里挑背景，再调这个背景。它和歌词样式是两层，各挑各的，任意组合都成立。 | backgroundPictures：背景类型 | `ponder.anchors.visPlayground.backgroundPictures` |
| `vis-playground` | `vis-playground-subtitle` | 字幕 | `ponder.captions.visPlayground.subtitleContent` | 字幕第二行可选：翻译、罗马音、罗马音在上翻译在下的两行，或不显示。莫奈、时计和静止选两行时只显示翻译。 | rowTwo：第二行 | `ponder.anchors.visPlayground.rowTwo` |
| `vis-playground` | `vis-playground-subtitle` | 字幕 | `ponder.captions.visPlayground.subtitleLegibility` | 下面三行管字幕看不看得清：「字幕透明度」「字幕背景」，以及「非翻译歌词添加模糊效果」。 | rowFour：第四行 | `ponder.anchors.visPlayground.rowFour` |
| `vis-playground` | `vis-playground-subtitle` | 字幕 | `ponder.captions.visPlayground.subtitleFont` | 字幕默认跟随歌词字体。关闭后，字幕自己的字体和字重设置才会出现；「字幕缩放」一直都在。 | subtitleFollowsFont：字幕字体 | `ponder.anchors.visPlayground.subtitleFont` |
