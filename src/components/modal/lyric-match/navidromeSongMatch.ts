import type { LyricProviderSource, SongResult } from '../../../types';
import { getNavidromeMatchCacheKey, type NavidromeMatchData, type NavidromeSong } from '../../../types/navidrome';
import { saveToCache } from '../../../services/db';
import { fetchLyricsForMatchSource } from '../../../utils/lyrics/lyricMatchSources';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';

// src/components/modal/lyric-match/navidromeSongMatch.ts
// Matching lyrics by hand for a song of a Navidrome server: which result is chosen at first, and
// what is stored for a chosen result and for "no match". The match is kept in the cache, one
// entry a song.

// The result named exactly like the song, whatever the case of its letters; else the first one.
export const pickNavidromeResult = (results: SongResult[], songName: string): SongResult | null => (
    results.find(result => result.name.toLowerCase() === songName.toLowerCase()) ?? results[0] ?? null
);

// Fetches the chosen result's lyrics and stores the match. False when the result has no lyrics
// to show and is not instrumental: nothing is stored then.
export const saveNavidromeLyricMatch = async (
    song: NavidromeSong,
    source: LyricProviderSource,
    selectedResult: SongResult,
    lyricsSource: 'navi' | 'online',
): Promise<boolean> => {
    const processed = await fetchLyricsForMatchSource(source, selectedResult);
    if (!processed || (!hasRenderableLyrics(processed.lyrics) && !processed.isPureMusic)) {
        return false;
    }

    const matchData: NavidromeMatchData = {
        matchedSongId: selectedResult.id,
        matchedLyrics: processed.lyrics || undefined,
        matchedIsPureMusic: processed.isPureMusic,
        useOnlineLyrics: lyricsSource === 'online',
        lyricsSource,
        hasManualLyricSelection: true,
        matchedLyricsSource: source,
        matchedLyricsProviderPlatform: processed.matchedLyricsProviderPlatform,
    };

    if (source !== 'netease') {
        matchData.useOnlineCover = false;
        matchData.useOnlineMetadata = false;
    }

    await saveToCache(getNavidromeMatchCacheKey(song), matchData);
    return true;
};

// "No match": the song keeps the server's lyrics and is not matched automatically again.
export const saveNavidromeNoMatch = async (song: NavidromeSong): Promise<void> => {
    const matchData: NavidromeMatchData = {
        noAutoMatch: true,
        useOnlineLyrics: false,
        lyricsSource: 'navi' as const,
        hasManualLyricSelection: true
    };
    await saveToCache(getNavidromeMatchCacheKey(song), matchData);
};
