import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modApi.test.ts
// The permission gate is the whole point of the `permissions` manifest field:
// a capability a mod did not declare has to be unreachable, not merely
// undocumented. These cover both directions for every guarded API family, the
// shared data store (queueing, quota), rpc registration, rpc.send's checks
// (Folium 1.7) and the deactivate hook the loader relies on to stop a
// disabled mod. Folium 1.5's `api.storage.paths` is covered here too: gated,
// frozen, and re-created on read.

const require = createRequire(import.meta.url);
const { createModApi, createModDataStore, RPC_SEND_MAX_BYTES } = require('../../../electron/modSystem/modApi.cjs');

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
    dataDir: '/user-data/mods-data/test-mod',
    hostInfo: { folium: { major: 1, minor: 6 }, folia: '0.7.8' },
    getUserFolder: (name: string) => `/home/${name}`,
    emitLog: () => {},
    getPlaybackSnapshot: () => ({ song: null }),
    registerDisposer: () => {},
    registerRpc: () => {},
    sendToClient: () => {},
    requestExport: () => Promise.resolve({ ok: true }),
    ...overrides,
});

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
});

describe('mod api permission gate', () => {
    it('refuses the playback snapshot without playback.read', () => {
        expect(() => createApi([]).runtime.getPlaybackSnapshot()).toThrow('permission-denied:playback.read');
    });

    it('returns the playback snapshot once playback.read is declared', () => {
        expect(createApi(['playback.read']).runtime.getPlaybackSnapshot()).toEqual({ song: null });
    });

    it('rejects every storage operation without storage', async () => {
        const api = createApi([]);
        await expect(api.storage.get('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.set('k', 1)).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.has('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.delete('k')).rejects.toThrow('permission-denied:filesystem.data');
        await expect(api.storage.keys()).rejects.toThrow('permission-denied:filesystem.data');
    });

    it('round-trips storage once storage is declared', async () => {
        const api = createApi(['filesystem.data']);
        await api.storage.set('answer', 42);
        expect(await api.storage.get('answer')).toBe(42);
        expect(await api.storage.has('answer')).toBe(true);
        expect(await api.storage.keys()).toEqual(['answer']);
        await api.storage.delete('answer');
        expect(await api.storage.has('answer')).toBe(false);
    });

    it('rejects a video export without render.export, and hands one over once it is declared', async () => {
        const requestExport = vi.fn(() => Promise.resolve({ ok: true }));
        await expect(createApi([], { requestExport }).render.exportVideo({})).rejects.toThrow('permission-denied:render.export');
        expect(requestExport).not.toHaveBeenCalled();
        await expect(createApi(['render.export'], { requestExport }).render.exportVideo({ fps: 30 })).resolves.toEqual({ ok: true });
        expect(requestExport).toHaveBeenCalledWith({ fps: 30 });
    });

    it('never lets a mod widen its own permissions through the frozen manifest', async () => {
        const api = createApi([]);
        try {
            api.manifest.permissions.push('filesystem.data');
        } catch {
            // Frozen in strict mode; either way the gate below must still hold.
        }
        await expect(api.storage.get('k')).rejects.toThrow('permission-denied:filesystem.data');
    });
});

describe('mod api file paths (api.storage.paths)', () => {
    const createPathsApi = (permissions: string[]) => {
        const userData = tempDir();
        const filesDir = path.join(userData, 'mods-data', 'test-mod', 'files');
        const cacheDir = path.join(userData, 'mods-cache', 'test-mod');
        return { api: createApi(permissions, { filesDir, cacheDir }), filesDir, cacheDir };
    };

    it('is always there for feature detection, and frozen', () => {
        const { api } = createPathsApi([]);
        expect('paths' in api.storage).toBe(true);
        expect(Object.isFrozen(api.storage.paths)).toBe(true);
    });

    it('throws permission-denied synchronously on read without storage, creating nothing', () => {
        const { api, filesDir, cacheDir } = createPathsApi([]);
        expect(() => api.storage.paths.data).toThrow('permission-denied:filesystem.data');
        expect(() => api.storage.paths.cache).toThrow('permission-denied:filesystem.data');
        expect(fs.existsSync(filesDir)).toBe(false);
        expect(fs.existsSync(cacheDir)).toBe(false);
    });

    it('returns the absolute directories and creates them on read', () => {
        const { api, filesDir, cacheDir } = createPathsApi(['filesystem.data']);
        expect(api.storage.paths.data).toBe(filesDir);
        expect(api.storage.paths.cache).toBe(cacheDir);
        expect(path.isAbsolute(api.storage.paths.data)).toBe(true);
        expect(fs.statSync(filesDir).isDirectory()).toBe(true);
        expect(fs.statSync(cacheDir).isDirectory()).toBe(true);
    });

    it('re-creates a directory removed since the last read (the user emptied the cache)', () => {
        const { api, cacheDir } = createPathsApi(['filesystem.data']);
        fs.writeFileSync(path.join(api.storage.paths.cache, 'thumb.png'), 'x');
        fs.rmSync(cacheDir, { recursive: true, force: true });
        expect(fs.existsSync(cacheDir)).toBe(false);
        expect(api.storage.paths.cache).toBe(cacheDir);
        expect(fs.statSync(cacheDir).isDirectory()).toBe(true);
    });

    it('cannot be pointed elsewhere by the mod', () => {
        const { api, filesDir } = createPathsApi(['filesystem.data']);
        expect(() => { (api.storage.paths as { data: string }).data = '/elsewhere'; }).toThrow(TypeError);
        expect(api.storage.paths.data).toBe(filesDir);
    });

    // The api serializes cleanly, so walking it must not read the gated, directory-creating getters.
    it('is skipped when the api is serialized or spread, without the permission', () => {
        const { api, filesDir, cacheDir } = createPathsApi([]);
        expect('data' in api.storage.paths && 'cache' in api.storage.paths).toBe(true);
        expect(Object.keys(api.storage.paths)).toEqual([]);
        expect(JSON.parse(JSON.stringify(api.storage))).toEqual({ paths: {} });
        expect(() => JSON.stringify(api)).not.toThrow();
        expect({ ...api.storage.paths }).toEqual({});
        expect(Object.assign({}, api.storage.paths)).toEqual({});
        expect(structuredClone(api.storage.paths)).toEqual({});
        expect(fs.existsSync(filesDir)).toBe(false);
        expect(fs.existsSync(cacheDir)).toBe(false);
    });

    it('creates no directory when the api is serialized, with the permission', () => {
        const { api, filesDir, cacheDir } = createPathsApi(['filesystem.data']);
        expect(JSON.stringify(api.storage.paths)).toBe('{}');
        expect(() => JSON.stringify(api)).not.toThrow();
        expect(fs.existsSync(filesDir)).toBe(false);
        expect(fs.existsSync(cacheDir)).toBe(false);
    });

    /*
     * A stray file where the cache directory should be (or a link whose target is gone): the read
     * fails with the file system's error until the entry goes, which the mods panel's "clear cache"
     * does (clearDirectoryContents removes a root that is not a directory as one entry).
     */
    it('throws while a file stands where the directory should be, and recovers once it is removed', () => {
        const { api, cacheDir } = createPathsApi(['filesystem.data']);
        fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
        fs.writeFileSync(cacheDir, 'stray');
        expect(() => api.storage.paths.cache).toThrow();
        fs.rmSync(cacheDir);
        expect(api.storage.paths.cache).toBe(cacheDir);
        expect(fs.statSync(cacheDir).isDirectory()).toBe(true);
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

    it('sends checked JSON text to the client, and throws at the call for a bad name or payload', () => {
        const sendToClient = vi.fn();
        const api = createApi([], { sendToClient });
        api.rpc.send('status.changed', { playing: true, title: '歌' });
        api.rpc.send('ping');
        api.rpc.send('zero', 0);
        expect(sendToClient.mock.calls).toEqual([
            ['status.changed', '{"playing":true,"title":"歌"}'],
            // Left out, the payload arrives as null, as an rpc.call answer of undefined does.
            ['ping', 'null'],
            ['zero', '0'],
        ]);

        sendToClient.mockClear();
        expect(() => api.rpc.send('bad name', 1)).toThrow('rpc.send requires a name');
        expect(() => api.rpc.send('', 1)).toThrow('rpc.send requires a name');
        expect(() => api.rpc.send(42 as unknown as string, 1)).toThrow('rpc.send requires a name');
        expect(() => api.rpc.send('big', 10n)).toThrow('JSON-serializable');
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => api.rpc.send('loop', circular)).toThrow('JSON-serializable');
        expect(() => api.rpc.send('fn', () => {})).toThrow('JSON-serializable');
        expect(() => api.rpc.send('sym', Symbol('x'))).toThrow('JSON-serializable');
        expect(sendToClient).not.toHaveBeenCalled();
    });

    it('caps a payload at 64 KB of JSON text, counted in UTF-8 bytes', () => {
        const sendToClient = vi.fn();
        const api = createApi([], { sendToClient });
        // A JSON string is its characters plus two quotes.
        api.rpc.send('fits', 'a'.repeat(RPC_SEND_MAX_BYTES - 2));
        expect(sendToClient).toHaveBeenCalledTimes(1);
        expect(() => api.rpc.send('over', 'a'.repeat(RPC_SEND_MAX_BYTES - 1))).toThrow(`rpc-payload-too-large:${RPC_SEND_MAX_BYTES}`);
        // Three bytes each in UTF-8: fewer characters than the cap, more bytes.
        expect(() => api.rpc.send('wide', '歌'.repeat(RPC_SEND_MAX_BYTES / 3))).toThrow('rpc-payload-too-large');
        expect(sendToClient).toHaveBeenCalledTimes(1);
        expect(RPC_SEND_MAX_BYTES).toBe(64 * 1024);
    });

    it('exposes the frozen host version info', () => {
        const api = createApi([]);
        expect(api.host).toEqual({ folium: { major: 1, minor: 6 }, folia: '0.7.8' });
        expect(Object.isFrozen(api.host)).toBe(true);
    });

    it('gives the mod its data folder, and asks for a user folder only when it is read', () => {
        const getUserFolder = vi.fn((name: string) => {
            if (name === 'music') throw new Error('Failed to get \'music\' path');
            return `/home/${name}`;
        });
        const api = createApi([], { getUserFolder });
        expect(getUserFolder).not.toHaveBeenCalled();
        expect('data' in api.paths).toBe(false);
        expect([api.paths.documents, api.paths.downloads, api.paths.videos]).toEqual(['/home/documents', '/home/downloads', '/home/videos']);
        // A folder the system does not have fails the read, not the mod's start.
        expect(() => api.paths.music).toThrow('music');
        expect(Object.isFrozen(api.paths)).toBe(true);
    });

    it('no longer offers command registration on the Node side', () => {
        expect((createApi([]) as Record<string, unknown>).commands).toBeUndefined();
    });
});

describe('mod api lifecycle', () => {
    it('forwards onDispose handlers to the loader', () => {
        const registerDisposer = vi.fn();
        const api = createApi([], { registerDisposer });
        const handler = () => {};
        api.onDispose(handler);
        expect(registerDisposer).toHaveBeenCalledWith(handler);
    });
});

describe('mod api secrets (Folium 1.7)', () => {
    it('hands api.secrets to the store bound to this mod, without asking for a permission', async () => {
        const off = vi.fn();
        const secrets = {
            get: vi.fn(async () => 'value'),
            has: vi.fn(async () => true),
            set: vi.fn(async () => undefined),
            subscribe: vi.fn(() => off),
        };
        const api = createApi([], { secrets });
        expect(Object.isFrozen(api.secrets)).toBe(true);
        await expect(api.secrets.get('apiKey')).resolves.toBe('value');
        await expect(api.secrets.has('apiKey')).resolves.toBe(true);
        await api.secrets.set('apiKey', null);
        const listener = () => {};
        expect(api.secrets.subscribe(listener)).toBe(off);
        expect(secrets.get).toHaveBeenCalledWith('apiKey');
        expect(secrets.set).toHaveBeenCalledWith('apiKey', null);
        expect(secrets.subscribe).toHaveBeenCalledWith(listener);
    });
});
