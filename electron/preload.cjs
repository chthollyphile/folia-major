const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    webUtils: {
      // File.path was removed in modern Electron; this is the supported way to
      // resolve the OS path of a dropped file from the renderer.
      getPathForFile: (file) => webUtils.getPathForFile(file),
    },
    // Beat This! inference. Returns null whenever the weights or the runtime are not there,
    // which is the browser build's permanent answer and any desktop install missing the model.
    runBeatThis: (chunks) => ipcRenderer.invoke('automix-beat-this', chunks),
    separateStems: (request) => ipcRenderer.invoke('automix-htdemucs', request),
    // Which weights exist, answered without loading them. See the handler for why the settings page
    // is not allowed to infer this from "am I running in Electron".
    getAutomixModelsPresent: () => ipcRenderer.invoke('automix-models-present'),
    // One-way stage marks from the automix session into the runtime log. See services/automix/diag.ts.
    diagMark: (text) => ipcRenderer.send('automix-diag', text),
    // Developer debug module: the runtime log and the memory monitor. See electron/debug/debugHost.cjs.
    debugGetState: () => ipcRenderer.invoke('debug-get-state'),
    debugSetState: (patch) => ipcRenderer.invoke('debug-set-state', patch),
    debugOpenLogs: (which) => ipcRenderer.invoke('debug-open-logs', which),
    // Batched by the caller - one message per line would cost more than the logging it records.
    debugWriteRuntimeLines: (lines) => ipcRenderer.send('debug-runtime-lines', lines),
    /**
     * What only this process can answer about itself.
     *
     * `app.getAppMetrics()` reports `privateBytes` on Windows and nowhere else - it is guarded
     * `#if IS_WIN` in Chromium. `ProcessMemoryInfo.private` has no such guard, and on macOS the
     * docs say it is the MORE meaningful of the two figures, because in-memory page compression
     * makes the resident set there smaller than the memory actually in use. The catch is that it
     * only ever describes the calling process, which is why this is asked of the renderer rather
     * than read off the metrics table.
     */
    debugRendererMemory: async () => {
        try {
            const memory = await process.getProcessMemoryInfo();
            const blink = process.getBlinkMemoryInfo();
            return {
                pid: process.pid,
                privateKB: memory.private,
                sharedKB: memory.shared,
                blinkAllocatedKB: blink.allocated,
            };
        } catch {
            return null;
        }
    },
    debugReportRendererMemory: (report) => ipcRenderer.send('debug-renderer-memory', report),
    onDebugMemorySample: (callback) => {
        const listener = (_event, sample) => callback(sample);
        ipcRenderer.on('debug-memory-sample', listener);
        return () => ipcRenderer.removeListener('debug-memory-sample', listener);
    },
    // Where the weights are kept. The settings page reads the live location off the model status;
    // these two only change it.
    chooseModelsDirectory: () => ipcRenderer.invoke('choose-models-directory'),
    resetModelsDirectory: () => ipcRenderer.invoke('reset-models-directory'),
    // Getting the weights onto this machine: over the network, off a file already here, or by
    // pointing at one. All three end at the same verified file - see analysis/modelStore.cjs.
    getAutomixModelStatus: () => ipcRenderer.invoke('automix-model-status'),
    downloadAutomixModel: (name) => ipcRenderer.invoke('automix-model-download', name),
    cancelAutomixModelDownload: (name) => ipcRenderer.invoke('automix-model-cancel', name),
    scanForAutomixModels: () => ipcRenderer.invoke('automix-model-scan'),
    installAutomixModel: (name, source) => ipcRenderer.invoke('automix-model-install', name, source),
    removeAllAutomixModels: () => ipcRenderer.invoke('automix-model-remove-all'),
    onAutomixModelProgress: (callback) => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('automix-model-progress', listener);
        return () => ipcRenderer.removeListener('automix-model-progress', listener);
    },
    platform: process.platform,
    isLinuxX11: process.platform === 'linux' && !process.env.WAYLAND_DISPLAY,
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (key, value) => ipcRenderer.invoke('save-settings', key, value),
    onWallpaperModeChanged: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('wallpaper-mode-changed', listener);
        return () => ipcRenderer.removeListener('wallpaper-mode-changed', listener);
    },
    setPlaybackDisplaySleepBlockingActive: (active) => ipcRenderer.invoke('playback-display-sleep-set-active', active),
    setAppLocale: (localeKey) => ipcRenderer.invoke('set-app-locale', localeKey),
    getCacheDirectory: () => ipcRenderer.invoke('get-cache-directory'),
    chooseCacheDirectory: () => ipcRenderer.invoke('choose-cache-directory'),
    resetCacheDirectory: () => ipcRenderer.invoke('reset-cache-directory'),
    getUpdateStatus: () => ipcRenderer.invoke('updates-get-status'),
    checkForUpdates: () => ipcRenderer.invoke('updates-check'),
    markUpdateSeen: (version) => ipcRenderer.invoke('updates-mark-seen', version),
    openUpdateReleasePage: (version) => ipcRenderer.invoke('updates-open-release-page', version),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    downloadUpdate: () => ipcRenderer.invoke('updates-download'),
    quitAndInstallUpdate: () => ipcRenderer.invoke('updates-quit-and-install'),
    onUpdateStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('update-status-changed', listener);
        return () => ipcRenderer.removeListener('update-status-changed', listener);
    },
    getAudioCache: (cacheKey) => ipcRenderer.invoke('get-audio-cache', cacheKey),
    hasAudioCache: (cacheKey) => ipcRenderer.invoke('has-audio-cache', cacheKey),
    saveAudioCache: (cacheKey, data, mimeType, limitBytes) => ipcRenderer.invoke('save-audio-cache', cacheKey, data, mimeType, limitBytes),
    getAudioCacheUsage: () => ipcRenderer.invoke('get-audio-cache-usage'),
    getAudioCacheStats: () => ipcRenderer.invoke('get-audio-cache-stats'),
    clearAudioCache: () => ipcRenderer.invoke('clear-audio-cache'),
    getCoverCache: (cacheKey) => ipcRenderer.invoke('get-cover-cache', cacheKey),
    saveCoverCache: (cacheKey, data, mimeType) => ipcRenderer.invoke('save-cover-cache', cacheKey, data, mimeType),
    removeCoverCache: (cacheKey) => ipcRenderer.invoke('remove-cover-cache', cacheKey),
    getCoverCacheUsage: () => ipcRenderer.invoke('get-cover-cache-usage'),
    clearCoverCache: () => ipcRenderer.invoke('clear-cover-cache'),
    hasLocalCoverAsset: (assetId) => ipcRenderer.invoke('has-local-cover-asset', assetId),
    saveLocalCoverAsset: (assetId, data, mimeType) => ipcRenderer.invoke('save-local-cover-asset', assetId, data, mimeType),
    removeLocalCoverAsset: (assetId) => ipcRenderer.invoke('remove-local-cover-asset', assetId),
    clearLocalCoverAssets: () => ipcRenderer.invoke('clear-local-cover-assets'),
    generateTheme: (lyricsText, options) => ipcRenderer.invoke('generate-theme', lyricsText, options),
    fetchLyricProxy: (url, init) => ipcRenderer.invoke('lyric-proxy-fetch', url, init),
    getNeteasePort: () => ipcRenderer.invoke('get-netease-port'),
    getNeteaseApiStatus: () => ipcRenderer.invoke('get-netease-api-status'),
    onNeteaseApiStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('netease-api-status-changed', listener);
        return () => ipcRenderer.removeListener('netease-api-status-changed', listener);
    },
    getKugouApiStatus: () => ipcRenderer.invoke('kugou-api-status'),
    kugouRequest: (operation, params) => ipcRenderer.invoke('kugou-api-request', operation, params),
    getQqPort: () => ipcRenderer.invoke('get-qq-port'),
    getQqApiStatus: () => ipcRenderer.invoke('get-qq-api-status'),
    onQqApiStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('qq-api-status-changed', listener);
        return () => ipcRenderer.removeListener('qq-api-status-changed', listener);
    },
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
    toggleFullscreenWindow: () => ipcRenderer.invoke('window-toggle-fullscreen'),
    closeWindow: () => ipcRenderer.invoke('window-close'),
    quitApp: () => ipcRenderer.invoke('app-quit'),
    isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    getWindowTransparentMode: () => ipcRenderer.invoke('window-get-transparent-mode'),
    setWindowTransparentMode: (enabled, handoff) => ipcRenderer.invoke('window-set-transparent-mode', enabled, handoff),
    consumeWindowPlaybackHandoff: () => ipcRenderer.invoke('window-playback-handoff-consume'),
    submitWindowPlaybackHandoff: (requestId, handoff) => ipcRenderer.invoke('window-playback-handoff-submit', requestId, handoff),
    onWindowPlaybackHandoffRequested: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('window-playback-handoff-requested', listener);
        return () => ipcRenderer.removeListener('window-playback-handoff-requested', listener);
    },
    setNativeTheme: (themeSource) => ipcRenderer.invoke('window-set-native-theme', themeSource),
    getMainWindowClickThroughEnabled: () => ipcRenderer.invoke('window-get-click-through'),
    setMainWindowClickThroughEnabled: (enabled) => ipcRenderer.invoke('window-set-click-through', enabled),
    setMainWindowClickThroughUnlockHover: (active) => ipcRenderer.invoke('window-set-click-through-unlock-hover', active),
    getMainWindowAlwaysOnTop: () => ipcRenderer.invoke('window-get-always-on-top'),
    setMainWindowAlwaysOnTop: (enabled) => ipcRenderer.invoke('window-set-always-on-top', enabled),
    onMainWindowClickThroughChanged: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('main-window-click-through-changed', listener);
        return () => ipcRenderer.removeListener('main-window-click-through-changed', listener);
    },
    getObsBrowserSourceStatus: () => ipcRenderer.invoke('obs-browser-source-get-status'),
    setObsBrowserSourceEnabled: (enabled) => ipcRenderer.invoke('obs-browser-source-set-enabled', enabled),
    regenerateObsBrowserSourceToken: () => ipcRenderer.invoke('obs-browser-source-regenerate-token'),
    publishObsBrowserSourceConfig: (config) => ipcRenderer.invoke('obs-browser-source-publish-config', config),
    publishObsBrowserSourceClock: (clock) => ipcRenderer.invoke('obs-browser-source-publish-clock', clock),
    publishObsBrowserSourceAudio: (audio) => ipcRenderer.invoke('obs-browser-source-publish-audio', audio),
    getLyricApiStatus: () => ipcRenderer.invoke('lyric-api-get-status'),
    setLyricApiEnabled: (enabled) => ipcRenderer.invoke('lyric-api-set-enabled', enabled),
    publishLyricApiData: (lyrics, offset) => ipcRenderer.invoke('lyric-api-publish', lyrics, offset),
    onLyricApiStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('lyric-api-status-changed', listener);
        return () => ipcRenderer.removeListener('lyric-api-status-changed', listener);
    },
    getDiscordPresenceStatus: () => ipcRenderer.invoke('discord-presence-get-status'),
    publishDiscordPresenceSnapshot: (snapshot) => ipcRenderer.invoke('discord-presence-publish-snapshot', snapshot),
    getPlaybackSyncBridgeStatus: () => ipcRenderer.invoke('playback-sync-bridge-get-status'),
    getVoiceInputPauseStatus: () => ipcRenderer.invoke('voice-input-pause-get-status'),
    onVoiceInputStateChanged: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('voice-input-state-changed', listener);
        return () => ipcRenderer.removeListener('voice-input-state-changed', listener);
    },
    onPlaybackSyncBridgeStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('playback-sync-bridge-status-changed', listener);
        return () => ipcRenderer.removeListener('playback-sync-bridge-status-changed', listener);
    },
    onDiscordPresenceStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('discord-presence-status-changed', listener);
        return () => ipcRenderer.removeListener('discord-presence-status-changed', listener);
    },
    onObsBrowserSourceStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('obs-browser-source-status-changed', listener);
        return () => ipcRenderer.removeListener('obs-browser-source-status-changed', listener);
    },
    updateTaskbarControls: (state) => ipcRenderer.invoke('thumbar-update-buttons', state),
    onTaskbarControl: (callback) => {
        const listener = (_event, action) => callback(action);
        ipcRenderer.on('thumbar-action', listener);
        return () => ipcRenderer.removeListener('thumbar-action', listener);
    },
    openRemoteControl: () => ipcRenderer.invoke('remote-control-open'),
    toggleRemoteControl: () => ipcRenderer.invoke('remote-control-toggle'),
    closeRemoteControl: () => ipcRenderer.invoke('remote-control-close'),
    getRemoteControlAlwaysOnTop: () => ipcRenderer.invoke('remote-control-get-always-on-top'),
    setRemoteControlAlwaysOnTop: (alwaysOnTop) => ipcRenderer.invoke('remote-control-set-always-on-top', alwaysOnTop),
    publishRemoteControlSnapshot: (snapshot) => ipcRenderer.invoke('remote-control-publish-snapshot', snapshot),
    getRemoteControlSnapshot: () => ipcRenderer.invoke('remote-control-get-snapshot'),
    sendRemoteControlCommand: (command) => ipcRenderer.invoke('remote-control-send-command', command),
    onRemoteControlCommand: (callback) => {
        const listener = (_event, command) => callback(command);
        ipcRenderer.on('remote-control-command', listener);
        return () => ipcRenderer.removeListener('remote-control-command', listener);
    },
    onRemoteControlSnapshot: (callback) => {
        const listener = (_event, snapshot) => callback(snapshot);
        ipcRenderer.on('remote-control-snapshot', listener);
        return () => ipcRenderer.removeListener('remote-control-snapshot', listener);
    },
    chooseVideoExportPath: (defaultName, extension, displayName) => ipcRenderer.invoke('video-export-choose-path', defaultName, extension, displayName),
    reportDevicePixelRatio: (ratio) => ipcRenderer.invoke('report-device-pixel-ratio', ratio),
    getMainWindowCaptureSource: () => ipcRenderer.invoke('video-export-get-main-window-source'),
    prepareVideoExportWindow: (size) => ipcRenderer.invoke('video-export-prepare-window', size),
    restoreVideoExportWindow: () => ipcRenderer.invoke('video-export-restore-window'),
    writeVideoExportFile: (filePath, data) => ipcRenderer.invoke('video-export-write-file', filePath, data),
    getStageStatus: () => ipcRenderer.invoke('stage-get-status'),
    setStageEnabled: (enabled) => ipcRenderer.invoke('stage-set-enabled', enabled),
    regenerateStageToken: () => ipcRenderer.invoke('stage-regenerate-token'),
    clearStageState: () => ipcRenderer.invoke('stage-clear-state'),
    completeStageExternalPlayRequest: (result) => ipcRenderer.invoke('stage-complete-external-play', result),
    publishStagePlayerSnapshot: (snapshot, options) => ipcRenderer.invoke('stage-publish-player-snapshot', snapshot, options),
    completeStagePlayerControlRequest: (result) => ipcRenderer.invoke('stage-complete-player-control', result),
    completeStagePlayerQueueRequest: (result) => ipcRenderer.invoke('stage-complete-player-queue', result),
    onStageSessionUpdated: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('stage-session-updated', listener);
        return () => ipcRenderer.removeListener('stage-session-updated', listener);
    },
    onStageSessionCleared: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('stage-session-cleared', listener);
        return () => ipcRenderer.removeListener('stage-session-cleared', listener);
    },
    onStageExternalPlayRequest: (callback) => {
        const listener = (_event, request) => callback(request);
        ipcRenderer.on('stage-external-play-request', listener);
        return () => ipcRenderer.removeListener('stage-external-play-request', listener);
    },
    onStagePlayerControlRequest: (callback) => {
        const listener = (_event, request) => callback(request);
        ipcRenderer.on('stage-player-control-request', listener);
        return () => ipcRenderer.removeListener('stage-player-control-request', listener);
    },
    onStagePlayerQueueRequest: (callback) => {
        const listener = (_event, request) => callback(request);
        ipcRenderer.on('stage-player-queue-request', listener);
        return () => ipcRenderer.removeListener('stage-player-queue-request', listener);
    },
    debugGetRenderedFonts: (selector) => ipcRenderer.invoke('debug-get-rendered-fonts', selector),
    mods: {
        listMods: () => ipcRenderer.invoke('folia-mods:list'),
        setModEnabled: (modId, enabled) => ipcRenderer.invoke('folia-mods:set-enabled', modId, enabled),
        reloadMods: () => ipcRenderer.invoke('folia-mods:reload'),
        invokeModCommand: (modId, commandId, params) => ipcRenderer.invoke('folia-mods:invoke', modId, commandId, params),
        cancelExport: () => ipcRenderer.invoke('folia-mods:export-cancel'),
        pushRuntimeSnapshot: (snapshot) => ipcRenderer.invoke('folia-mods:push-runtime-snapshot', snapshot),
        getFfmpegStatus: () => ipcRenderer.invoke('folia-mods:ffmpeg-status'),
        openModsDirectory: () => ipcRenderer.invoke('folia-mods:open-directory'),
        installModFromZip: (zipPath) => ipcRenderer.invoke('folia-mods:install-zip', zipPath),
        onModsStateChanged: (callback) => {
            const listener = (_event, mods) => callback(mods);
            ipcRenderer.on('folia-mods:state-changed', listener);
            return () => ipcRenderer.removeListener('folia-mods:state-changed', listener);
        },
        onExportProgress: (callback) => {
            const listener = (_event, progress) => callback(progress);
            ipcRenderer.on('folia-mods:export-progress', listener);
            return () => ipcRenderer.removeListener('folia-mods:export-progress', listener);
        },
        onModLog: (callback) => {
            const listener = (_event, entry) => callback(entry);
            ipcRenderer.on('folia-mods:log', listener);
            return () => ipcRenderer.removeListener('folia-mods:log', listener);
        },
    },
});
