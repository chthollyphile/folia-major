// electron/windowAlwaysOnTopSupport.cjs
// Whether this process can keep a window above the others. Under Chromium's native Wayland backend
// it cannot: WaylandToplevelWindow::SetZOrderLevel only stores the level in a local field and sends
// the compositor nothing (xdg-shell has no such request), and isAlwaysOnTop() reads that same field
// back, so it reports whatever was last set (issue #657). XWayland (--ozone-platform=x11) works.

/**
 * The windowing backend Chromium runs on: 'wayland', 'x11' (or another ozone name), null off Linux.
 * Chromium writes its choice into --ozone-platform before the main script runs; when that switch is
 * somehow missing, the environment is read the way Chromium's own fallback reads it.
 */
function resolveLinuxOzonePlatform({
  platform = process.platform,
  ozonePlatform = '',
  env = process.env,
} = {}) {
  if (platform !== 'linux') {
    return null;
  }
  if (ozonePlatform) {
    return ozonePlatform;
  }

  const hasWayland = Boolean(env.WAYLAND_SOCKET || env.WAYLAND_DISPLAY);
  const hasX11 = Boolean(env.DISPLAY);
  if (hasWayland !== hasX11) {
    return hasWayland ? 'wayland' : 'x11';
  }
  return env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : 'x11';
}

/** False only on the native Wayland backend, where setAlwaysOnTop does nothing and reports success. */
function isWindowAlwaysOnTopSupported(options) {
  return resolveLinuxOzonePlatform(options) !== 'wayland';
}

module.exports = {
  resolveLinuxOzonePlatform,
  isWindowAlwaysOnTopSupported,
};
