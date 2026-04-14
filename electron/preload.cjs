const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (key, value) => ipcRenderer.invoke('save-settings', key, value),
    generateTheme: (lyricsText, options) => ipcRenderer.invoke('generate-theme', lyricsText, options),
    getNeteasePort: () => ipcRenderer.invoke('get-netease-port'),
    openDesktopVisualizer: () => ipcRenderer.invoke('open-desktop-visualizer'),
    closeDesktopVisualizer: () => ipcRenderer.invoke('close-desktop-visualizer'),
    getDesktopVisualizerStatus: () => ipcRenderer.invoke('get-desktop-visualizer-status'),
    getDesktopVisualizerState: () => ipcRenderer.invoke('get-desktop-visualizer-state'),
    setDesktopVisualizerState: (snapshot) => ipcRenderer.invoke('set-desktop-visualizer-state', snapshot),
    getDesktopVisualizerOptions: () => ipcRenderer.invoke('get-desktop-visualizer-options'),
    setDesktopVisualizerOptions: (options) => ipcRenderer.invoke('set-desktop-visualizer-options', options),
    onDesktopVisualizerState: (listener) => {
        const wrapped = (_event, snapshot) => listener(snapshot);
        ipcRenderer.on('desktop-visualizer-state', wrapped);
        return () => ipcRenderer.removeListener('desktop-visualizer-state', wrapped);
    },
    onDesktopVisualizerOptions: (listener) => {
        const wrapped = (_event, options) => listener(options);
        ipcRenderer.on('desktop-visualizer-options', wrapped);
        return () => ipcRenderer.removeListener('desktop-visualizer-options', wrapped);
    },
    onDesktopVisualizerClosed: (listener) => {
        const wrapped = () => listener();
        ipcRenderer.on('desktop-visualizer-closed', wrapped);
        return () => ipcRenderer.removeListener('desktop-visualizer-closed', wrapped);
    }
});
