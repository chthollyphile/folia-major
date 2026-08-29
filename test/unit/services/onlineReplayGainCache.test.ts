import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayGainInfo, SongResult } from '@/types';

// test/unit/services/onlineReplayGainCache.test.ts
// A track played from the media cache must reach the fader with the gain the provider stated the
// last time anyone asked for its URL. Nothing on that path asks again, so if the gain is not
// persisted it silently becomes 0dB - which in album mode puts a 10dB step in the middle of an
// album, between the tracks that happen to be cached and the one that is not.

const store = new Map<string, unknown>();

const mocks = vi.hoisted(() => ({
    getCachedAudioBlob: vi.fn(),
}));

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    removeFromCache: vi.fn(),
}));
vi.mock('@/services/audioCache', () => ({
    getCachedAudioBlob: mocks.getCachedAudioBlob,
    hasCachedAudio: vi.fn(),
    saveAudioBlob: vi.fn(),
}));
vi.mock('@/services/coverCache', () => ({ getCachedCoverUrl: vi.fn(), saveCoverBlob: vi.fn() }));

// Statically, so the (large) module graph behind onlinePlayback is paid during collection rather
// than inside a test's timeout - it is slow enough under a full run to trip the 5s default.
const { getCachedSongReplayGain, saveSongReplayGain } = await import('@/services/onlineMusic/resourceCache');
const { loadOnlineSongAudioSource } = await import('@/services/onlinePlayback');

const song = {
    id: '1909927747',
    name: 'Less Than Zero',
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1909927747' },
} as unknown as SongResult;

const gain: ReplayGainInfo = { albumGain: -10.3644, trackGain: -10.3644 };

describe('ReplayGain survives the media cache', () => {
    beforeEach(() => {
        store.clear();
        vi.clearAllMocks();
    });

    it('hands a cached track the gain a fetched URL left behind', async () => {
        // What omni.getAudioSource now does the one time a provider states the gain.
        await saveSongReplayGain(song, gain);
        expect(await getCachedSongReplayGain(song)).toEqual(gain);

        // A later session: the bytes are in the cache, the song object carries nothing, and there
        // is no prefetch entry left - which is every track of an album played a second time.
        mocks.getCachedAudioBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-audio');

        const result = await loadOnlineSongAudioSource(song, 'hires', null);

        expect(result).toMatchObject({ kind: 'ok', audioSrc: 'blob:cached-audio', replayGain: gain });
    });

    it('is a miss, not a crash, for a track nobody ever fetched a URL for', async () => {
        await expect(getCachedSongReplayGain(song)).resolves.toBeUndefined();
    });

    // The cache router keys off the string prefix, so the prefix is the contract between these two
    // modules. Renaming the kind would silently drop the entry into the api_cache catch-all and
    // out of "clear media cache" - neither of which anything else would notice.
    it('lands in the metadata table, under the prefix the cache router matches on', async () => {
        const { getSongResourceCacheKey } = await import('@/services/onlineMusic/resourceKeys');
        const { getCacheTableName } = await import('@/services/repositories/cacheRepository');

        const key = getSongResourceCacheKey('replayGain', song);
        expect(key.startsWith('replayGain_')).toBe(true);
        expect(getCacheTableName(key)).toBe('metadata_cache');
    });
});
