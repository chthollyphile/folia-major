const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (key, value) => ipcRenderer.invoke('save-settings', key, value),
    getCacheDirectory: () => ipcRenderer.invoke('get-cache-directory'),
    chooseCacheDirectory: () => ipcRenderer.invoke('choose-cache-directory'),
    resetCacheDirectory: () => ipcRenderer.invoke('reset-cache-directory'),
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
    debugGetRenderedFonts: (selector) => ipcRenderer.invoke('debug-get-rendered-fonts', selector),
});
