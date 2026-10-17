import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/theme/useBuiltinThemeSlotStore.test.ts
// The cover-derived theme's per-slot colour source: which cover swatch each slot reads, persisted.

describe('builtin theme slot store', () => {
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

    it('starts with no slot pinned', async () => {
        const { useBuiltinThemeSlotStore } = await import('@/stores/useBuiltinThemeSlotStore');
        expect(useBuiltinThemeSlotStore.getState().slotPrefs).toEqual({});
    });

    it('pins a slot and persists it, then clears it back to automatic', async () => {
        const { useBuiltinThemeSlotStore } = await import('@/stores/useBuiltinThemeSlotStore');
        const store = useBuiltinThemeSlotStore.getState();

        store.setSlotPref('accentColor', 1);
        expect(useBuiltinThemeSlotStore.getState().slotPrefs).toEqual({ accentColor: 1 });
        expect(localStorage.getItem('builtin_theme_color_slots')).toBe('{"accentColor":1}');

        store.setSlotPref('accentColor', null);
        expect(useBuiltinThemeSlotStore.getState().slotPrefs).toEqual({});
    });

    it('restores the persisted pins', async () => {
        values.set('builtin_theme_color_slots', '{"accentColor":2,"backgroundColor":1}');
        const { useBuiltinThemeSlotStore } = await import('@/stores/useBuiltinThemeSlotStore');

        expect(useBuiltinThemeSlotStore.getState().slotPrefs).toEqual({ accentColor: 2, backgroundColor: 1 });
    });

    it('drops malformed persisted pins', async () => {
        values.set('builtin_theme_color_slots', '{"accentColor":"x","notASlot":1,"primaryColor":0}');
        const { useBuiltinThemeSlotStore } = await import('@/stores/useBuiltinThemeSlotStore');

        expect(useBuiltinThemeSlotStore.getState().slotPrefs).toEqual({});
    });
});
