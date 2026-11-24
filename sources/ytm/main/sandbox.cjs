// sources/ytm/main/sandbox.cjs
// YouTube's stream URLs are unlocked by code from its own player script. That code is third-party
// and changes without notice, so it runs in a hidden sandboxed page that has no Node access, no
// preload and no network: http(s) requests of its session are answered locally, and everything
// else (WebSocket, WebRTC) is sent to a proxy that does not exist.
// The page's partition and window come from the source main api (main/index.ts): `session` is
// `api.net.session('folia-ytm-sandbox')` (the in-memory partition the built-in provider used, claimed by
// the trusted table's row), `hidden(options)` is `api.windows.hidden` (sandboxed, no preload, destroyed
// with the mod).

const PARTITION = 'folia-ytm-sandbox';
const ORIGIN = 'https://www.youtube.com/';
const BLANK_PAGE = '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>';
const DEAD_PROXY = { proxyRules: 'socks5://127.0.0.1:1', proxyBypassRules: '<-loopback>' };

// `isAllowed` says whether the app still has its main window: the hidden page must not outlive it.
function createYtmSandbox({ session, hidden, isAllowed = () => true, timeoutMs = 15000 }) {
  let opening = null;
  let configured = null;

  const configure = async sandboxSession => {
    const serve = request => (request.url === ORIGIN
      ? new Response(BLANK_PAGE, { headers: { 'content-type': 'text/html' } })
      : new Response(null, { status: 403 }));
    sandboxSession.intercept('https', serve);
    sandboxSession.intercept('http', serve);
    sandboxSession.refusePermissions();
    await sandboxSession.setProxy(DEAD_PROXY);
  };

  const open = async () => {
    configured ??= configure(session);
    await configured;
    // Sandboxed, context-isolated and without Node or a preload (api.windows.hidden's own); its timers
    // must run while it is hidden, as the player code waits on them.
    const window = hidden({ session: PARTITION, backgroundThrottling: false });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    try {
      await window.loadURL(ORIGIN);
    } catch (error) {
      window.destroy();
      throw error;
    }
    return window;
  };

  // One window at a time, shared by concurrent callers.
  const ensure = () => {
    if (!opening) {
      const attempt = open();
      opening = attempt;
      attempt.catch(() => { if (opening === attempt) opening = null; });
    }
    return opening;
  };

  const close = attempt => {
    if (opening === attempt) opening = null;
    attempt.then(window => { if (!window.isDestroyed()) window.destroy(); }).catch(() => {});
  };

  return {
    // Runs one script in the page and resolves to its (structured-cloneable) result.
    async evaluate(code) {
      if (!isAllowed()) throw new Error('YouTube Music sandbox is closed');
      let attempt = ensure();
      let window = await attempt;
      if (window.isDestroyed()) {
        if (opening === attempt) opening = null;
        attempt = ensure();
        window = await attempt;
      }
      let timer;
      try {
        return await Promise.race([
          window.webContents.executeJavaScript(code, false),
          // A page that crashed or loops never answers; it is replaced on the next call.
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
              close(attempt);
              reject(new Error('YouTube Music sandbox did not answer'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },

    // A hidden window keeps the app alive after the main window closes, so it goes with it and is
    // opened again on the next use.
    destroy() {
      if (opening) close(opening);
    },
  };
}

module.exports = { createYtmSandbox };
