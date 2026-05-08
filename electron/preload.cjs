const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (key, value) => ipcRenderer.invoke('save-settings', key, value),
    getCacheDirectory: () => ipcRenderer.invoke('get-cache-directory'),
    chooseCacheDirectory: () => ipcRenderer.invoke('choose-cache-directory'),
    resetCacheDirectory: () => ipcRenderer.invoke('reset-cache-directory'),
    getUpdateStatus: () => ipcRenderer.invoke('updates-get-status'),
    checkForUpdates: () => ipcRenderer.invoke('updates-check'),
    markUpdateSeen: (version) => ipcRenderer.invoke('updates-mark-seen', version),
    openUpdateReleasePage: (version) => ipcRenderer.invoke('updates-open-release-page', version),
    downloadUpdate: () => ipcRenderer.invoke('updates-download'),
    quitAndInstallUpdate: () => ipcRenderer.invoke('updates-quit-and-install'),
    onUpdateStatusChanged: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('update-status-changed', listener);
        return () => ipcRenderer.removeListener('update-status-changed', listener);
    },
    getAudioCache: (cacheKey) => ipcRenderer.invoke('get-audio-cache', cacheKey),
    hasAudioCache: (cacheKey) => ipcRenderer.invoke('has-audio-cache', cacheKey),
    saveAudioCache: (cacheKey, data, mimeType) => ipcRenderer.invoke('save-audio-cache', cacheKey, data, mimeType),
    getAudioCacheUsage: () => ipcRenderer.invoke('get-audio-cache-usage'),
    getAudioCacheStats: () => ipcRenderer.invoke('get-audio-cache-stats'),
    clearAudioCache: () => ipcRenderer.invoke('clear-audio-cache'),
    generateTheme: (lyricsText, options) => ipcRenderer.invoke('generate-theme', lyricsText, options),
    getNeteasePort: () => ipcRenderer.invoke('get-netease-port'),
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('window-toggle-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),
    isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    updateTaskbarControls: (state) => ipcRenderer.invoke('thumbar-update-buttons', state),
    onTaskbarControl: (callback) => {
        const listener = (_event, action) => callback(action);
        ipcRenderer.on('thumbar-action', listener);
        return () => ipcRenderer.removeListener('thumbar-action', listener);
    },
    getStageStatus: () => ipcRenderer.invoke('stage-get-status'),
    setStageEnabled: (enabled) => ipcRenderer.invoke('stage-set-enabled', enabled),
    regenerateStageToken: () => ipcRenderer.invoke('stage-regenerate-token'),
    clearStageSession: () => ipcRenderer.invoke('stage-clear-session'),
    connectStageRealtime: () => ipcRenderer.invoke('stage-connect-realtime'),
    disconnectStageRealtime: () => ipcRenderer.invoke('stage-disconnect-realtime'),
    sendStageControlRequest: (request) => ipcRenderer.invoke('stage-send-control-request', request),
    reportStagePlaybackState: (report) => ipcRenderer.invoke('stage-report-playback-state', report),
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
    onStageRealtimeState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('stage-realtime-state', listener);
        return () => ipcRenderer.removeListener('stage-realtime-state', listener);
    },
    onStageConnectionState: (callback) => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('stage-connection-state', listener);
        return () => ipcRenderer.removeListener('stage-connection-state', listener);
    },
    debugGetRenderedFonts: (selector) => ipcRenderer.invoke('debug-get-rendered-fonts', selector),
});
