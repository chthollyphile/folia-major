import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromCache, removeFromCache, saveToCache } from '@/services/db';
import { getCachedAudioBlob, hasCachedAudio, removeAudioBlob, saveAudioBlob } from '@/services/audioCache';
import { deleteCachedSongAudio, getCachedSongAudioBlob, getSongCacheWithLegacyMigration, hasCachedSongAudio, saveSongAudioLevel } from '@/services/onlineMusic/resourceCache';
import type { SongResult } from '@/types';

// test/unit/onlineMusic/resourceCacheMigration.test.ts

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    removeFromCache: vi.fn(),
    saveToCache: vi.fn(),
}));

vi.mock('@/services/audioCache', () => ({
    getCachedAudioBlob: vi.fn(),
    hasCachedAudio: vi.fn(),
    saveAudioBlob: vi.fn(),
    removeAudioBlob: vi.fn(),
}));

vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: vi.fn(),
    saveCoverBlob: vi.fn(),
}));

const legacyNeteaseSong: SongResult = {
    id: 42,
    name: 'Legacy',
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' },
};

describe('provider-aware resource cache migration', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reads an old lyric key and writes the provider-aware key', async () => {
        const lyric = { lines: [{ fullText: 'legacy' }] };
        vi.mocked(getFromCache).mockImplementation(async key => (
            key === 'lyric_42' ? lyric : null
        ) as any);

        await expect(getSongCacheWithLegacyMigration('lyric', legacyNeteaseSong)).resolves.toEqual(lyric);
        expect(saveToCache).toHaveBeenCalledWith('lyric_online:netease:42', lyric);
    });

    it('reads an old audio key and writes the provider-aware key', async () => {
        const blob = new Blob(['audio'], { type: 'audio/mpeg' });
        vi.mocked(getCachedAudioBlob).mockImplementation(async key => key === 'audio_42' ? blob : null);

        await expect(getCachedSongAudioBlob(legacyNeteaseSong)).resolves.toBe(blob);
        expect(saveAudioBlob).toHaveBeenCalledWith('audio_online:netease:42', blob);
    });

    it('checks current audio cache existence without reading the audio blob', async () => {
        vi.mocked(hasCachedAudio).mockImplementation(async key => key === 'audio_online:netease:42');

        await expect(hasCachedSongAudio(legacyNeteaseSong)).resolves.toBe(true);
        expect(hasCachedAudio).toHaveBeenCalledTimes(1);
        expect(getCachedAudioBlob).not.toHaveBeenCalled();
    });

    it('checks legacy audio cache existence without reading or migrating the audio blob', async () => {
        vi.mocked(hasCachedAudio).mockImplementation(async key => key === 'audio_42');

        await expect(hasCachedSongAudio(legacyNeteaseSong)).resolves.toBe(true);
        expect(hasCachedAudio).toHaveBeenNthCalledWith(1, 'audio_online:netease:42');
        expect(hasCachedAudio).toHaveBeenNthCalledWith(2, 'audio_42');
        expect(getCachedAudioBlob).not.toHaveBeenCalled();
        expect(saveAudioBlob).not.toHaveBeenCalled();
    });
});

// The audio key names the song and no quality level, so one copy used to answer for every level:
// a song played to its end at 'standard' went on playing that copy after the option was moved to
// 'high'. The level a copy was fetched at is kept beside it, and a reader may ask for one.
describe('the quality level of a cached copy', () => {
    const blob = new Blob(['audio'], { type: 'audio/mpeg' });
    // The store as it stands with a copy under the song's own key, fetched at `savedLevel`.
    const holdCopy = (savedLevel: string | null) => {
        vi.mocked(getFromCache).mockImplementation(async key => (
            key === 'audioLevel_online:netease:42' ? savedLevel : null
        ) as any);
        vi.mocked(hasCachedAudio).mockImplementation(async key => key === 'audio_online:netease:42');
        vi.mocked(getCachedAudioBlob).mockImplementation(async key => key === 'audio_online:netease:42' ? blob : null);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    it('is a miss for a copy of another level when a level is asked for, and a hit when none is', async () => {
        holdCopy('standard');

        await expect(getCachedSongAudioBlob(legacyNeteaseSong, 'high')).resolves.toBeNull();
        await expect(hasCachedSongAudio(legacyNeteaseSong, 'high')).resolves.toBe(false);
        await expect(getCachedSongAudioBlob(legacyNeteaseSong)).resolves.toBe(blob);
        await expect(hasCachedSongAudio(legacyNeteaseSong)).resolves.toBe(true);
    });

    it('is a hit for a copy of the level asked for', async () => {
        holdCopy('standard');

        await expect(getCachedSongAudioBlob(legacyNeteaseSong, 'standard')).resolves.toBe(blob);
        await expect(hasCachedSongAudio(legacyNeteaseSong, 'standard')).resolves.toBe(true);
    });

    // Every copy saved before levels were kept, and every legacy NetEase copy.
    it('is a hit for any level when no level was saved with the copy', async () => {
        holdCopy(null);

        await expect(getCachedSongAudioBlob(legacyNeteaseSong, 'high')).resolves.toBe(blob);
        await expect(hasCachedSongAudio(legacyNeteaseSong, 'standard')).resolves.toBe(true);
    });

    // Reading is a whole file across the process boundary, and it marks the file as just played.
    it('does not read the bytes of a copy it passes over', async () => {
        holdCopy('standard');

        await getCachedSongAudioBlob(legacyNeteaseSong, 'high');

        expect(getCachedAudioBlob).not.toHaveBeenCalled();
    });

    // A copy playback found not to be the song. Reading a legacy key copies it under the song's own
    // key, so a copy left under the legacy one would come back on the next read.
    it('deletes the copy that was read under the song\'s key and the legacy one, with its level', async () => {
        const sizes = new Map([['audio_online:netease:42', 5], ['audio_42', 5]]);
        vi.mocked(removeAudioBlob).mockImplementation(async (key, size) => sizes.get(key) === size);

        await expect(deleteCachedSongAudio(legacyNeteaseSong, 5)).resolves.toBe(true);
        expect(vi.mocked(removeAudioBlob).mock.calls).toEqual([['audio_online:netease:42', 5], ['audio_42', 5]]);
        expect(removeFromCache).toHaveBeenCalledExactlyOnceWith('audioLevel_online:netease:42');
    });

    // A file written there since the read is not the copy that was read: it stays, and so does its level.
    it('keeps the level when no copy of the size read was there to delete', async () => {
        vi.mocked(removeAudioBlob).mockResolvedValue(false);

        await expect(deleteCachedSongAudio(legacyNeteaseSong, 5)).resolves.toBe(false);
        expect(removeFromCache).not.toHaveBeenCalled();
    });

    it('saves the level beside the audio, and removes it for a copy of an unknown level', async () => {
        await saveSongAudioLevel(legacyNeteaseSong, 'high');
        expect(saveToCache).toHaveBeenCalledExactlyOnceWith('audioLevel_online:netease:42', 'high');
        expect(removeFromCache).not.toHaveBeenCalled();

        await saveSongAudioLevel(legacyNeteaseSong, undefined);
        expect(removeFromCache).toHaveBeenCalledExactlyOnceWith('audioLevel_online:netease:42');
        expect(saveToCache).toHaveBeenCalledTimes(1);
    });
});
