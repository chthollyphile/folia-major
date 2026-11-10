import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useInteractionSettingsStore as StoreHook } from '@/stores/useInteractionSettingsStore';

// test/unit/stores/globalShortcutBindings.test.ts
// How the system-wide shortcut bindings are stored: always five slots, anything unreadable is an
// empty slot, keys are kept in lower case, modifiers are kept to the four known ones in the shown
// order (a binding stored before they could be chosen gets the trio older versions could only use),
// and clearing every slot removes the stored value. The store reads storage at import, so each case
// imports it again.

const KEY = 'global_shortcut_bindings';
const TRIO = ['control', 'alt', 'shift'];
let storage: Map<string, string>;

const loadStore = async (initial: Record<string, string> = {}): Promise<typeof StoreHook> => {
    vi.resetModules();
    storage = new Map(Object.entries(initial));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
    });
    return (await import('@/stores/useInteractionSettingsStore')).useInteractionSettingsStore;
};

const EMPTY = { key: null, modifiers: TRIO, commandId: null };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('global shortcut bindings', () => {
    it('starts with five empty slots', async () => {
        const store = await loadStore();
        expect(store.getState().globalShortcutBindings).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
    });

    it('reads malformed or non-array storage as five empty slots', async () => {
        for (const stored of ['{not json', '"p"', '{"key":"p"}', '42']) {
            const store = await loadStore({ [KEY]: stored });
            expect(store.getState().globalShortcutBindings, stored).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
        }
    });

    it('keeps legal entries, empties illegal ones, and pads a short list', async () => {
        const store = await loadStore({
            [KEY]: JSON.stringify([
                { key: 'p', commandId: 'playback-toggle' },
                { key: 'P', commandId: 'playback-next' },
                { key: 'f4', commandId: '' },
                { key: 'space', modifiers: ['shift', 'nonsense'], commandId: 'playback-volume-up' },
                null,
            ]),
        });
        expect(store.getState().globalShortcutBindings).toEqual([
            { key: 'p', modifiers: TRIO, commandId: 'playback-toggle' },
            { key: null, modifiers: TRIO, commandId: 'playback-next' },
            { key: 'f4', modifiers: TRIO, commandId: null },
            { key: 'space', modifiers: ['shift'], commandId: 'playback-volume-up' },
            EMPTY,
        ]);
    });

    it('lower-cases a key, puts modifiers in the shown order, ignores a slot out of range, and persists', async () => {
        const store = await loadStore();
        store.getState().setGlobalShortcutBinding(1, { key: 'N' });
        store.getState().setGlobalShortcutBinding(1, { commandId: 'playback-next' });
        store.getState().setGlobalShortcutBinding(7, { key: 'x' });

        expect(store.getState().globalShortcutBindings[1]).toEqual({ key: 'n', modifiers: TRIO, commandId: 'playback-next' });
        expect(JSON.parse(storage.get(KEY) ?? 'null')[1]).toEqual({ key: 'n', modifiers: TRIO, commandId: 'playback-next' });
        expect(store.getState().globalShortcutBindings).toHaveLength(5);

        store.getState().setGlobalShortcutBinding(2, { key: 'SPACE', modifiers: ['meta', 'control'] });
        expect(store.getState().globalShortcutBindings[2]).toEqual({ key: 'space', modifiers: ['control', 'meta'], commandId: null });
    });

    it('removes the stored value once every slot is empty again', async () => {
        const store = await loadStore();
        store.getState().setGlobalShortcutBinding(0, { key: 'p', commandId: 'playback-toggle' });
        expect(storage.has(KEY)).toBe(true);
        store.getState().setGlobalShortcutBinding(0, { key: null, commandId: null });
        expect(storage.has(KEY)).toBe(false);
    });

    it('keeps every named key the rules take, including the long ones', async () => {
        const store = await loadStore();
        const named = ['space', 'tab', 'enter', 'backspace', 'delete', 'insert', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'];
        for (const [slot, key] of named.entries()) {
            store.getState().setGlobalShortcutBinding(slot % 5, { key });
            expect(store.getState().globalShortcutBindings[slot % 5].key, key).toBe(key);
        }
    });

    it('keeps the Wayland portal off until asked, and remembers the answer', async () => {
        const store = await loadStore();
        expect(store.getState().globalShortcutPortalEnabled).toBe(false);
        store.getState().setGlobalShortcutPortalEnabled(true);
        expect(storage.get('global_shortcut_portal_enabled')).toBe('true');
        expect((await loadStore({ global_shortcut_portal_enabled: 'true' })).getState().globalShortcutPortalEnabled).toBe(true);
    });
});
