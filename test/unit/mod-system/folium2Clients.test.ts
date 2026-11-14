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
import { isFoliumClientActive, reconcileFoliumClients, startsIn } from '@/mods/runtime/clientLoader';
import { getSourceState, setSourceStates } from '@/services/onlineMusic/sourceStates';
import { callFoliumSourceMember, getFoliumCallStats, markFoliumSourceMod } from '@/mods/runtime/guard';
import { createFoliumRequestGate, resetFoliumRequestQuotasForTest } from '@/mods/folium/omni/requestQuota';
import { clearSourceData, installSourcesStoppingListener, registerSourcePlaybackStop, switchSourceState } from '@/mods/runtime/sourceSwitches';
import { useModsStore } from '@/mods/useModsStore';
import '@/mods/folium/api';

// test/unit/mod-system/folium2Clients.test.ts
// Folium 2.0 S2 in the window (dev/folium/folium-2-plan.md §5.2, §5.4): the source mods' clients start as a
// group of their own, together and first; none starts in the export window; `contexts` keeps a client out of a
// window; the first screen gives that group its own 3 s before the 1.5 s of the rest, and the session restore
// waits for the group and the source states (folium2FirstScreen.test.ts). Also the two seams of §5.4 in the window (the untimed hot path,
// the quota that counts callers only) and the window's half of switching a source.

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
    Object.values(probes()).forEach((probe) => probe.finish?.());
    await settle();
    await reconcileFoliumClients([], 'main');
    delete bridge.electron;
    delete (globalThis as { __s2Clients?: unknown }).__s2Clients;
    setSourceStates({});
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the source group', () => {
    it('starts every source client together, before any other client', async () => {
        void reconcileFoliumClients([mod('aaa-plain'), source('netease'), source('qq')], 'main');
        await settle();
        expect(probes().netease?.started).toBe(true);
        expect(probes().qq?.started).toBe(true);
        expect(probes()['aaa-plain']).toBeUndefined();
        probes().netease!.finish!();
        await settle();
        expect(probes()['aaa-plain']).toBeUndefined();
        probes().qq!.finish!();
        await settle();
        expect(probes()['aaa-plain']?.started).toBe(true);
    });

    it('never starts a source client in the export window, nor a client where its contexts leave it out', async () => {
        await reconcileFoliumClients([], 'main');
        void reconcileFoliumClients([source('netease'), mod('plain'), mod('main-only', { contexts: ['main'] })], 'export');
        await settle();
        expect(isFoliumClientActive('netease')).toBe(false);
        expect(isFoliumClientActive('main-only')).toBe(false);
        expect(isFoliumClientActive('plain')).toBe(true);
        expect(startsIn({ kind: 'standard', contexts: ['export'] }, 'main')).toBe(false);
        expect(startsIn({ kind: 'source', contexts: null }, 'main')).toBe(true);
        expect(startsIn({ kind: 'source', contexts: null }, 'export')).toBe(false);
    });
});

describe('the seams of §5.4 in the window', () => {
    it('calls a source mod\'s hot-path member untimed and unwrapped, and any other mod\'s through the gate', () => {
        markFoliumSourceMod('fast-source', true);
        const before = getFoliumCallStats('fast-source')?.calls ?? 0;
        expect(callFoliumSourceMember('fast-source', 'capabilities', () => 7)).toBe(7);
        expect(getFoliumCallStats('fast-source')?.calls ?? 0).toBe(before);
        expect(() => callFoliumSourceMember('fast-source', 'capabilities', () => { throw new Error('own result'); })).toThrow('own result');
        callFoliumSourceMember('plain-mod', 'capabilities', () => 1);
        expect(getFoliumCallStats('plain-mod')?.calls).toBe(1);
        markFoliumSourceMod('fast-source', false);
    });

    it('does not count a source mod\'s calls to its own source against the quota', async () => {
        resetFoliumRequestQuotasForTest();
        const signal = new AbortController().signal;
        const own = createFoliumRequestGate({ modId: 'radio', what: 'omni.searchSongs', signal, originOf: () => 'host', ownsSource: (id) => id === 'folium.radio.station' });
        for (let index = 0; index < 200; index += 1) {
            await own.run('folium.radio.station', async () => index);
        }
        // 120 a minute for anything else it calls.
        const results = await Promise.allSettled(Array.from({ length: 121 }, () => own.run('netease', async () => 1)));
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        resetFoliumRequestQuotasForTest();
    });
});

describe('the window\'s half of switching a source', () => {
    it('stops the source\'s playback before it leaves enabled, and refuses matching-only where it cannot match anonymously', async () => {
        const order: string[] = [];
        bridge.electron = {
            mods: {
                setSourceState: async (sourceId: string, state: string) => {
                    order.push(`set ${sourceId} ${state}`);
                    return { ok: true, states: { [sourceId]: state }, sources: [] };
                },
            },
        };
        registerSourcePlaybackStop((ids) => { order.push(`stop ${ids.join(',')}`); });
        expect(await switchSourceState('spotify', 'matching')).toEqual({ ok: false, error: 'source-cannot-match-only' });
        expect(await switchSourceState('qq', 'matching')).toMatchObject({ ok: true });
        expect(await switchSourceState('qq', 'enabled')).toMatchObject({ ok: true });
        expect(order).toEqual(['stop qq', 'set qq matching', 'set qq enabled']);
        expect(getSourceState('qq')).toBe('enabled');
        registerSourcePlaybackStop(null);
    });

    it('clears the window\'s own keys of the source after the main process cleared its data', async () => {
        localStorage.setItem('online_provider:netease:cookie', 'c');
        localStorage.setItem('online_provider_netease_cache', 'x');
        localStorage.setItem('online_provider:qq:cookie', 'kept');
        bridge.electron = {
            mods: {
                clearSourceData: async () => ({ ok: true, pageStorePrefixes: ['online_provider:netease:', 'online_provider_netease_'] }),
            },
        };
        expect(await clearSourceData('netease')).toMatchObject({ ok: true, removedKeys: 2 });
        expect(localStorage.getItem('online_provider:netease:cookie')).toBeNull();
        expect(localStorage.getItem('online_provider:qq:cookie')).toBe('kept');
    });
});

describe('stopping the playback of a source before it is unloaded', () => {
    it('stops it on the notice of the main process, and before the panel disables a source mod', async () => {
        const stopped: string[][] = [];
        let notify: (payload: { sourceIds: string[] }) => void = () => {};
        bridge.electron = {
            mods: {
                onSourcesStopping: (callback: (payload: { sourceIds: string[] }) => void) => { notify = callback; return () => {}; },
                setModEnabled: async () => { stopped.push(['set-enabled']); return { ok: true, mods: [] }; },
            },
        };
        registerSourcePlaybackStop((ids) => { stopped.push([...ids]); });
        const off = installSourcesStoppingListener();
        notify({ sourceIds: ['qq'] });
        await settle();
        expect(stopped).toEqual([['qq']]);
        // No client URL: the store reconciles its mods into clients, and this one is not to start here.
        useModsStore.setState({ mods: [source('radio-mod')].map((entry) => ({ ...entry, clientUrl: null, sources: [{ id: 'folium.radio-mod.station', localId: 'station', name: 'S', state: 'enabled', keepForMatching: false, takeover: false, requires: [] }] })) });
        await useModsStore.getState().toggleMod('radio-mod', false);
        expect(stopped).toEqual([['qq'], ['folium.radio-mod.station'], ['set-enabled']]);
        off();
        registerSourcePlaybackStop(null);
        useModsStore.setState({ mods: [] });
    });
});
