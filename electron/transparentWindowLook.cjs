// electron/transparentWindowLook.cjs
// The main window's look for the transparent-background setting: one source for the BrowserWindow
// options at creation and for the in-place switch (macOS builds the window transparent once and
// only changes these at runtime; the other platforms rebuild the window with them).
function transparentWindowLook(enabled, nativeBlur, platform = process.platform) {
  const blur = !enabled && nativeBlur;
  return {
    backgroundColor: (enabled || nativeBlur) ? '#00000000' : '#09090b',
    hasShadow: !enabled,
    vibrancy: blur && platform === 'darwin' ? 'fullscreen-ui' : undefined,
    backgroundMaterial: blur && platform === 'win32' ? 'acrylic' : undefined,
  };
}

module.exports = { transparentWindowLook };
