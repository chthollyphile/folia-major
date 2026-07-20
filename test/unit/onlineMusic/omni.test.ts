import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCapabilities, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/omni.test.ts

const providerId = 'omni-test';
const otherProviderId = 'omni-resource-test';
const capabilities: ProviderCapabilities = {
    search: true, playback: true, lyrics: false, auth: false, userLibrary: false,
    playlists: false, albums: false, artists: false, recommendations: false,
    mutations: false, wordByWordLyrics: false,
};
const song = (owner: string, mediaId = '1'): UnifiedSong => ({
    id: mediaId,
    name: `${owner}:${mediaId}`,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: owner, mediaId },
});

const provider = (id: string, search: OnlineMusicProvider['search']): OnlineMusicProvider => ({
    id,
    displayName: id,
    capabilities,
    normalizeSong: raw => song(id, String((raw as { id?: string }).id || '1')),
    search,
    playback: {
        getSongDetail: async mediaId => song(id, String(mediaId)),
        getAudioSource: async target => ({ url: `https://${id}/${target.sourceRef?.mediaId}`, fetchedAt: 1, quality: 'standard' }),
    },
});

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    unregisterOnlineMusicProvider(otherProviderId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('omni routing', () => {
    it('routes ordinary search through the active provider and resources through their owner', async () => {
        const activeSearch = vi.fn(async () => ({ items: [song(providerId)], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider(provider(providerId, { searchSongs: activeSearch }));
        registerOnlineMusicProvider(provider(otherProviderId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);

        await expect(omni.searchSongs('query', { limit: 10, offset: 0 })).resolves.toMatchObject({ items: [{ name: `${providerId}:1` }] });
        await expect(omni.getAudioSource(song(otherProviderId, '9'), 'standard')).resolves.toMatchObject({ url: `https://${otherProviderId}/9` });
        expect(activeSearch).toHaveBeenCalledWith('query', 10, 0);
    });

    it('rejects a late active-provider result after invalidation', async () => {
        let resolveSearch!: (value: { items: UnifiedSong[]; hasMore: false; nextOffset: number }) => void;
        registerOnlineMusicProvider(provider(providerId, {
            searchSongs: () => new Promise(resolve => { resolveSearch = resolve; }),
        }));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        const pending = omni.searchSongs('late', { limit: 10, offset: 0 });
        omni.invalidateActiveRequests();
        resolveSearch({ items: [song(providerId)], hasMore: false, nextOffset: 1 });
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('reads provider song likes through the Omni facade', () => {
        const target = song(providerId, 'liked-song');
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            likedSongIds: ['liked-song'],
        });

        expect(omni.isSongLiked(target)).toBe(true);
        expect(omni.isSongLiked(song(providerId, 'other-song'))).toBe(false);
        expect(omni.isSongLiked({ ...target, sourceRef: { kind: 'local', mediaId: 'liked-song' } })).toBe(false);
    });

    it('returns only the owning provider playlists for an online song', () => {
        const playlist: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'KuGou playlist',
            type: 'playlist',
        };
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            collections: [playlist, { ...playlist, id: 'kugou-album', type: 'album' }],
        });

        expect(omni.getPlaylistsForSong(song(providerId))).toEqual([playlist]);
        expect(omni.getPlaylistsForSong({ ...song(providerId), sourceRef: { kind: 'local', mediaId: 'local-song' } })).toEqual([]);
    });

    it('refreshes the owning provider playlist cache through Omni', async () => {
        const playlist: ProviderCollection = {
            providerId,
            id: 'refreshed-playlist',
            name: 'Refreshed playlist',
            type: 'playlist',
        };
        const getUserPlaylists = vi.fn(async () => ({ items: [playlist], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            library: { getUserPlaylists },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'user', nickname: 'User' },
            collections: [{ providerId, id: 'cloud', name: 'Cloud', type: 'cloud' }],
        });

        await expect(omni.refreshProviderPlaylists(providerId)).resolves.toEqual([playlist]);

        expect(getUserPlaylists).toHaveBeenCalledWith('user', 50, 0);
        expect(useOnlineProviderAccountStore.getState().accounts[providerId]?.collections).toEqual([
            { providerId, id: 'cloud', name: 'Cloud', type: 'cloud' },
            playlist,
        ]);
    });

    it('toggles a song through its owning provider and updates only that provider cache', async () => {
        const kugouLike = vi.fn(async () => undefined);
        const neteaseLike = vi.fn(async () => undefined);
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            mutations: { likeSong: kugouLike },
        });
        registerOnlineMusicProvider({
            ...provider(otherProviderId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            mutations: { likeSong: neteaseLike },
        });
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { likedSongIds: ['existing'] });

        const target = song(providerId, 'kugou-song');
        await expect(omni.toggleSongLike(target)).resolves.toBe(true);

        expect(kugouLike).toHaveBeenCalledWith(target, true);
        expect(neteaseLike).not.toHaveBeenCalled();
        expect(useOnlineProviderAccountStore.getState().accounts[providerId]?.likedSongIds).toEqual(['existing', 'kugou-song']);
    });

    it('routes playlist track updates through the collection owner', async () => {
        const updateTracks = vi.fn(async () => undefined);
        const refreshedPlaylist: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'Refreshed KuGou playlist',
            type: 'playlist',
        };
        const getUserPlaylists = vi.fn(async () => ({ items: [refreshedPlaylist], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider({
            ...provider(providerId, { searchSongs: async () => ({ items: [], hasMore: false, nextOffset: 0 }) }),
            mutations: { updatePlaylistTracks: updateTracks },
            library: { getUserPlaylists },
        });
        const collection: ProviderCollection = {
            providerId,
            id: 'kugou-playlist',
            name: 'KuGou playlist',
            type: 'playlist',
        };
        const target = song(providerId, 'kugou-song');
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            user: { id: 'user', nickname: 'User' },
        });

        await omni.addSongToPlaylist(target, collection);

        expect(updateTracks).toHaveBeenCalledWith('add', collection, [target]);
        expect(getUserPlaylists).toHaveBeenCalledWith('user', 50, 0);
    });
});
