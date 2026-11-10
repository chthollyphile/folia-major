import type { LocalSong, LyricProviderSource, SongResult } from '../../../types';
import { getLocalLibraryAssignment } from '../../../services/localLibraryEntityRepository';
import {
    applyLocalSongMatchSelection,
    resolveLyricMatchMetadataSelection,
    type ApplyLocalSongMatchSelectionResult,
} from '../../../services/localSongMatchSelectionService';
import { buildLocalSongMetadataSearchTarget, normalizeLyricMatchMetadataCandidate } from '../../../services/onlineMetadataSearchService';
import { fetchLyricsForMatchSource } from '../../../utils/lyrics/lyricMatchSources';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';

// src/components/modal/lyric-match/localSongMatch.ts
// Matching lyrics by hand for a local file: what is stored for a chosen result and for "no
// match". A local file takes more than lyrics from a result: its three switches say whether the
// result's cover, its metadata and its lyrics are used. No result is chosen at first. A source
// that has no song metadata of its own (AMLL DB) gives lyrics only: the song's metadata and cover
// stay as they are.

// The three switches of the window, as they stand when the person saves.
export type LocalSongMatchChoice = {
    useOnlineCover: boolean;
    useOnlineMetadata: boolean;
    /** `undefined`: the song's lyrics are picked by the configured priority. */
    lyricsSource: 'local' | 'embedded' | 'online' | undefined;
};

/**
 * Stores what the person chose for a local song. `confirmReplace` is asked when the result's
 * metadata would replace an artist or an album the person set by hand; a no ends it with null and
 * nothing stored. A lyric that cannot be fetched does not stop the rest from being stored.
 */
export const saveLocalSongMatch = async ({ song, source, selectedResult, choice, confirmReplace }: {
    song: LocalSong;
    source: LyricProviderSource;
    selectedResult: SongResult;
    choice: LocalSongMatchChoice;
    confirmReplace: () => Promise<boolean>;
}): Promise<ApplyLocalSongMatchSelectionResult | null> => {
    const candidate = normalizeLyricMatchMetadataCandidate(
        source,
        selectedResult,
        buildLocalSongMetadataSearchTarget(song),
    );
    const selection = resolveLyricMatchMetadataSelection(source, candidate, choice);
    if (selection.metadata === 'online') {
        const assignment = await getLocalLibraryAssignment(song.id);
        const protectedOrigins = new Set(['manual', 'split']);
        const replacesProtectedArtist = Boolean(
            candidate.artists.length
            && assignment
            && protectedOrigins.has(assignment.artistOrigin),
        );
        const replacesProtectedAlbum = Boolean(
            candidate.album?.name
            && assignment
            && protectedOrigins.has(assignment.albumOrigin),
        );
        if ((replacesProtectedArtist || replacesProtectedAlbum) && !await confirmReplace()) return null;
    }
    let processed = null;
    let lyricsFailed = false;
    if (choice.lyricsSource === 'online') {
        try {
            processed = await fetchLyricsForMatchSource(source, selectedResult);
            lyricsFailed = !processed?.isPureMusic && !hasRenderableLyrics(processed?.lyrics);
        } catch (error) {
            console.warn('[LocalMusic] Lyrics failed while applying metadata selection:', error);
            lyricsFailed = true;
        }
    }
    // A chosen result that is itself instrumental (no lyric lines) is stored as the instrumental mark.
    const pickedPureMusic = choice.lyricsSource === 'online' && Boolean(processed?.isPureMusic) && !processed?.lyrics;
    return applyLocalSongMatchSelection({
        songId: song.id,
        ...selection,
        setPureMusicMark: pickedPureMusic ? true : undefined,
        lyrics: choice.lyricsSource || 'automatic',
        onlineLyrics: processed?.lyrics ? {
            lyrics: processed.lyrics,
            songId: selectedResult.id,
            source,
            providerPlatform: processed.matchedLyricsProviderPlatform,
            isPureMusic: processed.isPureMusic,
        } : undefined,
        lyricsFailed,
    });
};

// "No match": the file's own metadata, cover and lyrics, and no automatic matching again.
export const saveLocalSongNoMatch = (songId: string): Promise<ApplyLocalSongMatchSelectionResult> => (
    applyLocalSongMatchSelection({
        songId,
        metadata: 'imported',
        cover: 'embedded',
        lyrics: 'automatic',
        setNoAutoMatch: true,
    })
);

// What of a saved choice could not be applied, as the key of the text that goes with the
// hand-over; undefined when all of it was applied.
export const getLocalSongMatchFailureKey = (applied: ApplyLocalSongMatchSelectionResult): string | undefined => {
    if (applied.partialLyricsFailure) return 'localMusic.lyricsNotAppliedOtherSaved';
    if (applied.coverAttempted && !applied.coverCached) return 'localMusic.coverCacheFailed';
    return undefined;
};
