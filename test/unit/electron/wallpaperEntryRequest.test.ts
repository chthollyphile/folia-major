import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/wallpaperEntryRequest.test.ts
// The tray cannot draw the in-app confirmation, so it asks the renderer. When no renderer can
// answer, the caller must be told so it can enter directly instead of dropping the click.

const require = createRequire(import.meta.url);
const {
  WALLPAPER_ENTRY_REQUEST_CHANNEL,
  requestWallpaperEntryConfirmation,
} = require('../../../electron/wallpaper/wallpaperEntryRequest.cjs') as {
  WALLPAPER_ENTRY_REQUEST_CHANNEL: string;
  requestWallpaperEntryConfirmation: (deps: {
    mainWindow: unknown;
    focusMainWindow: () => void;
    isClickThroughActive?: () => boolean;
  }) => boolean;
};

function makeWindow({ windowDestroyed = false, contentsDestroyed = false, loading = false, crashed = false } = {}) {
  const send = vi.fn();
  return {
    send,
    window: {
      isDestroyed: () => windowDestroyed,
      webContents: {
        isDestroyed: () => contentsDestroyed,
        isLoading: () => loading,
        isCrashed: () => crashed,
        send,
      },
    },
  };
}

describe('requestWallpaperEntryConfirmation', () => {
  it('brings the window forward and asks the renderer to confirm', () => {
    const { window, send } = makeWindow();
    const focusMainWindow = vi.fn();

    expect(requestWallpaperEntryConfirmation({ mainWindow: window, focusMainWindow })).toBe(true);

    expect(focusMainWindow).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(WALLPAPER_ENTRY_REQUEST_CHANNEL);
  });

  it.each([
    ['no window', null],
    ['destroyed window', makeWindow({ windowDestroyed: true }).window],
    ['destroyed webContents', makeWindow({ contentsDestroyed: true }).window],
    ['renderer still loading', makeWindow({ loading: true }).window],
    ['crashed renderer', makeWindow({ crashed: true }).window],
  ])('reports false so the tray can enter directly: %s', (_label, mainWindow) => {
    const focusMainWindow = vi.fn();

    expect(requestWallpaperEntryConfirmation({ mainWindow, focusMainWindow })).toBe(false);
    expect(focusMainWindow).not.toHaveBeenCalled();
  });

  it('reports false while the window is click-through, since the dialog could not be clicked', () => {
    const { window, send } = makeWindow();
    const focusMainWindow = vi.fn();

    expect(requestWallpaperEntryConfirmation({
      mainWindow: window,
      focusMainWindow,
      isClickThroughActive: () => true,
    })).toBe(false);
    expect(focusMainWindow).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    expect(requestWallpaperEntryConfirmation({
      mainWindow: window,
      focusMainWindow,
      isClickThroughActive: () => false,
    })).toBe(true);
  });

  it('uses the channel name the preload bridge listens on', () => {
    expect(WALLPAPER_ENTRY_REQUEST_CHANNEL).toBe('wallpaper-entry-requested');
  });
});
