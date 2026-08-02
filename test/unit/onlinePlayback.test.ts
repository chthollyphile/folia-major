import { beforeEach, describe, expect, it, vi } from 'vitest';

const cachedAudioMock = vi.hoisted(() => vi.fn());
const sourceMock = vi.hoisted(() => vi.fn());
const isUrlValidMock = vi.hoisted(() => vi.fn(() => true));
const updatePrefetchedAudioUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getCachedSongAudioBlob: cachedAudioMock,
    getSongCacheWithLegacyMigration: vi.fn(),
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getAudioSource: sourceMock,
    },
}));

vi.mock('@/services/prefetchService', () => ({
    isUrlValid: isUrlValidMock,
    updatePrefetchedAudioUrl: updatePrefetchedAudioUrlMock,
}));

vi.mock('@/services/db', () => ({
    saveToCache: vi.fn(),
}));

vi.mock('@/utils/blobGuards', () => ({
    createSafeObjectUrl: vi.fn(() => 'blob:test'),
}));

import { loadOnlineSongAudioSource } from '@/services/onlinePlayback';
import type { SongResult } from '@/types';

// test/unit/onlinePlayback.test.ts

const song: SongResult = {
    id: 'online-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'online-song' },
};

describe('online audio ReplayGain plumbing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cachedAudioMock.mockResolvedValue(null);
        isUrlValidMock.mockReturnValue(true);
    });

    it('returns provider metadata and stores it with the prefetched URL', async () => {
        sourceMock.mockResolvedValue({
            url: 'https://audio.test/song.flac',
            fetchedAt: 1,
            quality: 'high',
            replayGain: { trackGain: -12.1, trackPeak: 0.95 },
        });

        const result = await loadOnlineSongAudioSource(song, 'high', null);

        expect(result).toMatchObject({
            kind: 'ok',
            audioSrc: 'https://audio.test/song.flac',
            replayGain: { trackGain: -12.1, trackPeak: 0.95 },
        });
        expect(updatePrefetchedAudioUrlMock).toHaveBeenCalledWith(
            song,
            'https://audio.test/song.flac',
            'high',
            { trackGain: -12.1, trackPeak: 0.95 },
        );
    });

    it('reuses prefetched metadata without asking the provider again', async () => {
        const prefetched = {
            audioUrl: 'https://audio.test/prefetched.flac',
            audioUrlFetchedAt: Date.now(),
            replayGain: { trackGain: -3.2 },
        } as any;

        const result = await loadOnlineSongAudioSource(song, 'high', prefetched);

        expect(result).toMatchObject({
            kind: 'ok',
            audioSrc: 'https://audio.test/prefetched.flac',
            replayGain: { trackGain: -3.2 },
        });
        expect(sourceMock).not.toHaveBeenCalled();
    });

    it('leaves ReplayGain absent when the provider has no metadata', async () => {
        sourceMock.mockResolvedValue({
            url: 'https://audio.test/song.mp3',
            fetchedAt: 1,
            quality: 'high',
        });

        const result = await loadOnlineSongAudioSource(song, 'high', null);

        expect(result).toMatchObject({ kind: 'ok', audioSrc: 'https://audio.test/song.mp3' });
        expect(result.kind).toBe('ok');
        if (result.kind === 'ok') {
            expect(result.replayGain).toBeUndefined();
        }
        expect(updatePrefetchedAudioUrlMock).toHaveBeenCalledWith(song, 'https://audio.test/song.mp3', 'high', undefined);
    });
});
