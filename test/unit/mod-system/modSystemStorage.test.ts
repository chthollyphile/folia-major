import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FROM_MAIN_WINDOW, MAIN_WINDOW } from './mainWindowFake';

// test/unit/mod-system/modSystemStorage.test.ts
// Folium 1.5 mod files through the loader, with Electron replaced by fakes: a main entry gets
// `api.storage.paths` under userData named by its manifest id, and the mods panel's
// `storage-usage` / `clear-cache` IPC work for disabled mods but never for an id the loader did
// not validate (a broken entry's key is a directory name), and never follow a link.

const require = createRequire(import.meta.url);

type Response = { ok: boolean; data?: number; cache?: number; cacheBroken?: boolean; cleared?: number; error?: string };
type Handler = (event: unknown, ...args: unknown[]) => Promise<Response>;

const handlers = new Map<string, Handler>();
const persisted = new Map<string, unknown>();

class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}

const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', {
    dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: {
        handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
        removeHandler: (channel: string) => { handlers.delete(channel); },
    },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { createModSystem, IPC } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');

// What the test mod's main entry saw; set from inside the loader's require of main.cjs.
type SeenPaths = { data: string; cache: string } | { error: string };
const seenKey = '__foliaModFilesTestPaths';
const seenPaths = () => (globalThis as Record<string, unknown>)[seenKey] as SeenPaths | undefined;

let root = '';
const userData = () => path.join(root, 'userData');

/* A mod under app/mods (the dev source tree), optionally enabled and with a main entry. */
const writeMod = (directoryName: string, manifest: Record<string, unknown>, { enabled = false, main = false } = {}) => {
    const directory = path.join(root, 'app', 'mods', directoryName);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, name: manifest.id, version: '1.0.0', ...(main ? { main: 'main.cjs' } : { client: 'client.mjs' }), ...manifest,
    }));
    if (main) {
        fs.writeFileSync(path.join(directory, 'main.cjs'), [
            "'use strict';",
            'module.exports = function activate(api) {',
            '    try {',
            `        globalThis.${seenKey} = { data: api.storage.paths.data, cache: api.storage.paths.cache };`,
            '    } catch (error) {',
            `        globalThis.${seenKey} = { error: error.message };`,
            '    }',
            '};',
            '',
        ].join('\n'));
    } else {
        fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    }
    if (enabled) {
        persisted.set(`mods.enabled.${manifest.id}`, { enabled: true, digest: computeModDigest(directory) });
    }
    return directory;
};

const writeFile = (filePath: string, bytes: number) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(bytes));
};

const launch = () => {
    handlers.clear();
    const system = createModSystem({
        app: {
            getPath: () => userData(),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged: false,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => MAIN_WINDOW,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.registerIpc();
    system.loadAll();
    return system;
};

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(FROM_MAIN_WINDOW, ...args);

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-storage-'));
    persisted.clear();
    delete (globalThis as Record<string, unknown>)[seenKey];
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)[seenKey];
    fs.rmSync(root, { recursive: true, force: true });
});

describe('api.storage.paths from the loader', () => {
    it('hands a main entry its own directories under userData', () => {
        writeMod('mod-a', { id: 'mod-a', permissions: ['filesystem.data'] }, { enabled: true, main: true });
        const system = launch();
        expect(system.listMods().find((mod: { id: string }) => mod.id === 'mod-a')).toMatchObject({ status: 'loaded' });
        expect(seenPaths()).toEqual({
            data: path.join(userData(), 'mods-data', 'mod-a', 'files'),
            cache: path.join(userData(), 'mods-cache', 'mod-a'),
        });
        expect(fs.statSync(path.join(userData(), 'mods-data', 'mod-a', 'files')).isDirectory()).toBe(true);
        expect(fs.statSync(path.join(userData(), 'mods-cache', 'mod-a')).isDirectory()).toBe(true);
    });

    it('refuses them to a main entry without filesystem.data', () => {
        writeMod('mod-a', { id: 'mod-a', permissions: [] }, { enabled: true, main: true });
        launch();
        expect(seenPaths()).toEqual({ error: 'permission-denied:filesystem.data' });
        expect(fs.existsSync(path.join(userData(), 'mods-cache', 'mod-a'))).toBe(false);
    });
});

describe('storage usage for the mods panel', () => {
    it('counts all of mods-data/<id> and mods-cache/<id>, for a disabled mod too', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        writeFile(path.join(userData(), 'mods-data', 'mod-b', 'mod-data.json'), 10);
        writeFile(path.join(userData(), 'mods-data', 'mod-b', 'files', 'notes', 'log.txt'), 100);
        writeFile(path.join(userData(), 'mods-cache', 'mod-b', 'thumbs', 'a.png'), 50);
        writeFile(path.join(userData(), 'mods-cache', 'mod-b', 'index.json'), 7);
        const system = launch();
        expect(system.listMods().find((mod: { id: string }) => mod.id === 'mod-b')).toMatchObject({ status: 'disabled' });
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 110, cache: 57 });
    });

    it('counts 0 for directories that were never created', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        launch();
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 0, cache: 0 });
        expect(fs.existsSync(path.join(userData(), 'mods-cache', 'mod-b'))).toBe(false);
    });

    it('does not count what a link in the cache points to', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        const outside = path.join(root, 'elsewhere');
        writeFile(path.join(outside, 'big.bin'), 5000);
        writeFile(path.join(userData(), 'mods-cache', 'mod-b', 'own.bin'), 3);
        fs.symlinkSync(outside, path.join(userData(), 'mods-cache', 'mod-b', 'linked'), 'junction');
        launch();
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 0, cache: 3 });
    });
});

describe('clearing a mod cache from the mods panel', () => {
    it('empties mods-cache/<id>, keeps the directory and leaves the data alone', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        writeFile(path.join(userData(), 'mods-data', 'mod-b', 'files', 'keep.txt'), 20);
        writeFile(path.join(userData(), 'mods-cache', 'mod-b', 'thumbs', 'a.png'), 50);
        writeFile(path.join(userData(), 'mods-cache', 'mod-b', 'index.json'), 7);
        launch();
        expect(await invoke(IPC.clearCache, 'mod-b')).toEqual({ ok: true, cleared: 2 });
        expect(fs.readdirSync(path.join(userData(), 'mods-cache', 'mod-b'))).toEqual([]);
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 20, cache: 0 });
    });

    it('removes a link in the cache without touching its target', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        const outside = path.join(root, 'elsewhere');
        writeFile(path.join(outside, 'precious.txt'), 9);
        fs.mkdirSync(path.join(userData(), 'mods-cache', 'mod-b'), { recursive: true });
        fs.symlinkSync(outside, path.join(userData(), 'mods-cache', 'mod-b', 'linked'), 'junction');
        launch();
        expect(await invoke(IPC.clearCache, 'mod-b')).toEqual({ ok: true, cleared: 1 });
        expect(fs.readFileSync(path.join(outside, 'precious.txt')).length).toBe(9);
    });

    /*
     * A dead link (say, a junction to a drive that was unplugged) or a stray file where the cache
     * should be: paths.cache throws on every read and the cache counts 0, so the usage flags it and
     * the clear removes the entry, after which the mod's next read gets a real directory again.
     */
    it.each(['dead link', 'stray file'])('recovers a cache root that is a %s', async (kind) => {
        writeMod('mod-a', { id: 'mod-a', permissions: ['filesystem.data'] }, { enabled: true, main: true });
        const cacheDir = path.join(userData(), 'mods-cache', 'mod-a');
        if (kind === 'dead link') {
            const gone = path.join(root, 'unplugged');
            fs.mkdirSync(gone);
            fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
            fs.symlinkSync(gone, cacheDir, 'junction');
            fs.rmSync(gone, { recursive: true });
        } else {
            writeFile(cacheDir, 4);
        }
        const system = launch();
        expect(seenPaths()).toHaveProperty('error');
        expect(seenPaths()).not.toEqual({ error: 'permission-denied:filesystem.data' });
        expect(await invoke(IPC.storageUsage, 'mod-a')).toEqual({ ok: true, data: 0, cache: 0, cacheBroken: true });

        expect(await invoke(IPC.clearCache, 'mod-a')).toEqual({ ok: true, cleared: 1 });
        expect(await invoke(IPC.storageUsage, 'mod-a')).toEqual({ ok: true, data: 0, cache: 0 });
        system.loadAll();
        expect(seenPaths()).toEqual({ data: path.join(userData(), 'mods-data', 'mod-a', 'files'), cache: cacheDir });
        expect(fs.lstatSync(cacheDir).isDirectory()).toBe(true);
    });

    it('does not flag a cache root that links to a live directory, which the mod can use', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        const elsewhere = path.join(root, 'elsewhere');
        writeFile(path.join(elsewhere, 'big.bin'), 5000);
        fs.mkdirSync(path.join(userData(), 'mods-cache'), { recursive: true });
        fs.symlinkSync(elsewhere, path.join(userData(), 'mods-cache', 'mod-b'), 'junction');
        launch();
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 0, cache: 0 });
    });

    it('has nothing to clear when the cache was never created', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        launch();
        expect(await invoke(IPC.clearCache, 'mod-b')).toEqual({ ok: true, cleared: 0 });
    });
});

describe('ids the mods panel may act on', () => {
    it('refuses an unknown id and anything shaped like a path', async () => {
        writeMod('mod-b', { id: 'mod-b', permissions: ['filesystem.data'] });
        writeFile(path.join(userData(), 'mods-cache', 'keep.txt'), 1);
        launch();
        for (const modId of ['nope', '../mod-b', '..', '', 42, null]) {
            expect(await invoke(IPC.storageUsage, modId)).toEqual({ ok: false, error: 'mod-not-found' });
            expect(await invoke(IPC.clearCache, modId)).toEqual({ ok: false, error: 'mod-not-found' });
        }
        expect(fs.existsSync(path.join(userData(), 'mods-cache', 'keep.txt'))).toBe(true);
    });

    it('refuses a broken entry even when its directory name looks like an id', async () => {
        const directory = path.join(root, 'app', 'mods', 'broken-mod');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'mod.json'), '{ not json');
        writeFile(path.join(userData(), 'mods-cache', 'broken-mod', 'keep.bin'), 4);
        const system = launch();
        expect(system.listMods().find((mod: { id: string }) => mod.id === 'broken-mod')).toMatchObject({ status: 'error' });
        expect(await invoke(IPC.storageUsage, 'broken-mod')).toEqual({ ok: false, error: 'mod-not-found' });
        expect(await invoke(IPC.clearCache, 'broken-mod')).toEqual({ ok: false, error: 'mod-not-found' });
        expect(fs.existsSync(path.join(userData(), 'mods-cache', 'broken-mod', 'keep.bin'))).toBe(true);
    });

    it('refuses the key of a duplicate id', async () => {
        writeMod('first', { id: 'mod-b', permissions: ['filesystem.data'] });
        writeMod('second', { id: 'mod-b', permissions: ['filesystem.data'] });
        const system = launch();
        const duplicate = system.listMods().find((mod: { id: string }) => mod.id.includes('-duplicate-'));
        expect(duplicate).toBeDefined();
        expect(await invoke(IPC.storageUsage, duplicate.id)).toEqual({ ok: false, error: 'mod-not-found' });
        expect(await invoke(IPC.clearCache, duplicate.id)).toEqual({ ok: false, error: 'mod-not-found' });
        expect(fs.existsSync(path.join(userData(), 'mods-data', duplicate.id))).toBe(false);
        // The copy that owns the id is still served.
        expect(await invoke(IPC.storageUsage, 'mod-b')).toEqual({ ok: true, data: 0, cache: 0 });
    });
});
