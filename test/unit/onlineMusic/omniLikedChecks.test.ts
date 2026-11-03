import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { MediaId, OnlineLibraryProvider, OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniLikedChecks.test.ts
// Through omni: a read of the liked ids that is not whole has the hearts of the songs in play
// asked of the adapter, and its answer settles the account's liked ids.

vi.mock('@/services/onlineMusic/providerAccountCache', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/onlineMusic/providerAccountCache')>()),
    saveProviderAccountSnapshot: vi.fn(async () => null),
}));

// Each test has a platform of its own: omni keeps what it asked of each one.
const providerId = 'omni-liked-checks-test';
const listProviderId = 'omni-liked-checks-list-test';

const song = (mediaId: string, of = providerId): UnifiedSong => ({
    id: mediaId, name: mediaId, artists: [], album: { id: '', name: '' }, durationMs: 1,
    sourceRef: { kind: 'online', providerId: of, mediaId },
});

// Registers a platform with this library and signs its listener in, holding these liked ids.
const signIn = (id: string, library: OnlineLibraryProvider, likedSongIds: MediaId[], collections: ProviderCollection[] = []) => {
    const provider: OnlineMusicProvider = {
        id,
        displayName: id,
        capabilities: {
            search: false, playback: true, lyrics: false, auth: true, userLibrary: true,
            playlists: true, albums: false, artists: false, recommendations: false,
            mutations: true, likes: true, wordByWordLyrics: false,
        },
        normalizeSong: raw => song(String((raw as { id?: string }).id), id),
        library,
    };
    registerOnlineMusicProvider(provider);
    useOnlineProviderAccountStore.getState().updateAccount(id, {
        status: 'authenticated',
        user: { id: 'user', nickname: 'Listener' },
        collections,
        likedSongIds,
    });
};

describe('omni: the hearts of the songs in play', () => {
    let previousActive: string;
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        previousActive = useOnlineProviderAccountStore.getState().activeProviderId;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const id of [providerId, listProviderId]) {
            unregisterOnlineMusicProvider(id);
            useOnlineProviderAccountStore.getState().clearAccount(id);
        }
        useOnlineProviderAccountStore.getState().setActiveProviderId(previousActive);
    });

    it('asks them of the adapter after a read that was not whole, and once', async () => {
        const areSongsLiked = vi.fn(async (_ids: MediaId[]) => ({ 'past-liked': true, 'past-unliked': false }));
        signIn(providerId, {
            getUserPlaylists: async () => ({ items: [], hasMore: false, nextOffset: 0 }),
            getLikedSongCount: async () => 99,
            getLikedSongIds: async () => ({ ids: ['read'], whole: false }),
            areSongsLiked,
        }, ['held', 'past-unliked']);
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);

        const inPlay = [song('past-liked'), song('past-unliked'), song('past-liked')];
        omni.songsInPlay(inPlay);
        expect(areSongsLiked).not.toHaveBeenCalled();

        // The liked list counts 99 and 2 are held: it is read, not to the end.
        await omni.accountMoment('window-returned');
        await vi.waitFor(() => expect(useOnlineProviderAccountStore.getState().accounts[providerId].likedSongIds.map(String).sort())
            .toEqual(['held', 'past-liked', 'read']));
        expect(areSongsLiked).toHaveBeenCalledTimes(1);
        expect(areSongsLiked).toHaveBeenCalledWith(['past-liked', 'past-unliked']);

        omni.songsInPlay(inPlay);
        expect(areSongsLiked).toHaveBeenCalledTimes(1);
    });

    it('asks them after a read of the liked list that was not whole, and not after one that was whole', async () => {
        const likedList: ProviderCollection = { providerId: listProviderId, id: 'liked', type: 'playlist', name: 'Liked', isLiked: true, isOwned: true };
        const areSongsLiked = vi.fn(async (ids: MediaId[]) => Object.fromEntries(ids.map(id => [String(id), false])));
        signIn(listProviderId, { getUserPlaylists: async () => ({ items: [], hasMore: false, nextOffset: 0 }), areSongsLiked }, ['held'], [likedList]);
        omni.songsInPlay([song('playing', listProviderId)]);

        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('listed', listProviderId)], false);
        await vi.waitFor(() => expect(areSongsLiked).toHaveBeenCalledTimes(1));
        expect(areSongsLiked).toHaveBeenCalledWith(['playing']);

        // Read whole: the liked ids are all there, and a song put in play is not asked.
        omni.endLikedListRead(omni.beginLikedListRead(likedList)!, [song('listed', listProviderId)], true);
        omni.songsInPlay([song('next', listProviderId)]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(areSongsLiked).toHaveBeenCalledTimes(1);
    });
});
