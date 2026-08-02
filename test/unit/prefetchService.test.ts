import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { clearPrefetchRuntime, getPrefetchedData, updatePrefetchedAudioUrl } from '@/services/prefetchService';

// test/unit/prefetchService.test.ts

const song: SongResult = {
    id: 'prefetch-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'prefetch-song' },
};

describe('prefetched online ReplayGain metadata', () => {
    beforeEach(() => clearPrefetchRuntime());

    it('keeps ReplayGain alongside a prefetched URL', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', {
            trackGain: -7.1,
            trackPeak: 0.9,
        });

        expect(getPrefetchedData(song, 'high')).toMatchObject({
            audioUrl: 'https://audio.test/song.flac',
            replayGain: { trackGain: -7.1, trackPeak: 0.9 },
        });
    });

    it('invalidates URL metadata together on a quality mismatch', () => {
        updatePrefetchedAudioUrl(song, 'https://audio.test/song.flac', 'high', { trackGain: -7.1 });

        expect(getPrefetchedData(song, 'lossless')).toMatchObject({
            audioUrl: null,
            replayGain: undefined,
        });
    });
});
