import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, LyricData, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';
import type { OnlineMetadataCandidate } from '@/services/onlineMetadataSearchService';
import {
    getLocalSongMatchFailureKey,
    saveLocalSongMatch,
    saveLocalSongNoMatch,
} from '@/components/modal/lyric-match/localSongMatch';
import { pickOnlineResult, saveOnlineLyricMatch } from '@/components/modal/lyric-match/onlineSongMatch';
import {
    pickNavidromeResult,
    saveNavidromeLyricMatch,
    saveNavidromeNoMatch,
} from '@/components/modal/lyric-match/navidromeSongMatch';

// test/unit/lyrics/lyricMatchByHand.test.ts
// Matching lyrics by hand, for each kind of song: which result is chosen at first, what is stored
// for a chosen result, and what "no match" stores. Nobody sees these in the window: a wrong value
// shows only later, as the wrong lyrics or as a song matched again.

const mocks = vi.hoisted(() => ({
    fetchLyricsForMatchSource: vi.fn(),
    saveToCache: vi.fn(),
    loadOnlineLyricsState: vi.fn(),
    saveOnlineLyricsState: vi.fn(),
    getLocalLibraryAssignment: vi.fn(),
    applyLocalSongMatchSelection: vi.fn(),
    normalizeLyricMatchMetadataCandidate: vi.fn(),
    buildLocalSongMetadataSearchTarget: vi.fn(),
}));

vi.mock('@/utils/lyrics/lyricMatchSources', () => ({ fetchLyricsForMatchSource: mocks.fetchLyricsForMatchSource }));
vi.mock('@/services/db', () => ({ saveToCache: mocks.saveToCache }));
vi.mock('@/utils/onlineLyricsState', () => ({
    loadOnlineLyricsState: mocks.loadOnlineLyricsState,
    saveOnlineLyricsState: mocks.saveOnlineLyricsState,
}));
vi.mock('@/services/localLibraryEntityRepository', () => ({ getLocalLibraryAssignment: mocks.getLocalLibraryAssignment }));
vi.mock('@/services/localSongMatchSelectionService', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/localSongMatchSelectionService')>(),
    applyLocalSongMatchSelection: mocks.applyLocalSongMatchSelection,
}));
vi.mock('@/services/onlineMetadataSearchService', () => ({
    normalizeLyricMatchMetadataCandidate: mocks.normalizeLyricMatchMetadataCandidate,
    buildLocalSongMetadataSearchTarget: mocks.buildLocalSongMetadataSearchTarget,
}));

const lyrics: LyricData = { lines: [{ startTime: 0, endTime: 4, fullText: 'A line', words: [] }] } as LyricData;
const importedLyrics: LyricData = { lines: [{ startTime: 0, endTime: 4, fullText: 'From a file', words: [] }] } as LyricData;
const found = (id: number | string, name: string): SongResult => ({ id, name, artists: [], album: { id: 0, name: '' }, durationMs: 0 } as unknown as SongResult);
const chosen = found(42, 'Chosen');

beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics, isPureMusic: false });
    mocks.loadOnlineLyricsState.mockResolvedValue(null);
});

describe('a song of an online platform', () => {
    const song = found(7, 'Played');

    it('chooses the first result at first, and none when there is none', () => {
        expect(pickOnlineResult([found(1, 'Other'), found(2, 'Played')])?.id).toBe(1);
        expect(pickOnlineResult([])).toBeNull();
    });

    it('stores the chosen result as the song\'s online lyrics and keeps an imported lyric file', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics, isPureMusic: false, matchedLyricsProviderPlatform: 'qq' });
        mocks.loadOnlineLyricsState.mockResolvedValue({ lyricsSource: 'imported', importedLyrics, importedLyricsName: 'mine.lrc', matchedSongId: 1 });

        expect(await saveOnlineLyricMatch(song, 'amll', chosen)).toBe(true);

        expect(mocks.fetchLyricsForMatchSource).toHaveBeenCalledWith('amll', chosen);
        expect(mocks.saveOnlineLyricsState).toHaveBeenCalledTimes(1);
        expect(mocks.saveOnlineLyricsState.mock.calls[0][0]).toBe(song);
        expect(mocks.saveOnlineLyricsState.mock.calls[0][1]).toEqual({
            lyricsSource: 'online',
            importedLyrics,
            importedLyricsName: 'mine.lrc',
            hasOnlineOverride: true,
            onlineOverrideLyrics: lyrics,
            matchedSongId: 42,
            matchedIsPureMusic: false,
            matchedLyricsSource: 'amll',
            matchedLyricsProviderPlatform: 'qq',
        });
    });

    it('stores an instrumental result with no lyrics, and nothing imported when nothing was', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: true });

        expect(await saveOnlineLyricMatch(song, 'netease', chosen)).toBe(true);

        expect(mocks.saveOnlineLyricsState.mock.calls[0][1]).toEqual({
            lyricsSource: 'online',
            importedLyrics: null,
            importedLyricsName: null,
            hasOnlineOverride: true,
            onlineOverrideLyrics: null,
            matchedSongId: 42,
            matchedIsPureMusic: true,
            matchedLyricsSource: 'netease',
            matchedLyricsProviderPlatform: undefined,
        });
    });

    it('stores nothing for a result with no lyrics to show', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: false });
        expect(await saveOnlineLyricMatch(song, 'netease', chosen)).toBe(false);
        mocks.fetchLyricsForMatchSource.mockResolvedValue(null);
        expect(await saveOnlineLyricMatch(song, 'netease', chosen)).toBe(false);

        expect(mocks.loadOnlineLyricsState).not.toHaveBeenCalled();
        expect(mocks.saveOnlineLyricsState).not.toHaveBeenCalled();
    });
});

describe('a song of a Navidrome server', () => {
    const song = { ...found('nd-1', 'Blue Hour'), isNavidrome: true, navidromeData: { id: 'nd-1' } } as unknown as NavidromeSong;

    it('chooses the result named exactly like the song at first, else the first one', () => {
        expect(pickNavidromeResult([found(1, 'Blue Hour (Live)'), found(2, 'BLUE hour'), found(3, 'Blue Hour')], 'Blue Hour')?.id).toBe(2);
        expect(pickNavidromeResult([found(1, 'Blue Hour (Live)'), found(2, 'Blue Hours')], 'Blue Hour')?.id).toBe(1);
        expect(pickNavidromeResult([], 'Blue Hour')).toBeNull();
    });

    it('stores a NetEase result under the song\'s key, saying nothing of cover and metadata', async () => {
        expect(await saveNavidromeLyricMatch(song, 'netease', chosen, 'online')).toBe(true);

        expect(mocks.fetchLyricsForMatchSource).toHaveBeenCalledWith('netease', chosen);
        expect(mocks.saveToCache).toHaveBeenCalledTimes(1);
        expect(mocks.saveToCache.mock.calls[0][0]).toBe('navidrome_match_nd-1');
        const stored = mocks.saveToCache.mock.calls[0][1];
        expect(stored).toEqual({
            matchedSongId: 42,
            matchedLyrics: lyrics,
            matchedIsPureMusic: false,
            useOnlineLyrics: true,
            lyricsSource: 'online',
            hasManualLyricSelection: true,
            matchedLyricsSource: 'netease',
            matchedLyricsProviderPlatform: undefined,
        });
        expect('useOnlineCover' in stored).toBe(false);
        expect('useOnlineMetadata' in stored).toBe(false);
    });

    it('stores a result of any other source with the online cover and metadata switched off', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics, isPureMusic: false, matchedLyricsProviderPlatform: 'ncm' });

        expect(await saveNavidromeLyricMatch(song, 'amll', chosen, 'navi')).toBe(true);

        expect(mocks.saveToCache.mock.calls[0][1]).toEqual({
            matchedSongId: 42,
            matchedLyrics: lyrics,
            matchedIsPureMusic: false,
            useOnlineLyrics: false,
            lyricsSource: 'navi',
            hasManualLyricSelection: true,
            matchedLyricsSource: 'amll',
            matchedLyricsProviderPlatform: 'ncm',
            useOnlineCover: false,
            useOnlineMetadata: false,
        });
    });

    it('stores an instrumental result without lyrics, and nothing for a result with no lyrics to show', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: true });
        expect(await saveNavidromeLyricMatch(song, 'netease', chosen, 'online')).toBe(true);
        expect(mocks.saveToCache.mock.calls[0][1]).toMatchObject({ matchedLyrics: undefined, matchedIsPureMusic: true });

        mocks.saveToCache.mockClear();
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: false });
        expect(await saveNavidromeLyricMatch(song, 'netease', chosen, 'online')).toBe(false);
        mocks.fetchLyricsForMatchSource.mockResolvedValue(null);
        expect(await saveNavidromeLyricMatch(song, 'netease', chosen, 'online')).toBe(false);
        expect(mocks.saveToCache).not.toHaveBeenCalled();
    });

    it('stores "no match" as the server\'s lyrics and no automatic matching', async () => {
        await saveNavidromeNoMatch(song);

        expect(mocks.fetchLyricsForMatchSource).not.toHaveBeenCalled();
        expect(mocks.saveToCache.mock.calls).toEqual([['navidrome_match_nd-1', {
            noAutoMatch: true,
            useOnlineLyrics: false,
            lyricsSource: 'navi',
            hasManualLyricSelection: true,
        }]]);
    });
});

describe('a local file', () => {
    const song = { id: 'local-1', fileName: 'a.flac', title: 'Blue Hour' } as unknown as LocalSong;
    const target = { title: 'Blue Hour', artist: '', album: '', durationMs: 0 };
    const candidate = {
        source: 'netease',
        songId: 42,
        title: 'Chosen',
        artists: [{ id: 1, name: 'Artist' }],
        album: { id: 2, name: 'Album' },
        coverUrl: 'https://example.com/cover.jpg',
    } as unknown as OnlineMetadataCandidate;
    const applied = { coverAttempted: true, coverCached: true, lyricsApplied: true, partialLyricsFailure: false };
    const allOn = { useOnlineCover: true, useOnlineMetadata: true, lyricsSource: 'online' as const };
    const confirmReplace = vi.fn();
    const save = (choice: Parameters<typeof saveLocalSongMatch>[0]['choice'], source: 'netease' | 'qq' = 'netease') => (
        saveLocalSongMatch({ song, source, selectedResult: chosen, choice, confirmReplace })
    );

    beforeEach(() => {
        confirmReplace.mockReset();
        mocks.buildLocalSongMetadataSearchTarget.mockReturnValue(target);
        mocks.normalizeLyricMatchMetadataCandidate.mockReturnValue(candidate);
        mocks.getLocalLibraryAssignment.mockResolvedValue(undefined);
        mocks.applyLocalSongMatchSelection.mockResolvedValue(applied);
    });

    it('stores the result\'s metadata, cover and lyrics when all three switches are on', async () => {
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics, isPureMusic: false, matchedLyricsProviderPlatform: 'qq' });

        expect(await save(allOn, 'qq')).toBe(applied);

        expect(mocks.buildLocalSongMetadataSearchTarget).toHaveBeenCalledWith(song);
        expect(mocks.normalizeLyricMatchMetadataCandidate).toHaveBeenCalledWith('qq', chosen, target);
        expect(mocks.fetchLyricsForMatchSource).toHaveBeenCalledWith('qq', chosen);
        expect(mocks.applyLocalSongMatchSelection.mock.calls).toEqual([[{
            songId: 'local-1',
            candidate,
            metadata: 'online',
            cover: 'online',
            lyrics: 'online',
            onlineLyrics: { lyrics, songId: 42, source: 'qq', providerPlatform: 'qq', isPureMusic: false },
            lyricsFailed: false,
        }]]);
        expect(confirmReplace).not.toHaveBeenCalled();
    });

    it('stores the file\'s own metadata and cover when their switches are off, and fetches no lyrics when that switch is off', async () => {
        await save({ useOnlineCover: false, useOnlineMetadata: false, lyricsSource: undefined });
        await save({ useOnlineCover: false, useOnlineMetadata: false, lyricsSource: 'embedded' });

        expect(mocks.getLocalLibraryAssignment).not.toHaveBeenCalled();
        expect(mocks.fetchLyricsForMatchSource).not.toHaveBeenCalled();
        expect(mocks.applyLocalSongMatchSelection.mock.calls.map(call => call[0])).toEqual([
            { songId: 'local-1', candidate, metadata: 'imported', cover: 'embedded', lyrics: 'automatic', onlineLyrics: undefined, lyricsFailed: false },
            { songId: 'local-1', candidate, metadata: 'imported', cover: 'embedded', lyrics: 'embedded', onlineLyrics: undefined, lyricsFailed: false },
        ]);
    });

    it('keeps the file\'s cover when the result has none, whatever the switch says', async () => {
        mocks.normalizeLyricMatchMetadataCandidate.mockReturnValue({ ...candidate, coverUrl: undefined });

        await save(allOn);

        expect(mocks.applyLocalSongMatchSelection.mock.calls[0][0]).toMatchObject({ metadata: 'online', cover: 'embedded' });
    });

    it('stores the rest and reports the lyrics as failed when they cannot be fetched or are empty', async () => {
        mocks.fetchLyricsForMatchSource.mockRejectedValueOnce(new Error('offline'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await save(allOn);
        warn.mockRestore();
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: false });
        await save(allOn);
        mocks.fetchLyricsForMatchSource.mockResolvedValue({ lyrics: null, isPureMusic: true });
        await save(allOn);

        expect(mocks.applyLocalSongMatchSelection.mock.calls.map(call => [call[0].lyrics, call[0].onlineLyrics, call[0].lyricsFailed])).toEqual([
            ['online', undefined, true],
            ['online', undefined, true],
            ['online', undefined, false],
        ]);
    });

    it('asks before replacing an artist or album set by hand, and stores nothing on a no', async () => {
        mocks.getLocalLibraryAssignment.mockResolvedValue({ artistOrigin: 'manual', albumOrigin: 'auto-match' });
        confirmReplace.mockResolvedValue(false);

        expect(await save(allOn)).toBeNull();

        expect(mocks.getLocalLibraryAssignment).toHaveBeenCalledWith('local-1');
        expect(confirmReplace).toHaveBeenCalledTimes(1);
        expect(mocks.fetchLyricsForMatchSource).not.toHaveBeenCalled();
        expect(mocks.applyLocalSongMatchSelection).not.toHaveBeenCalled();

        mocks.getLocalLibraryAssignment.mockResolvedValue({ artistOrigin: 'auto-match', albumOrigin: 'split' });
        confirmReplace.mockResolvedValue(true);
        expect(await save(allOn)).toBe(applied);
        expect(confirmReplace).toHaveBeenCalledTimes(2);
    });

    it('does not ask when nothing set by hand would be replaced', async () => {
        mocks.getLocalLibraryAssignment.mockResolvedValue({ artistOrigin: 'auto-match', albumOrigin: 'manual-match' });
        await save(allOn);
        // Set by hand, but the result brings no artist and no album to replace them with.
        mocks.getLocalLibraryAssignment.mockResolvedValue({ artistOrigin: 'manual', albumOrigin: 'split' });
        mocks.normalizeLyricMatchMetadataCandidate.mockReturnValue({ ...candidate, artists: [], album: undefined });
        await save(allOn);

        expect(confirmReplace).not.toHaveBeenCalled();
        expect(mocks.applyLocalSongMatchSelection).toHaveBeenCalledTimes(2);
    });

    it('stores "no match" as the file\'s own data and no automatic matching', async () => {
        await saveLocalSongNoMatch('local-1');

        expect(mocks.applyLocalSongMatchSelection.mock.calls).toEqual([[{
            songId: 'local-1',
            metadata: 'imported',
            cover: 'embedded',
            lyrics: 'automatic',
            setNoAutoMatch: true,
        }]]);
    });

    it('names what could not be applied: the lyrics before the cover, nothing when all was', () => {
        expect(getLocalSongMatchFailureKey({ ...applied, partialLyricsFailure: true, coverCached: false })).toBe('localMusic.lyricsNotAppliedOtherSaved');
        expect(getLocalSongMatchFailureKey({ ...applied, coverCached: false })).toBe('localMusic.coverCacheFailed');
        expect(getLocalSongMatchFailureKey({ ...applied, coverAttempted: false, coverCached: false })).toBeUndefined();
        expect(getLocalSongMatchFailureKey(applied)).toBeUndefined();
    });
});
