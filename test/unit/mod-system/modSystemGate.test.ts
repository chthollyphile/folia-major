import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemGate.test.ts
// A main (Node) entry's promises. The load loop is synchronous, so a promise
// returned by activate() is followed rather than awaited: a rejection lands on
// the mod's status like a throw does, a disposer it resolves to is kept and
// run, and a disposer whose own promise rejects is caught. None of them may
// surface as an unhandled rejection in the main process.

const require = createRequire(import.meta.url);

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
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    ipcMain: { handle: () => {}, removeHandler: () => {} },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');

interface ListedMod { id: string; status: string; error: string | null; clientUrl: string | null }
interface ModSystem {
    loadAll: () => ListedMod[];
    listMods: () => ListedMod[];
    dispose: () => void;
    getModCallStats: (modId: string) => { calls: number; failures: number } | null;
}

let root = '';
let system: ModSystem | null = null;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
const probe = globalThis as { __foliumGateMain?: string[] };

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-gate-'));
    persisted.clear();
    unhandled.length = 0;
    probe.__foliumGateMain = [];
    process.on('unhandledRejection', onUnhandled);
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    system?.dispose();
    system = null;
    process.off('unhandledRejection', onUnhandled);
    vi.restoreAllMocks();
});

/* An enabled (confirmed) mod under userData/mods whose main entry is `source`. */
const writeMainMod = (modId: string, source: string) => {
    const directory = path.join(root, 'userData/mods', modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id: modId, name: modId, version: '1.0.0', main: 'index.cjs', client: 'client.mjs',
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    fs.writeFileSync(path.join(directory, 'index.cjs'), source);
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
};

const launch = (): ModSystem => {
    system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged: true,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => null,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    }) as ModSystem;
    system.loadAll();
    return system;
};

// Unhandled rejections are announced after the microtask queue drains, so one macrotask is enough.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const stateOf = (modId: string) => system!.listMods().find((entry) => entry.id === modId);

describe('promises of a main entry', () => {
    it('records a rejected activate() on the mod and runs what it registered before failing', async () => {
        writeMainMod('async-fails', `
            module.exports = async function activate(api) {
                api.onDispose(() => { globalThis.__foliumGateMain.push('released'); });
                await null;
                throw new Error('activate boom');
            };
        `);
        launch();
        // Until the promise settles the entry counts as loaded, as before.
        expect(stateOf('async-fails')).toMatchObject({ status: 'loaded', error: null });

        await settle();
        expect(unhandled).toEqual([]);
        expect(stateOf('async-fails')).toMatchObject({ status: 'error', error: 'activate boom', clientUrl: null });
        expect(probe.__foliumGateMain).toEqual(['released']);
        // require, activate and the one disposer went through the gate; the rejection is the failure.
        expect(system!.getModCallStats('async-fails')).toMatchObject({ calls: 3, failures: 1 });
    });

    it('keeps the disposer an async activate() resolves to', async () => {
        writeMainMod('async-disposer', `
            module.exports = async function activate() {
                await null;
                return () => { globalThis.__foliumGateMain.push('disposed'); };
            };
        `);
        launch();
        await settle();
        expect(stateOf('async-disposer')).toMatchObject({ status: 'loaded', error: null });
        expect(probe.__foliumGateMain).toEqual([]);

        system!.dispose();
        expect(probe.__foliumGateMain).toEqual(['disposed']);
    });

    it('runs at once a disposer that arrives after the mod was deactivated', async () => {
        writeMainMod('late-disposer', `
            module.exports = async function activate() {
                await new Promise((resolve) => setTimeout(resolve, 0));
                return () => { globalThis.__foliumGateMain.push('late'); };
            };
        `);
        launch();
        system!.dispose();
        expect(probe.__foliumGateMain).toEqual([]);

        await settle();
        await settle();
        expect(unhandled).toEqual([]);
        expect(probe.__foliumGateMain).toEqual(['late']);
    });

    it('runs at once a cleanup registered through onDispose after the mod was deactivated', async () => {
        writeMainMod('late-on-deactivate', `
            module.exports = async function activate(api) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                api.onDispose(() => { globalThis.__foliumGateMain.push('late cleanup'); });
            };
        `);
        launch();
        system!.dispose();
        expect(probe.__foliumGateMain).toEqual([]);

        await settle();
        await settle();
        expect(unhandled).toEqual([]);
        expect(probe.__foliumGateMain).toEqual(['late cleanup']);
    });

    it('asks a thenable for its then() once, so a result that can be consumed only once still reaches the caller', async () => {
        const { createModGuard } = require('../../../electron/modSystem/guard.cjs');
        const guard = createModGuard(() => {});
        let asked = 0;
        const oneShot = {
            then(resolve: (value: string) => void, reject: (error: Error) => void) {
                asked += 1;
                if (asked > 1) reject(new Error('already consumed'));
                else resolve('rows');
            },
        };
        await expect(guard.call('one-shot', 'rpc query', () => oneShot, { rethrow: true })).resolves.toBe('rows');
        expect(asked).toBe(1);
        expect(guard.getStats('one-shot')).toMatchObject({ calls: 1, failures: 0 });
    });

    it('catches a disposer whose promise rejects, and still runs the others', async () => {
        writeMainMod('bad-disposer', `
            module.exports = function activate(api) {
                api.onDispose(() => { globalThis.__foliumGateMain.push('first registered'); });
                api.onDispose(() => Promise.reject(new Error('dispose boom')));
            };
        `);
        launch();
        expect(stateOf('bad-disposer')).toMatchObject({ status: 'loaded' });

        system!.dispose();
        await settle();
        expect(unhandled).toEqual([]);
        expect(probe.__foliumGateMain).toEqual(['first registered']);
    });
});
