import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/playerChromeSettingsStore.test.ts
// The macOS native-fullscreen window button is experimental and must remain opt-in.

describe('player chrome settings store', () => {
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
