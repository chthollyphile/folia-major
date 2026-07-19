import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromCache, saveToCache } from '@/services/db';
import { getCachedAudioBlob, saveAudioBlob } from '@/services/audioCache';
import { getCachedSongAudioBlob, getSongCacheWithLegacyMigration } from '@/services/onlineMusic/resourceCache';
import type { SongResult } from '@/types';

// test/unit/onlineMusic/resourceCacheMigration.test.ts

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(),
    saveToCache: vi.fn(),
}));

vi.mock('@/services/audioCache', () => ({
    getCachedAudioBlob: vi.fn(),
    hasCachedAudio: vi.fn(),
    saveAudioBlob: vi.fn(),
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
});
