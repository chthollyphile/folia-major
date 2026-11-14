// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import { noteFoliumFirstScreenMounted, SOURCE_FIRST_SCREEN_MS, startFoliumForMainWindow } from '@/mods/runtime/mainWindowStart';
import { builtinSourcesSettled } from '@/services/onlineMusic/sourceReadiness';
import { getSourceState, setSourceStates } from '@/services/onlineMusic/sourceStates';
import '@/mods/folium/api';

// test/unit/mod-system/folium2FirstScreen.test.ts
// Folium 2.0 S2 (dev/folium/folium-2-plan.md §5.2): the first screen waits for the source mods' clients first,
// up to 3 s of their own, then 1.5 s for the rest; the session restore waits for that group (with the same cap)
// and for the source states. Its own file: the group it waits for is the window's first reconcile, once.

const FIRST_SCREEN_WAIT_MS = 1500;
const probes = () => ((globalThis as { __s2Clients?: Record<string, { finish?: () => void; started?: boolean }> }).__s2Clients ??= {});

/* A client that records it started and finishes only when the test says so. */
const waitingClient = (name: string) => `data:text/javascript,${encodeURIComponent(`
export default function activate() {
    const probe = ((globalThis.__s2Clients ??= {})['${name}'] = { started: true });
    return new Promise((resolve) => { probe.finish = () => { probe.finish = undefined; resolve(); }; });
}
`)}`;

const mod = (id: string, extra: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
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
    clientUrl: waitingClient(id),
    ...extra,
});
const source = (id: string) => mod(id, { kind: 'source', folium: 2, tier: 'builtin' });

const settle = async () => {
    for (let round = 0; round < 3; round += 1) {
        await vi.dynamicImportSettled();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

const bridge = window as unknown as { electron?: { mods: Record<string, unknown> } };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
    // Clients start one after another: let each finish (or pass its limit) in turn.
    for (let round = 0; round < 4; round += 1) {
        Object.values(probes()).forEach((probe) => probe.finish?.());
        vi.advanceTimersByTime(10_000);
        await settle();
    }
    await reconcileFoliumClients([], 'main');
    delete bridge.electron;
    delete (globalThis as { __s2Clients?: unknown }).__s2Clients;
    setSourceStates({});
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the first screen and the session restore', () => {
    it('waits up to 3 s for the source group, then 1.5 s for the rest; the restore waits for the group and the states', async () => {
        bridge.electron = {
            mods: {
                listMods: async () => ({ mods: [source('netease'), mod('plain')], ffmpeg: { available: false, path: null, version: null, candidates: [] }, directories: [] }),
                getSourceStates: async () => ({ ok: true, states: { qq: 'matching' }, sources: [], hasSourceMods: true }),
                onSourceStatesChanged: () => () => {},
                reportModsStartSettled: vi.fn(async () => ({ ok: true })),
                reportModsStartAlive: vi.fn(async () => ({ ok: true })),
            },
        };
        expect(SOURCE_FIRST_SCREEN_MS).toBe(3000);
        const progress = { firstScreen: false, restore: false };
        void startFoliumForMainWindow({ firstScreenWaitMs: FIRST_SCREEN_WAIT_MS }).then(() => { progress.firstScreen = true; });
        void builtinSourcesSettled().then(() => { progress.restore = true; });
        await settle();
        expect(getSourceState('qq')).toBe('matching');
        vi.advanceTimersByTime(SOURCE_FIRST_SCREEN_MS - 1);
        await settle();
        expect(progress).toEqual({ firstScreen: false, restore: false });
        vi.advanceTimersByTime(1);
        await settle();
        // The source is still starting: the restore goes on without it (S1 brings its songs back later).
        expect(progress.restore).toBe(true);
        expect(progress.firstScreen).toBe(false);
        vi.advanceTimersByTime(FIRST_SCREEN_WAIT_MS);
        await settle();
        expect(progress.firstScreen).toBe(true);
        noteFoliumFirstScreenMounted();
    });
});

