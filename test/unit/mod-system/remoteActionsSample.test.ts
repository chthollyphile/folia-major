import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { zipSync } from 'fflate';

// test/unit/mod-system/remoteActionsSample.test.ts
// Install the exact offline sample through the normal manifest/trust/client pipeline.
const require = createRequire(import.meta.url);
const persisted = new Map<string, unknown>();
const handlers = new Map<string, (...args: any[]) => any>();
let protocolHandler: (request: Request) => Response;
const stubModule = (name: string, exports: unknown) => {
    const filename = require.resolve(name);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron-store', class {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, value); }
});
stubModule('electron', {
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    protocol: { handle: (_scheme: string, handler: typeof protocolHandler) => { protocolHandler = handler; } },
    shell: { openPath: async () => '' },
});
const { createModSystem, IPC } = require('../../../electron/modSystem/modSystem.cjs');

it('installs the remote.actions sample without Node entry or a remote script loader', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-remote-actions-'));
    const sample = path.resolve('dev/folium/sample-remote-actions');
    const files = fs.readdirSync(sample);
    const manifest = JSON.parse(fs.readFileSync(path.join(sample, 'mod.json'), 'utf8'));
    expect(manifest.experimental).toEqual(['remote.actions']);
    expect(manifest.main).toBeUndefined();
    expect(files.sort()).toEqual(['README.md', 'client.mjs', 'mod.json']);
    const archive = path.join(root, 'sample.zip');
    fs.writeFileSync(archive, zipSync(Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(sample, file))]))));
    const system = createModSystem({
        app: { getPath: () => path.join(root, 'user'), getAppPath: () => path.join(root, 'app'), getVersion: () => '0.7.19', isPackaged: true },
        BrowserWindow: { getAllWindows: () => [] }, getMainWindow: () => null,
        getLocaleKey: () => 'en', isFeatureEnabled: () => true,
    });
    try {
        system.registerIpc(); system.loadAll();
        expect(await handlers.get(IPC.installZip)!(null, archive)).toMatchObject({ ok: true, id: manifest.id });
        expect(system.listClientDescriptors()).toEqual([]);
        expect(await handlers.get(IPC.setEnabled)!(null, manifest.id, true)).toMatchObject({ ok: true });
        const clients = system.listClientDescriptors();
        expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({ id: manifest.id, hasMain: false, experimental: ['remote.actions'] });
        const response = protocolHandler(new Request(clients[0].clientUrl));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(fs.readFileSync(path.join(sample, 'client.mjs'), 'utf8'));
        await system.setModEnabled(manifest.id, false);
        expect(system.listClientDescriptors()).toEqual([]);
        expect(protocolHandler(new Request(clients[0].clientUrl)).status).toBe(404);
        await system.setModEnabled(manifest.id, true);
        expect(system.listClientDescriptors()).toHaveLength(1);
    } finally { system.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});
