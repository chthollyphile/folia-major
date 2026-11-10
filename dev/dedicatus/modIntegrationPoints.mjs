// dev/dedicatus/modIntegrationPoints.mjs
// D307 的登记表：`src/mods/` 之外、在运行时引用 `src/mods/**` 的文件。每个都是 src/mods/README.md“接入点”一节写明了
// 用途的地方；模组相关的逻辑不散进普通代码路径，没装模组的用户不受影响，删模组系统时要改的就是这些。
// 新加一个接入点：先写进 README 的接入点表，再登记在这里。只有 `import type` 的引用不算。
// 初始名单是 2026-11-08 的现状（25 个文件）。标着“README 没写”的 5 个是现状里已经接着、README 接入点表还没写的，待补进 README。

export const MOD_INTEGRATION_POINTS = [
    'src/App.tsx',
    'src/bootstrap.tsx',
    'src/components/ProgressBar.tsx',
    'src/components/UnifiedPanel.tsx',
    'src/components/app/Home.tsx', // README 没写（待补）
    'src/components/app/home/FoliumHomePage.tsx',
    'src/components/app/home/foliumHomePageDismissal.ts', // README 没写（待补）
    'src/components/app/home/useFoliumHomeNavigation.ts',
    'src/components/app/playback/bridges/useElectronPlaybackBridge.ts',
    'src/components/command-palette/commands/playbackCommands.ts',
    'src/components/command-palette/globalShortcuts/useGlobalShortcuts.ts',
    'src/components/command-palette/surfaces/modsSurface.ts',
    'src/components/modal/settings/pages/GlobalShortcutsGroup.tsx',
    'src/components/modal/settings/pages/ModsPage.tsx',
    'src/components/modal/settings/pages/storage/visualConfigTransfer.ts',
    'src/components/remote/RemoteActionButtons.tsx', // README 没写（待补）
    'src/components/visualizer/VisualizerBackdrop.tsx',
    'src/components/visualizer/VisualizerShell.tsx',
    'src/components/visualizer/preview/LyricStylePicture.tsx',
    'src/components/visualizer/sonnet/VisualizerSonnet.tsx',
    'src/components/visualizer/window/VisPlayground.tsx',
    'src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx',
    'src/dev/mockSong.ts', // README 没写（待补）
    'src/hooks/useRemoteControlActions.ts', // README 没写（待补）
    'src/services/remoteControlActions.ts',
];
