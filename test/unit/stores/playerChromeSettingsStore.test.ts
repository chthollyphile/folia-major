import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/playerChromeSettingsStore.test.ts
// The macOS native-fullscreen window button is experimental and must remain opt-in.

describe('player chrome settings store', () => {
    it.each([['darwin', 'right'], ['win32', 'right'], ['linux', 'right']])('defaults controls on %s to %s', async (platform, side) => {
        vi.stubGlobal('window', { electron: { platform }, localStorage });
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');
        expect(usePlayerChromeSettingsStore.getState().titlebarSide).toBe(side);
        usePlayerChromeSettingsStore.getState().handleSetTitlebarSide(side === 'left' ? 'right' : 'left');
        expect(values.get('window_titlebar_side')).toBe(side === 'left' ? 'right' : 'left');
    });

    it('falls back to the right for a malformed saved side on macOS', async () => {
        values.set('window_titlebar_side', 'invalid');
        vi.stubGlobal('window', { electron: { platform: 'darwin' }, localStorage });
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');
        expect(usePlayerChromeSettingsStore.getState().titlebarSide).toBe('right');
    });

    it('restores an explicit left side over the default', async () => {
        values.set('window_titlebar_side', 'left');
        vi.stubGlobal('window', { electron: { platform: 'darwin' }, localStorage });
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');
        expect(usePlayerChromeSettingsStore.getState().titlebarSide).toBe('left');
    });

    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('keeps the native macOS fullscreen button disabled by default', async () => {
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');

        expect(usePlayerChromeSettingsStore.getState().useNativeMacFullscreenButton).toBe(false);
    });

    it('restores and persists the opt-in choice', async () => {
        values.set('use_native_mac_fullscreen_button', 'true');
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');

        expect(usePlayerChromeSettingsStore.getState().useNativeMacFullscreenButton).toBe(true);

        usePlayerChromeSettingsStore.getState().handleToggleNativeMacFullscreenButton(false);
        expect(localStorage.getItem('use_native_mac_fullscreen_button')).toBe('false');
    });

    it('keeps the idle cursor hide off by default', async () => {
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');

        expect(usePlayerChromeSettingsStore.getState().hideCursorWhenIdle).toBe(false);
    });

    it('persists the idle cursor hide toggle', async () => {
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');

        usePlayerChromeSettingsStore.getState().handleToggleHideCursorWhenIdle(true);
        expect(usePlayerChromeSettingsStore.getState().hideCursorWhenIdle).toBe(true);
        expect(localStorage.getItem('hide_cursor_when_idle')).toBe('true');

        usePlayerChromeSettingsStore.getState().handleToggleHideCursorWhenIdle(false);
        expect(usePlayerChromeSettingsStore.getState().hideCursorWhenIdle).toBe(false);
        expect(localStorage.getItem('hide_cursor_when_idle')).toBe('false');
    });

    it('restores the persisted idle cursor hide choice', async () => {
        values.set('hide_cursor_when_idle', 'true');
        const { usePlayerChromeSettingsStore } = await import('@/stores/usePlayerChromeSettingsStore');

        expect(usePlayerChromeSettingsStore.getState().hideCursorWhenIdle).toBe(true);
    });
});
