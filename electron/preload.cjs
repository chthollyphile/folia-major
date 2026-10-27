const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    webUtils: {
      // File.path was removed in modern Electron; this is the supported way to
      // resolve the OS path of a dropped file from the renderer.
      getPathForFile: (file) => webUtils.getPathForFile(file),
    },
    // Beat This! on the CPU, automix's fallback when the renderer's GPU path cannot run. Returns null
    // whenever the weights are not there, which is the browser build's permanent answer.
    runBeatThis: (chunks) => ipcRenderer.invoke('automix-beat-this', chunks),
    // The same model's WebGPU export ({ weights, manifest }) for the renderer's own GPU runtime, or null.
    getBeatThisGpuWeights: (model) => ipcRenderer.invoke('automix-beat-this-gpu-weights', model),
    getHtdemucsGpuWeights: () => ipcRenderer.invoke('automix-beat-this-gpu-weights', 'htdemucs'),
    separateStems: (request) => ipcRenderer.invoke('automix-htdemucs', request),
    // Whether automix is switched on. While it is, the analysis worker keeps htdemucs loaded; switching
    // it off releases it. See electron/analysis/host.cjs.
    // (From the PR #750 re-review, 2026-10-19: not kept while it is on any more - the worker releases
    // htdemucs a minute after each run - and switching it off still releases it at once.)
    setAutomixEnabled: (enabled) => ipcRenderer.send('automix-enabled', enabled === true),
    // Which weights exist, answered without loading them. See the handler for why the settings page
    // is not allowed to infer this from "am I running in Electron".
    getAutomixModelsPresent: () => ipcRenderer.invoke('automix-models-present'),
    // One-way stage marks from the automix session into the runtime log. See services/automix/diag.ts.
    diagMark: (text) => ipcRenderer.send('automix-diag', text),
    // Old automix models left in the folder an earlier version let the listener choose. See main.cjs.
    checkLegacyModels: () => ipcRenderer.invoke('legacy-models-check'),
    resolveLegacyModels: (action) => ipcRenderer.invoke('legacy-models-resolve', action),
    openLegacyModelsFolder: () => ipcRenderer.invoke('legacy-models-open'),
    // Developer debug module: the runtime log and the memory monitor. See electron/debug/debugHost.cjs.
    debugGetState: () => ipcRenderer.invoke('debug-get-state'),
    debugSetState: (patch) => ipcRenderer.invoke('debug-set-state', patch),
    debugOpenLogs: (which) => ipcRenderer.invoke('debug-open-logs', which),
    // Batched by the caller - one message per line would cost more than the logging it records.
    debugWriteRuntimeLines: (lines) => ipcRenderer.send('debug-runtime-lines', lines),
    // The main process's console lines, for the log panel: what was said so far, then each burst.
    onDebugMainLines: (callback) => {
        // After a reload the window is still listed from its last page, and a burst sent to it can
        // arrive ahead of the backlog this page asks for, which holds the same lines.
        let caughtUp = false;
        const listener = (_event, lines, isBacklog) => {
            caughtUp ||= isBacklog === true;
            if (caughtUp) callback(lines);
        };
        ipcRenderer.on('debug-main-lines', listener);
        ipcRenderer.send('debug-main-lines-ready');
        return () => ipcRenderer.removeListener('debug-main-lines', listener);
    },
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
    platform: process.platform,
    isLinuxX11: process.platform === 'linux' && !process.env.WAYLAND_DISPLAY,
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (key, value) => ipcRenderer.invoke('save-settings', key, value),
    onWallpaperModeChanged: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('wallpaper-mode-changed', listener);
        return () => ipcRenderer.removeListener('wallpaper-mode-changed', listener);
    },
    onWallpaperTransparentRefused: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('wallpaper-transparent-refused', listener);
        return () => ipcRenderer.removeListener('wallpaper-transparent-refused', listener);
    },
    onWallpaperEntryRequested: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('wallpaper-entry-requested', listener);
        return () => ipcRenderer.removeListener('wallpaper-entry-requested', listener);
    },
    onWallpaperInputMonitorRequested: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('wallpaper-input-monitor-requested', listener);
        return () => ipcRenderer.removeListener('wallpaper-input-monitor-requested', listener);
    },
    onWallpaperAccessibilitySuggested: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('wallpaper-accessibility-suggested', listener);
        return () => ipcRenderer.removeListener('wallpaper-accessibility-suggested', listener);
    },
    getGpuPreferenceState: () => ipcRenderer.invoke('gpu-preference-state'),
    getWallpaperDisplays: () => ipcRenderer.invoke('wallpaper-displays-get'),
    setWallpaperDisplay: (displayId) => ipcRenderer.invoke('wallpaper-display-set', displayId),
    onWallpaperDisplaysChanged: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('wallpaper-displays-changed', listener);
        return () => ipcRenderer.removeListener('wallpaper-displays-changed', listener);
    },
    setWallpaperHitRegions: (rects) => ipcRenderer.send('wallpaper-hit-regions', rects),
    setPlaybackDisplaySleepBlockingActive: (active) => ipcRenderer.invoke('playback-display-sleep-set-active', active),
    getBackgroundThrottlingState: () => ipcRenderer.invoke('background-throttling-get'),
    onBackgroundThrottlingChanged: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('background-throttling-changed', listener);
        return () => ipcRenderer.removeListener('background-throttling-changed', listener);
    },
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
    removeAudioCache: (cacheKey, size) => ipcRenderer.invoke('remove-audio-cache', cacheKey, size),
    getAudioCacheUsage: () => ipcRenderer.invoke('get-audio-cache-usage'),
    getAudioCacheStats: () => ipcRenderer.invoke('get-audio-cache-stats'),
    clearAudioCache: () => ipcRenderer.invoke('clear-audio-cache'),
    requestTranscodeFallback: (request) => ipcRenderer.invoke('transcode-fallback-request', request),
    cancelTranscodeFallback: (requestId) => ipcRenderer.invoke('transcode-fallback-cancel', requestId),
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
    segmentLyrics: (lines) => ipcRenderer.invoke('segment-lyrics', lines),
    testAiConnection: (settings) => ipcRenderer.invoke('ai-test-connection', settings),
    listAiModels: (settings) => ipcRenderer.invoke('ai-list-models', settings),
    fetchLyricProxy: (url, init) => ipcRenderer.invoke('lyric-proxy-fetch', url, init),
    getNeteasePort: () => ipcRenderer.invoke('get-netease-port'),
    getNeteaseApiStatus: () => ipcRenderer.invoke('get-netease-api-status'),
    getLoginDiagnostics: (providerId) => ipcRenderer.invoke('get-login-diagnostics', providerId),
    runLoginSelfCheck: (providerId) => ipcRenderer.invoke('run-login-self-check', providerId),
    // 'needed': a request needs the local service and finds it down (see startsAgainWhenNeeded).
    restartNeteaseApi: (reason) => ipcRenderer.invoke('restart-netease-api', reason),
    onNeteaseApiStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('netease-api-status-changed', listener);
        return () => ipcRenderer.removeListener('netease-api-status-changed', listener);
    },
    getKugouApiStatus: () => ipcRenderer.invoke('kugou-api-status'),
    kugouRequest: (operation, params) => ipcRenderer.invoke('kugou-api-request', operation, params),
    qishuiRequest: (operation, params) => ipcRenderer.invoke('qishui-api-request', operation, params),
    bodianRequest: (operation, params) => ipcRenderer.invoke('bodian-api-request', operation, params),
    ytmRequest: (operation, params) => ipcRenderer.invoke('ytm-api-request', operation, params),
    spotifyRequest: (operation, params) => ipcRenderer.invoke('spotify-api-request', operation, params),
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
    isWindowFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
    onWindowFullscreenChanged: (callback) => {
        const listener = (_event, fullscreen) => callback(fullscreen);
        ipcRenderer.on('window-fullscreen-changed', listener);
        return () => ipcRenderer.removeListener('window-fullscreen-changed', listener);
    },
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
    publishLyricApiData: (lyrics, offset, clipStartMs) => ipcRenderer.invoke('lyric-api-publish', lyrics, offset, clipStartMs),
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
    getGlobalShortcutBackend: () => ipcRenderer.invoke('global-shortcuts-backend'),
    setGlobalShortcuts: (accelerators) => ipcRenderer.invoke('global-shortcuts-set', accelerators),
    onGlobalShortcut: (callback) => {
        const listener = (_event, accelerator) => callback(accelerator);
        ipcRenderer.on('global-shortcut-triggered', listener);
        return () => ipcRenderer.removeListener('global-shortcut-triggered', listener);
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
    getRemoteControlWindowSettings: () => ipcRenderer.invoke('remote-control-get-window-settings'),
    onRemoteControlWindowSettingsChanged: (callback) => {
        const listener = (_event, settings) => callback(settings);
        ipcRenderer.on('remote-control-window-settings-changed', listener);
        return () => ipcRenderer.removeListener('remote-control-window-settings-changed', listener);
    },
    getRemoteControlPointerInside: () => ipcRenderer.invoke('remote-control-get-pointer-inside'),
    onRemoteControlPointerInside: (callback) => {
        const listener = (_event, inside) => callback(Boolean(inside));
        ipcRenderer.on('remote-control-pointer-inside', listener);
        return () => ipcRenderer.removeListener('remote-control-pointer-inside', listener);
    },
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
    prepareVideoExportWindow: (size) => ipcRenderer.invoke('video-export-prepare-window', size),
    restoreVideoExportWindow: () => ipcRenderer.invoke('video-export-restore-window'),
    openVideoExportFile: (filePath) => ipcRenderer.invoke('video-export-open-file', filePath),
    appendVideoExportChunk: (sessionId, data) => ipcRenderer.invoke('video-export-append-chunk', sessionId, data),
    finishVideoExportFile: (sessionId) => ipcRenderer.invoke('video-export-finish-file', sessionId),
    abortVideoExportFile: (sessionId) => ipcRenderer.invoke('video-export-abort-file', sessionId),
    // 设置 -> 连接与集成 -> AI 控制（CLI / MCP）：开关、状态（地址/令牌/路径）、换令牌。
    getControlStatus: () => ipcRenderer.invoke('control-get-status'),
    setControlEnabled: (enabled) => ipcRenderer.invoke('control-set-enabled', enabled),
    regenerateControlToken: () => ipcRenderer.invoke('control-regenerate-token'),
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
        invokeModRpc: (modId, name, args) => ipcRenderer.invoke('folia-mods:rpc', modId, name, args),
        invokeModStorage: (modId, operation, key, value) => ipcRenderer.invoke('folia-mods:storage', modId, operation, key, value),
        invokeModSecrets: (modId, operation, key, value) => ipcRenderer.invoke('folia-mods:secrets', modId, operation, key, value),
        invokeModNetFetch: (modId, url, init) => ipcRenderer.invoke('folia-mods:net-fetch', modId, url, init),
        invokeModPickFile: (modId, accept, persist) => ipcRenderer.invoke('folia-mods:pick-file', modId, accept, persist),
        invokeModRestoreFile: (modId, grantId) => ipcRenderer.invoke('folia-mods:restore-file', modId, grantId),
        invokeModReleaseFile: (modId, grantId) => ipcRenderer.invoke('folia-mods:release-file', modId, grantId),
        cancelExport: () => ipcRenderer.invoke('folia-mods:export-cancel'),
        pushRuntimeSnapshot: (snapshot) => ipcRenderer.invoke('folia-mods:push-runtime-snapshot', snapshot),
        getFfmpegStatus: () => ipcRenderer.invoke('folia-mods:ffmpeg-status'),
        openModsDirectory: () => ipcRenderer.invoke('folia-mods:open-directory'),
        installModFromZip: (zipPath) => ipcRenderer.invoke('folia-mods:install-zip', zipPath),
        getModStorageUsage: (modId) => ipcRenderer.invoke('folia-mods:storage-usage', modId),
        clearModCache: (modId) => ipcRenderer.invoke('folia-mods:clear-cache', modId),
        getModCallStats: () => ipcRenderer.invoke('folia-mods:call-stats'),
        reportModsStartSettled: () => ipcRenderer.invoke('folia-mods:start-settled'),
        reportModsStartAlive: () => ipcRenderer.invoke('folia-mods:start-alive'),
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
        onModRpcMessage: (callback) => {
            const listener = (_event, message) => callback(message);
            ipcRenderer.on('folia-mods:rpc-message', listener);
            return () => ipcRenderer.removeListener('folia-mods:rpc-message', listener);
        },
        onModSecretChanged: (callback) => {
            const listener = (_event, change) => callback(change);
            ipcRenderer.on('folia-mods:secret-changed', listener);
            return () => ipcRenderer.removeListener('folia-mods:secret-changed', listener);
        },
    },
    hifi: {
        getRuntimeStatus: () => ipcRenderer.invoke('hifi:get-runtime-status'),
        detectRuntime: () => ipcRenderer.invoke('hifi:detect-runtime'),
        pickRuntimePath: () => ipcRenderer.invoke('hifi:pick-runtime-path'),
        installRuntime: () => ipcRenderer.invoke('hifi:install-runtime'),
        cancelInstall: () => ipcRenderer.invoke('hifi:cancel-install'),
        configure: (config) => ipcRenderer.invoke('hifi:configure', config),
        listDevices: () => ipcRenderer.invoke('hifi:list-devices'),
        load: (request) => ipcRenderer.invoke('hifi:load', request),
        play: () => ipcRenderer.invoke('hifi:play'),
        pause: () => ipcRenderer.invoke('hifi:pause'),
        seek: (positionSec) => ipcRenderer.invoke('hifi:seek', positionSec),
        stop: () => ipcRenderer.invoke('hifi:stop'),
        setLoopFile: (loop) => ipcRenderer.invoke('hifi:set-loop-file', loop),
        preloadNext: (request) => ipcRenderer.invoke('hifi:preload-next', request),
        clearNext: () => ipcRenderer.invoke('hifi:clear-next'),
        getSnapshot: () => ipcRenderer.invoke('hifi:get-snapshot'),
        probeOutput: () => ipcRenderer.invoke('hifi:probe-output'),
        respondRead: (readId, response) => ipcRenderer.invoke('hifi:read-result', readId, response),
        // Linux：HiFi 在放时主进程登记的 MPRIS（electron/hifi/mpris/）。
        setMprisState: (state) => ipcRenderer.invoke('hifi:mpris-state', state),
        setMprisArtwork: (trackKey, artwork) => ipcRenderer.invoke('hifi:mpris-artwork', trackKey, artwork),
        onMprisCommand: (callback) => {
            const listener = (_event, command) => callback(command);
            ipcRenderer.on('hifi:mpris-command', listener);
            return () => ipcRenderer.removeListener('hifi:mpris-command', listener);
        },
        onMprisStatus: (callback) => {
            const listener = (_event, status) => callback(status);
            ipcRenderer.on('hifi:mpris-status', listener);
            return () => ipcRenderer.removeListener('hifi:mpris-status', listener);
        },
        onState: (callback) => {
            const listener = (_event, state) => callback(state);
            ipcRenderer.on('hifi:state', listener);
            return () => ipcRenderer.removeListener('hifi:state', listener);
        },
        onClock: (callback) => {
            const listener = (_event, update) => callback(update);
            ipcRenderer.on('hifi:clock', listener);
            return () => ipcRenderer.removeListener('hifi:clock', listener);
        },
        onError: (callback) => {
            const listener = (_event, hifiError) => callback(hifiError);
            ipcRenderer.on('hifi:error', listener);
            return () => ipcRenderer.removeListener('hifi:error', listener);
        },
        onInstallProgress: (callback) => {
            const listener = (_event, progress) => callback(progress);
            ipcRenderer.on('hifi:install-progress', listener);
            return () => ipcRenderer.removeListener('hifi:install-progress', listener);
        },
        onReadRequest: (callback) => {
            const listener = (_event, request) => callback(request);
            ipcRenderer.on('hifi:read', listener);
            return () => ipcRenderer.removeListener('hifi:read', listener);
        },
    },
});
