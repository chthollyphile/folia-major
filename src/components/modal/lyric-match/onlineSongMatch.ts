import type { LyricProviderSource, OnlineLyricsState, SongResult } from '../../../types';
import { loadOnlineLyricsState, saveOnlineLyricsState } from '../../../utils/onlineLyricsState';
import { fetchLyricsForMatchSource } from '../../../utils/lyrics/lyricMatchSources';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';

// src/components/modal/lyric-match/onlineSongMatch.ts
// Matching lyrics by hand for a song of an online platform: which result is chosen at first, and
// what is stored for a chosen result. The match is kept as the song's online lyric state.

// The first result: the search gives them best match first.
export const pickOnlineResult = (results: SongResult[]): SongResult | null => results[0] ?? null;

// Fetches the chosen result's lyrics and stores them as the song's lyrics, keeping a lyric file
// the person imported for it. False when the result has no lyrics to show and is not
// instrumental: nothing is stored then.
export const saveOnlineLyricMatch = async (
    song: SongResult,
    source: LyricProviderSource,
    selectedResult: SongResult,
): Promise<boolean> => {
    const processed = await fetchLyricsForMatchSource(source, selectedResult);

    if (!processed || (!hasRenderableLyrics(processed.lyrics) && !processed.isPureMusic)) {
        return false;
    }

    const previousState = await loadOnlineLyricsState(song);
    const nextState: OnlineLyricsState = {
        lyricsSource: 'online',
        importedLyrics: previousState?.importedLyrics ?? null,
        importedLyricsName: previousState?.importedLyricsName ?? null,
        hasOnlineOverride: true,
        onlineOverrideLyrics: processed.lyrics,
        matchedSongId: selectedResult.id,
        matchedIsPureMusic: processed.isPureMusic,
        matchedLyricsSource: source,
        matchedLyricsProviderPlatform: processed.matchedLyricsProviderPlatform,
    };
    await saveOnlineLyricsState(song, nextState);
    return true;
};
