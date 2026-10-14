import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';

// test/unit/mod-system/homePagesInstall.test.ts
// Exercise the shipped example through the main-process ZIP installation gate,
// not just the renderer registry. Only Electron and its persistent store are fake.

const require = createRequire(import.meta.url);
const sampleDirectory = path.resolve(__dirname, '../../../dev/folium/sample-home-pages');
const persisted = new Map<string, unknown>();
type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, IpcHandler>();
let protocolHandler: (request: Request) => Response;
let confirmations: string[] = [];

class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}

const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', {
    dialog: {
        showMessageBox: async (options: { detail: string }) => {
            confirmations.push(options.detail);
            return { response: 1 };
        },
    },
    ipcMain: {
        handle: (channel: string, handler: IpcHandler) => { handlers.set(channel, handler); },
        removeHandler: (channel: string) => { handlers.delete(channel); },
    },
    protocol: { handle: (_scheme: string, handler: typeof protocolHandler) => { protocolHandler = handler; } },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { createModSystem, IPC } = require('../../../electron/modSystem/modSystem.cjs');
let root = '';
let system: ReturnType<typeof createModSystem>;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-home-install-'));
    persisted.clear();
    handlers.clear();
    confirmations = [];
    system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.7.18',
            isPackaged: true,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow: () => null,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.registerIpc();
    system.loadAll();
});

afterEach(() => {
    system.dispose();
    fs.rmSync(root, { recursive: true, force: true });
});

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args);

const writeSampleZip = (unknownFeature = false) => {
    const entries = Object.fromEntries(fs.readdirSync(sampleDirectory).map((file) => [
        file, fs.readFileSync(path.join(sampleDirectory, file)),
    ]));
    if (unknownFeature) {
        const manifest = JSON.parse(entries['mod.json'].toString());
        manifest.experimental.push('home.unsupported');
        entries['mod.json'] = Buffer.from(JSON.stringify(manifest));
    }
    const zipPath = path.join(root, 'sample-home-pages.zip');
    fs.writeFileSync(zipPath, zipSync(entries));
    return zipPath;
};

describe('home page example installation through the packaged-app loader', () => {
    it('installs, enables and disables the real example through IPC', async () => {
        expect(await invoke(IPC.installZip, writeSampleZip())).toMatchObject({ ok: true, id: 'sample-home-pages' });
        expect(system.listMods()).toEqual([expect.objectContaining({
            id: 'sample-home-pages', experimental: ['home.pages'], status: 'disabled',
            enabled: false, error: null, clientUrl: null, devSource: false,
        })]);
        expect(system.listClientDescriptors()).toEqual([]);
        expect(confirmations).toEqual([]);

        expect(await invoke(IPC.setEnabled, 'sample-home-pages', true)).toMatchObject({ ok: true });
        expect(confirmations).toHaveLength(1);
        expect(confirmations[0]).toContain('home.pages');
        const descriptors = system.listClientDescriptors();
        expect(descriptors).toEqual([expect.objectContaining({
            id: 'sample-home-pages', experimental: ['home.pages'], status: 'loaded',
            enabled: true, error: null, clientUrl: expect.stringMatching(/^folia-mod:\/\/sample-home-pages\/client\.mjs\?/),
        })]);
        const clientUrl = descriptors[0].clientUrl;
        const response = protocolHandler(new Request(clientUrl));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(fs.readFileSync(path.join(sampleDirectory, 'client.mjs'), 'utf8'));

        expect(await invoke(IPC.setEnabled, 'sample-home-pages', false)).toMatchObject({ ok: true });
        expect(system.listMods()).toEqual([expect.objectContaining({
            id: 'sample-home-pages', status: 'disabled', enabled: false, error: null, clientUrl: null,
        })]);
        expect(system.listClientDescriptors()).toEqual([]);
        expect(protocolHandler(new Request(clientUrl)).status).toBe(404);
    });

    it('still rejects undeclared host experimental features before installing files', async () => {
        expect(await invoke(IPC.installZip, writeSampleZip(true))).toEqual({
            ok: false, error: 'install-invalid-manifest:unknown experimental feature home.unsupported',
        });
        expect(system.listMods()).toEqual([]);
        expect(system.listClientDescriptors()).toEqual([]);
        expect(fs.existsSync(path.join(root, 'userData/mods/sample-home-pages'))).toBe(false);
        expect(confirmations).toEqual([]);
    });
});
