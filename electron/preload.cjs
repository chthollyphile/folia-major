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
    openRemoteControl: () => ipcRenderer.invoke('remote-control-open'),
    closeRemoteControl: () => ipcRenderer.invoke('remote-control-close'),
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
    chooseVideoExportPath: (defaultName) => ipcRenderer.invoke('video-export-choose-path', defaultName),
    getMainWindowCaptureSource: () => ipcRenderer.invoke('video-export-get-main-window-source'),
    prepareVideoExportWindow: (size) => ipcRenderer.invoke('video-export-prepare-window', size),
    restoreVideoExportWindow: () => ipcRenderer.invoke('video-export-restore-window'),
    writeVideoExportFile: (filePath, data) => ipcRenderer.invoke('video-export-write-file', filePath, data),
    getStageStatus: () => ipcRenderer.invoke('stage-get-status'),
    setStageEnabled: (enabled) => ipcRenderer.invoke('stage-set-enabled', enabled),
    regenerateStageToken: () => ipcRenderer.invoke('stage-regenerate-token'),
    clearStageState: () => ipcRenderer.invoke('stage-clear-state'),
    completeStageExternalPlayRequest: (result) => ipcRenderer.invoke('stage-complete-external-play', result),
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
    debugGetRenderedFonts: (selector) => ipcRenderer.invoke('debug-get-rendered-fonts', selector),
});
