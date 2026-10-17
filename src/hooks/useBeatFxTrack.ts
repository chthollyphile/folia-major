import { useEffect, useSyncExternalStore } from 'react';
import { selectDisplaySong, usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { visualizerWantsBeatClock, visualizerWantsDrumHits } from '../components/visualizer/beatClockTargets';
import { beginBeatFxTrack, setBeatFxEvents, setBeatFxIntensities, stopBeatFx } from '../services/beatFx/beatFxLive';
import { loadBeatFxTrackBeats } from '../services/beatFx/beatFxSource';
import { getPlaybackAnalysisKey } from '../services/playbackRecovery/representationRegistry';
import { modelsPresent, subscribeModelAvailability } from '../services/analysis/modelAvailability';
import { setWantedDrumTrack } from '../services/analysis/drumHits';

// src/hooks/useBeatFxTrack.ts
// Loads the beat list of the on-screen track into the live beat clock whenever the track changes,
// while 智能动感模式 is on, the visualizer or background on screen draws beat FX
// (components/visualizer/beatClockTargets.ts) and static mode is off. Also hands the clock the
// 轻拍 / 重拍 strengths it scales the envelopes by. Only the track identity, that answer and the two
// strengths enter React; the per-frame clock lives in services/beatFx/beatFxLive. While the mode on
// screen plays drum hits (时计), the track's drum hits are read too, once its beats are in.

/** An online track's stream URL is resolved by playback around the same time as the lookup. */
const RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;

/** Whether the beat clock should be stepped; the caller's frame loop reads it. */
export function useBeatFxTrack(): boolean {
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    const wanted = useVisualizerSettingsStore(state => visualizerWantsBeatClock(state))
        && !staticMode;
    const drumsWanted = useVisualizerSettingsStore(state => visualizerWantsDrumHits(state)) && wanted;
    // Asked again when htdemucs_gpu arrives (the startup check answering, or a download finishing).
    const drumModel = useSyncExternalStore(subscribeModelAvailability, modelsPresent).htdemucs_gpu;
    const beatIntensity = useVisualizerSettingsStore(state => state.smartBeat.beatIntensity);
    const downbeatIntensity = useVisualizerSettingsStore(state => state.smartBeat.downbeatIntensity);

    useEffect(() => {
        setBeatFxIntensities(beatIntensity, downbeatIntensity);
    }, [beatIntensity, downbeatIntensity]);
    const song = usePlaybackStore(selectDisplaySong);
    // Only the identity, to key the effect; the load resolves the key it reads bytes for itself.
    const identity = wanted && song ? getPlaybackAnalysisKey(song) : null;

    useEffect(() => {
        if (!wanted) {
            stopBeatFx();
            return;
        }
        if (!identity || !song) {
            beginBeatFxTrack(null);
            return;
        }
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let begunKey: string | null = null;
        const load = (attempt: number) => {
            const { key, beats } = loadBeatFxTrackBeats(song);
            // A retry may resolve another key (a transcode registered meanwhile); the clock follows it.
            if (key !== begunKey) {
                beginBeatFxTrack(key);
                begunKey = key;
            }
            void beats.then((result) => {
                if (cancelled) return;
                setBeatFxEvents(key, result.events, result.source, result.note, result.trackScale);
                // An online track whose stream URL playback has not resolved yet: asked again shortly.
                if (result.source === 'none' && result.retry && attempt < RETRY_ATTEMPTS) {
                    retryTimer = setTimeout(() => load(attempt + 1), RETRY_DELAY_MS);
                    return;
                }
                // Only the case that needs explaining; a track with beats shows them.
                if (result.source === 'none') console.info(`[BeatFx] no beats for this track: ${result.note}`);
                // A list stored before accents existed: the same beats with them, once measured.
                void result.accented?.then((accented) => {
                    if (cancelled || !accented) return;
                    setBeatFxEvents(key, accented.events, accented.source, accented.note, accented.trackScale);
                });
            }).catch((error) => {
                if (cancelled) return;
                setBeatFxEvents(key, [], 'none', String(error));
                console.warn('[BeatFx] beat lookup failed', error);
            });
        };
        load(0);
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
        // Keyed on the track identity and the switch only; the song object changes for unrelated reasons.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, wanted]);

    useEffect(() => {
        if (!drumsWanted || !identity || !song) return undefined;
        let left = false;
        // The lookup above is shared, so this joins it rather than starting another; the hits are
        // read off getDrumHits by the frame loop once in, and a track with none plays its beats.
        void loadBeatFxTrackBeats(song).beats
            .then(result => (left ? undefined : result.loadDrums?.()))
            .catch(error => console.warn('[BeatFx] drum hits failed', error));
        return () => {
            left = true;
            // A separation still running for this track stops at its next segment.
            setWantedDrumTrack(null);
        };
        // Keyed like the lookup above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, drumsWanted, drumModel]);

    return wanted;
}
