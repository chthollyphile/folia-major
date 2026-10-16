import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/windowsWallpaperEntry.test.ts
// Exercise the actual main-process transition without starting Electron or touching the desktop.
const source = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
const start = source.indexOf('async function relaunchForWallpaperModeChange(');
const end = source.indexOf('// Rebuilds the main window before a mac wallpaper entry', start);
if (start < 0 || end < 0) throw new Error('Wallpaper transition source could not be located');

function createHarness(helperPath: string | null) {
  const values = new Map<string, unknown>([['wallpaper_mode', true]]);
  const send = vi.fn();
  const refreshTrayMenu = vi.fn();
  const requestWindowPlaybackHandoff = vi.fn().mockResolvedValue({ song: 'current' });
  const recreateMainWindowWithTransparencyMode = vi.fn();
  const clearTarget = vi.fn();
  const detach = vi.fn().mockReturnValue(false);
  const run = runInNewContext(`${source.slice(start, end)}\nrelaunchForWallpaperModeChange`, {
    process: { platform: 'win32' },
    console: { warn: vi.fn() },
    wallpaperModeRelaunchGeneration: 1,
    resolveWallpaperHelperPath: () => helperPath,
    store: { set: (key: string, value: unknown) => values.set(key, value) },
    WALLPAPER_MODE_SETTING_KEY: 'wallpaper_mode',
    mainWindow: { isDestroyed: () => false, webContents: { send } },
    getPublicSettings: () => Object.fromEntries(values),
    refreshTrayMenu,
    requestWindowPlaybackHandoff,
    recreateMainWindowWithTransparencyMode,
    isTransparentPlayerBackgroundEnabled: () => false,
    windowsWallpaper: { detach },
    windowsWallpaperTarget: { clear: clearTarget },
    setTimeout,
    clearTimeout,
  }) as (enabled: boolean, generation?: number) => Promise<void>;
  return { run, values, send, refreshTrayMenu, requestWindowPlaybackHandoff,
    recreateMainWindowWithTransparencyMode, detach, clearTarget };
}

describe('Windows wallpaper mode entry', () => {
  it('rolls back a missing helper before playback handoff or screen-sized window creation', async () => {
    const h = createHarness(null);
    await h.run(true, 1);
    expect(h.values.get('wallpaper_mode')).toBe(false);
    expect(h.send).toHaveBeenCalledWith('wallpaper-mode-changed', { wallpaper_mode: false });
    expect(h.refreshTrayMenu).toHaveBeenCalledOnce();
    expect(h.requestWindowPlaybackHandoff).not.toHaveBeenCalled();
    expect(h.recreateMainWindowWithTransparencyMode).not.toHaveBeenCalled();
  });

  it('keeps normal wallpaper entry and its playback handoff when the helper exists', async () => {
    const h = createHarness('C:\\helper.exe');
    await h.run(true, 1);
    expect(h.values.get('wallpaper_mode')).toBe(true);
    expect(h.requestWindowPlaybackHandoff).toHaveBeenCalledOnce();
    expect(h.recreateMainWindowWithTransparencyMode).toHaveBeenCalledWith(false, { song: 'current' });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('ignores a stale entry without overwriting the latest setting', async () => {
    const h = createHarness(null);
    await h.run(true, 0);
    expect(h.values.get('wallpaper_mode')).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.requestWindowPlaybackHandoff).not.toHaveBeenCalled();
  });

  it('still restores an ordinary window when leaving after the helper disappeared', async () => {
    const h = createHarness(null);
    h.values.set('wallpaper_mode', false);
    await h.run(false, 1);
    expect(h.detach).toHaveBeenCalledOnce();
    expect(h.clearTarget).toHaveBeenCalledOnce();
    expect(h.recreateMainWindowWithTransparencyMode).toHaveBeenCalledWith(false, { song: 'current' });
  });
});
