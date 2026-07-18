import { afterEach, describe, expect, it } from 'vitest';
import type { OnlineMusicProvider, ProviderCapabilities } from '@/types/onlineMusic';
import {
    canPlayOnlineMusicSong,
    getOnlineMusicProvider,
    providerSupports,
    registerOnlineMusicProvider,
    requireOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';
import { OnlineProviderError } from '@/types/onlineMusic';
import { getSongResourceCacheKey } from '@/services/onlineMusic/resourceKeys';
import { getPlaybackSongKey, normalizePlaybackSongSource } from '@/utils/appPlaybackGuards';

// test/unit/onlineMusic/providerRegistry.test.ts

const capabilities = (patch: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
    search: false,
    playback: false,
    lyrics: false,
    auth: false,
    userLibrary: false,
    playlists: false,
    albums: false,
    artists: false,
    recommendations: false,
    mutations: false,
    wordByWordLyrics: false,
    ...patch,
});

const partialProvider: OnlineMusicProvider = {
    id: 'partial-test',
    displayName: 'Partial Test',
    capabilities: capabilities({ search: true }),
    normalizeSong: raw => ({
        id: String((raw as { id?: string }).id || ''),
        name: 'Partial',
        artists: [],
        album: { id: '', name: '' },
        duration: 0,
        sourceRef: { kind: 'online', providerId: 'partial-test', mediaId: String((raw as { id?: string }).id || '') },
    }),
    search: {
        async searchSongs() { return { items: [], hasMore: false, nextOffset: 0 }; },
    },
};

afterEach(() => unregisterOnlineMusicProvider('partial-test'));

describe('online music provider registry', () => {
    it('accepts providers that implement only declared capabilities', () => {
        registerOnlineMusicProvider(partialProvider);
        expect(getOnlineMusicProvider('partial-test')).toBe(partialProvider);
        expect(providerSupports(partialProvider, 'search')).toBe(true);
        expect(providerSupports(partialProvider, 'playback')).toBe(false);
        expect(canPlayOnlineMusicSong(partialProvider.normalizeSong({ id: 'HASH' }))).toBe(false);
    });

    it('uses a standardized unavailable error for an unregistered provider', () => {
        expect(() => requireOnlineMusicProvider('missing-test')).toThrow(OnlineProviderError);
        try {
            requireOnlineMusicProvider('missing-test');
        } catch (error) {
            expect(error).toMatchObject({ code: 'unavailable', providerId: 'missing-test' });
        }
    });

    it('keeps source-aware keys distinct and migrates legacy online songs to NetEase', () => {
        const kugouSong = partialProvider.normalizeSong({ id: 'ABC123' });
        const legacySong = normalizePlaybackSongSource({
            id: 123,
            name: 'Legacy',
            artists: [],
            album: { id: 1, name: 'Album' },
            duration: 1000,
        });
        expect(getPlaybackSongKey(kugouSong)).toBe('online:partial-test:ABC123');
        expect(getPlaybackSongKey(legacySong)).toBe('online:netease:123');
        expect(getSongResourceCacheKey('audio', kugouSong)).toBe('audio_online:partial-test:ABC123');
    });
});
