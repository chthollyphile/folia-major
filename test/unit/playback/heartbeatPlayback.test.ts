import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderCollection } from '@/types/onlineMusic';
import { useHeartbeatModeStore } from '@/stores/useHeartbeatModeStore';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { canStartHeartbeatMode, refillHeartbeatQueue, startHeartbeatMode, stopHeartbeatMode,
    watchHeartbeatLifetime } from '@/services/heartbeatPlayback';

// test/unit/playback/heartbeatPlayback.test.ts — real store transitions with deferred provider responses.

const api = vi.hoisted(() => ({
    getProviderCapabilities: vi.fn(), getUserPlaylists: vi.fn(),
    getCollectionTracks: vi.fn(), getHeartbeatSongs: vi.fn(), isSongUnavailable: vi.fn(),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: api.isSongUnavailable }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/components/app/playback/createCoverUrlResolver', () => ({ createCoverUrlResolver: () => () => null }));

const song = (id: string, providerId = 'netease'): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
});
const likedPlaylist: ProviderCollection = {
    providerId: 'netease', id: 'liked-playlist', name: 'My likes', type: 'playlist',
    isLiked: true, isOwned: true, creator: { id: 'listener', nickname: 'Listener' },
};
const seed = song('seed');
const recommended = song('recommended');
const page = <T,>(items: T[], hasMore = false, nextOffset = items.length) => ({ items, hasMore, nextOffset });
let stopWatching: (() => void) | undefined;

// Keep the response pending while another synchronous store action changes ownership.
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const playSong = vi.fn((currentSong: SongResult, playQueue?: SongResult[]) => {
    usePlaybackStore.setState({ currentSong, ...(playQueue ? { playQueue } : {}), isFmMode: false });
});

beforeEach(() => {
    vi.resetAllMocks();
    api.getProviderCapabilities.mockReturnValue({ heartbeatRecommendations: true });
    api.isSongUnavailable.mockReturnValue(false);
    api.getUserPlaylists.mockResolvedValue(page([likedPlaylist]));
    api.getCollectionTracks.mockResolvedValue(page([seed]));
    api.getHeartbeatSongs.mockResolvedValue([recommended]);
    playSong.mockImplementation((currentSong, playQueue) => {
        usePlaybackStore.setState({ currentSong, ...(playQueue ? { playQueue } : {}), isFmMode: false });
    });
    useHeartbeatModeStore.setState({ session: null, loading: false, generation: 0, originalPlayback: null, pendingReturn: null });
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    useOnlineProviderAccountStore.getState().updateAccount('netease', {
        status: 'authenticated', user: { id: 'listener', nickname: 'Listener' }, collections: [likedPlaylist],
    });
    const original = song('original');
    usePlaybackStore.setState({ currentSong: original, playQueue: [original], activePlaybackContext: 'main', isFmMode: false });
    useStatusMessageStore.setState({ message: null });
});

afterEach(() => { stopWatching?.(); stopWatching = undefined; });

describe('Heartbeat start', () => {
    it('finds the active account liked playlist and sends its actual seed source ID', async () => {
        useOnlineProviderAccountStore.getState().updateAccount('netease', { collections: [] });
        const unrelated: ProviderCollection = { ...likedPlaylist, id: 'ordinary', isLiked: false };
        const foreign: ProviderCollection = { ...likedPlaylist, providerId: 'kugou' };
        api.getUserPlaylists.mockResolvedValueOnce(page([unrelated, foreign], true, 100))
            .mockResolvedValueOnce(page([likedPlaylist], false, 101));
        const seedWithLegacyId = { ...seed, id: 'legacy-row-id' };
        api.getCollectionTracks.mockResolvedValue(page([song('other-liked'), seedWithLegacyId]));
        usePlaybackStore.setState({ currentSong: seed });

        expect(await startHeartbeatMode(playSong)).toBe(true);
        expect(api.getUserPlaylists.mock.calls).toEqual([
            ['listener', { limit: 100, offset: 0 }], ['listener', { limit: 100, offset: 100 }],
        ]);
        expect(api.getCollectionTracks).toHaveBeenCalledWith(likedPlaylist, { limit: 100, offset: 0 });
        expect(api.getHeartbeatSongs).toHaveBeenCalledWith(expect.objectContaining({
            playlistId: likedPlaylist.id, seedSongId: 'seed', startSongId: 'seed', providerId: 'netease', userId: 'listener',
        }));
        expect(playSong).toHaveBeenCalledWith(seedWithLegacyId, [seedWithLegacyId, recommended], false,
            expect.objectContaining({ heartbeatSessionId: useHeartbeatModeStore.getState().session?.id }));
        expect(useHeartbeatModeStore.getState().loading).toBe(false);
    });

    it('deduplicates by source identity and excludes other providers, local tracks and unavailable tracks', async () => {
        const duplicate = { ...recommended, id: 'different-legacy-row' };
        const blocked = song('blocked');
        const local: SongResult = { ...song('local'), sourceRef: { kind: 'local', mediaId: 'local' } };
        api.isSongUnavailable.mockImplementation((candidate: SongResult) => candidate === blocked);
        api.getHeartbeatSongs.mockResolvedValue([seed, song('recommended', 'kugou'), recommended, duplicate, blocked, local]);

        expect(await startHeartbeatMode(playSong)).toBe(true);
        expect(usePlaybackStore.getState().playQueue).toEqual([seed, recommended]);
    });

    it('can enter from a local track while playback resets FM before committing the new current song', async () => {
        const local: SongResult = { ...song('local'), sourceRef: { kind: 'local', mediaId: 'local' } };
        usePlaybackStore.setState({ currentSong: local, playQueue: [local] });
        stopWatching = watchHeartbeatLifetime();
        playSong.mockImplementation((currentSong, playQueue) => {
            usePlaybackStore.getState().setIsFmMode(false);
            usePlaybackStore.setState({ currentSong, playQueue });
        });
        expect(await startHeartbeatMode(playSong)).toBe(true);
        expect(useHeartbeatModeStore.getState().session).not.toBeNull();
        expect(usePlaybackStore.getState().playQueue).toEqual([seed, recommended]);
    });

    it('does not claim an active session when playback declines without committing the queue', async () => {
        const before = usePlaybackStore.getState();
        playSong.mockImplementation(() => {
            useStatusMessageStore.setState({ message: { type: 'error', text: 'Audio URL unavailable' } });
        });
        expect(await startHeartbeatMode(playSong)).toBe(false);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: false });
        expect(usePlaybackStore.getState().playQueue).toBe(before.playQueue);
        expect(useStatusMessageStore.getState().message).toEqual({ type: 'error', text: 'Audio URL unavailable' });
    });

    it.each(['empty likes', 'empty recommendations', 'network failure'] as const)('%s leaves existing playback intact', async reason => {
        const before = usePlaybackStore.getState();
        if (reason === 'empty likes') api.getCollectionTracks.mockResolvedValue(page([]));
        if (reason === 'empty recommendations') api.getHeartbeatSongs.mockResolvedValue([seed]);
        if (reason === 'network failure') api.getHeartbeatSongs.mockRejectedValue(new Error('offline'));

        expect(await startHeartbeatMode(playSong)).toBe(false);
        expect(playSong).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playQueue).toBe(before.playQueue);
        expect(usePlaybackStore.getState().currentSong).toBe(before.currentSong);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: false });
        expect(useStatusMessageStore.getState().message?.type).toBe('error');
    });

    it.each(['anonymous', 'unsupported', 'stage'] as const)('does not start when %s', async reason => {
        if (reason === 'anonymous') useOnlineProviderAccountStore.getState().clearAccount('netease');
        if (reason === 'unsupported') api.getProviderCapabilities.mockReturnValue({ heartbeatRecommendations: false });
        if (reason === 'stage') usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        expect(canStartHeartbeatMode()).toBe(false);
        expect(await startHeartbeatMode(playSong)).toBe(false);
        expect(api.getCollectionTracks).not.toHaveBeenCalled();
        expect(api.getHeartbeatSongs).not.toHaveBeenCalled();
    });
});

const ownershipChanges = {
    stop: () => stopHeartbeatMode(),
    logout: () => useOnlineProviderAccountStore.getState().clearAccount('netease'),
    provider: () => useOnlineProviderAccountStore.getState().setActiveProviderId('kugou'),
    account: () => useOnlineProviderAccountStore.getState().updateAccount('netease', { user: { id: 'other-listener', nickname: 'Other' } }),
    queue: () => usePlaybackStore.getState().setPlayQueue([song('replacement')]),
    song: () => usePlaybackStore.getState().setCurrentSong(song('replacement')),
    stage: () => usePlaybackStore.getState().setActivePlaybackContext('stage'),
};

describe('Heartbeat async ownership', () => {
    it('rejects a second start while the first request is pending', async () => {
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const starting = startHeartbeatMode(playSong);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        expect(await startHeartbeatMode(playSong)).toBe(false);
        pending.resolve([recommended]);
        expect(await starting).toBe(true);
        expect(api.getHeartbeatSongs).toHaveBeenCalledOnce();
        expect(playSong).toHaveBeenCalledOnce();
    });

    it.each(Object.entries(ownershipChanges))('discards a late start after %s changes', async (_reason, change) => {
        stopWatching = watchHeartbeatLifetime();
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const starting = startHeartbeatMode(playSong);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        change();
        const playbackAfterChange = usePlaybackStore.getState();
        pending.resolve([recommended]);

        expect(await starting).toBe(false);
        expect(playSong).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState().playQueue).toBe(playbackAfterChange.playQueue);
        expect(usePlaybackStore.getState().currentSong).toBe(playbackAfterChange.currentSong);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: false });
    });

    it('invalidates a start even if the account switches away and back before the response arrives', async () => {
        stopWatching = watchHeartbeatLifetime();
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const starting = startHeartbeatMode(playSong);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        ownershipChanges.account();
        useOnlineProviderAccountStore.getState().updateAccount('netease', { user: { id: 'listener', nickname: 'Listener' } });
        pending.resolve([recommended]);
        expect(await starting).toBe(false);
        expect(playSong).not.toHaveBeenCalled();
    });

    it('keeps a pending start alive during same-account cache and unrelated account refreshes', async () => {
        stopWatching = watchHeartbeatLifetime();
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const starting = startHeartbeatMode(playSong);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        useOnlineProviderAccountStore.getState().updateAccount('netease', { freshness: 'fresh', likedSongIds: ['seed'] });
        useOnlineProviderAccountStore.getState().updateAccount('kugou', { freshness: 'refreshing' });
        pending.resolve([recommended]);
        expect(await starting).toBe(true);
        expect(playSong).toHaveBeenCalledOnce();
    });

    it('allows same-song metadata refreshes while start is pending', async () => {
        stopWatching = watchHeartbeatLifetime();
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const starting = startHeartbeatMode(playSong);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        const current = usePlaybackStore.getState().currentSong!;
        usePlaybackStore.getState().setCurrentSong({ ...current, name: 'Refreshed metadata' });
        pending.resolve([recommended]);
        expect(await starting).toBe(true);
        expect(playSong).toHaveBeenCalledOnce();
    });
});

describe('Heartbeat refill', () => {
    it('starts a fresh refill after same-queue navigation and keeps its singleflight when the old request settles', async () => {
        await startHeartbeatMode(playSong);
        const queue = usePlaybackStore.getState().playQueue;
        const oldResponse = deferred<SongResult[]>();
        const newResponse = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
        const oldRefill = refillHeartbeatQueue(queue);
        usePlaybackStore.getState().setCurrentSong(recommended);
        const currentRefill = refillHeartbeatQueue(queue);
        expect(currentRefill).not.toBe(oldRefill);
        oldResponse.resolve([song('stale')]);
        expect(await oldRefill).toBeNull();
        expect(refillHeartbeatQueue(queue)).toBe(currentRefill);
        expect(api.getHeartbeatSongs).toHaveBeenCalledTimes(3);
        newResponse.resolve([song('next')]);
        expect(await currentRefill).toEqual([...queue, song('next')]);
    });

    it('allows same-song metadata refreshes while a refill is pending', async () => {
        stopWatching = watchHeartbeatLifetime();
        await startHeartbeatMode(playSong);
        const queue = usePlaybackStore.getState().playQueue;
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const refilling = refillHeartbeatQueue(queue);
        usePlaybackStore.getState().setCurrentSong({ ...seed, name: 'Refreshed metadata' });
        pending.resolve([song('next')]);
        expect(await refilling).toEqual([...queue, song('next')]);
    });

    it('shares simultaneous refills and appends only fresh tracks using the last song as the next seed', async () => {
        await startHeartbeatMode(playSong);
        const queue = usePlaybackStore.getState().playQueue;
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const first = refillHeartbeatQueue(queue);
        const second = refillHeartbeatQueue(queue);
        expect(first).toBe(second);
        expect(api.getHeartbeatSongs).toHaveBeenCalledTimes(2);
        expect(api.getHeartbeatSongs).toHaveBeenLastCalledWith(expect.objectContaining({
            seedSongId: 'recommended', startSongId: 'seed', playlistId: likedPlaylist.id,
        }));
        const next = song('next');
        pending.resolve([seed, recommended, song('next', 'kugou'), next, { ...next, id: 'duplicate-row' }]);
        expect(await first).toEqual([seed, recommended, next]);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });

    it.each(Object.entries(ownershipChanges))('discards a late refill after %s changes', async (_reason, change) => {
        stopWatching = watchHeartbeatLifetime();
        await startHeartbeatMode(playSong);
        const queue = usePlaybackStore.getState().playQueue;
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const refilling = refillHeartbeatQueue(queue);
        change();
        const playbackAfterChange = usePlaybackStore.getState();
        pending.resolve([song('late')]);
        expect(await refilling).toBeNull();
        expect(usePlaybackStore.getState().playQueue).toBe(playbackAfterChange.playQueue);
        expect(usePlaybackStore.getState().currentSong).toBe(playbackAfterChange.currentSong);
    });

    it.each(['empty', 'failure'] as const)('preserves the queue on %s and allows a later retry', async outcome => {
        await startHeartbeatMode(playSong);
        const queue = usePlaybackStore.getState().playQueue;
        if (outcome === 'empty') api.getHeartbeatSongs.mockResolvedValueOnce([seed, recommended]);
        else api.getHeartbeatSongs.mockRejectedValueOnce(new Error('offline'));
        expect(await refillHeartbeatQueue(queue)).toBe(queue);
        api.getHeartbeatSongs.mockResolvedValueOnce([song('retry')]);
        expect(await refillHeartbeatQueue(queue)).toEqual([...queue, song('retry')]);
        expect(useHeartbeatModeStore.getState().session).not.toBeNull();
    });
});

describe('Heartbeat session store', () => {
    it('invalidates prior generations on begin and stop without touching playback', () => {
        const queue = usePlaybackStore.getState().playQueue;
        const first = useHeartbeatModeStore.getState().begin();
        stopHeartbeatMode();
        const second = useHeartbeatModeStore.getState().begin();
        expect(second).toBeGreaterThan(first);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: true });
        stopHeartbeatMode();
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: false });
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });
});
