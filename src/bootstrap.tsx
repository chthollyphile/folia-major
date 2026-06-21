import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/config';
import './index.css';
import App from './App';
import RemoteControlApp from './components/remote/RemoteControlApp';
import ObsBrowserSourceApp from './components/obs/ObsBrowserSourceApp';

// src/bootstrap.tsx
// Mounts the React app after index.tsx installs runtime-level browser shims.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const searchParams = new URLSearchParams(window.location.search);
root.render(
  <React.StrictMode>
    {searchParams.get('obs') === '1'
      ? <ObsBrowserSourceApp />
      : searchParams.get('remote') === '1'
        ? <RemoteControlApp />
        : <App />}
  </React.StrictMode>
);
