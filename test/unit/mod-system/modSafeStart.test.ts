import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSafeStart.test.ts
// Safe start, in the main process. What the user cannot see by using the app:
// the start note is written when the app's own start has a mod to run and
// taken up when the window reports that start as over; a note left over from
// the last start leads to one question before any mod code runs; "without
// mods" runs nothing for the rest of the run and writes no setting; and
// "reopen without mods" stops what is running the same way. The dialog is a
// stand-in the test answers; the note is a real file in a temp folder.

const require = createRequire(import.meta.url);

const persisted = new Map<string, unknown>();
class FakeStore {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, JSON.parse(JSON.stringify(value))); }
}

interface AskedDialog { message: string; buttons: string[]; defaultId: number; cancelId: number }
const dialogs: { asked: AskedDialog[]; answer: (response: number) => void } = { asked: [], answer: () => {} };
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

const stubModule = (name: string, exports: unknown) => {
    const resolved = require.resolve(name);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron', {
    dialog: {
        // Called with (options) or (window, options): the options are last either way.
        showMessageBox: (...args: unknown[]) => new Promise((resolve) => {
            dialogs.asked.push(args[args.length - 1] as AskedDialog);
            dialogs.answer = (response) => resolve({ response });
        }),
    },
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => { handlers.set(channel, handler); },
        removeHandler: () => {},
    },
    protocol: { handle: () => {} },
    shell: { openPath: async () => '' },
});
stubModule('electron-store', FakeStore);

const { createModSystem } = require('../../../electron/modSystem/modSystem.cjs');
const { computeModDigest } = require('../../../electron/modSystem/modDigest.cjs');
const { NOTE_FILE, PAGE_QUIET_LIMIT_MS } = require('../../../electron/modSystem/safeStart.cjs');

interface ListedMod { id: string; status: string; enabled: boolean; clientUrl: string | null }
interface ListPayload { mods: ListedMod[]; startSkipped: boolean }
interface ModSystem {
    start: () => void;
    loadAll: () => ListedMod[];
    listMods: () => ListedMod[];
    registerIpc: () => void;
    dispose: () => void;
    skipForThisRun: () => ListedMod[];
    hasRunningMods: () => boolean;
    noteNormalQuit: () => void;
    notePageFailed: () => void;
    askReopenWithoutMods: (win: unknown, signal?: AbortSignal) => Promise<boolean>;
}

let root = '';
let system: ModSystem | null = null;
const probe = globalThis as { __foliumSafeStart?: string[] };
const ran = () => probe.__foliumSafeStart!;
const notePath = () => path.join(root, 'userData', NOTE_FILE);
const noteExists = () => fs.existsSync(notePath());

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-safe-start-'));
    fs.mkdirSync(path.join(root, 'userData'), { recursive: true });
    persisted.clear();
    handlers.clear();
    dialogs.asked = [];
    probe.__foliumSafeStart = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    system?.dispose();
    system = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/* A mod under userData/mods with a Node entry that says when it ran and when it was released. */
const writeMod = (modId: string, enabled: boolean) => {
    const directory = path.join(root, 'userData/mods', modId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'mod.json'), JSON.stringify({
        folium: 1, id: modId, name: modId, version: '1.0.0', main: 'index.cjs', client: 'client.mjs',
    }));
    fs.writeFileSync(path.join(directory, 'client.mjs'), 'export default function activate(folium) {}\n');
    fs.writeFileSync(path.join(directory, 'index.cjs'), `
        module.exports = function activate(api) {
            globalThis.__foliumSafeStart.push('ran ${modId}');
            api.onDispose(() => { globalThis.__foliumSafeStart.push('released ${modId}'); });
        };
    `);
    if (enabled) {
        persisted.set(`mods.enabled.${modId}`, { enabled: true, digest: computeModDigest(directory) });
    }
};

/* The mod system as main.cjs sets it up, before its start. */
const create = (): ModSystem => {
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
    system.registerIpc();
    return system;
};

const invoke = <T>(channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) as Promise<T>;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

/* The next run of the app: a new mod system over the same folders, started. */
const nextRun = () => {
    system?.dispose();
    probe.__foliumSafeStart = [];
    dialogs.asked = [];
    const next = create();
    next.start();
    return next;
};

describe('the start note', () => {
    it('is written when the start has a mod to run, and taken up when the window reports the start as over', async () => {
        writeMod('safe-a', true);
        create().start();
        expect(ran()).toEqual(['ran safe-a']);
        expect(noteExists()).toBe(true);
        expect(dialogs.asked).toEqual([]);

        // What the gate counted for the Node entry reaches the window: its require and its activate.
        const { stats } = await invoke<{ stats: Record<string, { calls: number; failures: number }> }>('folia-mods:call-stats');
        expect(stats['safe-a']).toMatchObject({ calls: 2, failures: 0 });

        await invoke('folia-mods:start-settled');
        expect(noteExists()).toBe(false);

        // A reload later in the run is not the app's start: nothing would take a note up again.
        system!.loadAll();
        expect(ran()).toEqual(['ran safe-a', 'released safe-a', 'ran safe-a']);
        expect(noteExists()).toBe(false);
    });

    it('is not written when no mod is enabled', () => {
        writeMod('safe-off', false);
        create().start();
        expect(ran()).toEqual([]);
        expect(noteExists()).toBe(false);
    });
});

describe('leaving the app the normal way before the start is over', () => {
    it('takes the note up when the page has not begun starting the mods, so the next start asks nothing', () => {
        writeMod('safe-quit-early', true);
        create().start();
        expect(noteExists()).toBe(true);

        system!.noteNormalQuit();
        expect(noteExists()).toBe(false);
        nextRun();
        expect(dialogs.asked).toEqual([]);
        expect(ran()).toEqual(['ran safe-quit-early']);
    });

    it('takes the note up when the page said it was answering a moment before, and leaves it when the page has gone quiet', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_000_000);
        writeMod('safe-quit', true);
        create().start();

        // A slow mod is still starting; the page says every second that it is answering.
        await invoke('folia-mods:start-alive');
        vi.setSystemTime(1_000_000 + PAGE_QUIET_LIMIT_MS);
        system!.noteNormalQuit();
        expect(noteExists()).toBe(false);

        // The next run: the page begins, says so once, and then a mod holds it. Left through the
        // tray, or by the system shutting down: the note stays and the start after that asks.
        nextRun();
        expect(dialogs.asked).toEqual([]);
        expect(noteExists()).toBe(true);
        await invoke('folia-mods:start-alive');
        vi.setSystemTime(1_000_000 + 2 * PAGE_QUIET_LIMIT_MS + 1);
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);

        nextRun();
        expect(dialogs.asked).toHaveLength(1);
        dialogs.answer(1);
        await turn();
        vi.useRealTimers();
    });

    it('takes nothing up once the start was reported as over', async () => {
        writeMod('safe-quit-late', true);
        create().start();
        await invoke('folia-mods:start-settled');
        // A note someone else put there after the start ended is not this run's to remove.
        fs.writeFileSync(notePath(), '{}');
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);
    });

    it('takes nothing up in a run that wrote no note', () => {
        writeMod('safe-quit-none', false);
        create().start();
        expect(noteExists()).toBe(false);
        // No mod was started, so no note is this run's: one that appears is left alone.
        fs.writeFileSync(notePath(), '{}');
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);
    });

    it('leaves the note when the page failed to load or its process ended, whatever it said before or after', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(2_000_000);
        // The page never got as far as saying it was answering: its load failed.
        writeMod('safe-page-failed', true);
        create().start();
        system!.notePageFailed();
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);

        // The next run asks. "As usual": the page starts, says it is answering, and its process
        // ends. It is loaded again and answers; the app is left a moment later. That start went
        // wrong all the same.
        nextRun();
        expect(dialogs.asked).toHaveLength(1);
        dialogs.answer(1);
        await turn();
        expect(noteExists()).toBe(true);
        await invoke('folia-mods:start-alive');
        system!.notePageFailed();
        await invoke('folia-mods:start-alive');
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);

        // A page that was loaded again and got to the end of its start takes the note up as usual.
        await invoke('folia-mods:start-settled');
        expect(noteExists()).toBe(false);
        vi.useRealTimers();
    });
});

describe('a note left over from the last start', () => {
    it('leads to one question before any mod runs; "without mods" runs nothing, writes no setting, leaves no note', async () => {
        writeMod('safe-b', true);
        fs.writeFileSync(notePath(), '{}');
        const settingsBefore = JSON.stringify(Array.from(persisted.entries()));

        create().start();
        expect(dialogs.asked).toHaveLength(1);
        expect(dialogs.asked[0]).toMatchObject({
            message: 'Folia did not finish starting last time.',
            buttons: ['Start without mods', 'Start as usual'],
            defaultId: 0,
            cancelId: 0,
        });
        expect(ran()).toEqual([]);

        // The window's request for the list waits for the answer, so no client starts before it.
        const listed = { payload: null as ListPayload | null };
        void invoke<ListPayload>('folia-mods:list').then((payload) => { listed.payload = payload; });
        await turn();
        expect(listed.payload).toBeNull();

        dialogs.answer(0);
        await turn();
        expect(listed.payload).toMatchObject({
            startSkipped: true,
            mods: [{ id: 'safe-b', status: 'skipped', enabled: true, clientUrl: null }],
        });
        expect(ran()).toEqual([]);
        expect(system!.hasRunningMods()).toBe(false);
        expect(noteExists()).toBe(false);
        expect(JSON.stringify(Array.from(persisted.entries()))).toBe(settingsBefore);

        // For the rest of this run: a reload still runs nothing, and asks nothing.
        expect(system!.loadAll()).toMatchObject([{ id: 'safe-b', status: 'skipped' }]);
        expect(ran()).toEqual([]);
        expect(dialogs.asked).toHaveLength(1);
    });

    it('starts the mods on "as usual", with a new note for this start', async () => {
        writeMod('safe-c', true);
        fs.writeFileSync(notePath(), '{}');
        create().start();
        expect(ran()).toEqual([]);

        dialogs.answer(1);
        await turn();
        expect(ran()).toEqual(['ran safe-c']);
        expect(noteExists()).toBe(true);
        const payload = await invoke<ListPayload>('folia-mods:list');
        expect(payload).toMatchObject({ startSkipped: false, mods: [{ id: 'safe-c', status: 'loaded' }] });
        expect(system!.hasRunningMods()).toBe(true);
    });

    it('runs no mod while the question is open, whichever request asks for a load', async () => {
        writeMod('safe-open', true);
        fs.writeFileSync(notePath(), '{}');
        create().start();
        expect(dialogs.asked).toHaveLength(1);

        // What the window can send, and a load asked for inside the main process (the mod system switch).
        const answered: string[] = [];
        const requests: Array<[string, unknown[]]> = [
            ['folia-mods:reload', []],
            ['folia-mods:set-enabled', ['safe-open', false]],
            ['folia-mods:install-zip', [path.join(root, 'nothing.zip')]],
            ['folia-mods:call-stats', []],
        ];
        requests.forEach(([channel, args]) => {
            void invoke(channel, ...args).then(() => { answered.push(channel); });
        });
        expect(system!.loadAll()).toEqual([]);
        await turn();
        expect(answered).toEqual([]);
        expect(ran()).toEqual([]);
        expect(persisted.get('mods.enabled.safe-open')).toMatchObject({ enabled: true });

        // "Without mods": the requests are answered now, and still nothing has run.
        dialogs.answer(0);
        await turn();
        expect(answered.sort()).toEqual(requests.map(([channel]) => channel).sort());
        expect(ran()).toEqual([]);
    });

    it('asks nothing when no mod is enabled, and takes the note up', () => {
        writeMod('safe-none', false);
        fs.writeFileSync(notePath(), '{}');
        create().start();
        expect(dialogs.asked).toEqual([]);
        expect(ran()).toEqual([]);
        expect(noteExists()).toBe(false);
    });

    it('asks once about a note that cannot be removed, not at every start after it', async () => {
        writeMod('safe-stuck', true);
        fs.writeFileSync(notePath(), JSON.stringify({ startedAt: '2026-10-01T00:00:00.000Z' }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The note is locked: it can be read, and neither removed nor written.
        const remove = fs.rmSync;
        const write = fs.writeFileSync;
        vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
            if (String(target) === notePath()) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
            remove(target, options);
        });
        vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, data: string) => {
            if (String(target) === notePath()) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
            write(target, data);
        }) as typeof fs.writeFileSync);

        create().start();
        expect(dialogs.asked).toHaveLength(1);
        dialogs.answer(1);
        await turn();
        expect(ran()).toEqual(['ran safe-stuck']);
        expect(noteExists()).toBe(true);
        expect(warn).toHaveBeenCalled();

        // The same note is still on disk at the next start, and the one after: no question.
        nextRun();
        expect(dialogs.asked).toEqual([]);
        expect(ran()).toEqual(['ran safe-stuck']);
        nextRun();
        expect(dialogs.asked).toEqual([]);

        // The lock is gone: notes work again, and a start that does not get to its end is asked about.
        vi.mocked(fs.rmSync).mockRestore();
        vi.mocked(fs.writeFileSync).mockRestore();
        nextRun();
        expect(dialogs.asked).toEqual([]);
        nextRun();
        expect(dialogs.asked).toHaveLength(1);
        dialogs.answer(0);
        await turn();
        expect(noteExists()).toBe(false);
    });
});

describe('reopening the window without mods', () => {
    it('is offered with waiting as the default, and stops every running mod for this run without writing a setting', async () => {
        writeMod('safe-d', true);
        create().start();
        expect(system!.hasRunningMods()).toBe(true);
        const settingsBefore = JSON.stringify(Array.from(persisted.entries()));

        const waiting = system!.askReopenWithoutMods(null);
        expect(dialogs.asked[0]).toMatchObject({
            message: 'The Folia window has stopped answering.',
            buttons: ['Keep waiting', 'Reopen without mods'],
            defaultId: 0,
            cancelId: 0,
        });
        dialogs.answer(0);
        expect(await waiting).toBe(false);
        expect(ran()).toEqual(['ran safe-d']);

        const reopening = system!.askReopenWithoutMods(null);
        dialogs.answer(1);
        expect(await reopening).toBe(true);

        expect(system!.skipForThisRun()).toMatchObject([{ id: 'safe-d', status: 'skipped', enabled: true }]);
        expect(ran()).toEqual(['ran safe-d', 'released safe-d']);
        expect(system!.hasRunningMods()).toBe(false);
        expect(JSON.stringify(Array.from(persisted.entries()))).toBe(settingsBefore);
    });

    it('leaves the note of a start that got stuck, so the next start asks', async () => {
        writeMod('safe-e', true);
        create().start();
        expect(noteExists()).toBe(true);

        // The window got stuck while the mods were starting, and was reopened without them. The
        // page that loads then has no mod to start: what it reports is not the end of that start.
        system!.skipForThisRun();
        await invoke('folia-mods:start-alive');
        await invoke('folia-mods:start-settled');
        system!.noteNormalQuit();
        expect(noteExists()).toBe(true);

        nextRun();
        expect(dialogs.asked).toHaveLength(1);
        dialogs.answer(0);
        await turn();
    });
});
