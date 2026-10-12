import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState, type SongResult } from '@/types';
import type { ProviderCollection } from '@/types/onlineMusic';
import { currentTime } from '@/stores/motionSignals';
import { selectHeartbeatSequentialPlayback, useHeartbeatModeStore } from '@/stores/useHeartbeatModeStore';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { refillHeartbeatQueue, startHeartbeatMode, stopHeartbeatMode, watchHeartbeatLifetime } from '@/services/heartbeatPlayback';
import { buildHeartbeatReturnQueue, exitHeartbeatMode, finishEmptyHeartbeatReturn,
    prepareHeartbeatReturnQueue } from '@/components/app/playback/heartbeatQueueReturn';

// test/unit/playback/heartbeatQueueReturn.test.ts — exiting restores the ordinary queue without interrupting audio.

const api = vi.hoisted(() => ({
    getProviderCapabilities: vi.fn(), getUserPlaylists: vi.fn(), getCollectionTracks: vi.fn(),
    getHeartbeatSongs: vi.fn(), isSongUnavailable: vi.fn(), persistPlaybackCache: vi.fn(),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: api.isSongUnavailable }));
vi.mock('@/components/app/playback/persistPlaybackCache', () => ({ persistPlaybackCache: api.persistPlaybackCache }));
vi.mock('@/components/app/playback/createCoverUrlResolver', () => ({ createCoverUrlResolver: () => () => null }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));

const song = (id: string, providerId = 'netease'): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 120000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
});
const [a, b, c, x, y] = ['a', 'b', 'c', 'x', 'y'].map(id => song(id));
const originalQueue = [a, b, c];
const likedPlaylist: ProviderCollection = {
    providerId: 'netease', id: 'likes', name: 'My likes', type: 'playlist', isLiked: true,
    isOwned: true, creator: { id: 'listener', nickname: 'Listener' },
};
const page = <T,>(items: T[]) => ({ items, hasMore: false, nextOffset: items.length });
const commitPlay = (currentSong: SongResult, playQueue?: SongResult[]) => {
    usePlaybackStore.setState({ currentSong, ...(playQueue ? { playQueue } : {}), isFmMode: false });
};
let stopWatching: (() => void) | undefined;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.resetAllMocks();
    api.getProviderCapabilities.mockReturnValue({ heartbeatRecommendations: true });
    api.isSongUnavailable.mockReturnValue(false);
    api.getUserPlaylists.mockResolvedValue(page([likedPlaylist]));
    api.getCollectionTracks.mockResolvedValue(page([x]));
    api.getHeartbeatSongs.mockResolvedValue([y]);
    api.persistPlaybackCache.mockResolvedValue(undefined);
    useHeartbeatModeStore.setState({ session: null, loading: false, generation: 0, originalPlayback: null, pendingReturn: null });
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
    useOnlineProviderAccountStore.getState().updateAccount('netease', {
        status: 'authenticated', user: { id: 'listener', nickname: 'Listener' }, collections: [likedPlaylist],
    });
    usePlaybackStore.setState({
        currentSong: b, playQueue: [...originalQueue], activePlaybackContext: 'main', isFmMode: false,
        audioSrc: 'blob:still-playing', playerState: PlayerState.PLAYING, duration: 120,
        lyrics: { lines: [] }, currentLineIndex: 7, cachedCoverUrl: 'blob:cover', transitionDisplay: null,
    });
    currentTime.set(41);
});

afterEach(() => { stopWatching?.(); stopWatching = undefined; });

describe('explicit Heartbeat exit', () => {
    it.each([PlayerState.PLAYING, PlayerState.PAUSED])('returns before the original middle cursor without interrupting %s audio', async playerState => {
        await startHeartbeatMode(commitPlay);
        usePlaybackStore.setState({ playerState });
        const before = usePlaybackStore.getState();
        exitHeartbeatMode();
        const after = usePlaybackStore.getState();

        expect(after.playQueue).toEqual([a, x, b, c]);
        expect({ ...after, playQueue: before.playQueue }).toEqual(before);
        expect(currentTime.get()).toBe(41);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ session: null, loading: false, originalPlayback: null });
        expect(selectHeartbeatSequentialPlayback(useHeartbeatModeStore.getState())).toBe(true);
        expect(api.persistPlaybackCache).toHaveBeenCalledWith(x, [a, x, b, c]);
    });

    it('restores exact ordering on the next ordinary play and only releases sequential mode when it commits', async () => {
        stopWatching = watchHeartbeatLifetime();
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const bridge = usePlaybackStore.getState().playQueue;
        const restored = prepareHeartbeatReturnQueue(b, bridge);
        expect(restored).toEqual(originalQueue);
        expect(selectHeartbeatSequentialPlayback(useHeartbeatModeStore.getState())).toBe(true);
        usePlaybackStore.getState().setPlayQueue(restored);
        expect(useHeartbeatModeStore.getState().pendingReturn).not.toBeNull();
        usePlaybackStore.getState().setCurrentSong(b);
        expect(useHeartbeatModeStore.getState().pendingReturn).toBeNull();
        expect(selectHeartbeatSequentialPlayback(useHeartbeatModeStore.getState())).toBe(false);
        expect(usePlaybackStore.getState().playQueue).toEqual(originalQueue);
    });

    it('restores directly when the departing song is already the original cursor', async () => {
        api.getCollectionTracks.mockResolvedValue(page([b]));
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        expect(usePlaybackStore.getState().playQueue).toEqual(originalQueue);
        expect(usePlaybackStore.getState().currentSong).toBe(b);
        expect(useHeartbeatModeStore.getState().pendingReturn).toBeNull();
        expect(selectHeartbeatSequentialPlayback(useHeartbeatModeStore.getState())).toBe(false);
    });

    it.each([a, c])('does not duplicate an existing ordinary track $id before returning to the original cursor', async current => {
        api.getCollectionTracks.mockResolvedValue(page([current]));
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const bridge = usePlaybackStore.getState().playQueue;
        expect(bridge.filter(item => item.id === current.id)).toHaveLength(1);
        expect(bridge[bridge.indexOf(current) + 1]).toBe(b);
        expect(prepareHeartbeatReturnQueue(b, bridge)).toEqual(originalQueue);
    });

    it('retains same-numbered tracks from other providers and preserves the snapshot array', () => {
        const foreign = song('x', 'kugou');
        const queue = [foreign, b, c];
        const snapshot = { queue, currentSong: b };
        expect(buildHeartbeatReturnQueue(snapshot, x)).toEqual([foreign, x, b, c]);
        expect(queue).toEqual([foreign, b, c]);
    });

    it('keeps a departing song once when there was no ordinary queue and clears it after completion', async () => {
        usePlaybackStore.setState({ currentSong: null, playQueue: [] });
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        expect(usePlaybackStore.getState().playQueue).toEqual([x]);
        expect(selectHeartbeatSequentialPlayback(useHeartbeatModeStore.getState())).toBe(true);
        finishEmptyHeartbeatReturn();
        expect(usePlaybackStore.getState().playQueue).toEqual([]);
        expect(usePlaybackStore.getState().currentSong).toBe(x);
        expect(useHeartbeatModeStore.getState().pendingReturn).toBeNull();
        expect(api.persistPlaybackCache).toHaveBeenLastCalledWith(x, []);
    });

    it('does not clear a nonempty restored queue when ordinary playback reaches its end', async () => {
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const bridge = usePlaybackStore.getState().playQueue;
        finishEmptyHeartbeatReturn();
        expect(usePlaybackStore.getState().playQueue).toBe(bridge);
        expect(useHeartbeatModeStore.getState().pendingReturn).not.toBeNull();
    });

    it('makes a second explicit exit harmless while the current song is finishing', async () => {
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const pending = useHeartbeatModeStore.getState().pendingReturn;
        const queue = usePlaybackStore.getState().playQueue;
        exitHeartbeatMode();
        expect(useHeartbeatModeStore.getState().pendingReturn).toBe(pending);
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
        expect(api.persistPlaybackCache).toHaveBeenCalledOnce();
    });

    it('does not overwrite queue edits or unrelated replacement plays during the return', async () => {
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const bridge = usePlaybackStore.getState().playQueue;
        const edited = [...bridge, song('added')];
        expect(prepareHeartbeatReturnQueue(b, edited)).toBe(edited);
        expect(prepareHeartbeatReturnQueue(song('unrelated'), bridge)).toBe(bridge);
        expect(prepareHeartbeatReturnQueue(x, bridge)).toBe(bridge);
    });
});

describe('Heartbeat queue snapshot ownership', () => {
    it('attaches a copied snapshot only after the first successful queue commit', async () => {
        const queue = usePlaybackStore.getState().playQueue;
        const pendingPlay = deferred<void>();
        let commit!: () => void;
        const starting = startHeartbeatMode((current, nextQueue) => {
            commit = () => commitPlay(current, nextQueue);
            return pendingPlay.promise;
        });
        await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
        expect(useHeartbeatModeStore.getState().originalPlayback).toBeNull();
        commit();
        expect(useHeartbeatModeStore.getState().originalPlayback).toEqual({ queue: originalQueue, currentSong: b });
        expect(useHeartbeatModeStore.getState().originalPlayback!.queue).not.toBe(queue);
        pendingPlay.resolve();
        expect(await starting).toBe(true);
    });

    it('cancels an uncommitted start without restoring, and rejects its late response', async () => {
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const play = vi.fn(commitPlay);
        const before = usePlaybackStore.getState();
        const starting = startHeartbeatMode(play);
        await vi.waitFor(() => expect(api.getHeartbeatSongs).toHaveBeenCalledOnce());
        exitHeartbeatMode();
        pending.resolve([y]);
        expect(await starting).toBe(false);
        expect(play).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState()).toBe(before);
        expect(useHeartbeatModeStore.getState()).toMatchObject({ originalPlayback: null, pendingReturn: null, session: null });
        expect(api.persistPlaybackCache).not.toHaveBeenCalled();
    });

    it('does not save a restoration snapshot when playback declines the start', async () => {
        expect(await startHeartbeatMode(() => undefined)).toBe(false);
        exitHeartbeatMode();
        expect(useHeartbeatModeStore.getState()).toMatchObject({ originalPlayback: null, pendingReturn: null });
        expect(usePlaybackStore.getState().playQueue).toEqual(originalQueue);
        expect(api.persistPlaybackCache).not.toHaveBeenCalled();
    });

    it('ignores a refill that resolves after explicit exit', async () => {
        await startHeartbeatMode(commitPlay);
        const pending = deferred<SongResult[]>();
        api.getHeartbeatSongs.mockReturnValue(pending.promise);
        const refilling = refillHeartbeatQueue(usePlaybackStore.getState().playQueue);
        exitHeartbeatMode();
        const queue = usePlaybackStore.getState().playQueue;
        pending.resolve([song('late')]);
        expect(await refilling).toBeNull();
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
        expect(queue).toEqual([a, x, b, c]);
    });

    it('keeps the original ordinary cursor when Heartbeat restarts before the departing track finishes', async () => {
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        expect(usePlaybackStore.getState().playQueue).toEqual([a, x, b, c]);
        api.getCollectionTracks.mockResolvedValue(page([y]));
        api.getHeartbeatSongs.mockResolvedValue([song('new-recommendation')]);
        expect(await startHeartbeatMode(commitPlay)).toBe(true);
        exitHeartbeatMode();
        expect(usePlaybackStore.getState().currentSong).toBe(y);
        expect(usePlaybackStore.getState().playQueue).toEqual([a, y, b, c]);
        expect(prepareHeartbeatReturnQueue(b, usePlaybackStore.getState().playQueue)).toEqual(originalQueue);
    });

    it('passive cancellation discards the snapshot without replacing caller-owned playback', async () => {
        await startHeartbeatMode(commitPlay);
        const heartbeatQueue = usePlaybackStore.getState().playQueue;
        stopHeartbeatMode();
        expect(usePlaybackStore.getState().playQueue).toBe(heartbeatQueue);
        const replacement = [song('replacement')];
        commitPlay(replacement[0], replacement);
        exitHeartbeatMode();
        expect(usePlaybackStore.getState().playQueue).toBe(replacement);
        expect(api.persistPlaybackCache).not.toHaveBeenCalled();
    });

    it.each(['account', 'stage', 'fm', 'new-song'] as const)('invalidates the pending return after %s changes', async reason => {
        stopWatching = watchHeartbeatLifetime();
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const queue = usePlaybackStore.getState().playQueue;
        if (reason === 'account') useOnlineProviderAccountStore.getState().updateAccount('netease', { user: { id: 'other', nickname: 'Other' } });
        if (reason === 'stage') usePlaybackStore.getState().setActivePlaybackContext('stage');
        if (reason === 'fm') usePlaybackStore.getState().setIsFmMode(true);
        if (reason === 'new-song') usePlaybackStore.getState().setCurrentSong(y);
        expect(useHeartbeatModeStore.getState().pendingReturn).toBeNull();
        expect(usePlaybackStore.getState().playQueue).toBe(queue);
    });

    it('keeps pending return through same-song metadata refresh and same-account cache updates', async () => {
        stopWatching = watchHeartbeatLifetime();
        await startHeartbeatMode(commitPlay);
        exitHeartbeatMode();
        const pending = useHeartbeatModeStore.getState().pendingReturn;
        usePlaybackStore.getState().setCurrentSong({ ...x, name: 'Updated title' });
        useOnlineProviderAccountStore.getState().updateAccount('netease', { likedSongIds: ['x'], freshness: 'fresh' });
        expect(useHeartbeatModeStore.getState().pendingReturn).toBe(pending);
    });
});
