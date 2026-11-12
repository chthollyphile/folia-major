import { useEffect, useRef, useState } from 'react';
import i18n from '../i18n/config';
import type { VisualizerMode } from '../types';
import type { LyricSegmentationActions } from '../components/app/playback/createLyricSegmentationActions';
import { getVisualizerRegistryEntry } from '../components/visualizer/registry';
import { segmentLyricsWithAi } from '../services/lyricSegmentationAi';
import { saveSongSegmentation } from '../services/lyricSegmentation';
import { isLyricSegmentationAiAvailable } from '../services/aiText';
import { useLyricSegmentationStore } from '../stores/useLyricSegmentationStore';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { countAppliedSegmentationLines, createLyricSegmentationRecord, getLyricLineSegmentationKey } from '../utils/lyrics/lyricSegmentationRecord';
import { pickAutoSegmentationLines } from '../utils/lyrics/autoLyricSegmentation';

// src/hooks/useAutoLyricSegmentation.ts
// The "自动 AI 分词" setting (issue #960): runs the same AI word segmentation the command surface's
// --ai does, by itself, once per song that has no saved split, so a listener does not have to open
// the palette on every track.
//
// Which songs qualify is utils/lyrics/autoLyricSegmentation's pickAutoSegmentationLines. Each song
// is tried at most once per session, so a failure or a reset does not turn into a paid retry loop.
//
// The lyrics settle in stages after a skip (first load, a better match swapped in, the saved
// record and icu-folia baked on), so the run waits for them to stop changing before it starts.

/** Quiet time after the last lyric change before the request goes out. */
const SETTLE_DELAY_MS = 2500;

type UseAutoLyricSegmentationParams = {
    visualizerMode: VisualizerMode;
    isLyricsLoading: boolean;
    save: LyricSegmentationActions['save'];
};

export function useAutoLyricSegmentation({ visualizerMode, isLyricsLoading, save }: UseAutoLyricSegmentationParams) {
    const enabled = useLyricSettingsStore(state => state.autoAiLyricSegmentation);
    const usesWords = Boolean(getVisualizerRegistryEntry(visualizerMode).usesWordSegmentation);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const recordSongKey = useLyricSegmentationStore(state => state.songKey);
    const hasRecord = useLyricSegmentationStore(state => state.record !== null);
    const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;

    const attemptedSongKeysRef = useRef(new Set<string>());
    // Bumped when a run gives its song's try back, so the start effect looks again.
    const [retryTick, setRetryTick] = useState(0);
    // An error is said once until a run succeeds: with no model configured every song would fail
    // the same way, but a failure after the user fixed the settings is news again.
    const reportedFailureRef = useRef(false);
    const saveRef = useRef(save);
    saveRef.current = save;

    // Runs in flight, by song. A run is called off only when the setting goes off or its song gets a
    // split some other way while playing (the user saved one, or ran --ai themselves). Not when
    // the song ends: the request is paid for by then (on desktop it cannot even be stopped), so its
    // answer is kept for that song on disk. Not when the mode changes: the split is per song. Not
    // when the lyrics object changes under it: that is usually another bake of the same lyrics,
    // and the save checks the lines still match.
    const inFlightRef = useRef(new Map<string, AbortController>());
    useEffect(() => {
        const runs = inFlightRef.current;
        if (!enabled) {
            // Switched off: nothing was saved, so none of these songs has had its try.
            runs.forEach((controller, key) => {
                controller.abort();
                attemptedSongKeysRef.current.delete(key);
            });
            runs.clear();
            return;
        }
        if (songKey && hasRecord) {
            runs.get(songKey)?.abort();
            runs.delete(songKey);
        }
    }, [enabled, songKey, hasRecord]);
    useEffect(() => {
        const runs = inFlightRef.current;
        return () => runs.forEach(controller => controller.abort());
    }, []);

    useEffect(() => {
        const lines = pickAutoSegmentationLines({
            enabled,
            usesWords,
            songKey,
            recordSongKey,
            hasRecord,
            isLyricsLoading,
            lyrics,
            alreadyAttempted: songKey ? attemptedSongKeysRef.current.has(songKey) : false,
        });
        if (!lines || !songKey || !isLyricSegmentationAiAvailable()) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            const song = usePlaybackStore.getState().currentSong;
            if (!song || getPlaybackSongKey(song) !== songKey) {
                return;
            }
            attemptedSongKeysRef.current.add(songKey);
            const controller = new AbortController();
            inFlightRef.current.set(songKey, controller);
            console.info('[AutoLyricSegmentation] Segmenting', { songKey, lines: lines.length });
            void (async () => {
                try {
                    const { boundaries, failures } = await segmentLyricsWithAi(lines.map(line => line.fullText), {
                        signal: controller.signal,
                    });
                    // An IPC request cannot be called off, so a run cancelled meanwhile still
                    // resolves; its answer is dropped rather than saved.
                    if (controller.signal.aborted) {
                        return;
                    }
                    const record: Record<string, string[]> = {};
                    lines.forEach((line, index) => {
                        const row = boundaries[index];
                        if (row) record[getLyricLineSegmentationKey(line)] = row;
                    });
                    if (failures.length > 0) {
                        console.warn('[AutoLyricSegmentation] Some batches failed; those lines keep the default split', failures);
                    }
                    reportedFailureRef.current = false;
                    const playing = usePlaybackStore.getState().currentSong;
                    if (!playing || getPlaybackSongKey(playing) !== songKey) {
                        // The song ended while this ran: keep the paid answer for it on disk, where
                        // the next time it plays loads it like any saved split.
                        await saveSongSegmentation(song, createLyricSegmentationRecord(songKey, 'ai', record));
                        console.info('[AutoLyricSegmentation] Saved for a song no longer playing', { songKey, applied: Object.keys(record).length });
                        return;
                    }
                    // A split the user saved while this ran wins; it is theirs.
                    const saved = useLyricSegmentationStore.getState();
                    if (saved.songKey === songKey && saved.record) {
                        console.info('[AutoLyricSegmentation] Dropped: the song got a split meanwhile', { songKey });
                        return;
                    }
                    // Lyrics swapped for another source or timing meanwhile: a record keyed to the
                    // old lines would match nothing yet still mark the song as segmented for good.
                    // Give the try back instead, so the new lyrics get their own run.
                    const shown = usePlaybackStore.getState().lyrics;
                    if (countAppliedSegmentationLines(shown, createLyricSegmentationRecord(songKey, 'ai', record)) === 0) {
                        const shownKeys = new Set(shown?.lines.map(getLyricLineSegmentationKey));
                        // Only a real swap gets a retry. Lines still on screen that no row fits
                        // mean the answer itself was unusable, and asking again would loop on it.
                        if (!lines.some(line => shownKeys.has(getLyricLineSegmentationKey(line)))) {
                            console.info('[AutoLyricSegmentation] Dropped: the lyrics changed meanwhile', { songKey });
                            attemptedSongKeysRef.current.delete(songKey);
                            setRetryTick(tick => tick + 1);
                        } else {
                            console.warn('[AutoLyricSegmentation] Dropped: no row fits its line', { songKey });
                        }
                        return;
                    }
                    await saveRef.current(record, 'ai', { songKey, auto: true });
                    console.info('[AutoLyricSegmentation] Finished', { songKey, applied: Object.keys(record).length });
                } catch (error) {
                    if (error instanceof DOMException && error.name === 'AbortError') {
                        return;
                    }
                    console.warn('[AutoLyricSegmentation] Segmentation failed', error);
                    if (!reportedFailureRef.current) {
                        reportedFailureRef.current = true;
                        setStatusMessage({ type: 'error', text: i18n.t('lyricSegmentation.autoFailed') });
                    }
                } finally {
                    if (inFlightRef.current.get(songKey) === controller) {
                        inFlightRef.current.delete(songKey);
                    }
                }
            })();
        }, SETTLE_DELAY_MS);

        // Only the pending start is dropped here; a run already under way is the effect above's.
        return () => window.clearTimeout(timeoutId);
    }, [enabled, usesWords, songKey, recordSongKey, hasRecord, isLyricsLoading, lyrics, retryTick]);
}
