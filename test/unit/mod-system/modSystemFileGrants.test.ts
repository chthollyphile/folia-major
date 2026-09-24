import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemFileGrants.test.ts
// folium.ui.pickFile({ persist }) / restoreFile / releaseFile end to end
// through the loader's IPC handlers and the folia-mod:// protocol, with
// Electron replaced by fakes: a persisted pick survives a restart (a new
// loader over the same store), resolves only for its own mod, and serves the
// picked file's bytes.

const require = createRequire(import.meta.url);

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean; result?: any; error?: string }>;

const handlers = new Map<string, Handler>();
let protocolHandler: ((request: Request) => Response) | null = null;
let pickedPath: string | null = null;
// Shared across loader instances, like the electron-store file across app restarts.
const persisted = new Map<string, unknown>();

class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}

const fakeElectron = {
    dialog: { showOpenDialog: async () => ({ canceled: !pickedPath, filePaths: pickedPath ? [pickedPath] : [] }) },
    ipcMain: {
        handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
        removeHandler: (channel: string) => { handlers.delete(channel); },
    },
    protocol: { handle: (_scheme: string, handler: (request: Request) => Response) => { protocolHandler = handler; } },
    shell: { openPath: async () => '' },
};

const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', fakeElectron);
stubModule('electron-store', FakeStore);

const { createModSystem, IPC } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');

let root = '';

const writeMod = (modId: string) => {
    const directory = path.join(root, 'app', 'mods', modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id: modId, name: modId, version: '1.0.0', client: 'client.mjs',
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
};

// One app launch: a fresh loader over the same persisted store and files.
const launch = () => {
    handlers.clear();
    const system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged: false,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => null,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.registerIpc();
    system.loadAll();
    return system;
};

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args);

const fetchModUrl = async (url: string) => {
    const response = protocolHandler!(new Request(url));
    return { status: response.status, body: response.status === 200 ? await response.text() : null };
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-grants-'));
    persisted.clear();
    writeMod('mod-a');
    writeMod('mod-b');
    pickedPath = path.join(root, 'loop.mp4');
    fs.writeFileSync(pickedPath, 'video-bytes');
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('persistent file grants through the loader', () => {
    it('returns no grant id for a plain pick', async () => {
        launch();
        const picked = await invoke(IPC.pickFile, 'mod-a', 'video', false);
        expect(picked.ok).toBe(true);
        expect(picked.result.grantId).toBeUndefined();
        expect(await fetchModUrl(picked.result.url)).toEqual({ status: 200, body: 'video-bytes' });
    });

    it('restores a persisted pick after a restart, for its own mod only', async () => {
        launch();
        const picked = await invoke(IPC.pickFile, 'mod-a', 'video', true);
        const { grantId } = picked.result;
        expect(grantId).toMatch(/^[0-9a-f]{32}$/);

        launch();
        // The previous session's URL died with it.
        expect((await fetchModUrl(picked.result.url)).status).toBe(404);
        const restored = await invoke(IPC.restoreFile, 'mod-a', grantId);
        expect(restored.result).toMatchObject({ name: 'loop.mp4', size: 11, grantId });
        expect(await fetchModUrl(restored.result.url)).toEqual({ status: 200, body: 'video-bytes' });
        // Same URL when restored twice in one session.
        expect((await invoke(IPC.restoreFile, 'mod-a', grantId)).result.url).toBe(restored.result.url);

        expect((await invoke(IPC.restoreFile, 'mod-b', grantId)).result).toBeNull();
    });

    it('returns null once the grant is released or the file is gone', async () => {
        launch();
        const first = (await invoke(IPC.pickFile, 'mod-a', 'video', true)).result;
        const second = (await invoke(IPC.pickFile, 'mod-a', 'video', true)).result;
        expect((await invoke(IPC.releaseFile, 'mod-a', first.grantId)).result).toBe(true);
        expect((await invoke(IPC.restoreFile, 'mod-a', first.grantId)).result).toBeNull();
        // Already handed out: stays valid for this session.
        expect((await fetchModUrl(first.url)).status).toBe(200);

        fs.rmSync(pickedPath!);
        launch();
        expect((await invoke(IPC.restoreFile, 'mod-a', second.grantId)).result).toBeNull();
    });

    it('refuses a mod that is not loaded', async () => {
        launch();
        const response = await invoke(IPC.restoreFile, 'missing-mod', '0'.repeat(32));
        expect(response.ok).toBe(false);
    });
});
