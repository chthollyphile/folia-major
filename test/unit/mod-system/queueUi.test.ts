// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useFoliumStatusStore } from '@/mods/folium/status';
import { createFoliumClientApi } from '@/mods/folium/api';
import { createFoliumExperimental } from '@/mods/folium/experimental';
import {
    getQueueUiSnapshot,
    queueUiRegistry,
    subscribeQueueUi,
    type QueueUiComponent,
    type QueueUiExtension,
} from '@/mods/folium/queueUi';
import { readQueueUiEntry, readQueueUiHeader, readQueueUiLayout } from '@/mods/folium/queueUiContent';

// test/unit/mod-system/queueUi.test.ts
// Queue UI contributions cannot mutate native actions or retain permission to
// act on a queue occurrence after its owner or that occurrence has expired.

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

const song = (id = 1): SongResult => ({
    id, name: `Song ${id}`, artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' }, durationMs: 180_000,
});
const component = (overrides: Partial<QueueUiComponent> = {}): QueueUiComponent => ({
    id: 'custom', width: 80, mount: vi.fn(), ...overrides,
});
const register = (extension: Partial<QueueUiExtension> = {}) => queueUiRegistry.register('mod-a', {
    id: 'sample', getHeaderContent: () => [component()], ...extension,
});
const seedQueue = (...songs: SongResult[]) => {
    usePlaybackStore.setState({ playQueue: songs });
    return songs;
};
const mod = (experimental: string[] = []): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental, embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
});

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    queueUiRegistry.unregisterAll('mod-a');
    queueUiRegistry.unregisterAll('mod-b');
    usePlaybackStore.setState({ playQueue: [] });
    useFoliumStatusStore.setState({ issues: {} });
    vi.restoreAllMocks();
});

describe('queue.ui append-only component slots', () => {
    it('requires manifest opt-in and does not expose native action editors', () => {
        const plain = mod();
        const gated = createFoliumClientApi(plain, { context: 'main', internals: null, experimental: createFoliumExperimental(plain) });
        expect(() => gated.experimental['queue.ui']).toThrow('experimental-not-declared:queue.ui');
        expect(gated.registries).not.toHaveProperty('queueViews');
        expect(gated.ui).not.toHaveProperty('slots');
        const selected = mod(['queue.ui']);
        const api = createFoliumClientApi(selected, { context: 'main', internals: null, experimental: createFoliumExperimental(selected) });
        const queueApi = api.experimental['queue.ui'] as { register: (def: QueueUiExtension) => unknown };
        queueApi.register({ id: 'sample', getHeaderContent: () => [component()] });
        expect(readQueueUiHeader('panel')).toHaveLength(1);
    });

    it('does nothing without contributions and preserves stable snapshots', () => {
        const queue = seedQueue(song());
        expect(getQueueUiSnapshot()).toBe(getQueueUiSnapshot());
        expect(readQueueUiHeader('panel')).toEqual([]);
        expect(readQueueUiEntry(queue, 0, 'panel')).toEqual({ overlines: [], trailing: [] });
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });

    it('validates registration ownership and component geometry without prescribing UI', async () => {
        expect(() => register({ id: 'host:shuffle' })).toThrow();
        expect(() => register({ getHeaderContent: undefined })).toThrow();
        const custom = component({ width: 146 });
        register({ getHeaderContent: () => [custom] });
        expect(readQueueUiHeader('panel')[0]).toMatchObject({ id: 'mod-a:sample:custom', width: 146, mount: custom.mount });
        expect(readQueueUiHeader('panel')[0]).not.toHaveProperty('icon');
        expect(readQueueUiHeader('panel')[0]).not.toHaveProperty('count');
    });

    it.each([
        [{ ...component(), width: 0 }], [{ ...component(), width: Infinity }],
        [{ ...component(), width: 513 }], [{ ...component(), mount: null }],
        [component(), component()], Array(1), [{ ...component(), id: 'host:native' }],
    ])('isolates malformed component output: %j', async (...items) => {
        register({ getHeaderContent: () => items as unknown as QueueUiComponent[] });
        queueUiRegistry.register('mod-b', { id: 'healthy', getHeaderContent: () => [component()] });
        expect(readQueueUiHeader('panel').map(item => item.modId)).toEqual(['mod-b']);
        await Promise.resolve();
        expect(useFoliumStatusStore.getState().issues['mod-a']).toHaveLength(1);
    });

    it('subscribes once, releases on teardown and ignores stale notifications', () => {
        let notify = () => {};
        const dispose = vi.fn();
        const subscription = vi.fn((listener: () => void) => { notify = listener; return dispose; });
        register({ subscribe: subscription });
        readQueueUiHeader('panel'); readQueueUiHeader('command');
        expect(subscription).toHaveBeenCalledTimes(1);
        const listener = vi.fn(); const unsubscribe = subscribeQueueUi(listener);
        notify(); expect(listener).toHaveBeenCalledTimes(1);
        queueUiRegistry.unregisterAll('mod-a');
        const count = listener.mock.calls.length; notify(); expect(listener).toHaveBeenCalledTimes(count);
        expect(dispose).toHaveBeenCalledTimes(1); unsubscribe();
    });

    it('rolls back reentrant failed registrations without ghost components', () => {
        expect(() => register({ subscribe: () => {
            queueUiRegistry.register('mod-b', { id: 'child', getHeaderContent: () => [component()] });
            throw new Error('subscribe failed');
        } })).toThrow('subscribe failed');
        expect(getQueueUiSnapshot().entries.map(entry => entry.modId)).toEqual(['mod-b']);
    });

    it('keeps duplicate occurrences and each surface distinct, projecting only requested rows', () => {
        const repeated = song(); const queue = seedQueue(repeated, repeated);
        const item = component(); const provider = vi.fn(() => ({ trailing: [item] }));
        register({ getEntryContent: provider, getEntryLayout: () => 'plain' });
        const second = readQueueUiEntry(queue, 1, 'command');
        expect(second.trailing[0].context.entry).toMatchObject({ index: 1, surface: 'command', song: { title: 'Song 1' } });
        expect(Object.isFrozen(second.trailing[0].context.entry?.song)).toBe(true);
        expect(readQueueUiEntry(queue, 1, 'command')).toBe(second);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(readQueueUiEntry(queue, -1, 'panel')).toEqual({ overlines: [], trailing: [] });
        expect(readQueueUiLayout('panel')).toBe('plain');
        expect(provider).toHaveBeenCalledTimes(1);
        expect(readQueueUiEntry(queue, 0, 'wall').trailing[0].context.entry?.index).toBe(0);
    });

    it('invalidates cached content after structural changes', () => {
        let notify = () => {}; let present = true;
        const queue = seedQueue(song()); const item = component();
        register({ getEntryContent: () => present ? { trailing: [item] } : {}, subscribe: listener => { notify = listener; return () => {}; } });
        expect(readQueueUiEntry(queue, 0, 'panel').trailing).toHaveLength(1);
        present = false; notify();
        expect(readQueueUiEntry(queue, 0, 'panel').trailing).toEqual([]);
    });

    it('guards stale queue occurrences even before React unmounts their components', async () => {
        const repeated = song(); const queue = seedQueue(repeated, repeated); const item = component();
        register({ getEntryContent: () => ({ trailing: [item] }) });
        const ctx = readQueueUiEntry(queue, 1, 'panel').trailing[0].context; const run = vi.fn();
        expect(await ctx.run(run)).toBe(true);
        seedQueue(repeated);
        expect(ctx.isCurrent()).toBe(false); expect(await ctx.run(run)).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('guards removed or replaced mounts and unregister/re-register under the same id', async () => {
        let item = component(); register({ getHeaderContent: () => item ? [item] : [] });
        const old = readQueueUiHeader('panel')[0].context; const run = vi.fn();
        item = component(); expect(await old.run(run)).toBe(false);
        const current = readQueueUiHeader('panel')[0].context;
        queueUiRegistry.unregisterAll('mod-a'); register();
        expect(await current.run(run)).toBe(false); expect(run).not.toHaveBeenCalled();
    });

    it('rechecks the queue after a provider changes it during fresh validation', async () => {
        const queue = seedQueue(song()); const item = component(); let mutate = false;
        register({ getEntryContent: () => { if (mutate) seedQueue(song(2)); return { trailing: [item] }; } });
        const ctx = readQueueUiEntry(queue, 0, 'panel').trailing[0].context;
        mutate = true; const run = vi.fn();
        expect(await ctx.run(run)).toBe(false); expect(run).not.toHaveBeenCalled();
    });

    it('reports mod handler errors without throwing through the host event handler', async () => {
        const item = component(); register({ getHeaderContent: () => [item] });
        expect(await readQueueUiHeader('panel')[0].context.run(() => { throw new Error('custom failure'); })).toBe(false);
        await Promise.resolve();
        expect(useFoliumStatusStore.getState().issues['mod-a']).toHaveLength(1);
    });
});
