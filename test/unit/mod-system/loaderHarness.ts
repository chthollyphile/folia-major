import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/loaderHarness.ts
// A main-process mod loader (electron/modSystem/modSystem.cjs) with Electron and electron-store faked, for the
// Folium 2.0 S2 tests: built-in mods in <root>/app/dist-mods (a development build's built-in folder), user mods
// in <root>/userData/mods, the app's package.json in <root>/app. Import this file before anything that loads
// the loader: it puts the fakes in the require cache first.

const require = createRequire(import.meta.url);

/** The mod-system store. */
export const persisted = new Map<string, unknown>();
/** The main config store (`hostStore`, api.legacy.store). */
export const hostStore = new Map<string, unknown>();
/** IPC handlers the loader registered, by channel. */
export const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
/** Each dialog the loader showed (its options), and the button the next one answers with. */
export const dialogs: Array<{ title?: string; message?: string; detail?: string }> = [];
export const dialogAnswer = { response: 1 };
/** What the fake Electron services were asked. */
export const electronCalls: Array<[string, ...unknown[]]> = [];
let protocolHandler: ((request: Request) => Response | Promise<Response>) | null = null;

class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, value === undefined ? undefined : JSON.parse(JSON.stringify(value))); }
}

const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};

const fakeSession = (partition: string) => ({
    partition,
    fetch: async (url: string) => {
        electronCalls.push(['session.fetch', partition, url]);
        return new Response(`from ${partition}`);
    },
    resolveProxy: async (url: string) => {
        electronCalls.push(['session.resolveProxy', partition, url]);
        return 'DIRECT';
    },
    setProxy: async (config: unknown) => { electronCalls.push(['session.setProxy', partition, config]); },
    clearStorageData: async () => { electronCalls.push(['session.clearStorageData', partition]); },
});

stubModule('electron', {
    dialog: {
        showMessageBox: async (...args: unknown[]) => {
            dialogs.push(args[args.length - 1] as { title?: string; message?: string; detail?: string });
            return { response: dialogAnswer.response };
        },
        showOpenDialog: async (...args: unknown[]) => {
            electronCalls.push(['dialog.showOpenDialog', args[args.length - 1]]);
            return { canceled: false, filePaths: ['/picked/file.bin'] };
        },
    },
    ipcMain: {
        handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { handlers.set(channel, handler); },
        removeHandler: (channel: string) => { handlers.delete(channel); },
    },
    protocol: { handle: (_scheme: string, handler: (request: Request) => Response) => { protocolHandler = handler; } },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(`sealed:${text}`),
        decryptString: (buffer: Buffer) => buffer.toString().replace(/^sealed:/, ''),
    },
    shell: {
        openPath: async () => '',
        openExternal: async (url: string) => { electronCalls.push(['shell.openExternal', url]); },
    },
    net: {
        fetch: async (url: string, init: unknown) => {
            electronCalls.push(['net.fetch', url, init]);
            return new Response(new Uint8Array([0, 1, 2, 255]), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
        },
        // net.request: records the options it got (the session as its partition) and hands back a stand-in request.
        request: (options: { session?: { partition?: string } } & Record<string, unknown>) => {
            const { session, ...rest } = options;
            electronCalls.push(['net.request', { ...rest, ...(session ? { partition: session.partition } : {}) }]);
            return { options, kind: 'client-request' };
        },
    },
    session: {
        fromPartition: (partition: string) => fakeSession(partition),
        defaultSession: fakeSession('default'),
    },
});
stubModule('electron-store', FakeStore);

export const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs') as {
    createModSystem: (options: Record<string, unknown>) => ModSystem;
};
export const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs') as { computeModDigest: (dir: string) => string | null };

export interface ListedMod {
    id: string;
    status: string;
    error: string | null;
    enabled: boolean;
    tier: string;
    kind: string;
    clientUrl: string | null;
    signature: { status: string };
    sources: Array<{ id: string; localId: string; state: string; takeover: boolean; keepForMatching: boolean }>;
    sourcesOff: boolean;
    mainState: string;
    alternate: { tier: string; reason: string | null } | null;
    shadowedBy: string | null;
    notes: string[];
}

export interface ModSystem {
    start: () => void;
    startSources: () => void;
    loadAll: (options?: { differential?: boolean }) => ListedMod[];
    reloadChanged: () => Promise<ListedMod[]>;
    listMods: () => ListedMod[];
    listClientDescriptors: () => ListedMod[];
    setModEnabled: (modId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
    setSourceState: (sourceId: string, state: string) => Promise<{ ok: boolean; error?: string; states?: Record<string, string> }>;
    listSourceStates: () => { states: Record<string, string>; sources: Array<{ sourceId: string; modId: string | null; mainState: string }> };
    describeSourceData: (sourceId: string) => Record<string, unknown> & { ok: boolean };
    clearSourceData: (sourceId: string) => Promise<{ ok: boolean; error?: string; pageStorePrefixes?: string[] }>;
    confirmModOverride: (modId: string) => Promise<{ ok: boolean; error?: string }>;
    assignSourceClaim: (shortId: string, modId: string) => Promise<{ ok: boolean; error?: string }>;
    registerIpc: () => void;
    dispose: () => void;
    prepareQuit: () => Promise<void> | null;
    skipForThisRun: () => ListedMod[];
    hasRunningMods: () => boolean;
    notePlayersOrphaned: (reason: string) => void;
    noteMainWindowChanged: () => void;
    isLyricRelayHost: (host: string) => boolean;
    allowsCertificateException: (host: string) => boolean;
    sourceCaches: { list: () => Promise<unknown[]> };
    mediaRules: { allows: (details: Record<string, unknown>) => boolean; followRedirect: (details: Record<string, unknown>) => void };
}

export interface Harness {
    root: string;
    userData: string;
    appPath: string;
    builtinDir: string;
    userModsDir: string;
}

let current: Harness | null = null;

/** A fresh root, and every fake reset. */
export const resetHarness = (): Harness => {
    persisted.clear();
    hostStore.clear();
    handlers.clear();
    dialogs.length = 0;
    dialogAnswer.response = 1;
    electronCalls.length = 0;
    protocolHandler = null;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-s2-'));
    current = {
        root,
        userData: path.join(root, 'userData'),
        appPath: path.join(root, 'app'),
        builtinDir: path.join(root, 'app', 'dist-mods'),
        userModsDir: path.join(root, 'userData', 'mods'),
    };
    fs.mkdirSync(current.appPath, { recursive: true });
    return current;
};

export const harness = (): Harness => {
    if (!current) throw new Error('resetHarness() first');
    return current;
};

export const cleanHarness = () => {
    if (current) fs.rmSync(current.root, { recursive: true, force: true });
    current = null;
};

/*
 * A main entry that counts its activations and deactivations in globalThis.__s2Mods[<id>] and keeps its api
 * there, so a test can see whether a load restarted it. `body` is extra code in activate (it has `api`).
 */
export const countingMain = (body = '') => `'use strict';
module.exports = function activate(api) {
    const record = (globalThis.__s2Mods ??= {})[api.manifest.id] ??= { activations: 0, deactivations: 0 };
    record.activations += 1;
    record.api = api;
    ${body}
    return () => { record.deactivations += 1; };
};
`;

export const modRecord = (modId: string): { activations: number; deactivations: number; api: Record<string, unknown> } | undefined => (
    (globalThis as { __s2Mods?: Record<string, { activations: number; deactivations: number; api: Record<string, unknown> }> }).__s2Mods?.[modId]
);

export const clearModRecords = () => {
    delete (globalThis as { __s2Mods?: unknown }).__s2Mods;
};

/**
 * Writes a mod at `<base>/<id>` (`base`: 'builtin', 'user' or a path). `main: true` writes a counting main
 * entry; `main` as a string writes that code. Returns its folder.
 */
export const writeMod = (
    base: 'builtin' | 'user' | string,
    manifest: Record<string, unknown> & { id: string },
    { main = false, client = true, files = {} }: { main?: boolean | string; client?: boolean; files?: Record<string, string | Buffer> } = {},
): string => {
    const { builtinDir, userModsDir } = harness();
    const directory = path.join(base === 'builtin' ? builtinDir : base === 'user' ? userModsDir : base, manifest.id);
    fs.mkdirSync(directory, { recursive: true });
    const full = {
        folium: 1,
        name: manifest.id,
        version: '1.0.0',
        ...(main ? { main: 'index.cjs' } : {}),
        ...(client ? { client: 'client.mjs' } : {}),
        ...manifest,
    };
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify(full));
    if (client) fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate() {}\n');
    if (main) fs.writeFileSync(path.join(directory, 'index.cjs'), typeof main === 'string' ? main : countingMain());
    Object.entries(files).forEach(([name, content]) => {
        fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
        fs.writeFileSync(path.join(directory, name), content);
    });
    return directory;
};

/** Records the user's confirmation of a user-folder mod, bound to its files as they are now. */
export const confirmMod = (directory: string, modId: string) => {
    persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
};

/** A source manifest: `folium: 2` with one source per id. */
export const sourceManifest = (id: string, sources: Array<Record<string, unknown>> | string[], extra: Record<string, unknown> = {}) => ({
    id,
    folium: 2,
    sources: sources.map((source) => (typeof source === 'string' ? { id: source, name: source } : { name: String(source.id), ...source })),
    ...extra,
});

/** The app's package.json (`foliaBundledSources`). */
export const writeAppPackage = (json: Record<string, unknown>) => {
    fs.writeFileSync(path.join(harness().appPath, 'package.json'), JSON.stringify({ name: 'folia', ...json }));
};

export const MAIN_FRAME = { name: 'main frame' };
export const sentToWindow: Array<[string, unknown]> = [];
export const MAIN_WINDOW = {
    isDestroyed: () => false,
    webContents: {
        mainFrame: MAIN_FRAME,
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => { sentToWindow.push([channel, payload]); },
    },
};
export const FROM_MAIN = { sender: MAIN_WINDOW.webContents, senderFrame: MAIN_FRAME };

/** Makes a loader on the harness. `switchOn` is the mod system's master switch. */
export const launch = (options: {
    switchOn?: boolean;
    isPackaged?: boolean;
    appVersion?: string;
    mainWindow?: unknown;
    extra?: Record<string, unknown>;
    load?: boolean;
} = {}): ModSystem => {
    const { userData, appPath } = harness();
    const switchState = { on: options.switchOn ?? true };
    const system = createModSystem({
        app: {
            getPath: (name: string) => (name === 'userData' ? userData : path.join(userData, name)),
            getAppPath: () => appPath,
            getVersion: () => options.appVersion ?? '0.8.0',
            isPackaged: options.isPackaged ?? false,
        },
        BrowserWindow: class {
            options: unknown;
            destroyed = false;
            constructor(windowOptions: unknown) {
                this.options = windowOptions;
                electronCalls.push(['BrowserWindow', windowOptions]);
            }
            isDestroyed() { return this.destroyed; }
            destroy() { this.destroyed = true; electronCalls.push(['BrowserWindow.destroy']); }
        },
        getMainWindow: () => (options.mainWindow === undefined ? MAIN_WINDOW : options.mainWindow),
        getLocaleKey: () => 'en',
        isFeatureEnabled: () => switchState.on,
        openExternal: async (url: string) => { electronCalls.push(['shell.openExternal', url]); return true; },
        hostStore: {
            get: (key: string) => hostStore.get(key),
            set: (key: string, value: unknown) => { hostStore.set(key, value); },
            has: (key: string) => hostStore.has(key),
            delete: (key: string) => { hostStore.delete(key); },
        },
        ...(options.extra ?? {}),
    });
    (system as ModSystem & { setSwitch?: (on: boolean) => void }).setSwitch = (on: boolean) => { switchState.on = on; };
    system.registerIpc();
    if (options.load !== false) system.loadAll();
    return system;
};

export const setSwitch = (system: ModSystem, on: boolean) => (system as ModSystem & { setSwitch: (on: boolean) => void }).setSwitch(on);

export const stateOf = (system: ModSystem, modId: string) => system.listMods().find((mod) => mod.id === modId);

/** Calls an IPC handler as the main window's main frame. */
export const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(FROM_MAIN, ...args);

/** The folia-mod:// handler the loader attached. */
export const fetchModUrl = async (url: string, headers: Record<string, string> = {}) => {
    if (!protocolHandler) throw new Error('no protocol handler');
    return protocolHandler(new Request(url, { headers }));
};

export const IPC = (require('../../../electron/modSystem/foliumShared.json') as { channels: Record<string, string> }).channels;
