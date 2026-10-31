import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import type { OnlineMusicProvider, ProviderCapabilities, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniSearchCollections.test.ts
// 专辑与歌单搜索经 omni：哪些种类搜得到、按种类分给平台、只收这个平台自己的集合。

const providerId = 'omni-collection-search-test';
const capabilities: ProviderCapabilities = {
    search: true, playback: false, lyrics: false, auth: false, userLibrary: false,
    playlists: true, albums: true, artists: false, recommendations: false,
    mutations: false, wordByWordLyrics: false,
};

const collection = (owner: string, id: string, type: string): ProviderCollection => ({
    providerId: owner, id, name: `${type} ${id}`, type,
});

const provider = (
    search: OnlineMusicProvider['search'],
    overrides: Partial<ProviderCapabilities> = {},
): OnlineMusicProvider => ({
    id: providerId,
    displayName: providerId,
    capabilities: { ...capabilities, ...overrides },
    normalizeSong: () => { throw new Error('unused'); },
    search,
});

const noSongs = async () => ({ items: [], hasMore: false, nextOffset: 0 });

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
});

describe('omni collection search', () => {
    it('lists the kinds a provider searches: songs always, albums and playlists where it has both the search and the catalog', () => {
        registerOnlineMusicProvider(provider({ searchSongs: noSongs, searchAlbums: noSongs, searchPlaylists: noSongs }));
        expect(omni.getProviderSearchKinds(providerId)).toEqual(['song', 'album', 'playlist']);

        unregisterOnlineMusicProvider(providerId);
        registerOnlineMusicProvider(provider({ searchSongs: noSongs, searchAlbums: noSongs, searchPlaylists: noSongs }, { albums: false }));
        expect(omni.getProviderSearchKinds(providerId)).toEqual(['song', 'playlist']);

        unregisterOnlineMusicProvider(providerId);
        registerOnlineMusicProvider(provider({ searchSongs: noSongs }));
        expect(omni.getProviderSearchKinds(providerId)).toEqual(['song']);

        unregisterOnlineMusicProvider(providerId);
        registerOnlineMusicProvider(provider({ searchSongs: noSongs, searchAlbums: noSongs }, { search: false }));
        expect(omni.getProviderSearchKinds(providerId)).toEqual([]);
        expect(omni.getProviderSearchKinds('omni-collection-search-missing')).toEqual([]);
    });

    it('routes an album or playlist search to the provider by kind and keeps only its own collections', async () => {
        const searchAlbums = vi.fn(async () => ({
            items: [collection(providerId, 'a1', 'album'), collection('someone-else', 'x', 'album')],
            total: 7,
            hasMore: true,
            nextOffset: 2,
        }));
        const searchPlaylists = vi.fn(async () => ({ items: [collection(providerId, 'p1', 'playlist')], hasMore: false, nextOffset: 1 }));
        registerOnlineMusicProvider(provider({ searchSongs: noSongs, searchAlbums, searchPlaylists }));

        await expect(omni.searchProviderCollections(providerId, 'album', 'jay', { limit: 2, offset: 0 })).resolves.toEqual({
            items: [collection(providerId, 'a1', 'album')],
            total: 7,
            hasMore: true,
            nextOffset: 2,
        });
        expect(searchAlbums).toHaveBeenCalledWith('jay', 2, 0);
        expect(searchPlaylists).not.toHaveBeenCalled();

        await expect(omni.searchProviderCollections(providerId, 'playlist', 'jay', { limit: 30, offset: 30 }))
            .resolves.toMatchObject({ items: [{ id: 'p1' }] });
        expect(searchPlaylists).toHaveBeenCalledWith('jay', 30, 30);
    });

    it('answers an empty page for a kind the provider does not search', async () => {
        const searchAlbums = vi.fn(noSongs);
        registerOnlineMusicProvider(provider({ searchSongs: noSongs, searchAlbums }, { albums: false }));

        await expect(omni.searchProviderCollections(providerId, 'album', 'jay', { limit: 10, offset: 20 }))
            .resolves.toEqual({ items: [], hasMore: false, nextOffset: 20 });
        await expect(omni.searchProviderCollections(providerId, 'playlist', 'jay', { limit: 10, offset: 0 }))
            .resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(searchAlbums).not.toHaveBeenCalled();
    });
});
