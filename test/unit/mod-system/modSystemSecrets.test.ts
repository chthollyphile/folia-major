import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemSecrets.test.ts
// Folium 1.7 `secret` values through the loader, with Electron replaced by fakes (no safeStorage, so the
// store runs memory-only): the `folia-mods:secrets` channel serves only a loaded mod and only that mod's
// store, the main entry's `api.secrets` is the same store, a change from either side reaches the window
// and the main entry's subscribers as the key alone, and a main entry's subscription ends with the mod.

const require = createRequire(import.meta.url);

type Response = { ok: boolean; result?: unknown; error?: string };
type Handler = (event: unknown, ...args: unknown[]) => Promise<Response>;

const handlers = new Map<string, Handler>();
const persisted = new Map<string, unknown>();
const sent: Array<{ channel: string; payload: unknown }> = [];

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

// What the test mod's main entry exposes to the test: its api.secrets and what its listener heard.
const seenKey = '__foliaModSecretsTest';
type Seen = {
    secrets: { get(key: string): Promise<string | null>; set(key: string, value: string | null): Promise<void> };
    heard: string[];
    read?: string | null;
};
const seen = () => (globalThis as Record<string, unknown>)[seenKey] as Seen;

let root = '';

const writeMod = (id: string, { enabled = true, awaitSecretInActivate = false } = {}) => {
    const directory = path.join(root, 'app', 'mods', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id, name: id, version: '1.0.0', main: 'main.cjs', client: 'client.mjs', permissions: [],
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate() {}\n');
    fs.writeFileSync(path.join(directory, 'main.cjs'), [
        "'use strict';",
        'module.exports = function activate(api) {',
        `    const state = { secrets: api.secrets, heard: [] };`,
        `    globalThis.${seenKey} = state;`,
        '    api.secrets.subscribe((key) => state.heard.push(key));',
        ...(awaitSecretInActivate ? [
            "    return api.secrets.get('apiKey').then((value) => { state.read = value; });",
        ] : []),
        '};',
        '',
    ].join('\n'));
    if (enabled) {
        persisted.set(`mods.enabled.${id}`, { enabled: true, digest: computeModDigest(directory) });
    }
};

const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
    },
};

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
        getMainWindow: () => fakeWindow,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    });
    system.registerIpc();
    system.loadAll();
    return system;
};

const invoke = (...args: unknown[]) => handlers.get(IPC.secrets)!(null, ...args);
const secretNotices = () => sent.filter((entry) => entry.channel === IPC.fSecretChanged).map((entry) => entry.payload);

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-secrets-loader-'));
    persisted.clear();
    sent.length = 0;
    delete (globalThis as Record<string, unknown>)[seenKey];
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)[seenKey];
    fs.rmSync(root, { recursive: true, force: true });
});

describe('secret values through the loader', () => {
    it('shares one store between the window and the main entry, and tells both sides the key only', async () => {
        writeMod('mod-a');
        launch();
        expect(await invoke('mod-a', 'declare', ['apiKey'])).toEqual({ ok: true, result: 1 });
        expect(await invoke('mod-a', 'set', 'apiKey', 'from-window')).toEqual({ ok: true, result: null });

        expect(await seen().secrets.get('apiKey')).toBe('from-window');
        expect(seen().heard).toEqual(['apiKey']);
        expect(secretNotices()).toEqual([{ modId: 'mod-a', key: 'apiKey' }]);

        await seen().secrets.set('apiKey', 'from-main');
        expect(await invoke('mod-a', 'get', 'apiKey')).toEqual({ ok: true, result: 'from-main' });
        expect(seen().heard).toEqual(['apiKey', 'apiKey']);
        expect(secretNotices()).toHaveLength(2);
        expect(JSON.stringify(sent)).not.toContain('from-');

        expect(await invoke('mod-a', 'state')).toEqual({ ok: true, result: { persistent: false, stored: ['apiKey'] } });
    });

    it('serves only a loaded mod, and refuses undeclared keys and unknown operations', async () => {
        writeMod('mod-a');
        writeMod('mod-off', { enabled: false });
        launch();
        expect(await invoke('mod-off', 'declare', ['apiKey'])).toEqual({ ok: false, error: 'mod-not-loaded' });
        expect(await invoke('nobody', 'get', 'apiKey')).toEqual({ ok: false, error: 'mod-not-found' });
        // Before the window declares anything this run, an unset key reads as unset; a write waits.
        expect(await invoke('mod-a', 'get', 'apiKey')).toEqual({ ok: true, result: null });
        expect(await invoke('mod-a', 'set', 'apiKey', 'x')).toEqual({ ok: false, error: 'secret-undeclared:apiKey' });
        await invoke('mod-a', 'declare', ['apiKey']);
        expect(await invoke('mod-a', 'get', 'other')).toEqual({ ok: false, error: 'secret-undeclared:other' });
        expect(await invoke('mod-a', 'keys')).toEqual({ ok: false, error: 'secrets-unknown-operation:keys' });
    });

    it('keeps a main entry loaded that awaits an unset key in activate, before the client declares it', async () => {
        writeMod('mod-a', { awaitSecretInActivate: true });
        const system = launch();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(seen().read).toBeNull();
        const mods = system.listMods() as Array<{ id: string; status: string }>;
        expect(mods.find((mod) => mod.id === 'mod-a')?.status).toBe('loaded');
    });

    it('keeps one mod out of another\'s values', async () => {
        writeMod('mod-a');
        writeMod('mod-b');
        launch();
        await invoke('mod-a', 'declare', ['apiKey']);
        await invoke('mod-b', 'declare', ['apiKey']);
        await invoke('mod-a', 'set', 'apiKey', 'a-only');
        expect(await invoke('mod-b', 'get', 'apiKey')).toEqual({ ok: true, result: null });
    });

    it('ends a main entry\'s subscription when the mod stops', async () => {
        writeMod('mod-a');
        const system = launch();
        await invoke('mod-a', 'declare', ['apiKey']);
        const before = seen();
        system.loadAll();
        const after = seen();
        expect(after).not.toBe(before);
        await invoke('mod-a', 'set', 'apiKey', 'x');
        expect(before.heard).toEqual([]);
        expect(after.heard).toEqual(['apiKey']);
    });
});
