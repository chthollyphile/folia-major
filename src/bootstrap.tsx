import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import './index.css';
import App from './App';
import AppSplashGate from './components/AppSplashGate';
import RemoteControlApp from './components/remote/RemoteControlApp';
import ObsBrowserSourceApp from './components/obs/ObsBrowserSourceApp';
import ObsNowPlayingSourceApp from './components/obs/ObsNowPlayingSourceApp';
import ObsPlayerCapSourceApp from './components/obs/ObsPlayerCapSourceApp';
import { initializeLocalCoverRuntime } from './services/localCoverRuntime';
import { initFoliumClients } from './mods/folium/clientLoader';
import { hasVisualizerMode } from './components/visualizer/registry';
import { useVisualizerSettingsStore } from './stores/useVisualizerSettingsStore';
// 副作用 import：store 在模块加载时就把 `<html data-reduce-motion>` 写好并保持同步。放在 bootstrap
// 而不是 App 里，是因为下面按 URL 挂的根不止 App —— 远程控制窗口的进度辉光也读这个属性。
import './stores/useMotionSettingsStore';

// src/bootstrap.tsx
// Mounts the React app after index.tsx installs runtime-level browser shims.

// A mod visualizer saved to localStorage can only survive a restart if its
// registry entry exists before the settings store validates the stored mode.
// The store initializes eagerly through the static import graph, so the mode it
// read may already have fallen back to classic; after mod contributions are
// registered we restore the stored mode when it is now a valid, registered entry.
const restoreStoredModVisualizer = () => {
    try {
        const saved = localStorage.getItem('visualizer_mode');
        if (!saved || !saved.startsWith('mod:')) {
            return;
        }
        if (!hasVisualizerMode(saved)) {
            return;
        }
  const storeVisualizer = useVisualizerSettingsStore.getState();
        if (storeVisualizer.visualizerMode !== saved) {
            storeVisualizer.handleSetVisualizerMode(saved, { notify: false });
        }
    } catch {
        // Best-effort: a restore failure must never block app startup.
    }
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
const isObsBrowserSource = searchParams.get('obs') === '1' || window.location.pathname === '/obs';
const obsSource = searchParams.get('obsSource');
// obsSource=now-playing / playercap: static OBS overlay that connects directly to NowPlaying / PlayerCap in the browser (no Electron SSE relay).
const isNowPlayingObsSource = isObsBrowserSource && obsSource === 'now-playing';
const isPlayerCapObsSource = isObsBrowserSource && obsSource === 'playercap';
const renderApp = () => root.render(
    <React.StrictMode>
      <AppSplashGate>
        {isNowPlayingObsSource
          ? <ObsNowPlayingSourceApp />
          : isPlayerCapObsSource
            ? <ObsPlayerCapSourceApp />
            : isObsBrowserSource
              ? <ObsBrowserSourceApp />
              : searchParams.get('remote') === '1'
                ? <RemoteControlApp />
                : <App />}
      </AppSplashGate>
    </React.StrictMode>
  );

void initFoliumClients()
    .then(restoreStoredModVisualizer)
    .finally(() => {
        void initializeLocalCoverRuntime().finally(renderApp);
    });
