// electron/appleMusic/authorization.cjs

// MusicKit stays hidden; one Apple-owned modal belongs to Folia's visible main window.
function createAuthorization({ getParentWindow, invoke, timeoutMs = 600000 }) {
  let popup;
  let pending;
  let cancel;
  const closePopup = () => {
    const current = popup;
    popup = undefined;
    if (current && !current.isDestroyed()) current.destroy();
  };
  function attach(contents) {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url);
        if (!pending || target.protocol !== 'https:' || !(target.hostname === 'apple.com' || target.hostname.endsWith('.apple.com'))) return { action: 'deny' };
        if (popup && !popup.isDestroyed()) { popup.focus(); return { action: 'deny' }; }
        const parent = getParentWindow();
        return { action: 'allow', overrideBrowserWindowOptions: {
          ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
          width: 520, height: 720, autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
        } };
      } catch { return { action: 'deny' }; }
    });
    contents.on('did-create-window', window => {
      if (!pending || popup) { window.destroy(); return; }
      popup = window;
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // Apple's completion page can display an error before delivering the grant.
      // Use its own close action, then let MusicKit decide whether authorization succeeded.
      let completing = false;
      const finishAppleCallback = async () => {
        if (completing || popup !== window || window.isDestroyed()) return;
        try {
          const target = new URL(window.webContents.getURL());
          if (target.origin !== 'https://authorize.music.apple.com' || target.pathname !== '/error') return;
          completing = true;
          const clicked = await window.webContents.executeJavaScript(`(() => {
            if (location.origin !== 'https://authorize.music.apple.com' || location.pathname !== '/error') return false;
            const button = document.querySelector('[data-test="close-window-button"]');
            if (!button) return false;
            button.click();
            return true;
          })()`, true);
          if (!clicked) completing = false;
        } catch { completing = false; }
      };
      window.webContents.on('did-finish-load', finishAppleCallback);
      window.webContents.on('did-navigate-in-page', finishAppleCallback);
      window.on('closed', () => {
        if (popup !== window) return;
        popup = undefined;
        // Closing the popup is not an authorization result. MusicKit may still be
        // exchanging the grant or resolving its promise; keep waiting for that result.
      });
    });
  }
  function authorize() {
    if (pending) { popup?.focus(); return pending; }
    let timer;
    const interrupted = new Promise((_, reject) => {
      cancel = reject;
      timer = setTimeout(() => reject(new Error('login-timeout')), timeoutMs);
    });
    // Defer invocation so the popup handler sees an active login attempt.
    pending = Promise.race([Promise.resolve().then(() => invoke('authorize', {}, true)), interrupted])
      .finally(() => {
        cancel = undefined;
        clearTimeout(timer);
        closePopup();
        pending = undefined;
      });
    return pending;
  }
  function dispose() {
    cancel?.(new Error('login-cancelled'));
    closePopup();
  }
  return { attach, authorize, dispose };
}
module.exports = { createAuthorization };
