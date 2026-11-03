import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkFoliumMod } from '../../../dev/folium/check.mjs';

// test/unit/mod-system/foliumDeprecatedMain.test.ts
// Folium 1.6 only (electron/modSystem/deprecated.cjs): mod.json and the main entry as Folium 1.5 mods
// write them still work. An old permission id means its new one, a field mod.json does not have warns
// instead of refusing the mod, and each old member of the main api works and warns once per mod. A mod
// that uses no old name gets no warning. Step 2 deletes this file.

const require = createRequire(import.meta.url);

const persisted = new Map<string, unknown>();
class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}
const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', {
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => { ipcHandlers.set(channel, handler); },
        removeHandler: (channel: string) => { ipcHandlers.delete(channel); },
    },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const { createModApi, createModDataStore } = require('../../../electron/modSystem/modApi.cjs');
const { oldNameWarnings, readOldActivation } = require('../../../electron/modSystem/deprecated.cjs');
const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');

const FIXTURES = path.resolve(__dirname, '../../fixtures/folium-1.5-mods');

const baseManifest = { folium: 1, id: 'old-mod', name: 'Old mod', version: '1.0.0', main: 'index.cjs' };

/* A validated manifest, with the warnings the layer kept for it. */
const validate = (raw: Record<string, unknown>) => {
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    return { manifest: result.value, warnings: oldNameWarnings(result.value) as string[] };
};

describe('mod.json as Folium 1.5 mods write it', () => {
    it.each([
        ['runtime.playback', 'playback.read'],
        ['ui.stage', 'stageLayers'],
    ])('reads the old permission id %s as %s, with a warning', (old, now) => {
        const { manifest, warnings } = validate({ ...baseManifest, permissions: [old, 'net.fetch'] });
        expect(manifest.permissions).toEqual([now, 'net.fetch']);
        expect(warnings).toEqual([`mod.json permission "${old}": removed in Folium 2, use "${now}"`]);
    });

    it('drops an old permission id whose new id is listed too, with its warning', () => {
        const { manifest, warnings } = validate({ ...baseManifest, permissions: ['runtime.playback', 'playback.read'] });
        expect(manifest.permissions).toEqual(['playback.read']);
        expect(warnings).toEqual(['mod.json permission "runtime.playback": removed in Folium 2, use "playback.read"']);
    });

    it('accepts a field mod.json does not have, with a warning that names it', () => {
        const { manifest, warnings } = validate({ ...baseManifest, homepage: 'https://example.com', premissions: [] });
        expect(manifest).not.toHaveProperty('homepage');
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/^unknown field "homepage" in mod\.json \(it can have: folium, id, name, .*\); Folium 2 refuses it$/);
        expect(warnings[1]).toContain('unknown field "premissions"');
    });

    it('says nothing about a mod.json with only today\'s names', () => {
        expect(validate({ ...baseManifest, permissions: ['filesystem.data', 'playback.read', 'stageLayers'] }).warnings).toEqual([]);
    });

    it('still refuses what Folium 1.5 refused', () => {
        expect(validateManifest({ ...baseManifest, permissions: ['everything'] }).ok).toBe(false);
        expect(validateManifest({ ...baseManifest, folium: 2 }).ok).toBe(false);
    });
});

describe('the main api as Folium 1.5 mods use it', () => {
    const temporary: string[] = [];
    afterEach(() => {
        while (temporary.length > 0) fs.rmSync(temporary.pop()!, { recursive: true, force: true });
    });

    const createApi = (permissions: string[], registerDisposer: (fn: () => void) => void = () => {}) => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-old-api-'));
        temporary.push(dataDir);
        const manifest = { id: 'old-mod', permissions };
        const api = createModApi({
            modId: 'old-mod',
            manifest,
            dataStore: createModDataStore(dataDir),
            dataDir,
            hostInfo: { folium: { major: 1, minor: 6 }, folia: '0.7.8' },
            getUserFolder: (name: string) => `/home/${name}`,
            emitLog: () => {},
            getPlaybackSnapshot: () => null,
            registerDisposer,
            registerRpc: () => {},
            requestExport: () => Promise.resolve({ ok: true }),
        });
        return { api, warnings: () => oldNameWarnings(manifest) as string[] };
    };

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps api.storage.data working, behind the same permission, and warns once', async () => {
        const { api, warnings } = createApi(['filesystem.data']);
        await api.storage.data.set('k', 1);
        expect(await api.storage.data.get('k')).toBe(1);
        expect(await api.storage.get('k')).toBe(1);
        expect(warnings()).toEqual(['api.storage.data: removed in Folium 2, use api.storage']);
        await expect(createApi([]).api.storage.data.get('k')).rejects.toThrow('permission-denied:filesystem.data');
    });

    it('keeps api.lifecycle.onDeactivate and api.experimental, each warning once', () => {
        const registerDisposer = vi.fn();
        const { api, warnings } = createApi([], registerDisposer);
        const disposer = () => {};
        api.lifecycle.onDeactivate(disposer);
        api.lifecycle.onDeactivate(disposer);
        expect(registerDisposer).toHaveBeenCalledWith(disposer);
        expect(api.experimental).toEqual({});
        expect(warnings()).toEqual([
            'api.lifecycle.onDeactivate: removed in Folium 2, use api.onDispose',
            'api.experimental: removed in Folium 2, nothing takes its place',
        ]);
    });

    it('says nothing to a mod that uses only today\'s names', async () => {
        const { api, warnings } = createApi(['filesystem.data']);
        await api.storage.set('k', 2);
        api.onDispose(() => {});
        expect(Object.keys(api)).not.toContain('lifecycle');
        expect(warnings()).toEqual([]);
    });

    it('reads a { dispose } object returned from activate as its function, with a warning', () => {
        const manifest = { id: 'old-mod' };
        const dispose = vi.fn();
        const disposer = readOldActivation({ dispose }, manifest);
        disposer();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(oldNameWarnings(manifest)).toEqual([
            'activate returning { dispose }: removed in Folium 2, use a function returned from activate, or api.onDispose',
        ]);
        const plain = () => {};
        expect(readOldActivation(plain, { id: 'new-mod' })).toBe(plain);
        expect(readOldActivation(undefined, { id: 'new-mod' })).toBeUndefined();
    });
});

describe('Folium 1.5 main entries in the loader', () => {
    let root = '';
    let system: { loadAll: () => unknown; listMods: () => Array<Record<string, unknown>>; registerIpc: () => void; dispose: () => void } | null = null;
    const probe = globalThis as { __oldMainNames?: string[] };
    const sent: Array<[string, unknown]> = [];

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-old-main-'));
        persisted.clear();
        ipcHandlers.clear();
        sent.length = 0;
        probe.__oldMainNames = [];
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        system?.dispose();
        system = null;
        fs.rmSync(root, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    /* Copies a fixture mod into userData/mods, enabled as if the user had confirmed it. */
    const install = (name: string) => {
        const directory = path.join(root, 'userData/mods', name);
        fs.cpSync(path.join(FIXTURES, name), directory, { recursive: true });
        const { id } = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        persisted.set(`mods.enabled.${id}`, { enabled: true, digest: computeModDigest(directory) });
        return id as string;
    };

    const launch = () => {
        const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push([channel, payload]) } };
        system = createModSystem({
            app: {
                getPath: () => path.join(root, 'userData'),
                getAppPath: () => path.join(root, 'app'),
                getVersion: () => '0.7.20',
                isPackaged: true,
            },
            BrowserWindow: { getAllWindows: () => [] },
            getMainWindow: () => window,
            getLocaleKey: () => 'en',
            isFeatureEnabled: () => true,
        });
        system!.registerIpc();
        system!.loadAll();
    };
    const stateOf = (id: string) => system!.listMods().find((mod) => mod.id === id)!;
    const rpc = (id: string, name: string, args: unknown[]) => ipcHandlers.get('folia-mods:rpc')!({}, id, name, args);

    it('loads and runs a main entry that uses every old main name, and lists each one in the mod\'s row', async () => {
        const id = install('old-main-names');
        launch();
        expect(stateOf(id)).toMatchObject({ status: 'loaded', error: null, permissions: ['filesystem.data', 'playback.read'] });
        expect(probe.__oldMainNames).toEqual(['experimental:0']);
        expect(stateOf(id).warnings).toEqual([
            'mod.json permission "runtime.playback": removed in Folium 2, use "playback.read"',
            expect.stringMatching(/^unknown field "homepage" in mod\.json/),
            'api.lifecycle.onDeactivate: removed in Folium 2, use api.onDispose',
            'api.experimental: removed in Folium 2, nothing takes its place',
            'activate returning { dispose }: removed in Folium 2, use a function returned from activate, or api.onDispose',
        ]);

        // A name first used while the mod runs joins its row, and the list is sent again.
        await Promise.resolve();
        sent.length = 0;
        expect(await rpc(id, 'roundTrip', [{ a: 1 }])).toEqual({ ok: true, result: { a: 1 } });
        expect(await rpc(id, 'snapshot', [])).toMatchObject({ ok: true });
        await Promise.resolve();
        expect(stateOf(id).warnings).toContain('api.storage.data: removed in Folium 2, use api.storage');
        expect(sent.filter(([channel]) => channel === 'folia-mods:state-changed')).toHaveLength(1);
        // Used again: no second line.
        await rpc(id, 'roundTrip', [2]);
        expect((stateOf(id).warnings as string[]).filter((line) => line.startsWith('api.storage.data'))).toHaveLength(1);

        system!.dispose();
        system = null;
        expect(probe.__oldMainNames).toEqual(['experimental:0', 'dispose', 'onDeactivate']);
    });

    it('stops sending the list for old names once the loader is disposed', async () => {
        launch();
        system!.dispose();
        system = null;
        await Promise.resolve();
        sent.length = 0;
        readOldActivation({ dispose: () => {} }, { id: 'late-mod' });
        await Promise.resolve();
        expect(sent).toEqual([]);
    });

    it('loads the Folium 1.5 sample with a main entry without a warning', () => {
        const id = install('sample-transparent-mov-export');
        launch();
        expect(stateOf(id)).toMatchObject({ status: 'loaded', error: null, warnings: [] });
    });
});

describe('folium:check on Folium 1.5 names', () => {
    let root = '';
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-old-check-'));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('lists the old names of mod.json and the main entry as warnings, not problems', () => {
        const { ok, problems, warnings } = checkFoliumMod(path.join(FIXTURES, 'old-main-names'));
        expect(problems).toEqual([]);
        expect(ok).toBe(true);
        expect(warnings).toEqual([
            'mod.json permission "runtime.playback": removed in Folium 2, use "playback.read"',
            expect.stringMatching(/^unknown field "homepage" in mod\.json/),
            'api.storage.data: removed in Folium 2, use api.storage',
            'api.lifecycle.onDeactivate: removed in Folium 2, use api.onDispose',
            'activate returning { dispose }: removed in Folium 2, use a function returned from activate, or api.onDispose',
        ]);
    });

    it('lists the old names of a client entry as warnings, and an old registry name as the registry it is now', () => {
        const directory = path.join(root, 'old-client');
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({ folium: 1, id: 'old-client', name: 'Old client', version: '1.0.0', client: 'client.mjs' }));
        fs.writeFileSync(path.join(directory, 'client.mjs'), [
            'export default function activate(folium) {',
            '  folium.registries.controlButtons.register({ id: "b", slot: "progress.trailing", mount(container, ctx) { ctx.subscribe(() => {}); } });',
            '  folium.registries.styles.register({ id: "s", css: \'[data-folium-kind="control-button"] { color: red; }\' });',
            '}',
            '',
        ].join('\n'));
        const { ok, problems, warnings } = checkFoliumMod(directory);
        expect(problems).toEqual([]);
        expect(ok).toBe(true);
        expect(warnings).toEqual([
            'ctx.subscribe: removed in Folium 2, use ctx.onChange',
            'folium.registries.controlButtons: removed in Folium 2, use folium.registries.progressButtons',
            'data-folium-kind="control-button": removed in Folium 2, use data-folium-kind="progress-button"',
        ]);
    });

    it('says nothing about a mod with only today\'s names', () => {
        const directory = path.join(root, 'new-client');
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({ folium: 1, id: 'new-client', name: 'New client', version: '1.0.0', client: 'client.mjs' }));
        fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {\n  folium.registries.progressButtons.register({ id: "b", slot: "progress.trailing", mount(container, ctx) { ctx.onChange(() => {}); } });\n}\n');
        expect(checkFoliumMod(directory).warnings).toEqual([]);
    });
});
