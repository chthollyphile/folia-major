import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import './index.css';
import App from './App';
import RemoteControlApp from './components/remote/RemoteControlApp';
import ObsBrowserSourceApp from './components/obs/ObsBrowserSourceApp';
import ObsNowPlayingSourceApp from './components/obs/ObsNowPlayingSourceApp';

// src/bootstrap.tsx
// Mounts the React app after index.tsx installs runtime-level browser shims.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
const isObsBrowserSource = searchParams.get('obs') === '1' || window.location.pathname === '/obs';
// obsSource=now-playing: static OBS overlay that connects directly to NowPlaying in the browser (no Electron SSE relay).
const isNowPlayingObsSource = isObsBrowserSource && searchParams.get('obsSource') === 'now-playing';
root.render(
  <React.StrictMode>
    {isNowPlayingObsSource
      ? <ObsNowPlayingSourceApp />
      : isObsBrowserSource
        ? <ObsBrowserSourceApp />
        : searchParams.get('remote') === '1'
          ? <RemoteControlApp />
          : <App />}
  </React.StrictMode>
);
