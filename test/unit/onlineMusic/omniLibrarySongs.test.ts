import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';

// All-library-song collections read their owner's library, never playlist or cloud catalog routes.
const providerId = 'library-songs-test';
const otherProviderId = 'other-library-songs-test';
const song: UnifiedSong = {
    id: 'library-row', name: 'Library row', artists: [], album: { id: '', name: '' }, durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: 'library-row' },
};
const baseProvider = (id: string): OnlineMusicProvider => ({
    id, displayName: id, normalizeSong: () => song,
    capabilities: {
        search: false, playback: false, lyrics: false, auth: false, userLibrary: true, userSongs: true,
        playlists: false, albums: false, artists: false, recommendations: false, mutations: false, wordByWordLyrics: false,
    },
});
const entry: ProviderCollection = { providerId, id: 'account-id', type: 'library_songs', name: 'All songs' };

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    unregisterOnlineMusicProvider(otherProviderId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('Omni library songs', () => {
    it('routes the user API through the active provider and keeps its cursor unchanged', async () => {
        const page = { items: [song], hasMore: true, nextOffset: 47 };
        const getUserSongs = vi.fn(async () => page);
        registerOnlineMusicProvider({ ...baseProvider(providerId), library: { getUserPlaylists: vi.fn(), getUserSongs } });
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        await expect(omni.getUserSongs('account-id', { limit: 20, offset: 3 })).resolves.toEqual(page);
        expect(getUserSongs).toHaveBeenCalledWith('account-id', 20, 3);
    });

    it('routes a collection by owner and account ID, not the active provider or playlist/cloud', async () => {
        const getUserSongs = vi.fn(async () => ({ items: [song], hasMore: false, nextOffset: 8 }));
        const getPlaylistTracks = vi.fn();
        const getCloudTracks = vi.fn();
        const otherRead = vi.fn();
        registerOnlineMusicProvider({ ...baseProvider(providerId), library: { getUserPlaylists: vi.fn(), getUserSongs }, catalog: { getPlaylistTracks, getCloudTracks } });
        registerOnlineMusicProvider({ ...baseProvider(otherProviderId), library: { getUserPlaylists: vi.fn(), getUserSongs: otherRead } });
        useOnlineProviderAccountStore.getState().setActiveProviderId(otherProviderId);
        await expect(omni.getCollectionTracks(entry, { limit: 150, offset: 7 })).resolves.toMatchObject({ items: [song], nextOffset: 8 });
        expect(getUserSongs).toHaveBeenCalledWith('account-id', 150, 7);
        expect(otherRead).not.toHaveBeenCalled();
        expect(getPlaylistTracks).not.toHaveBeenCalled();
        expect(getCloudTracks).not.toHaveBeenCalled();
    });

    it('follows the existing empty-page convention on a provider without user songs', async () => {
        const getPlaylistTracks = vi.fn();
        registerOnlineMusicProvider({ ...baseProvider(providerId), capabilities: { ...baseProvider(providerId).capabilities, userSongs: false }, catalog: { getPlaylistTracks } });
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        await expect(omni.getUserSongs('account-id', { limit: 10, offset: 5 })).resolves.toMatchObject({ items: [], hasMore: false, nextOffset: 5 });
        await expect(omni.getCollectionTracks(entry, { limit: 10, offset: 5 })).resolves.toMatchObject({ items: [], hasMore: false, nextOffset: 5 });
        expect(getPlaylistTracks).not.toHaveBeenCalled();
    });

    it('invalidates a late active-provider library page after switching providers', async () => {
        let finish!: (page: { items: UnifiedSong[]; hasMore: boolean; nextOffset: number }) => void;
        const getUserSongs = vi.fn(() => new Promise<{ items: UnifiedSong[]; hasMore: boolean; nextOffset: number }>(resolve => { finish = resolve; }));
        registerOnlineMusicProvider({ ...baseProvider(providerId), library: { getUserPlaylists: vi.fn(), getUserSongs } });
        registerOnlineMusicProvider(baseProvider(otherProviderId));
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        const pending = omni.getUserSongs('account-id', { limit: 10, offset: 0 });
        useOnlineProviderAccountStore.getState().setActiveProviderId(otherProviderId);
        omni.invalidateActiveRequests();
        finish({ items: [song], hasMore: false, nextOffset: 1 });
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('treats all library songs as read-only even on providers that can edit playlists', async () => {
        const getSubscriptionStatus = vi.fn();
        const updatePlaylistTracks = vi.fn();
        const subscribePlaylist = vi.fn();
        const base = baseProvider(providerId);
        registerOnlineMusicProvider({
            ...base,
            capabilities: { ...base.capabilities, mutations: true, playlistTrackMutations: true, playlistSubscription: true },
            catalog: { getSubscriptionStatus },
            mutations: { updatePlaylistTracks, subscribePlaylist },
        });
        expect(omni.canSubscribeCollection(entry)).toBe(false);
        expect(omni.canEditCollectionTracks(entry)).toBe(false);
        await expect(omni.getSubscriptionStatus(entry)).resolves.toBe(false);
        await expect(omni.updateCollectionTracks(entry, 'add', [song])).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.subscribe(entry, true)).rejects.toMatchObject({ code: 'unsupported' });
        expect(getSubscriptionStatus).not.toHaveBeenCalled();
        expect(updatePlaylistTracks).not.toHaveBeenCalled();
        expect(subscribePlaylist).not.toHaveBeenCalled();
    });
});
