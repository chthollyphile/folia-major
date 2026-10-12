import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { UnifiedSong } from '@/types';
import type { HeartbeatRequestOptions, OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/onlineMusic/omniHeartbeat.test.ts
// Heartbeat results must obey the same capability and account-switch boundary as other online data.

const providerId = 'heartbeat-test';
const options = { playlistId: 123, seedSongId: 456 };
const installProvider = (getHeartbeatSongs?: (options: HeartbeatRequestOptions) => Promise<UnifiedSong[]>, supported = true) => {
    const provider: OnlineMusicProvider = {
        id: providerId, displayName: providerId,
        capabilities: {
            search: false, playback: false, lyrics: false, auth: false, userLibrary: false,
            playlists: false, albums: false, artists: false, recommendations: true,
            heartbeatRecommendations: supported, mutations: false, wordByWordLyrics: false,
        },
        normalizeSong: raw => raw as UnifiedSong,
        recommendations: { getHeartbeatSongs },
    };
    registerOnlineMusicProvider(provider);
    useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
};

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('Omni heartbeat routing', () => {
    it('forwards the playlist seed through the active provider', async () => {
        const getHeartbeatSongs = vi.fn(async () => []);
        installProvider(getHeartbeatSongs);
        await expect(omni.getHeartbeatSongs(options)).resolves.toEqual([]);
        expect(getHeartbeatSongs).toHaveBeenCalledWith(options);
    });

    it('rejects providers without the capability before calling them', async () => {
        const getHeartbeatSongs = vi.fn(async () => []);
        installProvider(getHeartbeatSongs, false);
        await expect(omni.getHeartbeatSongs(options)).rejects.toMatchObject({ code: 'unsupported', providerId });
        expect(getHeartbeatSongs).not.toHaveBeenCalled();
    });

    it('rejects a capability that has no implementation', async () => {
        installProvider();
        await expect(omni.getHeartbeatSongs(options)).rejects.toMatchObject({ code: 'unsupported' });
    });

    it.each(['switch', 'invalidate'])('rejects late results after %s', async action => {
        let resolve!: (songs: UnifiedSong[]) => void;
        installProvider(() => new Promise(done => { resolve = done; }));
        const pending = omni.getHeartbeatSongs(options);
        if (action === 'switch') useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
        else omni.invalidateActiveRequests();
        resolve([]);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});
