import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemTrust.test.ts
// The enable approval is bound to a mod's content digest: changed files revoke
// it. The one exemption is a development build (unpackaged) editing a mod in
// the repository's own mods/ directory, where the approval follows the edit.
// These pin both sides, so the exemption can never reach user-installed mods.

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
const { TRUST_DIALOG_LOCALE } = require('../../../electron/modSystem/approval.cjs');

let root = '';

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-trust-'));
    persisted.clear();
});

/* A confirmed (enabled, digest-bound) mod under `base` ('app/mods' is the repository directory). */
const writeConfirmedMod = (base: string, modId: string) => {
    const directory = path.join(root, base, modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({ folium: 1, id: modId, name: modId, version: '1.0.0', client: 'client.mjs' }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
    return directory;
};

const launch = ({ isPackaged = false } = {}) => {
    const system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => null,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.loadAll();
    return system;
};

interface ListedMod { id: string; enabled: boolean; trustStale: boolean; devSource: boolean }
const stateOf = (system: { listMods: () => ListedMod[] }, modId: string) => system.listMods().find((mod) => mod.id === modId);

describe('enable approval and content changes', () => {
    it('keeps the approval of an edited mod in the development source tree', () => {
        const directory = writeConfirmedMod('app/mods', 'dev-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        const state = stateOf(launch(), 'dev-mod');
        expect(state).toMatchObject({ enabled: true, trustStale: false, devSource: true });
        // The approval now follows the edited bytes.
        expect(persisted.get('mods.enabled.dev-mod')).toMatchObject({ enabled: true, digest: computeModDigest(directory) });
    });

    it('revokes the approval of an edited mod in the user mods directory', () => {
        const directory = writeConfirmedMod('userData/mods', 'user-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        const state = stateOf(launch(), 'user-mod');
        expect(state).toMatchObject({ enabled: false, trustStale: true, devSource: false });
        expect(persisted.get('mods.enabled.user-mod')).toMatchObject({ enabled: false, digest: null });
    });

    it('never exempts a packaged app', () => {
        const directory = writeConfirmedMod('userData/mods', 'packaged-mod');
        fs.appendFileSync(path.join(directory, 'client.mjs'), '// edited\n');
        expect(stateOf(launch({ isPackaged: true }), 'packaged-mod')).toMatchObject({ enabled: false, trustStale: true, devSource: false });
    });

    // A build from before approvals were bound to files stored a bare `true`.
    it('reads a stored approval that is not an object as none: the mod stays off, with no files-changed note', () => {
        for (const [index, stored] of [true, 1, 'yes'].entries()) {
            const modId = `old-record-${index}`;
            writeConfirmedMod('userData/mods', modId);
            persisted.set(`mods.enabled.${modId}`, stored);
        }
        const system = launch();
        for (const index of [0, 1, 2]) {
            expect(stateOf(system, `old-record-${index}`)).toMatchObject({ enabled: false, trustStale: false });
        }
    });

    it('still needs the first confirmation in the development source tree', () => {
        writeConfirmedMod('app/mods', 'never-enabled');
        persisted.delete('mods.enabled.never-enabled');
        expect(stateOf(launch(), 'never-enabled')).toMatchObject({ enabled: false, trustStale: false, devSource: true });
    });
});

describe('the enable dialog text', () => {
    // A line one language lacks would read "undefined" in the dialog there.
    it('has the same lines in the four languages', () => {
        const english = Object.keys(TRUST_DIALOG_LOCALE.en).sort();
        for (const language of ['zh-CN', 'zh-TW', 'in']) {
            expect(Object.keys(TRUST_DIALOG_LOCALE[language]).sort(), language).toEqual(english);
        }
    });
});
