import { afterEach, describe, expect, it } from 'vitest';
import {
    readStoredThemeAutoGenerateEnabled,
    resolveCustomThemePreferenceChange,
    resolveSongThemeAutoGenerateChange,
    resolveSongThemeAutoSwitchChange,
    saveStoredThemeAutoGenerateEnabled,
    type ThemePreferenceSwitchState,
} from '@/services/themePreferences';

// test/unit/theme/themePreferences.test.ts
// Covers persisted theme preference toggles and their mutual-exclusion rules.

const createLocalStorageMock = (): Storage => {
    const store = new Map<string, string>();

    return {
        get length() {
            return store.size;
        },
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
    };
};

const baseState: ThemePreferenceSwitchState = {
    isCustomThemePreferred: false,
    songThemeAutoSwitchEnabled: true,
    songThemeAutoGenerateEnabled: true,
};

describe('themePreferences', () => {
    afterEach(() => {
        delete (globalThis as { window?: unknown; }).window;
    });

    it('defaults automatic song theme generation to disabled', () => {
        (globalThis as { window?: { localStorage: Storage; }; }).window = {
            localStorage: createLocalStorageMock(),
        };

        expect(readStoredThemeAutoGenerateEnabled()).toBe(false);
    });

    it('persists automatic song theme generation', () => {
        const localStorage = createLocalStorageMock();
        (globalThis as { window?: { localStorage: Storage; }; }).window = { localStorage };

        saveStoredThemeAutoGenerateEnabled(true);
        expect(readStoredThemeAutoGenerateEnabled()).toBe(true);

        saveStoredThemeAutoGenerateEnabled(false);
        expect(readStoredThemeAutoGenerateEnabled()).toBe(false);
    });

    it('turns off song automation when custom theme preference is enabled', () => {
        expect(resolveCustomThemePreferenceChange(baseState, true)).toEqual({
            isCustomThemePreferred: true,
            songThemeAutoSwitchEnabled: false,
            songThemeAutoGenerateEnabled: false,
        });
    });

    it('turns off custom theme preference when song auto switch is enabled', () => {
        expect(resolveSongThemeAutoSwitchChange({
            isCustomThemePreferred: true,
            songThemeAutoSwitchEnabled: false,
            songThemeAutoGenerateEnabled: false,
        }, true)).toEqual({
            isCustomThemePreferred: false,
            songThemeAutoSwitchEnabled: true,
            songThemeAutoGenerateEnabled: false,
        });
    });

    it('turns off child auto generation when song auto switch is disabled', () => {
        expect(resolveSongThemeAutoSwitchChange(baseState, false)).toEqual({
            isCustomThemePreferred: false,
            songThemeAutoSwitchEnabled: false,
            songThemeAutoGenerateEnabled: false,
        });
    });

    it('enabling auto generation also enables song auto switch and disables custom preference', () => {
        expect(resolveSongThemeAutoGenerateChange({
            isCustomThemePreferred: true,
            songThemeAutoSwitchEnabled: false,
            songThemeAutoGenerateEnabled: false,
        }, true)).toEqual({
            isCustomThemePreferred: false,
            songThemeAutoSwitchEnabled: true,
            songThemeAutoGenerateEnabled: true,
        });
    });
});
