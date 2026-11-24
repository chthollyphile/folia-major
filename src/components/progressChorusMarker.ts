import { useMemo } from 'react';
import { untransformedLyrics } from '../services/hostExtensionHooks';
import { selectDisplayLyrics, usePlaybackStore } from '../stores/usePlaybackStore';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { findSourceChorusStart } from '../utils/lyrics/chorusEffects';

// src/components/progressChorusMarker.ts
// Where the progress bar's chorus-start tick sits: only for a chorus the lyric data marked (a platform's
// chorus ranges, a TTML songPart), never one the host guessed from repeated lines.

// A tick this close to either end says nothing the ends do not already say.
const EDGE_MARGIN = 0.01;

/**
 * The chorus start as a fraction of the bar, or null for no tick. Lyric time runs `offsetMs` behind the
 * audio (lyric = audio - offset), so the audio position of a lyric time adds the offset back.
 */
export const getChorusMarkerFraction = (
    chorusStartSec: number | null,
    offsetMs: number,
    durationSec: number,
): number | null => {
    if (chorusStartSec === null || !(durationSec > 0)) return null;
    const fraction = (chorusStartSec + offsetMs / 1000) / durationSec;
    if (!Number.isFinite(fraction) || fraction <= EDGE_MARGIN || fraction >= 1 - EDGE_MARGIN) return null;
    return fraction;
};

/**
 * The tick's position on a bar of `durationSec` for the lyrics on screen, null when it is off or there is
 * none. `wanted` is false for a bar that is not the song on screen (another song's poster on the wall).
 * The chorus is read off the lyrics before an extension's `lyrics.transform`: lines a mod rebuilt come
 * back without their chorus origin, and a transform does not move where the song's chorus is.
 */
export const useChorusMarkerFraction = (durationSec: number, wanted = true): number | null => {
    const enabled = usePlayerChromeSettingsStore(state => state.progressBarChorusMarker) && wanted;
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const songOffsetMs = usePlaybackStore(state => state.lyricTimelineOffsetMs);
    const globalOffsetMs = useLyricSettingsStore(state => state.globalLyricTimelineOffsetMs);
    const chorusStartSec = useMemo(() => (enabled ? findSourceChorusStart(untransformedLyrics(lyrics)) : null), [enabled, lyrics]);
    return getChorusMarkerFraction(chorusStartSec, songOffsetMs + globalOffsetMs, durationSec);
};
