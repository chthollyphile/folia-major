import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCapabilities } from '@/types/onlineMusic';

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
});
