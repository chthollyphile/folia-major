// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, String(value)),
            removeItem: (key: string) => values.delete(key),
            clear: () => values.clear(),
        },
    });
});
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getSongDetail: vi.fn() } }));
import { omni } from '@/services/onlineMusic/omni';
import { createFoliumPlaybackSessions, registerExternalPlaybackActions } from '@/mods/folium/externalPlayback';
import { useFoliumStatusStore, clearFoliumIssues } from '@/mods/folium/status';
import { disposeFoliumServices } from '@/mods/folium/lifecycle';
import { createFoliumClientApi } from '@/mods/folium/api';
import { createFoliumExperimental } from '@/mods/folium/experimental';
import { reconcileFoliumClients } from '@/mods/folium/clientLoader';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import {
    hasExternalPlayback,
    getExternalPlaybackCapabilities,
    releaseAllExternalPlayback,
    routeExternalPlayback,
} from '@/services/externalPlaybackSession';
import { toFoliumSong } from '@/mods/folium/dto';
import type { FoliumPlaybackSessionIntent } from '@/mods/folium/contract';
import type { PlaybackRequest } from '@/types/externalPlayback';
import type { SongResult } from '@/types';
import type { UnifiedSong } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';

// test/unit/mod-system/foliumPlaybackSessions.test.ts
const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'session-test',
    name: 'Test',
    version: '1.0.0',
    author: null,
    description: null,
    permissions: ['playback.control'],
    experimental: ['playback.sessions'],
    enabled: true,
    status: 'loaded',
    error: null,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl: null,
    ...overrides,
});
const original = usePlaybackStore.getState();
const song = (providerId = 'netease', id = '99') =>
    ({
        id,
        name: 'Test',
        artists: [],
        album: { id: 'album', name: '' },
        durationMs: 100000,
        sourceRef: { kind: 'online', providerId, mediaId: id },
    }) as UnifiedSong;
const options = (onIntent: (event: FoliumPlaybackSessionIntent) => void | Promise<void> = vi.fn()) => ({
    onIntent,
    restore: 'queue-stopped' as const,
});
const host = {
    play: vi.fn(async (_song: SongResult, request: PlaybackRequest) => {
        request.finish('source-committed');
    }),
    stop: vi.fn(),
    seek: vi.fn(),
};
beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState(original, true);
    registerExternalPlaybackActions(host);
});
afterEach(async () => {
    await reconcileFoliumClients([], 'main');
    for (const id of ['session-test', 'other']) disposeFoliumServices(id);
    releaseAllExternalPlayback();
    registerExternalPlaybackActions(null);
});

describe('experimental playback.sessions', () => {
    it('reports source failure to the mod and returns failed without releasing its queue ownership', async () => {
        clearFoliumIssues('session-test');
        host.play.mockRejectedValueOnce(new Error('source load failed'));
        const lease = createFoliumPlaybackSessions(mod()).acquire(options());
        expect(await lease.play(toFoliumSong(song())!)).toEqual({ status: 'failed' });
        expect(useFoliumStatusStore.getState().issues['session-test']).toEqual([
            expect.objectContaining({ where: 'playback session', message: 'source load failed' }),
        ]);
        expect(hasExternalPlayback()).toBe(true);
    });

    it('is unavailable in the export context even when experimental services are supplied', () => {
        const allowed = mod();
        const api = createFoliumClientApi(allowed, {
            context: 'export',
            internals: null,
            experimental: createFoliumExperimental(allowed),
        });
        expect(() => api.experimental['playback.sessions']).toThrow('unavailable-in-export-context');
        expect(host.stop).not.toHaveBeenCalled();
    });
    it('uses the live host acquisition guard to reject recording without changing playback', () => {
        let recording = true;
        registerExternalPlaybackActions({ ...host, canAcquire: () => !recording });
        const service = createFoliumPlaybackSessions(mod());
        expect(() => service.acquire(options())).toThrow('external-playback-context-unavailable');
        expect(host.stop).not.toHaveBeenCalled();
        recording = false;
        service.acquire(options()).release();
        expect(hasExternalPlayback()).toBe(false);
    });
    it('requires opt-in and playback.control, without requiring internals or a pinned host', () => {
        expect(() => createFoliumPlaybackSessions(mod({ experimental: [] })).acquire(options())).toThrow(
            'experimental-not-declared',
        );
        const denied = mod({ permissions: [] });
        const deniedApi = createFoliumClientApi(denied, {
            context: 'main',
            internals: null,
            experimental: createFoliumExperimental(denied),
        });
        expect(() => deniedApi.experimental['playback.sessions'].acquire(options())).toThrow(
            'permission-denied:playback.control',
        );
        const allowed = mod();
        const api = createFoliumClientApi(allowed, {
            context: 'main',
            internals: null,
            experimental: createFoliumExperimental(allowed),
        });
        const lease = api.experimental['playback.sessions'].acquire(options());
        expect(hasExternalPlayback()).toBe(true);
        lease.release();
    });
    it('resolves opaque IDs through the explicitly selected Omni provider and plays their host refs', async () => {
        const service = createFoliumPlaybackSessions(mod());
        vi.mocked(omni.getSongDetail).mockResolvedValue(song('qq', 'opaque-mid'));
        const dto = await service.resolveSong('qq', 'opaque-mid');
        expect(omni.getSongDetail).toHaveBeenCalledWith('qq', 'opaque-mid');
        const lease = service.acquire(options());
        expect(await lease.play(dto)).toEqual({ status: 'source-committed' });
        expect(host.play.mock.calls[0][0].sourceRef).toMatchObject({ providerId: 'qq' });
    });
    it('preserves the discriminated seek payload and distinct enqueue/play intents', () => {
        const received: FoliumPlaybackSessionIntent[] = [];
        createFoliumPlaybackSessions(mod()).acquire(
            options((intent) => {
                received.push(intent);
            }),
        );
        routeExternalPlayback({ type: 'seek', seconds: 22, resume: false });
        routeExternalPlayback({ type: 'enqueue', songs: [song()] });
        routeExternalPlayback({ type: 'play', song: song() });
        const intent = received[0];
        if (intent.type !== 'seek') throw Error('Expected seek');
        const seconds: number = intent.seconds;
        expect(seconds).toBe(22);
        expect(intent.resume).toBe(false);
        expect(received.map((event) => event.type)).toEqual(['seek', 'enqueue', 'play']);
    });
    it('reports cancelled host work instead of claiming that an empty load committed a source', async () => {
        host.play.mockImplementationOnce(async () => {});
        const lease = createFoliumPlaybackSessions(mod()).acquire(options());
        expect(await lease.play(toFoliumSong(song())!)).toEqual({ status: 'cancelled' });
    });
    it('cancels pending play on teardown and makes retained service handles unusable', async () => {
        host.play.mockImplementationOnce(() => new Promise(() => {}));
        const service = createFoliumPlaybackSessions(mod()),
            lease = service.acquire(options());
        const pending = lease.play(toFoliumSong(song())!);
        disposeFoliumServices('session-test');
        expect(await pending).toEqual({ status: 'cancelled' });
        expect(hasExternalPlayback()).toBe(false);
        expect(() => service.acquire(options())).toThrow('mod-service-disposed');
        expect(await lease.play(toFoliumSong(song())!)).toEqual({ status: 'cancelled' });
    });
    it('releases on host teardown, and even stop errors cannot strand the owner or original queue', () => {
        const queue = [song()];
        usePlaybackStore.setState({ playQueue: queue });
        createFoliumPlaybackSessions(mod()).acquire(options());
        host.stop.mockImplementationOnce(() => {
            throw Error('failed stop');
        });
        registerExternalPlaybackActions(null);
        expect(hasExternalPlayback()).toBe(false);
        expect(usePlaybackStore.getState().playQueue).toEqual(queue);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
    });
    it('rejects FM and Stage before mutating their queues or context', () => {
        const queue = [song()];
        usePlaybackStore.setState({ playQueue: queue, isFmMode: true });
        const service = createFoliumPlaybackSessions(mod());
        expect(() => service.acquire(options())).toThrow('external-playback-context-unavailable');
        expect(usePlaybackStore.getState().isFmMode).toBe(true);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
        usePlaybackStore.setState({ isFmMode: false, activePlaybackContext: 'stage' });
        expect(() => service.acquire(options())).toThrow('external-playback-context-unavailable');
        expect(host.stop).not.toHaveBeenCalled();
        expect(hasExternalPlayback()).toBe(false);
    });
    it('rolls back an acquisition that fails while stopping the host', () => {
        const queue = [song()];
        usePlaybackStore.setState({ playQueue: queue });
        host.stop.mockImplementationOnce(() => {
            throw Error('stop failed');
        });
        expect(() => createFoliumPlaybackSessions(mod()).acquire(options())).toThrow('stop failed');
        expect(hasExternalPlayback()).toBe(false);
        expect(usePlaybackStore.getState().playQueue).toEqual(queue);
    });
    it('cleans a lease acquired before a client activation throws', async () => {
        const source = `export default api => { api.experimental['playback.sessions'].acquire({restore:'queue-stopped',onIntent(){}}); throw Error('activation failed'); };`;
        await reconcileFoliumClients(
            [mod({ clientUrl: `data:text/javascript,${encodeURIComponent(source)}` })],
            'main',
        );
        expect(host.stop).toHaveBeenCalledTimes(2);
        expect(hasExternalPlayback()).toBe(false);
    });
    it('cleans a lease even when the client disposer throws', async () => {
        const source = `export default api => { api.experimental['playback.sessions'].acquire({restore:'queue-stopped',onIntent(){}}); return () => { throw Error('dispose failed'); }; };`;
        await reconcileFoliumClients(
            [mod({ clientUrl: `data:text/javascript,${encodeURIComponent(source)}` })],
            'main',
        );
        expect(hasExternalPlayback()).toBe(true);
        await reconcileFoliumClients([], 'main');
        expect(hasExternalPlayback()).toBe(false);
    });
});


it('validates and updates transport capabilities without allowing disabled intents to fall through', () => {
    const dispatch = vi.fn();
    const api = createFoliumPlaybackSessions(mod());
    expect(() => api.acquire({ ...options(), capabilities: { canNext: 'yes' } as never })).toThrow('invalid-playback-session-capabilities');
    expect(host.stop).not.toHaveBeenCalled();
    const lease = api.acquire({ ...options(), onIntent: dispatch, capabilities: { canNext: true, canPrevious: false, canSeek: false } });
    expect(routeExternalPlayback({ type: 'previous' })).toBe(true);
    expect(routeExternalPlayback({ type: 'seek', seconds: 10, resume: true })).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    lease.setCapabilities({ canNext: false, canPrevious: true, canSeek: true });
    expect(getExternalPlaybackCapabilities()).toEqual({ canNext: false, canPrevious: true, canSeek: true });
    routeExternalPlayback({ type: 'next' });
    expect(dispatch).not.toHaveBeenCalled();
    routeExternalPlayback({ type: 'seek', seconds: 10, resume: false });
    expect(dispatch).toHaveBeenCalledWith({ type: 'seek', seconds: 10, resume: false });
    lease.release();
    expect(getExternalPlaybackCapabilities()).toBeNull();
    expect(() => lease.setCapabilities({ canNext: true, canPrevious: true, canSeek: true })).toThrow('playback-session-released');
});

it('stops media and pending loads without releasing the session', async () => {
    const service = createFoliumPlaybackSessions(mod());
    const lease = service.acquire(options());
    host.play.mockReturnValueOnce(new Promise(() => {}));
    const loading = lease.play(toFoliumSong(song())!);
    lease.stop();
    expect(await loading).toEqual({ status: 'cancelled' });
    expect(hasExternalPlayback()).toBe(true);
    expect(usePlaybackStore.getState().audioSrc).toBeNull();
    expect(() => service.acquire(options())).toThrow('external-playback-busy');
});


it('reports superseded when another lease load replaces a pending source', async () => {
    host.play.mockImplementation(() => new Promise<void>(() => {}));
    const lease = createFoliumPlaybackSessions(mod()).acquire(options());
    const first = lease.play(toFoliumSong(song())!);
    const second = lease.play(toFoliumSong(song())!);
    expect(await first).toEqual({ status: 'superseded' });
    lease.stop();
    expect(await second).toEqual({ status: 'cancelled' });
});
