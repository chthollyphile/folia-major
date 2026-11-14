import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '@/types';

// test/unit/playback/takenTrackDetails.test.ts
// The words of a track this app took over from a player's own window. A listener who moves on while
// that read is on its way - once, twice, three tracks in a row - keeps the words of the song they
// are on: a lyric answer that arrives for a track they left behind is dropped, however late it is.

/** The lyric caller each taken-over song left waiting, by the song's own name. */
const env = vi.hoisted(() => ({
    hooks: new Map<string, { onLyrics: (lyrics: LyricData | null) => void; isCurrent: () => boolean }>(),
}));

vi.mock('@/services/onlineMusic/songAvailability', () => ({ isSongUnavailable: () => false }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getCachedSongCoverUrl: async () => null }));
vi.mock('@/services/onlineMusic/songMetadata', () => ({ getSongCoverUrl: () => null }));
vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongLyrics: async (
        song: SongResult,
        _prefetched: unknown,
        _userId: unknown,
        callbacks: { isCurrent: () => boolean; onLyrics: (lyrics: LyricData | null) => void },
    ) => {
        env.hooks.set(String(song.name), { onLyrics: callbacks.onLyrics, isCurrent: callbacks.isCurrent });
    },
}));
vi.mock('@/stores/useOnlineProviderAccountStore', () => ({
    useOnlineProviderAccountStore: { getState: () => ({ accounts: {} }) },
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    setCachedCoverUrl: () => undefined,
    setCurrentSong: () => undefined,
}));

const { loadTakenTrackDetails } = await import('@/components/app/playback/restore/runningTrack');

const songOf = (letter: string): SongResult => ({
    id: letter.repeat(22), name: `Song ${letter}`, artists: [{ name: 'Artist' }], durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId: letter.repeat(22) },
} as unknown as SongResult);

const lyricsOf = (text: string): LyricData => ({
    lines: [{ startTime: 0, endTime: 1000, fullText: text, words: [] }],
} as unknown as LyricData);

/**
 * Lets every wait the cover and the lyric read make settle, the dynamic imports of both included:
 * the take-over reaches them that way, so each one costs a turn of its own.
 */
const settle = async () => {
    for (let round = 0; round < 40; round += 1) await Promise.resolve();
};

beforeEach(() => {
    env.hooks.clear();
});

describe('the words of a track taken over from a player', () => {
    it('keeps only the words of the third song when three are taken over in a row', async () => {
        const applied: (LyricData | null)[] = [];
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        // The song the screen is on, as the take-over of each track asks it: a take-over answers for
        // the track it was made for, and a listener who moved on keeps the song they moved to.
        let shown = 'Song a';
        const takeOver = (song: SongResult) => {
            shown = String(song.name);
            return loadTakenTrackDetails(song, () => shown === String(song.name), lyrics => applied.push(lyrics));
        };
        void takeOver(a);
        await settle();
        void takeOver(b);
        await settle();
        void takeOver(c);
        await settle();

        // Every read is still on its way, and the listener is on the third song by now.
        expect(env.hooks.get('Song a')).toBeDefined();
        expect(env.hooks.get('Song c')).toBeDefined();
        // The first song's words arrive last, after two more songs were taken over.
        env.hooks.get('Song c')!.onLyrics(lyricsOf('the third song'));
        env.hooks.get('Song a')!.onLyrics(lyricsOf('the first song'));

        expect(applied).toEqual([lyricsOf('the third song')]);
    });

    it('applies no words at all for a track the listener already left', async () => {
        const applied: (LyricData | null)[] = [];
        const [a, b] = ['a', 'b'].map(songOf);
        let shown = 'Song a';
        void loadTakenTrackDetails(a, () => shown === 'Song a', lyrics => applied.push(lyrics));
        await settle();
        shown = 'Song b';
        void loadTakenTrackDetails(b, () => shown === 'Song b', lyrics => applied.push(lyrics));
        await settle();

        env.hooks.get('Song a')!.onLyrics(lyricsOf('the first song'));

        expect(applied).toEqual([]);
    });
});
