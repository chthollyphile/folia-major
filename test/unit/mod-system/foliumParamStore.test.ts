// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/foliumParamStore.test.ts
// The persisted store behind every schema-backed surface: corrupt payloads
// degrade to nothing, writes go through the schema, reads merge defaults and
// stay referentially stable, persistence is debounced, and the export window
// never writes back.

const STORAGE_KEY = 'folia_folium_params_v1';

const loadStore = async () => {
    vi.resetModules();
    return import('@/mods/folium/paramStore');
};

const schema = [
    { key: 'size', type: 'number' as const, label: {}, min: 0, max: 10, defaultValue: 4 },
    { key: 'on', type: 'boolean' as const, label: {}, defaultValue: true },
];

// Node's own experimental localStorage shadows jsdom's here, so tests stub an
// in-memory Storage (same approach as ponderStore.test.ts).
const createMemoryStorage = () => {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => { items.set(key, String(value)); },
        removeItem: (key: string) => { items.delete(key); },
        clear: () => items.clear(),
        key: (index: number) => Array.from(items.keys())[index] ?? null,
        get length() { return items.size; },
    };
};

beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.useRealTimers();
});

describe('folium param store', () => {
    it('ignores corrupt and foreign payloads', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ good: { a: 1 }, bad: [1, 2], worse: 3 }));
        const { snapshotFoliumParams } = await loadStore();
        expect(snapshotFoliumParams()).toEqual({ good: { a: 1 } });

        localStorage.setItem(STORAGE_KEY, '{not json');
        const reloaded = await loadStore();
        expect(reloaded.snapshotFoliumParams()).toEqual({});
    });

    it('merges defaults on read and filters writes through the schema', async () => {
        const { createFoliumParamAccess } = await loadStore();
        const access = createFoliumParamAccess('visualizer:m:v', schema);
        expect(access.get()).toEqual({ size: 4, on: true });
        access.set({ size: 99, on: 'yes', extra: 1 });
        expect(access.get()).toEqual({ size: 10, on: true });
    });

    it('returns the same object until the scope changes, and notifies only that scope', async () => {
        const { createFoliumParamAccess } = await loadStore();
        const access = createFoliumParamAccess('a', schema);
        const other = createFoliumParamAccess('b', schema);
        const listener = vi.fn();
        access.subscribe(listener);
        const first = access.get();
        expect(access.get()).toBe(first);
        other.set({ size: 1 });
        expect(listener).not.toHaveBeenCalled();
        expect(access.get()).toBe(first);
        access.set({ size: 2 });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(access.get()).not.toBe(first);
        access.reset();
        expect(access.get()).toEqual({ size: 4, on: true });
    });

    it('debounces persistence and flushes on demand', async () => {
        vi.useFakeTimers();
        const { createFoliumParamAccess, flushFoliumParamsSave } = await loadStore();
        const access = createFoliumParamAccess('a', schema);
        access.set({ size: 1 });
        access.set({ size: 2 });
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        flushFoliumParamsSave();
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ a: { size: 2 } });
    });

    it('does not persist values hydrated for the export window', async () => {
        vi.useFakeTimers();
        const { hydrateFoliumParamsForExport, createFoliumParamAccess, flushFoliumParamsSave } = await loadStore();
        hydrateFoliumParamsForExport({ a: { size: 7 } });
        const access = createFoliumParamAccess('a', schema);
        expect(access.get().size).toBe(7);
        access.set({ size: 3 });
        flushFoliumParamsSave();
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('replaces everything on config import', async () => {
        const { importFoliumParams, snapshotFoliumParams } = await loadStore();
        importFoliumParams({ x: { size: 1 }, junk: 'nope' });
        expect(snapshotFoliumParams()).toEqual({ x: { size: 1 } });
    });
});
