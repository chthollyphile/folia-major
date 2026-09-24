import { useEffect, useRef } from 'react';
import { setLyricsState, usePlaybackStore } from '../stores/usePlaybackStore';
import { clearLyricSegmentationRecord, setLyricSegmentationRecord } from '../stores/useLyricSegmentationStore';
import { loadSongSegmentation } from '../services/lyricSegmentation';
import { applyLyricWordSegmentation } from '../utils/lyrics/lyricSegmentationRecord';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { applyLyricsTransform, untransformedLyrics } from '../services/hostExtensionHooks';

// src/hooks/useLyricWordSegmentation.ts
// Keeps the saved word segmentation for the playing song in the store the lyric setter reads.
//
// Clearing first is not a nicety: the setter is synchronous, so between a skip and the new load
// resolving the previous song's record would still be live and could bake itself onto the new
// lyrics for any line whose start time and text happened to match.
//
// The record load and the lyric load race, and either can win. If the record lands first the
// setter picks it up on its own; if the lyrics land first they were built without it, so the
// record is applied to them here. That second path is a pure transform over the lines already in
// the store — not a re-run of the lyric pipeline, which would re-apply the display filter and the
// staff policy to text they have already been applied to.

export function useLyricWordSegmentation() {
    const currentSong = usePlaybackStore(state => state.currentSong);
    const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // A load that resolves after another skip must not overwrite the newer song's record.
    const requestedSongKeyRef = useRef<string | null>(null);

    useEffect(() => {
        requestedSongKeyRef.current = songKey;
        clearLyricSegmentationRecord();

        if (!currentSong || !songKey) {
            return;
        }

        let cancelled = false;
        void loadSongSegmentation(currentSong).then(record => {
            if (cancelled || requestedSongKeyRef.current !== songKey) {
                return;
            }
            setLyricSegmentationRecord(songKey, record);
            if (!record) {
                return;
            }
            // Returns the same object when no line matches, so lyrics that already carry the
            // record (or belong to another song) are left alone rather than needlessly replaced.
            // Segmentation goes onto the pre-transform lyrics and the extension transform is re-run
            // from there, so a mod's `lyrics.transform` never applies on top of its own output.
            setLyricsState(previous => {
                const source = untransformedLyrics(previous);
                const segmented = applyLyricWordSegmentation(source, record);
                return segmented === source ? previous : applyLyricsTransform(segmented);
            });
        });

        return () => {
            cancelled = true;
        };
        // currentSong identity changes on metadata hydration; the key is what actually matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songKey]);
}
