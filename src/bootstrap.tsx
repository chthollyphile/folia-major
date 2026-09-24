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
import { restoreSavedFoliumSelections } from './mods/folium/missingEntries';
import { installFoliumCommandPaletteSync } from './mods/folium/commandPaletteSync';
// 副作用 import：store 在模块加载时就把 `<html data-reduce-motion>` 写好并保持同步。放在 bootstrap
// 而不是 App 里，是因为下面按 URL 挂的根不止 App —— 远程控制窗口的进度辉光也读这个属性。
import './stores/useMotionSettingsStore';

// src/bootstrap.tsx
// Mounts the React app after index.tsx installs runtime-level browser shims.

// A mod visualizer or background saved to localStorage can only survive a
// restart if its registry entry exists before the settings store validates the
// stored mode. The store initializes eagerly through the static import graph,
// so the mode it read may already have fallen back to a builtin; after mod
// clients register their entries we restore the saved selections
// (src/mods/folium/missingEntries.ts, which also re-runs on every mod reload).

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

installFoliumCommandPaletteSync();
void initFoliumClients()
    .then(restoreSavedFoliumSelections)
    .finally(() => {
        void initializeLocalCoverRuntime().finally(renderApp);
    });
