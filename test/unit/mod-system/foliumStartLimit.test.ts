// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});
import type { ModRuntimeInfo } from '@/mods/types';
import * as loader from '@/mods/runtime/clientLoader';
import * as exportStart from '@/mods/export/exportStart';
import { getFoliumIssues, setFoliumFaultNotifier } from '@/mods/runtime/status';
// The loader imports the client API on first use; loading it here keeps that out of the test's own time.
import '@/mods/folium/api';

// test/unit/mod-system/foliumStartLimit.test.ts
// The start limit of one mod's client. What the user cannot see by using the
// app: a mod whose import plus `activate` runs past the limit is slow, not
// failed: the queue goes on to the next mod, the user is told once that it has
// not finished starting, and nothing is recorded against it; its start is not
// cancelled, so what it hands over late is still kept, or run at once when the
// mod was torn down in the meantime; a start that throws is the failure, in
// time or late, unless the mod was stopped or replaced before it threw; and
// the loader itself has no shorter cap, so the export window waits for a slow
// mod past the first-screen wait, and for the mod of the style it is to draw
// until that mod's start has really ended.
// Clients are data: modules; the test decides when a slow one finishes or throws.

const { reconcileFoliumClients } = loader;
// Read through the namespace: on the code before the limit these two are absent.
const START_LIMIT_MS = loader.FOLIUM_START_LIMIT_MS ?? 5000;
const onStarted = loader.onFoliumClientStarted ?? (() => () => {});

interface Probe {
    started?: boolean;
    disposed?: boolean;
    finish?: () => void;
    fail?: () => void;
}
const probes = () => ((globalThis as { __foliumStartLimit?: Record<string, Probe> }).__foliumStartLimit ??= {});

const dataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/*
 * A client whose `activate` stays pending until the test calls `finish` (it then registers a lyric
 * style named "glow" and hands over a disposer) or `fail` (its promise rejects).
 */
const slowClient = (name: string) => dataUrl(`
export default function activate(folium) {
    const probe = ((globalThis.__foliumStartLimit ??= {})['${name}'] = { started: true });
    return new Promise((resolve, reject) => {
        probe.finish = () => {
            probe.finish = undefined;
            folium.registries.visualizers.register({ id: 'glow', label: { en: 'Glow' }, mount: () => {} });
            resolve(() => { probe.disposed = true; });
        };
        probe.fail = () => {
            probe.finish = undefined;
            reject(new Error('late boom'));
        };
    });
}
`);

const fastClient = (name: string) => dataUrl(`
export default function activate() {
    (globalThis.__foliumStartLimit ??= {})['${name}'] = { started: true };
}
`);

const throwingClient = () => dataUrl(`
export default function activate() {
    throw new Error('start boom');
}
`);

const mod = (id: string, clientUrl: string, loadOrder = 0): ModRuntimeInfo => ({
    id,
    name: id,
    version: '1.0.0',
    author: null,
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl,
    loadOrder,
});

/* Lets the imports and the promise chains behind them run; the timers stay where the test put them. */
const settle = async () => {
    for (let round = 0; round < 3; round += 1) {
        await vi.dynamicImportSettled();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

const watch = <T>(promise: Promise<T>) => {
    const state: { done: boolean; value?: T } = { done: false };
    void promise.then((value) => {
        state.done = true;
        state.value = value;
    });
    return state;
};

/* Who is told what, as the notice would be: [mod, kind]. */
let notices: Array<[string, string | undefined]> = [];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    notices = [];
    setFoliumFaultNotifier((modId, kind) => { notices.push([modId, kind]); });
});

afterEach(async () => {
    Object.values(probes()).forEach((probe) => probe.finish?.());
    await settle();
    await reconcileFoliumClients([], 'main');
    setFoliumFaultNotifier(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the start limit of a mod client', () => {
    it('goes on to the next mod past the limit and says the slow one has not finished, without counting a failure; what it hands over late is kept', async () => {
        const told: string[] = [];
        const stopListening = onStarted((modId) => { told.push(modId); });
        const queue = watch(reconcileFoliumClients([
            mod('limit-slow', slowClient('limit-slow'), 0),
            mod('limit-next', fastClient('limit-next'), 1),
        ], 'main'));
        await settle();
        expect(probes()['limit-slow']?.started).toBe(true);
        expect(loader.getFoliumClientStart('limit-slow')).toEqual({ state: 'starting', late: false });

        vi.advanceTimersByTime(START_LIMIT_MS - 1);
        await settle();
        expect(probes()['limit-next']).toBeUndefined();
        expect(notices).toEqual([]);

        vi.advanceTimersByTime(1);
        await settle();
        expect(probes()['limit-next']?.started).toBe(true);
        expect(queue.done).toBe(true);
        // Slow, not failed: one notice that says so, and no row of failures.
        expect(notices).toEqual([['limit-slow', 'slow-start']]);
        expect(getFoliumIssues('limit-slow')).toEqual([]);
        expect(loader.getFoliumClientStart('limit-slow')).toEqual({ state: 'starting', late: true });
        expect(told).toEqual(['limit-next']);

        // Not cancelled: it finishes late, whoever listens for started clients is told, its
        // start has a time, still nothing is counted against it, and the disposer it handed
        // over runs when the mod is torn down.
        probes()['limit-slow'].finish!();
        await settle();
        expect(told).toEqual(['limit-next', 'limit-slow']);
        expect(loader.getFoliumClientStart('limit-slow')).toMatchObject({ state: 'started', ms: expect.any(Number) });
        expect(getFoliumIssues('limit-slow')).toEqual([]);
        expect(notices).toEqual([['limit-slow', 'slow-start']]);
        expect(probes()['limit-slow'].disposed).toBeUndefined();
        await reconcileFoliumClients([], 'main');
        expect(probes()['limit-slow'].disposed).toBe(true);
        stopListening();
    });

    it('counts a start that throws as the failure, in time or after the limit, and gives it no start time', async () => {
        await reconcileFoliumClients([mod('limit-throws', throwingClient())], 'main');
        expect(getFoliumIssues('limit-throws')).toMatchObject([{ where: 'client activate', count: 1, piece: 'start', message: 'start boom' }]);
        expect(loader.getFoliumClientStart('limit-throws')).toEqual({ state: 'failed' });
        expect(notices).toEqual([['limit-throws', 'start']]);

        const queue = watch(reconcileFoliumClients([mod('limit-late-throw', slowClient('limit-late-throw'))], 'main'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(queue.done).toBe(true);
        expect(getFoliumIssues('limit-late-throw')).toEqual([]);

        probes()['limit-late-throw'].fail!();
        await settle();
        expect(getFoliumIssues('limit-late-throw')).toMatchObject([{ where: 'client activate', count: 1, piece: 'start', message: 'late boom' }]);
        expect(loader.getFoliumClientStart('limit-late-throw')).toEqual({ state: 'failed' });
        // Told it was slow, then told it failed: two different things.
        expect(notices).toEqual([
            ['limit-throws', 'start'],
            ['limit-late-throw', 'slow-start'],
            ['limit-late-throw', 'start'],
        ]);
    });

    it('does not count a start that throws after its mod was disabled, or after newer code took its place', async () => {
        // Disabled while its start was still going.
        const disabled = watch(reconcileFoliumClients([mod('limit-stopped', slowClient('limit-stopped'))], 'main'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(disabled.done).toBe(true);
        await reconcileFoliumClients([], 'main');
        probes()['limit-stopped'].fail!();
        await settle();
        expect(getFoliumIssues('limit-stopped')).toEqual([]);
        expect(loader.getFoliumClientStart('limit-stopped')).toBeUndefined();

        // Reloaded with other code (another URL) while the old start was still going.
        const old = watch(reconcileFoliumClients([mod('limit-replaced', slowClient('limit-replaced'))], 'main'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(old.done).toBe(true);
        const failOld = probes()['limit-replaced'].fail!;
        await reconcileFoliumClients([mod('limit-replaced', fastClient('limit-replaced'))], 'main');
        expect(loader.getFoliumClientStart('limit-replaced')).toMatchObject({ state: 'started' });
        failOld();
        await settle();
        expect(getFoliumIssues('limit-replaced')).toEqual([]);
        expect(loader.getFoliumClientStart('limit-replaced')).toMatchObject({ state: 'started' });
        expect(notices.filter(([, kind]) => kind === 'start')).toEqual([]);
    });

    it('runs the disposer at once when a mod finishes starting after it was torn down', async () => {
        const queue = watch(reconcileFoliumClients([mod('limit-gone', slowClient('limit-gone'))], 'main'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(queue.done).toBe(true);

        // Disabled while its `activate` is still pending: no teardown is left to run what it returns.
        await reconcileFoliumClients([], 'main');
        expect(probes()['limit-gone'].disposed).toBeUndefined();
        probes()['limit-gone'].finish!();
        await settle();
        expect(probes()['limit-gone'].disposed).toBe(true);
    });

    it('lets the export window wait for a slow mod past the first-screen wait of 1.5 s', async () => {
        const queue = watch(reconcileFoliumClients([mod('limit-export', slowClient('limit-export'))], 'export'));
        await settle();
        vi.advanceTimersByTime(1500);
        await settle();
        expect(queue.done).toBe(false);

        vi.advanceTimersByTime(1500);
        probes()['limit-export'].finish!();
        await settle();
        expect(queue.done).toBe(true);
        expect(getFoliumIssues('limit-export')).toEqual([]);
    });
});

describe('the export window and the mod of the style it is to draw', () => {
    it('waits for that mod past the start limit, until its start has ended, and then draws its style', async () => {
        const queue = watch(reconcileFoliumClients([mod('export-slow', slowClient('export-slow'))], 'export'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(queue.done).toBe(true);

        const answer = watch(exportStart.waitForExportMode('mod:export-slow:glow'));
        await settle();
        // Long past the limit, the mod still starting: the export is neither failed nor begun.
        vi.advanceTimersByTime(START_LIMIT_MS * 10);
        await settle();
        expect(answer.done).toBe(false);

        probes()['export-slow'].finish!();
        await settle();
        expect(answer).toEqual({ done: true, value: null });
    });

    it('stops with a stated reason when that mod\'s start threw, when the mod is not there, and not for a builtin style', async () => {
        const queue = watch(reconcileFoliumClients([mod('export-throws', slowClient('export-throws'))], 'export'));
        await settle();
        vi.advanceTimersByTime(START_LIMIT_MS);
        await settle();
        expect(queue.done).toBe(true);
        const answer = watch(exportStart.waitForExportMode('mod:export-throws:glow'));
        await settle();
        expect(answer.done).toBe(false);
        probes()['export-throws'].fail!();
        await settle();
        expect(answer).toEqual({ done: true, value: 'export-mod-style-not-started' });

        expect(await exportStart.waitForExportMode('mod:export-absent:glow')).toBe('export-mod-style-not-started');
        expect(await exportStart.waitForExportMode('classic')).toBeNull();
    });
});
