import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, OmniExplorePage, ProviderCollection } from '@/types/onlineMusic';

// Daily recommendation previews follow successful Omni reads without rereading a feed or retaining another account's song.

const providerId = 'daily-preview-test';
const otherProviderId = 'daily-preview-other-test';
const song = (id: string, owner = providerId): UnifiedSong => ({
    id,
    name: id,
    artists: [],
    album: { id: '', name: '', coverUrl: `https://covers.test/${id}` },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: owner, mediaId: id },
});
const page = (firstSong?: UnifiedSong, dailySongs?: true, type = 'daily_recommendations'): OmniExplorePage => ({
    sections: [{
        id: 'recommendations',
        title: '',
        items: [{
            kind: 'collection',
            collection: {
                providerId,
                id: 'today',
                type,
                name: 'Today',
                songPreview: { firstSong, ...(dailySongs ? { dailySongs } : {}) },
            },
        }],
    }],
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};
const getDailySongs = vi.fn<NonNullable<NonNullable<OnlineMusicProvider['recommendations']>['getDailySongs']>>();
const getFeed = vi.fn<NonNullable<OnlineMusicProvider['explore']>['getFeed']>();
const subscriptions: Array<() => void> = [];

const provider = (id: string): OnlineMusicProvider => ({
    id,
    displayName: id,
    capabilities: {
        search: false, playback: false, lyrics: false, auth: true, userLibrary: false,
        playlists: false, albums: false, artists: false, recommendations: true,
        mutations: false, wordByWordLyrics: false, explore: true,
    },
    normalizeSong: () => song('normalized', id),
    recommendations: {
        getDailySongs,
        getHistorySongs: async () => [song('history', id)],
        getPersonalFm: async () => [song('fm', id)],
        getDailyStyleSongs: async () => ({ songs: [song('style', id)], selection: null }),
    },
    explore: { getFeed },
});

beforeEach(() => {
    getDailySongs.mockReset().mockResolvedValue([]);
    getFeed.mockReset().mockResolvedValue({ sections: [] });
    registerOnlineMusicProvider(provider(providerId));
    registerOnlineMusicProvider(provider(otherProviderId));
    const store = useOnlineProviderAccountStore.getState();
    store.clearAccount(providerId);
    store.clearAccount(otherProviderId);
    store.updateAccount(providerId, { status: 'authenticated', user: { id: 'listener', nickname: 'Listener' } });
    store.setActiveProviderId(providerId);
});

afterEach(() => {
    subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    unregisterOnlineMusicProvider(providerId);
    unregisterOnlineMusicProvider(otherProviderId);
    omni.invalidateActiveRequests();
});

describe('daily song previews through Omni', () => {
    it('updates a cached feed preview A after an independent daily read B, then follows a fresh feed C', async () => {
        const a = song('A');
        const b = song('B');
        const c = song('C');
        getFeed.mockResolvedValueOnce(page(a, true)).mockResolvedValueOnce(page(c, true));
        getDailySongs.mockResolvedValueOnce([b]);
        const listener = vi.fn();
        subscriptions.push(omni.subscribeDailySongPreview(listener));

        const originalFeed = await omni.getExploreFeed();
        const originalPreview = omni.getDailySongPreview();
        expect(originalPreview).toEqual({ providerId, firstSong: a });
        expect(omni.getDailySongPreview()).toBe(originalPreview);
        await expect(omni.getDailySongs(true)).resolves.toEqual([b]);

        expect(omni.getDailySongPreview()).toEqual({ providerId, firstSong: b });
        expect((originalFeed.sections[0].items[0] as { collection: ProviderCollection }).collection.songPreview?.firstSong).toBe(a);
        expect(getFeed).toHaveBeenCalledTimes(1);
        expect(getDailySongs).toHaveBeenCalledExactlyOnceWith(true);

        await omni.getExploreFeed();
        expect(omni.getDailySongPreview()).toEqual({ providerId, firstSong: c });
        expect(listener).toHaveBeenCalledTimes(3);
    });

    it.each(['feed', 'daily'] as const)('does not let an older %s response roll back a newer successful read', async olderKind => {
        const oldDaily = deferred<UnifiedSong[]>();
        const oldFeed = deferred<OmniExplorePage>();
        getDailySongs.mockImplementationOnce(() => oldDaily.promise).mockResolvedValueOnce([song('new')]);
        getFeed.mockImplementationOnce(() => oldFeed.promise).mockResolvedValueOnce(page(song('new'), true));
        const oldRead = olderKind === 'feed' ? omni.getExploreFeed() : omni.getDailySongs();
        if (olderKind === 'feed') {
            getDailySongs.mockReset().mockResolvedValue([song('new')]);
            await omni.getDailySongs();
            oldFeed.resolve(page(song('old'), true));
        } else {
            getFeed.mockReset().mockResolvedValue(page(song('new'), true));
            await omni.getExploreFeed();
            oldDaily.resolve([song('old')]);
        }
        const newerPreview = omni.getDailySongPreview();
        await oldRead;
        expect(omni.getDailySongPreview()).toBe(newerPreview);
        expect(newerPreview?.firstSong?.id).toBe('new');
    });

    it('accepts an older success when the newer read fails', async () => {
        const older = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => older.promise);
        getFeed.mockRejectedValueOnce(new Error('unavailable'));
        const oldRead = omni.getDailySongs();
        await expect(omni.getExploreFeed()).rejects.toThrow('unavailable');
        older.resolve([song('usable')]);
        await oldRead;
        expect(omni.getDailySongPreview()?.firstSong?.id).toBe('usable');
    });

    it('keeps a successful preview after failure or cancellation, and clears its song on an empty success', async () => {
        getDailySongs.mockResolvedValueOnce([song('kept')]);
        await omni.getDailySongs();
        const kept = omni.getDailySongPreview();
        getDailySongs.mockRejectedValueOnce(new Error('unavailable'));
        await expect(omni.getDailySongs()).rejects.toThrow('unavailable');
        expect(omni.getDailySongPreview()).toBe(kept);

        const canceled = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => canceled.promise);
        const canceledRead = omni.getDailySongs();
        omni.invalidateActiveRequests();
        canceled.resolve([song('canceled')]);
        await expect(canceledRead).rejects.toMatchObject({ name: 'AbortError' });
        expect(omni.getDailySongPreview()).toBe(kept);

        await omni.getDailySongs();
        expect(omni.getDailySongPreview()).toEqual({ providerId, firstSong: undefined });
    });

    it('only publishes explicitly opted-in daily feed cards, leaving history, FM and style reads alone', async () => {
        getDailySongs.mockResolvedValueOnce([song('today')]);
        await omni.getDailySongs();
        const today = omni.getDailySongPreview();
        getFeed.mockResolvedValueOnce(page(song('historical-card'))).mockResolvedValueOnce({ sections: [] });
        await omni.getRecommendationHistorySongs('yesterday');
        await omni.getPersonalFm();
        await omni.getDailyStyleSongs();
        await omni.getExploreFeed();
        await omni.getExploreFeed();
        expect(omni.getDailySongPreview()).toBe(today);

        getFeed.mockResolvedValueOnce(page(undefined, true));
        await omni.getExploreFeed();
        expect(omni.getDailySongPreview()).toBe(today);
    });

    it('keeps known B after a partial daily feed with no song, without blocking an earlier successful read', async () => {
        getDailySongs.mockResolvedValueOnce([song('B')]);
        await omni.getDailySongs();
        const known = omni.getDailySongPreview();
        const earlier = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => earlier.promise);
        const earlierRead = omni.getDailySongs();
        getFeed.mockResolvedValueOnce(page(undefined, true));

        await omni.getExploreFeed();
        expect(omni.getDailySongPreview()).toBe(known);
        earlier.resolve([song('successful')]);
        await earlierRead;
        expect(omni.getDailySongPreview()?.firstSong?.id).toBe('successful');
    });

    it('ignores non-daily feed cards even when they erroneously opt in', async () => {
        getDailySongs.mockResolvedValueOnce([song('today')]);
        await omni.getDailySongs();
        const today = omni.getDailySongPreview();
        getFeed.mockResolvedValueOnce(page(song('playlist'), true, 'playlist'));

        await omni.getExploreFeed();
        expect(omni.getDailySongPreview()).toBe(today);
    });

    it('clears and rejects old previews across a provider switch, including a switch back before completion', async () => {
        getDailySongs.mockResolvedValueOnce([song('before-switch')]);
        await omni.getDailySongs();
        const older = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => older.promise);
        const oldRead = omni.getDailySongs();
        const listener = vi.fn();
        subscriptions.push(omni.subscribeDailySongPreview(listener));
        const store = useOnlineProviderAccountStore.getState();
        store.setActiveProviderId(otherProviderId);
        expect(omni.getDailySongPreview()).toBeNull();
        store.setActiveProviderId(providerId);
        older.resolve([song('wrong-owner')]);
        await oldRead;
        expect(omni.getDailySongPreview()).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('clears a preview and ignores an old feed after switching accounts', async () => {
        getDailySongs.mockResolvedValueOnce([song('first-account')]);
        await omni.getDailySongs();
        const oldFeed = deferred<OmniExplorePage>();
        getFeed.mockImplementationOnce(() => oldFeed.promise);
        const oldRead = omni.getExploreFeed();
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'another-listener', nickname: 'Another listener' },
        });
        expect(omni.getDailySongPreview()).toBeNull();
        getDailySongs.mockResolvedValueOnce([song('second-account')]);
        await omni.getDailySongs();
        const current = omni.getDailySongPreview();
        oldFeed.resolve(page(song('stale-account'), true));
        await oldRead;
        expect(omni.getDailySongPreview()).toBe(current);
    });

    it('does not accept a pre-logout read after logging back into the same account', async () => {
        getDailySongs.mockResolvedValueOnce([song('before-logout')]);
        await omni.getDailySongs();
        const older = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => older.promise);
        const oldRead = omni.getDailySongs();
        const store = useOnlineProviderAccountStore.getState();
        store.clearAccount(providerId);
        store.updateAccount(providerId, { status: 'authenticated', user: { id: 'listener', nickname: 'Listener again' } });
        older.resolve([song('before-new-session')]);
        await oldRead;
        expect(omni.getDailySongPreview()).toBeNull();
    });

    it('preserves a preview and pending reads during a normal refresh of the same account', async () => {
        getDailySongs.mockResolvedValueOnce([song('before-refresh')]);
        await omni.getDailySongs();
        const before = omni.getDailySongPreview();
        const pending = deferred<UnifiedSong[]>();
        getDailySongs.mockImplementationOnce(() => pending.promise);
        const read = omni.getDailySongs();
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'listener', nickname: 'Refreshed profile' },
            freshness: 'refreshing',
        });
        expect(omni.getDailySongPreview()).toBe(before);
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { freshness: 'fresh', lastUpdatedAt: 2 });
        pending.resolve([song('after-refresh')]);
        await read;
        expect(omni.getDailySongPreview()?.firstSong?.id).toBe('after-refresh');
    });
});
