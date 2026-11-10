import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { fetchAmllDbLyrics } from '@/utils/lyrics/providers/amllDbProvider';

// test/unit/lyrics/autoMatchNonPlatformSource.test.ts
// The table of lyric sources with one more source that is not an online platform, as someone
// adding a source would write it. No such source exists today, so nobody can see this by using
// the app: the automatic pick must pass it over, not ask AMLL DB a second time in its place.

vi.mock('@/services/onlineMusic/netease/netease', () => ({
    neteaseApi: { cloudSearch: vi.fn(), getLyric: vi.fn(), getSongDetail: vi.fn(), getChorus: vi.fn() },
}));
vi.mock('@/utils/lyrics/neteaseProcessing', () => ({ parseNeteaseChorusRanges: vi.fn(() => []), processNeteaseLyrics: vi.fn() }));
vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({ searchQQLyrics: vi.fn(), fetchQQLyrics: vi.fn() }));
vi.mock('@/services/onlineMusic/kugou/kugouLyricProvider', () => ({ searchKugouLyrics: vi.fn(), fetchKugouLyrics: vi.fn() }));
vi.mock('@/utils/lyrics/providers/amllDbProvider', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/lyrics/providers/amllDbProvider')>(),
    fetchAmllDbLyrics: vi.fn(),
}));
vi.mock('@/utils/lyrics/lyricSources', async (importOriginal) => {
    const table = await importOriginal<typeof import('@/utils/lyrics/lyricSources')>();
    const other = { id: 'other', labelKey: 'lyricProvider.other', platform: false };
    return {
        ...table,
        LYRIC_SOURCE_IDS: [...table.LYRIC_SOURCE_IDS, other.id],
        getLyricSource: (id: string) => (id === other.id ? other : table.getLyricSource(id as never)),
    };
});

describe('a lyric source that is not a platform and is not AMLL DB', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(fetchAmllDbLyrics).mockResolvedValue(null);
    });

    it('is passed over by the automatic pick: AMLL DB is asked once, for its own turn', async () => {
        const neteaseSong = {
            id: 101,
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 2, name: 'Album' },
            durationMs: 200000,
            sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '101' },
        };
        // Timed by line only, so every source gets its turn.
        const lineLyrics = { lines: [{ fullText: 'Test lyric', startTime: 0, endTime: 1, words: [] }], isWordByWord: false };
        // KuGou's search is not behind one of the mocked modules.
        vi.spyOn(getOnlineMusicProvider('kugou')!.search!, 'searchSongs').mockResolvedValue({ items: [], hasMore: false, nextOffset: 0 });

        const result = await autoMatchBestLyric('Song Title', 'Artist Name', 200000, {
            providerCandidate: { providerId: 'netease', song: neteaseSong, lyricsResult: { lyrics: lineLyrics, isPureMusic: false } },
        });

        expect(result).toMatchObject({ source: 'netease', id: 101 });
        expect(vi.mocked(fetchAmllDbLyrics)).toHaveBeenCalledTimes(1);
    });
});
