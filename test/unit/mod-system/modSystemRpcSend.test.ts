import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSystemRpcSend.test.ts
// A main entry's `api.rpc.send` (Folium 1.7) through the real loader: the message goes to the main
// window on the rpc-message channel, tagged with the sending mod's id, and is dropped without an
// error when there is no main window, when it is destroyed, or once the mod has stopped.

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
const { channels } = require('../../../electron/modSystem/foliumShared.json');

interface ModSystem {
    loadAll: () => unknown;
    dispose: () => void;
}
interface SendApi { rpc: { send: (name: string, payload?: unknown) => void } }

let root = '';
let system: ModSystem | null = null;
const probe = globalThis as { __foliumRpcSend?: Record<string, SendApi> };

// The main window as the loader sees it; `send` records what reached its page.
const createWindow = () => {
    const state = { destroyed: false, contentsDestroyed: false };
    const send = vi.fn();
    return {
        state,
        send,
        window: {
            isDestroyed: () => state.destroyed,
            webContents: { isDestroyed: () => state.contentsDestroyed, send },
        },
    };
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-rpc-send-'));
    persisted.clear();
    probe.__foliumRpcSend = {};
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    system?.dispose();
    system = null;
    delete probe.__foliumRpcSend;
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/* An enabled (confirmed) mod whose main entry keeps its api where the test can call it. */
const writeMod = (modId: string) => {
    const directory = path.join(root, 'userData/mods', modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id: modId, name: modId, version: '1.0.0', main: 'index.cjs', client: 'client.mjs',
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    fs.writeFileSync(path.join(directory, 'index.cjs'), `
        module.exports = function activate(api) { globalThis.__foliumRpcSend[api.manifest.id] = api; };
    `);
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
};

const launch = (getMainWindow: () => unknown) => {
    system = createModSystem({
        app: {
            getPath: () => path.join(root, 'userData'),
            getAppPath: () => path.join(root, 'app'),
            getVersion: () => '0.8.0',
            isPackaged: true,
        },
        BrowserWindow: { getAllWindows: () => [] },
        getMainWindow,
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => true,
    }) as ModSystem;
    system.loadAll();
};

const apiOf = (modId: string) => probe.__foliumRpcSend![modId];
const rpcMessages = (send: ReturnType<typeof vi.fn>) => send.mock.calls
    .filter(([channel]) => channel === channels.fRpcMessage)
    .map(([, message]) => message);

describe('api.rpc.send through the loader', () => {
    it('pushes the message to the main window, tagged with the mod that sent it', () => {
        const main = createWindow();
        writeMod('sender-a');
        writeMod('sender-b');
        launch(() => main.window);

        apiOf('sender-a').rpc.send('hotkey', { key: 'F9' });
        apiOf('sender-b').rpc.send('hotkey');
        expect(channels.fRpcMessage).toBe('folia-mods:rpc-message');
        expect(rpcMessages(main.send)).toEqual([
            { modId: 'sender-a', name: 'hotkey', json: '{"key":"F9"}' },
            { modId: 'sender-b', name: 'hotkey', json: 'null' },
        ]);
    });

    it('drops a message without an error when there is no main window or it is destroyed', () => {
        const main = createWindow();
        let current: unknown = null;
        writeMod('sender');
        launch(() => current);

        expect(() => apiOf('sender').rpc.send('lost', 1)).not.toThrow();
        current = main.window;
        main.state.destroyed = true;
        expect(() => apiOf('sender').rpc.send('lost', 2)).not.toThrow();
        main.state.destroyed = false;
        main.state.contentsDestroyed = true;
        expect(() => apiOf('sender').rpc.send('lost', 3)).not.toThrow();
        expect(rpcMessages(main.send)).toEqual([]);

        // A window whose getter throws counts as none.
        system!.dispose();
        writeMod('sender-2');
        launch(() => { throw new Error('no window yet'); });
        expect(() => apiOf('sender-2').rpc.send('lost', 4)).not.toThrow();
    });

    it('still throws for a bad payload when no window would receive it', () => {
        writeMod('sender');
        launch(() => null);
        expect(() => apiOf('sender').rpc.send('big', 'a'.repeat(64 * 1024))).toThrow('rpc-payload-too-large:65536');
    });

    it('sends nothing once the mod has stopped', () => {
        const main = createWindow();
        writeMod('sender');
        launch(() => main.window);
        const stale = apiOf('sender');

        system!.dispose();
        expect(() => stale.rpc.send('after', 1)).not.toThrow();
        expect(rpcMessages(main.send)).toEqual([]);
    });
});
