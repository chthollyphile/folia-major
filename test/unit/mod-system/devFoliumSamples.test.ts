// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
    FoliumAccountState,
    FoliumClientApi,
    FoliumCommandDef,
    FoliumEventMap,
    FoliumHomeTabDef,
    FoliumLoopMode,
    FoliumOmniPage,
    FoliumOmniProviderInfo,
    FoliumPanelContext,
    FoliumPlaybackService,
    FoliumPlatformResponse,
    FoliumQueueReplaceRefusal,
    FoliumQueueReplaceResult,
    FoliumQueueSnapshot,
    FoliumSettingsSectionDef,
    FoliumSong,
    FoliumSongKey,
    FoliumSongResolution,
} from '@/mods/folium/contract';

// test/unit/mod-system/devFoliumSamples.test.ts
// The demonstration mods under dev/folium/ (every directory there holding a mod.json) are Folium 1
// mods like the signed samples in mods/: the manifest validates, the declared entries exist, and the
// client uses the literal `export default function activate(folium)` form authors copy. Unlike
// mods/ they are unsigned (installed by hand, never scanned by the loader), so no signature check.
// sample-playback-console also runs here: its main entry against the real api.storage.paths
// (append, cache, rebuild after the cache is emptied) and its client against a stand-in folium.
// So does sample-account-console (Folium 1.7): its main entry against the real api with a stand-in
// secret store, its client against a stand-in folium with secrets, rpc.on, account and platform.raw.
// And sample-omni-console (Folium 1.7): its client against a stand-in folium.omni that answers the way
// the contract says. On an older host and in the export window it calls nothing of folium.omni.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const { createModApi, createModDataStore } = require('../../../electron/modSystem/modApi.cjs');
const { clearDirectoryContents, resolveModStorageDirs } = require('../../../electron/modSystem/modFiles.cjs');

const DEV_FOLIUM_DIR = path.resolve(__dirname, '../../../dev/folium');
const PLAYBACK_CONSOLE_DIR = path.join(DEV_FOLIUM_DIR, 'sample-playback-console');
const sampleDirectories = fs.readdirSync(DEV_FOLIUM_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(DEV_FOLIUM_DIR, entry.name, 'mod.json')))
    .map((entry) => path.join(DEV_FOLIUM_DIR, entry.name));
const samples = sampleDirectories.map((directory) => [path.basename(directory), directory]);

const temporaryDirectories: string[] = [];
afterEach(() => {
    while (temporaryDirectories.length > 0) {
        fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
    }
    document.body.replaceChildren();
});

describe('dev/folium sample mods', () => {
    it('has the samples the docs point to', () => {
        expect(samples.map(([name]) => name)).toEqual(expect.arrayContaining([
            'sample-home-tab', 'sample-playback-console', 'sample-account-console', 'sample-omni-console',
            'sample-equalizer-console',
        ]));
    });

    it.each(samples)('%s is a valid Folium 1 mod', (_name, directory) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'mod.json'), 'utf8'));
        const result = validateManifest(manifest);
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok) return;
        if (result.value.main) expect(fs.existsSync(path.join(directory, result.value.main))).toBe(true);
        if (result.value.client) {
            const clientPath = path.join(directory, result.value.client);
            expect(fs.existsSync(clientPath)).toBe(true);
            expect(fs.readFileSync(clientPath, 'utf8')).toMatch(/export default function activate\(folium\)/);
        }
    });

    it.each(samples)('%s ships unsigned, as the docs say', (_name, directory) => {
        expect(fs.existsSync(path.join(directory, 'folium.sig.json'))).toBe(false);
    });
});

/* The main entry, activated against the real mod api with its own userData under the temp directory. */
const activatePlaybackConsoleMain = () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-dev-sample-'));
    temporaryDirectories.push(userData);
    // As the loader hands it over: validated, its permission ids as Folium 1.6 names them.
    const { value: manifest } = validateManifest(JSON.parse(fs.readFileSync(path.join(PLAYBACK_CONSOLE_DIR, 'mod.json'), 'utf8')));
    const dirs = resolveModStorageDirs(userData, manifest.id);
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const api = createModApi({
        modId: manifest.id,
        manifest,
        dataStore: createModDataStore(dirs.dataDir),
        filesDir: dirs.filesDir,
        cacheDir: dirs.cacheDir,
        hostInfo: { folium: { major: 1, minor: 5 }, folia: '0.7.20' },
        emitLog: () => {},
        getPlaybackSnapshot: () => null,
        registerDisposer: () => {},
        registerRpc: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler),
        requestExport: () => Promise.reject(new Error('unused')),
    });
    const activate = require(path.join(PLAYBACK_CONSOLE_DIR, 'index.cjs'));
    activate(api);
    const call = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
    return { dirs, call, handlers };
};

const failureRecord = (id: string, title: string) => ({
    id,
    at: 1_760_000_000_000,
    song: { title, artist: 'Artist', source: 'netease' },
    reason: 'restricted',
    phase: 'play',
    willAutoSkip: true,
});

describe('sample-playback-console main entry', () => {
    it('appends failures to the data log and lists them newest first from the cache', async () => {
        const { dirs, call, handlers } = activatePlaybackConsoleMain();
        expect([...handlers.keys()].sort()).toEqual(['recentFailures', 'recordFailure']);

        await call('recordFailure', failureRecord('a', 'First'));
        await call('recordFailure', failureRecord('b', 'Second'));

        const log = fs.readFileSync(path.join(dirs.filesDir, 'failures.log'), 'utf8').trim().split('\n');
        expect(log.map((line) => JSON.parse(line).id)).toEqual(['a', 'b']);
        expect(fs.existsSync(path.join(dirs.cacheDir, 'recent-failures.json'))).toBe(true);
        expect((await call('recentFailures') as Array<{ id: string }>).map((item) => item.id)).toEqual(['b', 'a']);
    });

    it('rebuilds the cache from the log after the mods panel empties it', async () => {
        const { dirs, call } = activatePlaybackConsoleMain();
        await call('recordFailure', failureRecord('a', 'First'));
        await call('recordFailure', failureRecord('b', 'Second'));

        await clearDirectoryContents(dirs.cacheDir);
        expect(fs.readdirSync(dirs.cacheDir)).toEqual([]);

        expect((await call('recentFailures') as Array<{ id: string }>).map((item) => item.id)).toEqual(['b', 'a']);
        expect(fs.existsSync(path.join(dirs.cacheDir, 'recent-failures.json'))).toBe(true);
        // A record after the rebuild is not listed twice.
        await clearDirectoryContents(dirs.cacheDir);
        await call('recordFailure', failureRecord('c', 'Third'));
        expect((await call('recentFailures') as Array<{ id: string }>).map((item) => item.id)).toEqual(['c', 'b', 'a']);
    });

    it('keeps only the fields it knows from what the renderer sends', async () => {
        const { call } = activatePlaybackConsoleMain();
        await call('recordFailure', { id: 'x', reason: 'bogus', phase: 'later', song: { title: 5, artist: 'A', ref: 'r' }, extra: 'drop me' });
        expect(await call('recentFailures')).toEqual([expect.objectContaining({
            id: 'x',
            reason: 'unknown',
            phase: 'play',
            willAutoSkip: false,
            song: { title: '', artist: 'A', source: null },
        })]);
    });
});

/*
 * A stand-in for the parts of folium the client uses. The playback half follows the contract's
 * types, and getQueue pages the way the host does (centred on the current song without an offset).
 * replaceQueue answers from `replaceAnswers` while it holds any; past them it replaces: the queue takes
 * the songs given, the version moves on, and the mod hears its own change (byThisMod).
 */
const createFakeFolium = (context: 'main' | 'export' = 'main', { minor = 5 } = {}) => {
    const handlers = new Map<string, Array<{ handler: (event: unknown) => void; rank: number }>>();
    const homeTabs: FoliumHomeTabDef[] = [];
    const commands: FoliumCommandDef[] = [];
    const rpcCalls: Array<{ name: string; args: unknown[] }> = [];
    const queue: FoliumSong[] = Array.from({ length: 120 }, (_, index) => ({
        id: String(index), title: `Song ${index}`, artist: 'Artist', album: null, source: 'local', ref: `ref-${index}`,
    }));
    const state = { volume: 0.5, muted: false, loopMode: 'off' as FoliumLoopMode, currentIndex: 70, version: 'v1', kind: 'queue' as FoliumQueueSnapshot['kind'] };
    const RANK: Record<string, number> = { highest: 0, high: 1, normal: 2, low: 3, lowest: 4 };
    const replaceAnswers: FoliumQueueReplaceResult[] = [];

    const emit = <K extends keyof FoliumEventMap>(type: K, payload: FoliumEventMap[K]) => {
        (handlers.get(type) ?? []).forEach(({ handler }) => handler(Object.freeze({ ...payload })));
    };
    const playback: Pick<FoliumPlaybackService, 'getVolume' | 'setVolume' | 'setMuted' | 'getLoopMode' | 'setLoopMode' | 'getQueue' | 'playQueueItem' | 'replaceQueue'> = {
        getVolume: () => ({ volume: state.volume, muted: state.muted }),
        setVolume: vi.fn((volume: number) => {
            state.volume = volume;
            emit('playback.volumeChanged', { volume: state.volume, muted: state.muted });
        }),
        setMuted: vi.fn((muted: boolean) => {
            state.muted = muted;
            emit('playback.volumeChanged', { volume: state.volume, muted: state.muted });
        }),
        getLoopMode: () => state.loopMode,
        setLoopMode: vi.fn((mode: FoliumLoopMode) => {
            state.loopMode = mode;
            emit('playback.loopModeChanged', { mode });
        }),
        getQueue: (options = {}): FoliumQueueSnapshot => {
            const limit = options.limit ?? 500;
            const start = options.offset === undefined
                ? Math.min(Math.max(0, state.currentIndex - Math.floor(limit / 2)), Math.max(0, queue.length - limit))
                : Math.min(Math.max(0, options.offset), queue.length);
            return {
                items: queue.slice(start, start + limit).map((song, position) => ({ song, index: start + position })),
                length: queue.length,
                currentIndex: state.currentIndex,
                kind: state.kind,
                version: state.version,
            };
        },
        playQueueItem: vi.fn(async (index: number, expectedRef?: string) => queue[index]?.ref === expectedRef),
        replaceQueue: vi.fn(async (songs: readonly FoliumSong[], _options: { expectedVersion: string }): Promise<FoliumQueueReplaceResult> => {
            const answer = replaceAnswers.shift();
            if (answer) return answer;
            queue.splice(0, queue.length, ...songs);
            state.version = `v${Number(state.version.slice(1)) + 1}`;
            emit('playback.queueChanged', { length: queue.length, currentIndex: state.currentIndex, version: state.version, byThisMod: true });
            return { status: 'replaced', version: state.version, length: queue.length, currentIndex: state.currentIndex };
        }),
    };
    const folium = {
        modId: 'sample-playback-console',
        host: { folium: { major: 1, minor }, folia: '0.7.20' },
        env: { context },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        registries: {
            homeTabs: { register: (def: FoliumHomeTabDef) => { homeTabs.push(def); return { id: `sample-playback-console:${def.id}`, unregister: () => {} }; } },
            commands: { register: (def: FoliumCommandDef) => { commands.push(def); return { id: `sample-playback-console:${def.id}`, unregister: () => {} }; } },
        },
        events: {
            on: (type: string, handler: (event: unknown) => void, options?: { priority?: string }) => {
                const registration = { handler, rank: RANK[options?.priority ?? 'normal'] };
                handlers.set(type, [...(handlers.get(type) ?? []), registration].sort((left, right) => left.rank - right.rank));
                return () => handlers.set(type, (handlers.get(type) ?? []).filter((entry) => entry !== registration));
            },
        },
        playback,
        ui: { openHomeTab: vi.fn() },
        rpc: {
            call: async (name: string, ...args: unknown[]) => {
                rpcCalls.push({ name, args });
                return name === 'recentFailures' ? [{ ...failureRecord('old', 'Earlier'), at: 1 }] : { logged: true };
            },
        },
    } as unknown as FoliumClientApi;
    return { folium, homeTabs, commands, rpcCalls, emit, playback, state, replaceAnswers, handlerCount: () => [...handlers.values()].reduce((sum, list) => sum + list.length, 0) };
};

// The sample is written for Folium 1.5, which named onChange `subscribe`; the host hands it both.
const panelContext = (locale: string): FoliumPanelContext => ({
    locale,
    getTheme: () => { throw new Error('unused'); },
    onChange: () => () => {},
    subscribe: () => () => {},
}) as unknown as FoliumPanelContext;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sample-playback-console client', () => {
    const loadClient = async () => (await import('../../../dev/folium/sample-playback-console/client.mjs')).default as (folium: FoliumClientApi) => (() => void) | undefined;

    it('registers nothing in the export window', async () => {
        const activate = await loadClient();
        const fake = createFakeFolium('export');
        expect(activate(fake.folium)).toBeUndefined();
        expect(fake.homeTabs).toEqual([]);
        expect(fake.rpcCalls).toEqual([]);
    });

    it('registers the home page and a command that opens it', async () => {
        const activate = await loadClient();
        const fake = createFakeFolium();
        activate(fake.folium);
        expect(fake.homeTabs.map((def) => def.id)).toEqual(['console']);
        await fake.commands[0].run({ values: {} } as never);
        expect(fake.folium.ui.openHomeTab).toHaveBeenCalledWith('console');
    });

    it('shows and drives volume, repeat and the queue, and records failures through rpc', async () => {
        const activate = await loadClient();
        const fake = createFakeFolium();
        const deactivate = activate(fake.folium);
        await flush();
        const container = document.createElement('div');
        document.body.append(container);
        const dispose = fake.homeTabs[0].mount(container, panelContext('en'));

        const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
        expect(slider.value).toBe('50');
        slider.value = '30';
        slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new Event('change'));
        expect(fake.playback.setVolume).toHaveBeenCalledWith(0.3);
        fake.emit('playback.volumeChanged', { volume: 0.8, muted: true });
        expect(slider.value).toBe('80');

        const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((node) => node.textContent === name)!;
        expect(buttonNamed('Off').getAttribute('aria-pressed')).toBe('true');
        buttonNamed('One song').click();
        expect(fake.playback.setLoopMode).toHaveBeenCalledWith('one');
        expect(buttonNamed('One song').getAttribute('aria-pressed')).toBe('true');

        // Centred on the current song: entries 45–94 of 120, with #70 marked current.
        const tracks = () => [...container.querySelectorAll<HTMLButtonElement>('button.track')];
        expect(tracks()).toHaveLength(50);
        expect(tracks()[0].textContent).toContain('Song 45');
        expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Song 70');
        tracks()[3].click();
        await flush();
        expect(fake.playback.playQueueItem).toHaveBeenCalledWith(48, 'ref-48');
        buttonNamed('Next page').click();
        expect(tracks()[0].textContent).toContain('Song 95');
        expect(buttonNamed('Next page').disabled).toBe(true);
        fake.state.currentIndex = 10;
        buttonNamed('Back to current').click();
        expect(tracks()[0].textContent).toContain('Song 0');
        // A redraw keeps keyboard focus on the same entry.
        tracks()[5].focus();
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 10, version: 'v1', byThisMod: false });
        expect((document.activeElement as HTMLElement).dataset.index).toBe('5');

        fake.emit('playback.failed', {
            song: { id: '7', title: 'Locked', artist: 'Someone', album: null, source: 'netease', ref: 'ref-x' },
            reason: 'restricted',
            phase: 'play',
            willAutoSkip: true,
        });
        const record = fake.rpcCalls.find((entry) => entry.name === 'recordFailure')!.args[0];
        expect(JSON.parse(JSON.stringify(record))).toEqual(record);
        expect(record).toMatchObject({ song: { title: 'Locked', artist: 'Someone', source: 'netease' }, reason: 'restricted', phase: 'play', willAutoSkip: true });
        expect(container.textContent).toContain('Locked — Someone');
        // The record loaded from the main entry is listed after this session's.
        expect(container.textContent!.indexOf('Locked')).toBeLessThan(container.textContent!.indexOf('Earlier'));

        const listening = fake.handlerCount();
        (dispose as () => void)();
        expect(fake.handlerCount()).toBe(listening - 4);
        expect(container.childElementCount).toBe(0);
        deactivate?.();
        expect(fake.handlerCount()).toBe(0);
    });
});

// Folium 1.7: "Reverse the queue" hands the whole queue back reversed with replaceQueue, and answers
// each refusal once: the next queueChanged for a passing one, retryAfterMs for the rate limit, a fresh read
// for a stale ref, and none for a stale version (the queue changed: the user decides again). A passing
// reason is waited out for as long as it holds: a refusal for it again waits again.
describe('sample-playback-console client: replaceQueue', () => {
    const loadClient = async () => (await import('../../../dev/folium/sample-playback-console/client.mjs')).default as (folium: FoliumClientApi) => (() => void) | undefined;
    const mountPage = async (minor: number) => {
        const activate = await loadClient();
        const fake = createFakeFolium('main', { minor });
        const deactivate = activate(fake.folium);
        await flush();
        const container = document.createElement('div');
        document.body.append(container);
        const dispose = fake.homeTabs[0].mount(container, panelContext('en')) as () => void;
        const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((node) => node.textContent === name);
        return { fake, container, buttonNamed, close: () => { dispose(); deactivate?.(); container.remove(); } };
    };
    const refusal = (fake: ReturnType<typeof createFakeFolium>, reason: FoliumQueueReplaceRefusal, extra: { index?: number; retryAfterMs?: number } = {}): FoliumQueueReplaceResult => ({
        status: 'refused', reason, version: fake.state.version, index: extra.index ?? null, retryAfterMs: extra.retryAfterMs ?? null,
    });

    it('offers no reversal on a host before Folium 1.7', async () => {
        const { buttonNamed, close } = await mountPage(5);
        expect(buttonNamed('Reverse the queue')).toBeUndefined();
        close();
    });

    it('reads the whole queue under one version and hands it back reversed, trying a blend\'s refusal again on the next queueChanged', async () => {
        const { fake, container, buttonNamed, close } = await mountPage(7);
        const replaceQueue = vi.mocked(fake.playback.replaceQueue);
        fake.replaceAnswers.push(refusal(fake, 'transition'));

        buttonNamed('Reverse the queue')!.click();
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(1);
        const [songs, options] = replaceQueue.mock.calls[0];
        expect(songs.map((song) => song.title)).toEqual(Array.from({ length: 120 }, (_, index) => `Song ${119 - index}`));
        expect(options).toEqual({ expectedVersion: 'v1' });
        expect(container.textContent).toContain('A blend (automix) is under way');

        // The blend ends: the host's queueChanged, not this mod's.
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('The queue is reversed');
        expect(container.textContent).toContain('That was this mod\'s replacement.');
        // Tried once: a later change does not start it again.
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: fake.state.version, byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(2);
        expect(container.textContent).not.toContain('That was this mod\'s replacement.');
        close();
    });

    it('keeps waiting through a blend: a queueChanged mid-blend that is refused again is no reason to give up', async () => {
        const { fake, container, buttonNamed, close } = await mountPage(7);
        const replaceQueue = vi.mocked(fake.playback.replaceQueue);
        fake.replaceAnswers.push(refusal(fake, 'transition'), refusal(fake, 'transition'));

        buttonNamed('Reverse the queue')!.click();
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(1);

        // The arriving song lands in the queue while the blend still runs: tried, refused again.
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('A blend (automix) is under way');
        expect(container.textContent).not.toContain('Still not reversed');

        // The blend ends.
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(3);
        expect(container.textContent).toContain('The queue is reversed');
        close();
    });

    it('waits out the Stage: a queueChanged while the queue is still the Stage\'s is not a try', async () => {
        const { fake, container, buttonNamed, close } = await mountPage(7);
        const replaceQueue = vi.mocked(fake.playback.replaceQueue);
        fake.replaceAnswers.push(refusal(fake, 'stage'));

        buttonNamed('Reverse the queue')!.click();
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('External Stage playback holds the player');

        fake.state.kind = 'stage';
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(1);

        // The Stage lets go: the main queue is back.
        fake.state.kind = 'queue';
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('The queue is reversed');
        close();
    });

    it('refreshes and stops on a stale version, waits out the rate limit once, and reads again for a stale ref', async () => {
        const { fake, container, buttonNamed, close } = await mountPage(7);
        const replaceQueue = vi.mocked(fake.playback.replaceQueue);
        const reverse = buttonNamed('Reverse the queue')!;

        fake.replaceAnswers.push(refusal(fake, 'stale-version'));
        reverse.click();
        await flush();
        expect(container.textContent).toContain('The queue just changed; the list is refreshed.');
        fake.emit('playback.queueChanged', { length: 120, currentIndex: 70, version: 'v1', byThisMod: false });
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(1);

        fake.replaceAnswers.push(refusal(fake, 'rate-limited', { retryAfterMs: 5 }));
        reverse.click();
        await flush();
        expect(container.textContent).toContain('Replaced a moment ago');
        expect(replaceQueue).toHaveBeenCalledTimes(2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(replaceQueue).toHaveBeenCalledTimes(3);
        expect(container.textContent).toContain('The queue is reversed');

        fake.replaceAnswers.push(refusal(fake, 'stale-ref', { index: 3 }));
        reverse.click();
        await flush();
        expect(replaceQueue).toHaveBeenCalledTimes(5);
        // Read again after the refusal: the version the rate limit's retry left.
        expect(replaceQueue.mock.calls[4][1]).toEqual({ expectedVersion: 'v2' });
        expect(container.textContent).toContain('The queue is reversed');
        close();
    });
});

const ACCOUNT_CONSOLE_DIR = path.join(DEV_FOLIUM_DIR, 'sample-account-console');

/*
 * sample-account-console's main entry, activated against the real mod api. The secret store is a
 * stand-in that, the way modSecrets.cjs does before the client declares its keys, reads a key with no
 * value as null and refuses to write one, and tells its
 * subscribers the key of every change; what api.rpc.send pushes is read back from sendToClient.
 */
const activateAccountConsoleMain = ({ declared = true, minor = 7 } = {}) => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-dev-sample-'));
    temporaryDirectories.push(userData);
    const { value: manifest } = validateManifest(JSON.parse(fs.readFileSync(path.join(ACCOUNT_CONSOLE_DIR, 'mod.json'), 'utf8')));
    const dirs = resolveModStorageDirs(userData, manifest.id);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const disposers: Array<() => void> = [];
    const sent: Array<{ name: string; payload: unknown }> = [];
    const logs: string[] = [];
    const values = new Map<string, string>();
    const secretListeners = new Set<(key: string) => void>();
    const check = (key: string) => {
        if (!declared && !values.has(key)) throw new Error(`secret-undeclared:${key}`);
    };
    const secrets = {
        get: async (key: string) => values.get(key) ?? null,
        has: async (key: string) => values.has(key),
        set: async (key: string, value: string | null) => {
            check(key);
            if (value) values.set(key, value);
            else values.delete(key);
            secretListeners.forEach((listener) => listener(key));
        },
        subscribe: (listener: (key: string) => void) => {
            secretListeners.add(listener);
            return () => secretListeners.delete(listener);
        },
    };
    const api = createModApi({
        modId: manifest.id,
        manifest,
        dataStore: createModDataStore(dirs.dataDir),
        filesDir: dirs.filesDir,
        cacheDir: dirs.cacheDir,
        hostInfo: { folium: { major: 1, minor }, folia: '0.7.22' },
        emitLog: (_level: string, message: string) => logs.push(message),
        getPlaybackSnapshot: () => null,
        registerDisposer: (disposer: () => void) => disposers.push(disposer),
        secrets,
        registerRpc: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
        sendToClient: (name: string, json: string) => sent.push({ name, payload: JSON.parse(json) }),
        requestExport: () => Promise.reject(new Error('unused')),
    });
    require(path.join(ACCOUNT_CONSOLE_DIR, 'index.cjs'))(api);
    const call = (name: string, ...args: unknown[]) => handlers.get(name)!(...args);
    const stop = () => disposers.splice(0).reverse().forEach((dispose) => dispose());
    return { call, handlers, sent, logs, secrets, stop };
};

describe('sample-account-console main entry', () => {
    it('reports its state and pushes a pong from inside the ping handler', async () => {
        const main = activateAccountConsoleMain();
        expect([...main.handlers.keys()].sort()).toEqual(['ping', 'status']);
        expect(await main.call('status')).toEqual({ startedAt: expect.any(Number), sent: 0, beats: 0, secret: 'unset' });

        expect(main.call('ping', 'hello')).toEqual({ sent: 1 });
        expect(main.sent).toEqual([{ name: 'pong', payload: { note: 'hello', at: expect.any(Number) } }]);
        main.stop();
    });

    it('tells the client whether the secret field is set, never its value', async () => {
        const main = activateAccountConsoleMain();
        await main.secrets.set('apiKey', 'sk-not-for-the-window');
        await flush();
        await main.secrets.set('other', 'x');
        await main.secrets.set('apiKey', null);
        await flush();

        expect(main.sent.map((message) => message.name)).toEqual(['secretStatus', 'secretStatus']);
        expect(main.sent.map((message) => (message.payload as { status: string }).status)).toEqual(['set', 'unset']);
        expect(JSON.stringify([main.sent, main.logs])).not.toContain('sk-not-for-the-window');
        main.stop();
    });

    it('reads the key as unset before the client registered its section', async () => {
        const main = activateAccountConsoleMain({ declared: false });
        expect(await main.call('status')).toMatchObject({ secret: 'unset' });
        await flush();
        expect(main.logs).toContain('sample-account-console 1.0.0: secret field unset');
        main.stop();
    });

    it('sends a heartbeat every 15 seconds until the mod stops', () => {
        vi.useFakeTimers();
        try {
            const main = activateAccountConsoleMain();
            vi.advanceTimersByTime(30_000);
            expect(main.sent.map((message) => message.payload)).toEqual([
                { count: 1, at: expect.any(Number) },
                { count: 2, at: expect.any(Number) },
            ]);
            main.stop();
            vi.advanceTimersByTime(60_000);
            expect(main.sent).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does nothing on a host older than Folium 1.7', () => {
        const main = activateAccountConsoleMain({ minor: 6 });
        expect(main.handlers.size).toBe(0);
        expect(main.logs).toEqual([expect.stringContaining('needs Folium 1.7')]);
    });
});

/*
 * A stand-in for the parts of folium sample-account-console uses: a settings section handle, secrets
 * that notify by key, rpc.on listeners the test can send to, the account state, the events bus and a
 * platform.raw whose requests the test answers (and that rejects with `aborted` when the signal aborts).
 */
const createAccountConsoleFolium = (context: 'main' | 'export' = 'main') => {
    const sections: FoliumSettingsSectionDef[] = [];
    const homeTabs: FoliumHomeTabDef[] = [];
    const commands: FoliumCommandDef[] = [];
    const rpcListeners = new Map<string, Array<(payload: unknown) => void>>();
    const rpcCalls: Array<{ name: string; args: unknown[]; listening: string[] }> = [];
    const eventHandlers = new Map<string, Array<(event: unknown) => void>>();
    const secretValues = new Map<string, string>();
    const secretListeners = new Set<(key: string) => void>();
    const settingsListeners = new Set<() => void>();
    const requests: Array<{ args: unknown[]; resolve: (value: FoliumPlatformResponse) => void; reject: (error: unknown) => void }> = [];
    let settingsValues: Record<string, unknown> = { range: 'week' };
    let account: FoliumAccountState | null = Object.freeze({
        providerId: 'netease', status: 'signed-in', user: { nickname: 'Listener' }, accountKey: 'key-one-0123456789',
    });
    const platform = {
        describe: vi.fn(() => ({ supported: true, backend: { name: 'backend-lib', version: '1.2.3' } })),
        request: vi.fn((...args: unknown[]) => new Promise<FoliumPlatformResponse>((resolve, reject) => {
            requests.push({ args, resolve, reject });
            (args[3] as { signal?: AbortSignal } | undefined)?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
            });
        })),
    };
    const folium = {
        modId: 'sample-account-console',
        host: { folium: { major: 1, minor: 7 }, folia: '0.7.22' },
        env: { context },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        registries: {
            settingsSections: {
                register: (def: FoliumSettingsSectionDef) => {
                    sections.push(def);
                    return {
                        id: `sample-account-console:${def.id}`,
                        unregister: () => {},
                        settings: {
                            schema: def.settings,
                            get: () => settingsValues,
                            set: () => {},
                            reset: () => {},
                            onChange: (listener: () => void) => {
                                settingsListeners.add(listener);
                                return () => settingsListeners.delete(listener);
                            },
                        },
                    };
                },
            },
            homeTabs: { register: (def: FoliumHomeTabDef) => { homeTabs.push(def); return { id: `sample-account-console:${def.id}`, unregister: () => {} }; } },
            commands: { register: (def: FoliumCommandDef) => { commands.push(def); return { id: `sample-account-console:${def.id}`, unregister: () => {} }; } },
        },
        events: {
            on: (type: string, handler: (event: unknown) => void) => {
                eventHandlers.set(type, [...(eventHandlers.get(type) ?? []), handler]);
                return () => eventHandlers.set(type, (eventHandlers.get(type) ?? []).filter((entry) => entry !== handler));
            },
        },
        secrets: {
            get: async (key: string) => secretValues.get(key) ?? null,
            has: async (key: string) => secretValues.has(key),
            set: async (key: string, value: string | null) => {
                if (value) secretValues.set(key, value);
                else secretValues.delete(key);
                secretListeners.forEach((listener) => listener(key));
            },
            subscribe: (listener: (key: string) => void) => {
                secretListeners.add(listener);
                return () => secretListeners.delete(listener);
            },
        },
        rpc: {
            call: async (name: string, ...args: unknown[]) => {
                rpcCalls.push({ name, args, listening: [...rpcListeners.keys()] });
                return name === 'status' ? { startedAt: 0, sent: 3, beats: 2, secret: 'unset' } : { sent: 4 };
            },
            on: (name: string, listener: (payload: unknown) => void) => {
                rpcListeners.set(name, [...(rpcListeners.get(name) ?? []), listener]);
                return () => rpcListeners.set(name, (rpcListeners.get(name) ?? []).filter((entry) => entry !== listener));
            },
        },
        account: {
            getState: (providerId?: string) => (providerId === undefined || providerId === account?.providerId ? account : null),
        },
        experimental: { 'platform.raw': platform },
        ui: { openHomeTab: vi.fn(), toast: vi.fn() },
    } as unknown as FoliumClientApi;
    return {
        folium,
        sections,
        homeTabs,
        commands,
        rpcCalls,
        requests,
        platform,
        send: (name: string, payload: unknown) => (rpcListeners.get(name) ?? []).forEach((listener) => listener(payload)),
        emit: (type: string, payload: unknown) => (eventHandlers.get(type) ?? []).forEach((handler) => handler(payload)),
        setAccount: (next: FoliumAccountState | null) => { account = next; },
        setSettings: (next: Record<string, unknown>) => {
            settingsValues = next;
            settingsListeners.forEach((listener) => listener());
        },
    };
};

describe('sample-account-console client', () => {
    const loadClient = async () => (await import('../../../dev/folium/sample-account-console/client.mjs')).default as (folium: FoliumClientApi) => (() => void) | undefined;

    it('registers nothing in the export window', async () => {
        const activate = await loadClient();
        const fake = createAccountConsoleFolium('export');
        expect(activate(fake.folium)).toBeUndefined();
        expect([fake.sections, fake.homeTabs, fake.rpcCalls]).toEqual([[], [], []]);
    });

    it('declares a secret field beside an ordinary one, and listens before it asks the main entry', async () => {
        const activate = await loadClient();
        const fake = createAccountConsoleFolium();
        activate(fake.folium);
        expect(fake.sections[0].settings.map((field) => [field.key, field.type])).toEqual([['apiKey', 'secret'], ['range', 'select']]);
        expect(fake.rpcCalls[0]).toEqual({ name: 'status', args: [], listening: ['heartbeat', 'pong', 'secretStatus'] });
        await fake.commands[0].run({ values: {} } as never);
        expect(fake.folium.ui.openHomeTab).toHaveBeenCalledWith('desk');
    });

    it('offers a command without params to the global shortcuts, which pings the main entry and says so', async () => {
        const activate = await loadClient();
        const fake = createAccountConsoleFolium();
        activate(fake.folium);
        const offered = fake.commands.filter((command) => command.globalShortcut === true);
        expect(offered.map((command) => command.id)).toEqual(['ping']);
        expect(offered[0].params ?? []).toEqual([]);
        // The open command stays a palette command only.
        expect(fake.commands.find((command) => command.id === 'open')?.globalShortcut).toBeUndefined();

        document.documentElement.lang = 'en';
        await offered[0].run({ values: {} } as never);
        expect(fake.rpcCalls.at(-1)).toMatchObject({ name: 'ping', args: ['from a global shortcut'] });
        expect(fake.folium.ui.toast).toHaveBeenCalledWith('The main entry sent a pong (4 messages so far)', { type: 'success' });
    });

    it('shows the secret status, the messages, the account and the listening records', async () => {
        const activate = await loadClient();
        const fake = createAccountConsoleFolium();
        const deactivate = activate(fake.folium);
        await flush();
        const container = document.createElement('div');
        document.body.append(container);
        const dispose = fake.homeTabs[0].mount(container, panelContext('en'));
        const text = () => container.textContent ?? '';
        const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((node) => node.textContent === name)!;

        // The secret field: whether it is set, as the client and the main entry read it; never the value.
        expect(text()).toContain('As the client reads itNot set');
        expect(text()).toContain('As the main entry reads itNot set');
        expect(text()).toContain('Keys in settings.get(): range');
        await fake.folium.secrets.set('apiKey', 'sk-hidden');
        await flush();
        fake.send('secretStatus', { status: 'set', at: 1 });
        expect(text()).toContain('As the client reads itSet');
        expect(text()).toContain('As the main entry reads itSet');
        expect(text()).not.toContain('sk-hidden');
        buttonNamed('Clear the key').click();
        await flush();
        expect(text()).toContain('As the client reads itNot set');

        // Messages pushed by the main entry, newest first.
        fake.send('heartbeat', { count: 1, at: 0 });
        expect(text()).toContain('heartbeat {"count":1,"at":0}');
        buttonNamed('Ask the main entry for a message').click();
        expect(fake.rpcCalls.map((entry) => entry.name)).toContain('ping');

        // The selected source's account.
        expect(text()).toContain('Listener');
        expect(text()).toContain('netease · Signed in');
        expect(text()).toContain('accountKey: key-one-…');

        // Listening records, read as the signed-in account through platform.raw.
        expect(text()).toContain('Backend backend-lib 1.2.3');
        buttonNamed('Load').click();
        expect(fake.platform.request).toHaveBeenCalledWith('netease', 'user_record', { type: 1 }, { signal: expect.any(AbortSignal) });
        fake.requests[0].resolve({
            body: { code: 200, weekData: [{ playCount: 12, score: 100, song: { name: 'Song A', ar: [{ name: 'Artist A' }] } }] },
            accountKey: 'key-one-0123456789',
        });
        await flush();
        expect(text()).toContain('Song A — Artist A12 plays');

        // Another account: the records of the old one are dropped.
        fake.setAccount({ providerId: 'netease', status: 'signed-in', user: { nickname: 'Second' }, accountKey: 'key-two-0123456789' });
        fake.emit('account.changed', { providerId: 'netease', status: 'signed-in', user: { nickname: 'Second' }, accountKey: 'key-two-0123456789' });
        expect(text()).not.toContain('Song A');
        expect(text()).toContain('Second');
        expect(text()).toContain('Last account.changed');

        // A request under way when the range changes is aborted and its answer never shown.
        buttonNamed('Load').click();
        fake.setSettings({ range: 'all' });
        await flush();
        expect((fake.requests[1].args[3] as { signal: AbortSignal }).signal.aborted).toBe(true);
        expect(text()).not.toContain('Loading');
        buttonNamed('Load').click();
        expect(fake.requests[2].args[2]).toEqual({ type: 0 });
        fake.requests[2].reject(Object.assign(new Error('not-signed-in'), { code: 'not-signed-in' }));
        await flush();
        expect(text()).toContain('Not signed in to this platform.');

        (dispose as () => void)();
        expect(container.childElementCount).toBe(0);
        deactivate?.();
    });
});

const omniError = (code: string) => Object.assign(new Error(code), { code });

/*
 * A stand-in for the parts of folium sample-omni-console uses. Its folium.omni answers from a catalog of
 * 25 songs at `netease` the way the contract says: frozen DTOs, every song read with a new ref, opaque
 * cursors that keep the first page's length, one resolution per key (`unsupported` for any other
 * source). In the export window every method throws, as the host's do. `stored` backs folium.storage and
 * may be handed to a second stand-in, as a restart keeps the mod's data. On a Folium 1.6 host there is
 * no folium.omni at all.
 */
const createOmniConsoleFolium = ({ context = 'main' as 'main' | 'export', minor = 7, stored = new Map<string, unknown>() } = {}) => {
    const homeTabs: FoliumHomeTabDef[] = [];
    const commands: FoliumCommandDef[] = [];
    const events: string[] = [];
    const catalog = Array.from({ length: 25 }, (_, index) => ({ id: String(100 + index), title: `Track ${index}` }));
    let refCount = 0;
    const song = (entry: { id: string; title: string }): FoliumSong => Object.freeze({
        id: entry.id, title: entry.title, artist: 'Artist', album: 'The Album', source: 'netease', ref: `song-${(refCount += 1)}`,
    });
    const providers: readonly FoliumOmniProviderInfo[] = Object.freeze([
        Object.freeze({
            providerId: 'netease', displayName: 'NetEase Cloud Music', shortName: 'NetEase', origin: 'host' as const, selected: true, configured: true,
            supports: Object.freeze({ search: true, resolve: true, lyrics: true, albums: true, artists: true }),
        }),
        Object.freeze({
            providerId: 'folium.radio.fm', displayName: 'Radio', shortName: 'Radio', origin: 'mod' as const, selected: false, configured: true,
            supports: Object.freeze({ search: true, resolve: false, lyrics: false, albums: false, artists: false }),
        }),
    ]);
    const cursors = new Map<string, { offset: number; limit: number }>();
    let cursorCount = 0;
    const inExport = () => {
        if (context !== 'main') throw new Error('omni-unavailable-in-export-context');
    };
    const omni = {
        listProviders: vi.fn(() => {
            inExport();
            return providers;
        }),
        searchSongs: vi.fn(async (_query: string, options: { providerId?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<FoliumOmniPage<FoliumSong>> => {
            inExport();
            let offset = 0;
            let limit = options.limit ?? 30;
            if (options.cursor !== undefined) {
                const kept = cursors.get(options.cursor);
                if (!kept) throw omniError('stale-ref');
                ({ offset, limit } = kept);
            }
            const items = catalog.slice(offset, offset + limit).map(song);
            let nextCursor: string | null = null;
            if (offset + items.length < catalog.length) {
                cursorCount += 1;
                nextCursor = `cursor-${cursorCount}`;
                cursors.set(nextCursor, { offset: offset + items.length, limit });
            }
            return Object.freeze({ items: Object.freeze(items), nextCursor, total: catalog.length });
        }),
        resolveSongs: vi.fn(async (keys: readonly FoliumSongKey[]): Promise<readonly FoliumSongResolution[]> => {
            inExport();
            return Object.freeze(keys.map((key): FoliumSongResolution => {
                if (key.source !== 'netease') return Object.freeze({ status: 'unsupported' });
                const entry = catalog.find((candidate) => candidate.id === key.id);
                return Object.freeze(entry ? { status: 'found', song: song(entry) } : { status: 'not-found' });
            }));
        }),
        describeSong: vi.fn((target: FoliumSong) => {
            inExport();
            return Object.freeze({ durationMs: 215_000, coverUrl: null, availability: 'restricted' as const, pageUrl: `https://music.example/song/${target.id}` });
        }),
        getLyrics: vi.fn(async () => {
            inExport();
            const lines = Array.from({ length: 9 }, (_, index) => Object.freeze({ fullText: `Line ${index}`, startTime: index, endTime: index + 1, words: [], isChorus: index === 2 }));
            return Object.freeze({ lines: Object.freeze(lines), isWordByWord: true, isPureMusic: false });
        }),
        getAlbum: vi.fn(async () => {
            inExport();
            return Object.freeze({
                kind: 'album' as const, source: 'netease', id: '77', name: 'The Album', artist: 'Artist',
                coverUrl: null, description: null, trackCount: null, albumCount: null, publishedAt: null, ref: 'collection-1',
            });
        }),
        getTracks: vi.fn(async (_album: unknown, options: { limit?: number } = {}): Promise<FoliumOmniPage<FoliumSong>> => {
            inExport();
            return Object.freeze({ items: Object.freeze(catalog.slice(0, options.limit ?? 50).map(song)), nextCursor: 'cursor-album', total: 12 });
        }),
        getArtists: vi.fn(async () => { inExport(); return Object.freeze([]); }),
        resolveCollection: vi.fn(async () => { inExport(); return null; }),
        getArtistAlbums: vi.fn(async () => { inExport(); return Object.freeze({ items: Object.freeze([]), nextCursor: null, total: null }); }),
    };
    const storage = {
        get: vi.fn(async (key: string) => stored.get(key)),
        set: vi.fn(async (key: string, value: unknown) => { stored.set(key, JSON.parse(JSON.stringify(value))); }),
    };
    let playing: FoliumSong | null = null;
    const playback = {
        getState: () => ({ song: playing, state: 'playing', position: 0, duration: 0, liked: false, canLike: false }),
        enqueue: vi.fn(() => true),
    };
    const eventHandlers = new Map<string, Array<() => void>>();
    const folium = {
        modId: 'sample-omni-console',
        host: { folium: { major: 1, minor }, folia: '0.7.22' },
        env: { context },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        registries: {
            homeTabs: { register: (def: FoliumHomeTabDef) => { homeTabs.push(def); return { id: `sample-omni-console:${def.id}`, unregister: () => {} }; } },
            commands: { register: (def: FoliumCommandDef) => { commands.push(def); return { id: `sample-omni-console:${def.id}`, unregister: () => {} }; } },
        },
        events: {
            on: (type: string, handler: () => void) => {
                events.push(type);
                eventHandlers.set(type, [...(eventHandlers.get(type) ?? []), handler]);
                return () => {};
            },
        },
        storage,
        playback,
        ui: { openHomeTab: vi.fn() },
        ...(minor >= 7 ? { omni } : {}),
    } as unknown as FoliumClientApi;
    return {
        folium,
        omni,
        storage,
        playback,
        stored,
        cursors,
        homeTabs,
        commands,
        events,
        setPlaying: (next: FoliumSong | null) => { playing = next; },
        emit: (type: string) => (eventHandlers.get(type) ?? []).forEach((handler) => handler()),
    };
};

describe('sample-omni-console client', () => {
    const loadClient = async () => (await import('../../../dev/folium/sample-omni-console/client.mjs')).default as (folium: FoliumClientApi) => (() => void) | undefined;

    /* Mounts the home page; `text`, `buttonsNamed` and `type` read and drive it. */
    const mountConsole = (fake: ReturnType<typeof createOmniConsoleFolium>) => {
        const container = document.createElement('div');
        document.body.append(container);
        const dispose = fake.homeTabs[0].mount(container, panelContext('en')) as () => void;
        const buttonsNamed = (name: string) => [...container.querySelectorAll('button')].filter((node) => node.textContent === name);
        const type = (label: string, value: string) => {
            const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
            input.value = value;
        };
        return { container, dispose, text: () => container.textContent ?? '', buttonsNamed, type };
    };

    it('does nothing on a host older than Folium 1.7', async () => {
        const activate = await loadClient();
        const fake = createOmniConsoleFolium({ minor: 6 });
        expect((fake.folium as unknown as { omni?: unknown }).omni).toBeUndefined();
        expect(activate(fake.folium)).toBeUndefined();
        expect([fake.homeTabs, fake.commands, fake.events]).toEqual([[], [], []]);
        expect(fake.storage.get).not.toHaveBeenCalled();
        expect(fake.folium.log.warn).toHaveBeenCalledWith(expect.stringContaining('needs Folium 1.7'));
    });

    it('calls nothing of folium.omni in the export window', async () => {
        const activate = await loadClient();
        const fake = createOmniConsoleFolium({ context: 'export' });
        expect(activate(fake.folium)).toBeUndefined();
        expect([fake.homeTabs, fake.commands, fake.events]).toEqual([[], [], []]);
        for (const method of Object.values(fake.omni)) expect(method).not.toHaveBeenCalled();
        expect(fake.storage.get).not.toHaveBeenCalled();
    });

    it('registers the home page and a command that opens it', async () => {
        const activate = await loadClient();
        const fake = createOmniConsoleFolium();
        activate(fake.folium);
        expect(fake.homeTabs.map((def) => def.id)).toEqual(['console']);
        await fake.commands[0].run({ values: {} } as never);
        expect(fake.folium.ui.openHomeTab).toHaveBeenCalledWith('console');
    });

    it('lists the sources, searches page by page, describes a song with its lyrics and album, and saves its key', async () => {
        const activate = await loadClient();
        const fake = createOmniConsoleFolium();
        const deactivate = activate(fake.folium);
        // Another ref of the first song, as the queue would hand it out: the same song all the same.
        fake.setPlaying({ id: '100', title: 'Track 0', artist: 'Artist', album: 'The Album', source: 'netease', ref: 'queue-ref' });
        const page = mountConsole(fake);
        await flush();

        // The sources, with where they come from and what they answer.
        expect(page.text()).toContain('NetEase Cloud Music');
        expect(page.text()).toContain('folium.radio.fm');
        expect(page.text()).toContain('from a mod');
        expect(page.container.querySelector('.off')?.textContent).toBe('resolve');

        // The first page sets the page length; the next one passes only the cursor.
        page.type('Search words', '  night  ');
        page.buttonsNamed('Search')[0].click();
        await flush();
        expect(fake.omni.searchSongs).toHaveBeenLastCalledWith('night', { limit: 10, signal: expect.any(AbortSignal) });
        expect(page.buttonsNamed('Details')).toHaveLength(10);
        expect(page.text()).toContain('10 of 25 read');
        page.buttonsNamed('30')[0].click();
        page.buttonsNamed('Next page')[0].click();
        await flush();
        expect(fake.omni.searchSongs).toHaveBeenLastCalledWith('night', { cursor: 'cursor-1', signal: expect.any(AbortSignal) });
        expect(page.buttonsNamed('Details')).toHaveLength(20);
        page.buttonsNamed('Next page')[0].click();
        await flush();
        expect(page.buttonsNamed('Details')).toHaveLength(25);
        expect(page.buttonsNamed('Next page')[0].disabled).toBe(true);

        // Now playing is told by source and id: the queue's ref of that song is another one.
        const rows = [...page.container.querySelectorAll('li')].filter((row) => row.textContent?.includes('Track '));
        expect(rows[0].textContent).toContain('Now playing');
        expect(rows[1].textContent).not.toContain('Now playing');

        // A fixed source goes in as providerId; the new search takes the page length now chosen.
        page.buttonsNamed('NetEase')[0].click();
        page.buttonsNamed('Search')[0].click();
        await flush();
        expect(fake.omni.searchSongs).toHaveBeenLastCalledWith('night', { providerId: 'netease', limit: 30, signal: expect.any(AbortSignal) });
        expect(page.buttonsNamed('Details')).toHaveLength(25);

        // A cursor that no longer resolves ends the list: search again.
        page.buttonsNamed('10')[0].click();
        page.buttonsNamed('Search')[0].click();
        await flush();
        fake.cursors.clear();
        page.buttonsNamed('Next page')[0].click();
        await flush();
        expect(page.text()).toContain('It expired (a cursor or a ref); read it again.');
        expect(page.buttonsNamed('Details')).toHaveLength(10);
        expect(page.buttonsNamed('Next page')[0].disabled).toBe(true);

        // Details: describeSong, then the first lines of the lyrics; chorus lines marked.
        const first = fake.omni.searchSongs.mock.results.at(-2)!;
        const firstSong = (await first.value as FoliumOmniPage<FoliumSong>).items[0];
        page.buttonsNamed('Details')[0].click();
        await flush();
        expect(fake.omni.describeSong).toHaveBeenLastCalledWith(firstSong);
        expect(fake.omni.getLyrics).toHaveBeenLastCalledWith(firstSong, { signal: expect.any(AbortSignal) });
        expect(page.text()).toContain('Duration: 3:35');
        expect(page.text()).toContain('Key netease:100');
        expect(page.text()).toContain('9 lines, word by word');
        expect(page.text()).toContain('♪ Line 2');
        expect(page.text()).toContain('Line 5');
        expect(page.text()).not.toContain('Line 6');

        // The album, then the first page of its songs.
        page.buttonsNamed('Album songs (first page)')[0].click();
        await flush();
        expect(fake.omni.getAlbum).toHaveBeenCalledWith(firstSong, { signal: expect.any(AbortSignal) });
        expect(fake.omni.getTracks).toHaveBeenCalledWith(expect.objectContaining({ ref: 'collection-1' }), { limit: 10, signal: expect.any(AbortSignal) });
        expect(page.text()).toContain('Key netease:album:77');
        expect(page.text()).toContain('First 10 of 12; nextCursor reads on');

        // Adding to the queue hands the host the song as it came.
        page.buttonsNamed('Add to queue')[0].click();
        expect(fake.playback.enqueue).toHaveBeenCalledWith(firstSong);

        // Saving a key keeps { source, id } and the names, never the ref.
        page.buttonsNamed('Save key')[0].click();
        await flush();
        expect(fake.stored.get('savedKeys')).toEqual([{ source: 'netease', id: '100', title: 'Track 0', artist: 'Artist' }]);
        expect(JSON.stringify(fake.stored.get('savedKeys'))).not.toContain('song-');
        expect(page.buttonsNamed('Saved')[0].disabled).toBe(true);
        // The song in hand is its own resolution: nothing was asked.
        expect(fake.omni.resolveSongs).not.toHaveBeenCalled();

        page.dispose();
        expect(page.container.childElementCount).toBe(0);
        deactivate?.();
    });

    it('resolves the keys saved before a restart when the page opens, and keeps the ones it cannot look up now', async () => {
        const activate = await loadClient();
        const stored = new Map<string, unknown>([['savedKeys', [
            { source: 'netease', id: '101', title: 'Track 1', artist: 'Artist' },
            { source: 'folium.gone.fm', id: 'x', title: 'Gone', artist: '' },
            { source: 'netease', id: '999', title: 'Missing', artist: '' },
            { title: 'not a key' },
        ]]]);
        const fake = createOmniConsoleFolium({ stored });
        const deactivate = activate(fake.folium);
        await flush();
        // Only what is shown is resolved: nothing before the page opens.
        expect(fake.omni.resolveSongs).not.toHaveBeenCalled();

        const page = mountConsole(fake);
        await flush();
        expect(fake.omni.resolveSongs).toHaveBeenCalledTimes(1);
        expect(fake.omni.resolveSongs).toHaveBeenCalledWith(
            [{ source: 'netease', id: '101' }, { source: 'folium.gone.fm', id: 'x' }, { source: 'netease', id: '999' }],
            { signal: expect.any(AbortSignal) },
        );
        expect(page.text()).toContain('Track 1 — Artist');
        expect(page.text()).toContain('Gone · This host cannot look it up now');
        expect(page.text()).toContain('Missing · The source answered: no such song.');
        // The key the host cannot look up now is kept.
        expect(fake.storage.set).not.toHaveBeenCalled();

        // The resolved song plays like any other: details and the queue take it.
        page.buttonsNamed('Details')[0].click();
        await flush();
        expect(page.text()).toContain('Key netease:101');
        page.buttonsNamed('Add to queue')[0].click();
        expect(fake.playback.enqueue).toHaveBeenCalledWith(expect.objectContaining({ source: 'netease', id: '101' }));

        // Leaving the page and coming back does not resolve them again; "Resolve again" does.
        page.dispose();
        const again = mountConsole(fake);
        await flush();
        expect(fake.omni.resolveSongs).toHaveBeenCalledTimes(1);
        again.buttonsNamed('Resolve again')[0].click();
        await flush();
        expect(fake.omni.resolveSongs).toHaveBeenCalledTimes(2);

        // A key typed in: an empty source is the selected one; another source is unsupported here.
        again.type('Song id', '105');
        again.buttonsNamed('Resolve')[0].click();
        await flush();
        expect(fake.omni.resolveSongs).toHaveBeenLastCalledWith([{ source: 'netease', id: '105' }], { signal: expect.any(AbortSignal) });
        expect(again.text()).toContain('Found: netease:105');
        again.type('Source id (empty: the selected one)', 'local');
        again.buttonsNamed('Resolve')[0].click();
        await flush();
        expect(again.text()).toContain('local:105 · This host cannot look it up now');

        // Removing a key forgets it in storage.
        again.buttonsNamed('Remove')[1].click();
        await flush();
        expect((fake.stored.get('savedKeys') as FoliumSongKey[]).map((key) => key.id)).toEqual(['101', '999']);

        again.dispose();
        deactivate?.();
    });
});
