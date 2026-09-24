import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modApi.test.ts
// The permission gate is the whole point of the `permissions` manifest field:
// a capability a mod did not declare has to be unreachable, not merely
// undocumented. These cover both directions for every guarded API family, the
// shared data store (queueing, quota), rpc registration and the deactivate
// hook the loader relies on to stop a disabled mod.

const require = createRequire(import.meta.url);
const { createModApi, createModDataStore } = require('../../../electron/modSystem/modApi.cjs');

const temporaryDirectories: string[] = [];

const tempDir = () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-api-'));
    temporaryDirectories.push(dataDir);
    return dataDir;
};

const createApi = (permissions: string[], overrides: Record<string, unknown> = {}) => createModApi({
    modId: 'test-mod',
    manifest: { id: 'test-mod', permissions },
    dataStore: createModDataStore(tempDir()),
    hostInfo: { folium: { major: 1, minor: 0 }, folia: '0.7.8' },
    emitLog: () => {},
    getPlaybackSnapshot: () => ({ song: null }),
    registerDisposer: () => {},
    registerRpc: () => {},
    requestExport: () => Promise.resolve({ ok: true }),
    ...overrides,
});

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('mod api permission gate', () => {
    it('refuses the playback snapshot without runtime.playback', () => {
        expect(() => createApi([]).runtime.getPlaybackSnapshot()).toThrow('permission-denied:runtime.playback');
    });

    it('returns the playback snapshot once runtime.playback is declared', () => {
        expect(createApi(['runtime.playback']).runtime.getPlaybackSnapshot()).toEqual({ song: null });
    });

    it('rejects every storage operation without filesystem.data', async () => {
        const api = createApi([]);
        await expect(api.storage.data.get('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.data.set('k', 1)).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.data.has('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.data.delete('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.data.keys()).rejects.toThrow('permission-denied:filesystem.data');
    });

    it('round-trips storage once filesystem.data is declared', async () => {
        const api = createApi(['filesystem.data']);
        await api.storage.data.set('answer', 42);
        expect(await api.storage.data.get('answer')).toBe(42);
        expect(await api.storage.data.has('answer')).toBe(true);
        expect(await api.storage.data.keys()).toEqual(['answer']);
        await api.storage.data.delete('answer');
        expect(await api.storage.data.has('answer')).toBe(false);
    });

    it('never lets a mod widen its own permissions through the frozen manifest', async () => {
        const api = createApi([]);
        try {
            api.manifest.permissions.push('filesystem.data');
        } catch {
            // Frozen in strict mode; either way the gate below must still hold.
        }
        await expect(api.storage.data.get('k')).rejects.toThrow('permission-denied:filesystem.data');
    });
});

describe('mod data store', () => {
    it('serializes overlapping writes so none is lost', async () => {
        const store = createModDataStore(tempDir());
        await Promise.all(Array.from({ length: 20 }, (_, index) => store.set(`k${index}`, index)));
        expect((await store.keys()).length).toBe(20);
    });

    it('refuses a write past the quota and keeps the previous data', async () => {
        const store = createModDataStore(tempDir(), { maxBytes: 64 });
        await store.set('small', 1);
        await expect(store.set('big', 'x'.repeat(200))).rejects.toThrow('storage-quota-exceeded');
        expect(await store.get('small')).toBe(1);
        expect(await store.has('big')).toBe(false);
    });

    it('rejects undefined values and empty keys', async () => {
        const store = createModDataStore(tempDir());
        await expect(store.set('k', undefined)).rejects.toThrow('JSON-serializable');
        await expect(store.get('')).rejects.toThrow('non-empty');
    });

    it('treats prototype names as ordinary keys', async () => {
        const store = createModDataStore(tempDir());
        expect(await store.has('constructor')).toBe(false);
        expect(await store.get('toString')).toBeUndefined();
        await store.set('__proto__', { a: 1 });
        expect(await store.has('__proto__')).toBe(true);
        expect(await store.get('__proto__')).toEqual({ a: 1 });
        expect(await store.keys()).toEqual(['__proto__']);
    });

    it('serializes writes across store instances for the same directory', async () => {
        const dataDir = tempDir();
        const first = createModDataStore(dataDir);
        const second = createModDataStore(dataDir);
        await Promise.all(Array.from({ length: 20 }, (_, index) => (
            (index % 2 ? first : second).set(`k${index}`, index)
        )));
        expect((await first.keys()).length).toBe(20);
    });
});

describe('mod api rpc and host info', () => {
    it('forwards rpc handlers to the loader and validates names', () => {
        const registerRpc = vi.fn();
        const api = createApi([], { registerRpc });
        const handler = async () => 'pong';
        api.rpc.handle('ping', handler);
        expect(registerRpc).toHaveBeenCalledWith('ping', handler);
        expect(() => api.rpc.handle('bad name', handler)).toThrow('rpc.handle');
        expect(() => api.rpc.handle('ok', 'nope')).toThrow('handler function');
    });

    it('exposes the frozen host version info', () => {
        const api = createApi([]);
        expect(api.host).toEqual({ folium: { major: 1, minor: 0 }, folia: '0.7.8' });
        expect(Object.isFrozen(api.host)).toBe(true);
    });

    it('no longer offers command registration on the Node side', () => {
        expect((createApi([]) as Record<string, unknown>).commands).toBeUndefined();
    });
});

describe('mod api lifecycle', () => {
    it('forwards deactivate handlers to the loader', () => {
        const registerDisposer = vi.fn();
        const api = createApi([], { registerDisposer });
        const handler = () => {};
        api.lifecycle.onDeactivate(handler);
        expect(registerDisposer).toHaveBeenCalledWith(handler);
    });
});
