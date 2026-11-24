import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    IPC, MAIN_WINDOW, cleanHarness, clearModRecords, confirmMod, dialogAnswer, dialogs, handlers, harness, hostStore,
    invoke, launch, modRecord, persisted, resetHarness, sentToWindow, setSwitch, sourceManifest, stateOf, writeMod,
} from './loaderHarness';
import { FROM_MAIN_WINDOW_SUBFRAME, FROM_OTHER_WINDOW } from './mainWindowFake';

// test/unit/mod-system/folium2Loader.test.ts
// Folium 2.0 S2 in the main-process loader (dev/folium/folium-2-plan.md §5): the built-in tier and an empty
// built-in folder, a load that reloads only what changed, the source states (enabled / only for matching /
// disabled) with the main entry of a matching-only source started at load like an enabled one, the unload order and the
// moments before an unload or a quit, and the main-window-only IPC.

beforeEach(() => {
    resetHarness();
    clearModRecords();
    sentToWindow.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
});

const userMod = (id: string, extra: Record<string, unknown> = {}, options: { main?: boolean | string } = { main: true }) => {
    const directory = writeMod('user', { id, ...extra }, options);
    confirmMod(directory, id);
    return directory;
};

describe('an empty or missing built-in folder (gate 2)', () => {
    // What a load gives with no built-in folder: the rows as Folium 1.9 drew them.
    const snapshot = () => {
        userMod('alpha');
        writeMod('user', { id: 'beta' });
        const system = launch();
        return system.listMods().map(({ id, status, enabled, clientUrl, signature, tier, kind, sources }) => (
            { id, status, enabled, clientUrl: clientUrl?.replace(/\?v=.*/, ''), signature: signature.status, tier, kind, sources }
        ));
    };

    it('loads the mods of the user folder as before when dist-mods/ does not exist', () => {
        expect(fs.existsSync(harness().builtinDir)).toBe(false);
        expect(snapshot()).toEqual([
            { id: 'alpha', status: 'loaded', enabled: true, clientUrl: 'folia-mod://alpha/client.mjs', signature: 'unsigned', tier: 'user', kind: 'standard', sources: [] },
            { id: 'beta', status: 'disabled', enabled: false, clientUrl: undefined, signature: 'unsigned', tier: 'user', kind: 'standard', sources: [] },
        ]);
        expect(modRecord('alpha')?.activations).toBe(1);
    });

    it('loads the same when dist-mods/ is there and empty', () => {
        fs.mkdirSync(harness().builtinDir, { recursive: true });
        expect(snapshot().map(({ id, status }) => [id, status])).toEqual([['alpha', 'loaded'], ['beta', 'disabled']]);
    });

    it('switches nothing on with the master switch off, and asks the same start question', () => {
        userMod('alpha');
        const system = launch({ switchOn: false });
        expect(system.listMods()).toEqual([]);
        expect(system.hasRunningMods()).toBe(false);
    });

    it('still lists the carried short ids as enabled host sources, and changes nothing about them', () => {
        const system = launch();
        const { states, sources } = system.listSourceStates();
        expect(Object.values(states).every((state) => state === 'enabled')).toBe(true);
        expect(sources.map((source) => source.sourceId)).toEqual(
            ['netease', 'kugou', 'qq', 'bodian', 'qishui', 'ytm', 'spotify', 'appleMusic', 'fnmusic', 'lxmusic'],
        );
        expect(sources.every((source) => source.modId === null)).toBe(true);
    });
});

describe('the built-in tier', () => {
    it('runs without the master switch, without a confirmation, with no digest and no signature check', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch({ switchOn: false });
        expect(stateOf(system, 'netease')).toMatchObject({ status: 'loaded', tier: 'builtin', kind: 'source', signature: { status: 'builtin' } });
        expect(stateOf(system, 'netease')!.clientUrl).toMatch(/^folia-mod:\/\/netease\/client\.mjs\?v=builtin/);
        expect(dialogs).toEqual([]);
        expect(modRecord('netease')?.activations).toBe(1);
    });

    it('claims its short ids through the trusted table; a mod not in the table gets third-party ids', () => {
        writeMod('builtin', sourceManifest('qq', [{ id: 'qq', keepForMatching: true }]));
        writeMod('builtin', sourceManifest('extra-source', ['radio']));
        const system = launch();
        expect(stateOf(system, 'qq')!.sources).toEqual([expect.objectContaining({ id: 'qq', keepForMatching: true, takeover: false })]);
        expect(stateOf(system, 'extra-source')!.sources).toEqual([expect.objectContaining({ id: 'folium.extra-source.radio' })]);
    });

    it('starts a source its manifest marks offByDefault as disabled, until it is switched on', async () => {
        writeMod('builtin', sourceManifest('lxmusic', [{ id: 'lxmusic', offByDefault: true, enableNotice: { en: 'Runs scripts you import.' } }]), { main: true });
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch();
        const rowOf = (id: string) => system.listSourceStates().sources.find((source: { sourceId: string }) => source.sourceId === id);
        expect(rowOf('lxmusic')).toMatchObject({ state: 'disabled', loaded: false, enableNotice: { en: 'Runs scripts you import.' } });
        expect(system.listSourceStates().states.lxmusic).toBe('disabled');
        expect(rowOf('netease')).toMatchObject({ state: 'enabled', loaded: true, enableNotice: null });
        // Nothing of it ran: no main entry, no client.
        expect(modRecord('lxmusic')?.activations ?? 0).toBe(0);
        expect(stateOf(system, 'lxmusic')!.sources).toEqual([expect.objectContaining({ id: 'lxmusic', state: 'disabled' })]);

        expect(await system.setSourceState('lxmusic', 'enabled')).toMatchObject({ ok: true });
        expect(rowOf('lxmusic')).toMatchObject({ state: 'enabled', loaded: true });
        expect(modRecord('lxmusic')?.activations).toBe(1);
        expect(await system.setSourceState('lxmusic', 'disabled')).toMatchObject({ ok: true });
        expect(rowOf('lxmusic')).toMatchObject({ state: 'disabled', loaded: false });
    });

    it('reads offByDefault from a built-in copy only: a third-party source starts enabled whatever it says', () => {
        writeMod('builtin', sourceManifest('extra-source', [{ id: 'radio', offByDefault: true }]));
        const system = launch();
        expect(system.listSourceStates().states['folium.extra-source.radio']).toBe('enabled');
    });

    it('is switched off and on alone, with no dialog and the master switch off', async () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch({ switchOn: false });
        expect(await system.setModEnabled('netease', false)).toMatchObject({ ok: true });
        expect(stateOf(system, 'netease')).toMatchObject({ status: 'disabled', enabled: false });
        expect(modRecord('netease')).toMatchObject({ activations: 1, deactivations: 1 });
        expect(await system.setModEnabled('netease', true)).toMatchObject({ ok: true });
        expect(stateOf(system, 'netease')).toMatchObject({ status: 'loaded', enabled: true });
        expect(dialogs).toEqual([]);
        // The record is the built-in one, not the digest-bound approval of a user mod.
        expect(persisted.get('mods.builtin.netease')).toMatchObject({ enabled: true });
        expect(persisted.has('mods.enabled.netease')).toBe(false);
    });

    it('is not counted by "without mods this time" nor by the stuck-window question', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        userMod('alpha');
        const system = launch();
        system.skipForThisRun();
        expect(stateOf(system, 'netease')!.status).toBe('loaded');
        expect(stateOf(system, 'alpha')!.status).toBe('skipped');
        expect(modRecord('netease')?.activations).toBe(1);
        expect(system.hasRunningMods()).toBe(false);
    });

    it('does not make the start question come up when it is the only mod to run', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        // A start note left by an earlier start that never ended.
        fs.mkdirSync(harness().userData, { recursive: true });
        fs.writeFileSync(path.join(harness().userData, 'mod-start-note.json'), JSON.stringify({ startedAt: '2026-11-14T00:00:00.000Z' }));
        const system = launch({ load: false });
        const before = dialogs.length;
        system.start();
        expect(dialogs.length).toBe(before);
        expect(stateOf(system, 'netease')!.status).toBe('loaded');
        // No mod of the user's folders ran, so no new note went down.
        expect(fs.existsSync(path.join(harness().userData, 'mod-start-note.json'))).toBe(false);
    });

    it('starts before the window with startSources, and the full start keeps it running', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        userMod('alpha');
        const system = launch({ load: false });
        system.startSources();
        expect(stateOf(system, 'netease')!.status).toBe('loaded');
        expect(stateOf(system, 'alpha')).toBeUndefined();
        system.start();
        expect(stateOf(system, 'alpha')!.status).toBe('loaded');
        expect(modRecord('netease')?.activations).toBe(1);
    });

    it('is never handed to the export window', () => {
        writeMod('builtin', sourceManifest('netease', ['netease']));
        userMod('alpha', {}, { main: false });
        const system = launch();
        expect(system.listClientDescriptors().map((mod) => mod.id)).toEqual(['alpha']);
    });
});

describe('a load reloads only what changed (gate 4)', () => {
    it('keeps every other main entry running when a mod is enabled, disabled or installed', async () => {
        userMod('alpha');
        const betaDirectory = writeMod('user', { id: 'beta' }, { main: true });
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch();
        expect(modRecord('alpha')?.activations).toBe(1);

        dialogAnswer.response = 1;
        expect(await system.setModEnabled('beta', true)).toMatchObject({ ok: true });
        expect(modRecord('beta')?.activations).toBe(1);
        expect(modRecord('alpha')).toMatchObject({ activations: 1, deactivations: 0 });
        expect(modRecord('netease')).toMatchObject({ activations: 1, deactivations: 0 });

        expect(await system.setModEnabled('beta', false)).toMatchObject({ ok: true });
        expect(modRecord('beta')).toMatchObject({ activations: 1, deactivations: 1 });
        expect(modRecord('alpha')).toMatchObject({ activations: 1, deactivations: 0 });

        // A new mod dropped in and reloaded through the differential path (an install ends with it).
        userMod('gamma');
        await system.reloadChanged();
        expect(modRecord('gamma')?.activations).toBe(1);
        expect(modRecord('alpha')).toMatchObject({ activations: 1, deactivations: 0 });
        expect(fs.existsSync(betaDirectory)).toBe(true);
    });

    it('reloads a mod whose files changed, and the mods that depend on it', async () => {
        const baseDirectory = userMod('base');
        userMod('dependent', { depends: ['base'] });
        userMod('other');
        const system = launch();
        fs.appendFileSync(path.join(baseDirectory, 'client.mjs'), '// edited\n');
        // A user-folder edit revokes the approval; confirm the new files.
        confirmMod(baseDirectory, 'base');
        await system.reloadChanged();
        expect(modRecord('base')?.activations).toBe(2);
        expect(modRecord('dependent')?.activations).toBe(2);
        expect(modRecord('other')?.activations).toBe(1);
    });

    it('keeps an unchanged source mod through the panel\'s full reload and the master switch, which restart ordinary mods', () => {
        userMod('alpha');
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        const system = launch();
        system.loadAll();
        expect(modRecord('alpha')?.activations).toBe(2);
        expect(modRecord('netease')?.activations).toBe(1);
        setSwitch(system, false);
        system.loadAll();
        expect(stateOf(system, 'alpha')).toBeUndefined();
        expect(modRecord('netease')).toMatchObject({ activations: 1, deactivations: 0 });
    });

    it('unloads ordinary mods before source mods', () => {
        const order: string[] = [];
        (globalThis as { __s2Order?: string[] }).__s2Order = order;
        const main = `'use strict';
module.exports = function activate(api) { return () => globalThis.__s2Order.push(api.manifest.id); };`;
        writeMod('builtin', sourceManifest('aaa-source', ['radio']), { main });
        const directory = writeMod('user', { id: 'zzz-plain' }, { main });
        confirmMod(directory, 'zzz-plain');
        const system = launch();
        system.dispose();
        expect(order).toEqual(['zzz-plain', 'aaa-source']);
        delete (globalThis as { __s2Order?: string[] }).__s2Order;
    });
});

describe('source states (plan §5.3)', () => {
    const matchingMain = `'use strict';
module.exports = function activate(api) {
    const record = (globalThis.__s2Mods ??= {})[api.manifest.id] ??= { activations: 0, deactivations: 0 };
    record.activations += 1;
    api.rpc.handle('match', (title) => ({ matched: title }));
};`;

    it('reads no record as enabled, and does not load a disabled source at all', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        const system = launch();
        expect(stateOf(system, 'qq')!.sources[0]!.state).toBe('enabled');
        expect(await system.setSourceState('qq', 'disabled')).toMatchObject({ ok: true });
        expect(stateOf(system, 'qq')).toMatchObject({ status: 'disabled', sourcesOff: true, enabled: true, clientUrl: null });
        expect(modRecord('qq')).toMatchObject({ activations: 1, deactivations: 1 });
        expect(persisted.get('mods.sourceStates')).toEqual({ qq: 'disabled' });
        // Back on, without restarting the app.
        expect(await system.setSourceState('qq', 'enabled')).toMatchObject({ ok: true });
        expect(stateOf(system, 'qq')!.status).toBe('loaded');
        expect(modRecord('qq')?.activations).toBe(2);
    });

    it('starts a matching-only source\'s main entry at load, like an enabled one', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: matchingMain });
        persisted.set('mods.sourceStates', { qq: 'matching' });
        const system = launch();
        expect(stateOf(system, 'qq')).toMatchObject({ status: 'loaded', mainState: 'ready' });
        expect(stateOf(system, 'qq')!.clientUrl).toMatch(/^folia-mod:\/\/qq\//);
        expect(modRecord('qq')?.activations).toBe(1);
        expect(system.listSourceStates().sources.find((source) => source.sourceId === 'qq')).toMatchObject({ mainState: 'ready' });

        expect(await invoke(IPC.rpc, 'qq', 'match', ['song'])).toEqual({ ok: true, result: { matched: 'song' } });
        expect(modRecord('qq')?.activations).toBe(1);
    });

    it('switches among the three states without touching another source or mod', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: matchingMain });
        writeMod('builtin', sourceManifest('netease', ['netease']), { main: true });
        userMod('alpha');
        const system = launch();
        expect(modRecord('qq')?.activations).toBe(1);
        // Enabled and matching only run the same copy: switching between them does not restart it.
        await system.setSourceState('qq', 'matching');
        expect(stateOf(system, 'qq')!.mainState).toBe('ready');
        expect(modRecord('qq')?.activations).toBe(1);
        await system.setSourceState('qq', 'disabled');
        expect(stateOf(system, 'qq')!.status).toBe('disabled');
        await system.setSourceState('qq', 'matching');
        expect(modRecord('qq')?.activations).toBe(2);
        await system.setSourceState('qq', 'enabled');
        expect(stateOf(system, 'qq')!.mainState).toBe('ready');
        expect(modRecord('qq')?.activations).toBe(2);
        expect(modRecord('netease')).toMatchObject({ activations: 1, deactivations: 0 });
        expect(modRecord('alpha')).toMatchObject({ activations: 1, deactivations: 0 });
    });

    it('switches a source the host still registers itself, and refuses unknown ids and states', async () => {
        const system = launch();
        expect(await system.setSourceState('netease', 'matching')).toMatchObject({ ok: true, states: expect.objectContaining({ netease: 'matching' }) });
        expect(await system.setSourceState('nope', 'disabled')).toEqual({ ok: false, error: 'source-not-found' });
        expect(await system.setSourceState('netease', 'off')).toEqual({ ok: false, error: 'unknown-source-state:off' });
        // The window hears the change.
        expect(sentToWindow.some(([channel, payload]) => channel === IPC.fSourceStatesChanged
            && (payload as { states: Record<string, string> }).states.netease === 'matching')).toBe(true);
    });

    it('waits for a source\'s onBeforeUnload before it stops, and for its onBeforeQuit at the quit', async () => {
        const seen: string[] = [];
        (globalThis as { __s2Seen?: string[] }).__s2Seen = seen;
        writeMod('builtin', sourceManifest('ytm', ['ytm']), {
            main: `'use strict';
module.exports = function activate(api) {
    api.onBeforeUnload(() => new Promise((resolve) => setTimeout(() => { globalThis.__s2Seen.push('before-unload'); resolve(); }, 20)));
    api.onBeforeQuit(async () => { globalThis.__s2Seen.push('before-quit'); });
    return () => globalThis.__s2Seen.push('disposed');
};`,
        });
        const system = launch();
        const quitting = system.prepareQuit();
        expect(quitting).not.toBeNull();
        await quitting;
        expect(seen).toEqual(['before-quit']);
        await system.setSourceState('ytm', 'disabled');
        expect(seen).toEqual(['before-quit', 'before-unload', 'disposed']);
        delete (globalThis as { __s2Seen?: string[] }).__s2Seen;
    });

    it('describes and clears one source\'s data, signed out and started again', async () => {
        writeMod('builtin', sourceManifest('kugou', ['kugou']), { main: true });
        hostStore.set('KUGOU_API_SESSION_V2', 'sealed');
        hostStore.set('OTHER_KEY', 'kept');
        const dataDir = path.join(harness().userData, 'mods-data', 'kugou');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'secrets.json'), '{}');
        const system = launch();
        expect(system.describeSourceData('kugou')).toMatchObject({
            ok: true, modId: 'kugou', storeKeys: ['KUGOU_API_SESSION_V2', 'KUGOU_API_SESSION_V1'],
            pageStorePrefixes: ['online_provider:kugou:', 'online_provider_kugou_'],
        });
        expect(await system.clearSourceData('kugou')).toMatchObject({ ok: true });
        expect(hostStore.has('KUGOU_API_SESSION_V2')).toBe(false);
        expect(hostStore.get('OTHER_KEY')).toBe('kept');
        expect(fs.existsSync(dataDir)).toBe(false);
        expect(stateOf(system, 'kugou')!.status).toBe('loaded');
        expect(modRecord('kugou')).toMatchObject({ activations: 2, deactivations: 1 });
        // A source the host still registers itself is not cleared here: its platform code holds the sign-in.
        expect(await system.clearSourceData('qq')).toEqual({ ok: false, error: 'source-not-a-mod' });
    });
});

describe('the disk use of one source (plan §5.3)', () => {
    const write = (file: string, bytes: number) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.alloc(bytes));
    };

    it('counts what its clear data removes: mod folders, old folders and keys, and its own on-disk partitions', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: true });
        const { userData } = harness();
        write(path.join(userData, 'mods-data', 'qq', 'mod-data.json'), 100);
        write(path.join(userData, 'mods-cache', 'qq', 'a', 'b.bin'), 1000);
        // The trusted table's row for qq claims the userData folder qq-auth-state and one store key.
        write(path.join(userData, 'qq-auth-state', 'state.json'), 20);
        hostStore.set('QQ_API_AUTH_SESSION_V1', 'abc');
        hostStore.set('OTHER_KEY', 'x'.repeat(5000));
        // A partition of its own: Chromium's caches inside it are cache, the rest is the sign-in.
        persisted.set('mods.sourcePartitions', { qq: ['persist:folium.qq.web', 'folium.qq.memory'] });
        write(path.join(userData, 'Partitions', 'folium.qq.web', 'Cookies'), 7);
        write(path.join(userData, 'Partitions', 'folium.qq.web', 'Cache', 'Cache_Data', 'f'), 300);
        write(path.join(userData, 'Partitions', 'folium.qq.web', 'Code Cache', 'js', 'g'), 30);
        // Another mod's folders and another source's folders are not its own.
        write(path.join(userData, 'mods-data', 'kugou', 'mod-data.json'), 9999);
        write(path.join(userData, 'ytm-sign-in', 'x'), 9999);
        const system = launch();
        expect(await system.getSourceStorageUsage('qq')).toEqual({
            ok: true,
            data: 100 + 20 + Buffer.byteLength(JSON.stringify('abc')) + 7,
            cache: 1000 + 300 + 30,
        });
        expect(await invoke(IPC.sourceUsage, 'qq')).toEqual({ ok: true, data: 132, cache: 1330 });
    });

    it('counts 0 for folders that are not there, and refuses a source that is not a mod as clearing does', async () => {
        writeMod('builtin', sourceManifest('kugou', ['kugou']), { main: true });
        const system = launch();
        expect(await system.getSourceStorageUsage('kugou')).toEqual({ ok: true, data: 0, cache: 0 });
        expect(await system.getSourceStorageUsage('qq')).toEqual({ ok: false, error: 'source-not-a-mod' });
        expect(await system.getSourceStorageUsage('nowhere')).toEqual({ ok: false, error: 'source-not-found' });
    });

    it('answers could-not-measure, never 0, when a folder cannot be read', async () => {
        writeMod('builtin', sourceManifest('kugou', ['kugou']), { main: true });
        const dataDir = path.join(harness().userData, 'mods-data', 'kugou');
        write(path.join(dataDir, 'mod-data.json'), 10);
        const system = launch();
        const readdir = fs.promises.readdir;
        const spy = vi.spyOn(fs.promises, 'readdir').mockImplementation((async (target: fs.PathLike, ...rest: unknown[]) => {
            if (String(target) === dataDir) throw Object.assign(new Error('denied'), { code: 'EACCES' });
            return (readdir as (...args: unknown[]) => unknown)(target, ...rest);
        }) as typeof fs.promises.readdir);
        expect(await system.getSourceStorageUsage('kugou')).toEqual({ ok: false, error: 'source-usage-failed' });
        spy.mockRestore();
    });
});

describe('main-window-only IPC (plan §2 item 1)', () => {
    it('serves the main window\'s main frame and refuses a sub-frame, another window, and no window', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: `'use strict';
module.exports = function activate(api) { api.rpc.handle('ping', () => 'pong'); };` });
        launch();
        const rpc = handlers.get(IPC.rpc)!;
        expect(await rpc({ sender: MAIN_WINDOW.webContents, senderFrame: MAIN_WINDOW.webContents.mainFrame }, 'qq', 'ping', [])).toEqual({ ok: true, result: 'pong' });
        expect(await rpc(FROM_MAIN_WINDOW_SUBFRAME, 'qq', 'ping', [])).toEqual({ ok: false, error: 'untrusted-sender' });
        expect(await rpc(FROM_OTHER_WINDOW, 'qq', 'ping', [])).toEqual({ ok: false, error: 'untrusted-sender' });
        expect(await rpc(null, 'qq', 'ping', [])).toEqual({ ok: false, error: 'untrusted-sender' });
        // Every channel of the table goes through the same check.
        for (const channel of Object.values(IPC).filter((name) => handlers.has(name))) {
            expect(await handlers.get(channel)!(FROM_OTHER_WINDOW), channel).toEqual({ ok: false, error: 'untrusted-sender' });
        }
    });

    it('refuses everything while there is no main window', async () => {
        launch({ mainWindow: null });
        expect(await handlers.get(IPC.list)!({ sender: MAIN_WINDOW.webContents, senderFrame: MAIN_WINDOW.webContents.mainFrame }))
            .toEqual({ ok: false, error: 'untrusted-sender' });
    });
});

describe('an rpc during an async activate (plan §5.4)', () => {
    it('waits for the handlers activate() registers instead of answering rpc-not-found', async () => {
        writeMod('builtin', sourceManifest('qq', ['qq']), { main: `'use strict';
module.exports = async function activate(api) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    api.rpc.handle('late', () => 'here');
};` });
        launch();
        expect(await invoke(IPC.rpc, 'qq', 'late', [])).toEqual({ ok: true, result: 'here' });
        expect(await invoke(IPC.rpc, 'qq', 'missing', [])).toEqual({ ok: false, error: 'rpc-not-found:missing' });
    });
});
