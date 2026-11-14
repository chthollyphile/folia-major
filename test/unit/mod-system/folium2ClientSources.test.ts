// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { clearFoliumIssues, getFoliumIssues } from '@/mods/runtime/status';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';

// test/unit/mod-system/folium2ClientSources.test.ts
// The client loader's half of folium.sources (Folium 2.0 S3): a `folium: 2` mod gets folium.sources in the main
// window, its registrations go when it stops, and once a source mod's activate has ended every source its
// manifest declares (and the user left on) must be registered. One missing is said in the mod's row; none at all
// is told to the main process (folia-mods:sources-registered), which takes the source exemptions back.

const client = (body: string) => `data:text/javascript,${encodeURIComponent(`export default function activate(folium) {\n${body}\n}\n`)}`;

const mod = (id: string, body: string, sources: string[]): ModRuntimeInfo => ({
    id, name: id, version: '1.0.0', author: null, description: null, permissions: [], status: 'loaded', error: null,
    enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: client(body),
    folium: 2, kind: 'source', tier: 'user',
    sources: sources.map((localId) => ({ id: `folium.${id}.${localId}`, localId, name: localId, state: 'enabled', keepForMatching: false, takeover: false, requires: [] })),
});

const bridge = window as unknown as { electron?: { mods: Record<string, unknown> } };

afterEach(async () => {
    await reconcileFoliumClients([], 'main');
    ['all-there', 'one-missing', 'none'].forEach(clearFoliumIssues);
    delete bridge.electron;
    vi.restoreAllMocks();
});

describe('a source mod\'s client', () => {
    it('registers through folium.sources, and its sources go when it stops', async () => {
        const reported = vi.fn(async () => ({ ok: true }));
        bridge.electron = { mods: { reportSourcesRegistered: reported } };
        vi.spyOn(console, 'info').mockImplementation(() => {});
        await reconcileFoliumClients([mod('all-there', "folium.sources.register({ id: 'a', displayName: 'A', capabilities: { 'search@1': { searchSongs: async () => ({ items: [], hasMore: false }) } } });", ['a'])], 'main');
        expect(getOnlineMusicProvider('folium.all-there.a')?.capabilities.search).toBe(true);
        expect(reported).not.toHaveBeenCalled();
        expect(getFoliumIssues('all-there')).toEqual([]);
        await reconcileFoliumClients([], 'main');
        expect(getOnlineMusicProvider('folium.all-there.a')).toBeNull();
    });

    it('that leaves a declared source out is told so in its row', async () => {
        const reported = vi.fn(async () => ({ ok: true }));
        bridge.electron = { mods: { reportSourcesRegistered: reported } };
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await reconcileFoliumClients([mod('one-missing', "folium.sources.register({ id: 'a', displayName: 'A', capabilities: {} });", ['a', 'b'])], 'main');
        expect(getFoliumIssues('one-missing').map((issue) => issue.where)).toEqual(['source folium.one-missing.b']);
        expect(reported).not.toHaveBeenCalled();
    });

    it('whose start was stopped before its activate ended has nothing checked for the copy that runs now', async () => {
        const reported = vi.fn(async () => ({ ok: true }));
        bridge.electron = { mods: { reportSourcesRegistered: reported } };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gate = globalThis as unknown as { __s3Finish?: () => void };
        const slow = mod('none', 'return new Promise((resolve) => { globalThis.__s3Finish = resolve; });', ['a']);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const starting = reconcileFoliumClients([slow], 'main');
            for (let round = 0; round < 20 && !gate.__s3Finish; round += 1) {
                await vi.dynamicImportSettled();
                await new Promise<void>((resolve) => { setImmediate(resolve); });
            }
            expect(gate.__s3Finish).toBeTypeOf('function');
            // Past its start limit the queue goes on; the mod is stopped (a reload, an update); then its activate ends.
            await vi.advanceTimersByTimeAsync(5000);
            await starting;
            await reconcileFoliumClients([], 'main');
            gate.__s3Finish!();
            for (let round = 0; round < 5; round += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
            expect(reported).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
            delete gate.__s3Finish;
        }
    });

    it('that registers none of them has the main process take the exemptions back', async () => {
        const reported = vi.fn(async () => ({ ok: true, revoked: true }));
        bridge.electron = { mods: { reportSourcesRegistered: reported } };
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await reconcileFoliumClients([mod('none', '', ['a'])], 'main');
        expect(reported).toHaveBeenCalledWith('none', [], expect.stringMatching(/^data:text\/javascript,/));
        expect(getFoliumIssues('none').map((issue) => issue.where)).toEqual(['source folium.none.a']);
    });
});
