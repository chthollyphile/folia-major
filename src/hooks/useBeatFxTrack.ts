import { useEffect, useRef, useSyncExternalStore } from 'react';
import { selectDisplaySong, usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { liveBeatEffects, liveBeatEffectStrength, visualizerWantsBeats, visualizerWantsDrumHits } from '../components/visualizer/beatClockTargets';
import { resolveBeatEffectSetting } from '../services/beatFx/beatEffects';
import { beginBeatFxTrack, getBeatFxHeard, setBeatFxEvents, setBeatFxIntensities, setBeatFxLiveEffects, stopBeatFx } from '../services/beatFx/beatFxLive';
import { loadBeatFxTrackBeats, loadBeatFxTrackDrums } from '../services/beatFx/beatFxSource';
import { getPlaybackAnalysisKey, getPlaybackAnalysisTarget } from '../services/playbackRecovery/representationRegistry';
import { modelsPresent, subscribeModelAvailability } from '../services/analysis/modelAvailability';
import { setWantedDrumTrack } from '../services/analysis/drumHits';

// src/hooks/useBeatFxTrack.ts
// Loads the beat list of the on-screen track into the live beat clock whenever the track changes,
// while 智能动感模式 is on, a live beat effect on screen reads beats
// (components/visualizer/beatClockTargets.ts) and static mode is off. Also hands the clock the
// 轻拍 / 重拍 strengths it scales the envelopes by (the strength of the beat-list effect on screen)
// and every live effect's strength. Only the track identity, those answers and the strengths enter
// React; the per-frame clock lives in services/beatFx/beatFxLive. While a live effect on screen plays
// drum hits (时计's 仿真鼓面), the track's drum hits are read, on their own: a picture with no live
// beat-list effect never runs beat_this, and the clock then only carries the track and its time.

/** An online track's stream URL is resolved by playback around the same time as the lookup. */
const RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;

/** Whether the beat clock should be stepped; the caller's frame loop reads it. */
export function useBeatFxTrack(): boolean {
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    const beatsWanted = useVisualizerSettingsStore(state => visualizerWantsBeats(state)) && !staticMode;
    const drumsWanted = useVisualizerSettingsStore(state => visualizerWantsDrumHits(state)) && !staticMode;
    const wanted = beatsWanted || drumsWanted;
    // Read by the drum hits' retries, which must not restart (and so cancel a separation) when it changes.
    const beatsWantedRef = useRef(beatsWanted);
    beatsWantedRef.current = beatsWanted;
    const beatStrength = useVisualizerSettingsStore(state => liveBeatEffectStrength(state, 'beats'));
    // The live effects and their strengths as one string, so the store's other changes do not re-render.
    const liveEffects = useVisualizerSettingsStore(state => liveBeatEffects(state)
        .map(effect => `${effect.id}=${resolveBeatEffectSetting(state.smartBeat, effect.id).strength}`)
        .join(','));
    // Asked again when htdemucs_gpu arrives (the startup check answering, or a download finishing).
    const drumModel = useSyncExternalStore(subscribeModelAvailability, modelsPresent).htdemucs_gpu;

    useEffect(() => {
        setBeatFxIntensities(beatStrength, beatStrength);
    }, [beatStrength]);
    useEffect(() => {
        const strengths: Record<string, number> = {};
        if (!staticMode && liveEffects) {
            for (const pair of liveEffects.split(',')) {
                const at = pair.lastIndexOf('=');
                strengths[pair.slice(0, at)] = Number(pair.slice(at + 1));
            }
        }
        setBeatFxLiveEffects(strengths);
    }, [liveEffects, staticMode]);
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
        if (!beatsWanted) {
            // Drum hits alone: the clock carries the track and its heard time, with no beats installed.
            beginBeatFxTrack(getPlaybackAnalysisTarget(song).key);
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
        // Keyed on the track identity and the switches only; the song object changes for unrelated reasons.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, wanted, beatsWanted]);

    useEffect(() => {
        if (!drumsWanted || !identity || !song) return undefined;
        let left = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        // The hits are read off getDrumHits by the frame loop once in; a track with none plays nothing.
        const load = (attempt: number) => {
            const { key, drums } = loadBeatFxTrackDrums(song);
            // A retry may resolve another key (a transcode registered meanwhile); with no beats to
            // follow it, the clock follows the drum hits' key, which they are looked up under.
            if (!beatsWantedRef.current && key !== getBeatFxHeard().key) beginBeatFxTrack(key);
            void drums
                .then((result) => {
                    // An online track whose stream URL playback has not resolved yet: asked again shortly.
                    if (!left && result === 'retry' && attempt < RETRY_ATTEMPTS) retryTimer = setTimeout(() => load(attempt + 1), RETRY_DELAY_MS);
                })
                .catch(error => console.warn('[BeatFx] drum hits failed', error));
        };
        load(0);
        return () => {
            left = true;
            if (retryTimer) clearTimeout(retryTimer);
            // A separation still running for this track stops at its next segment.
            setWantedDrumTrack(null);
        };
        // Keyed like the lookup above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, drumsWanted, drumModel]);

    return wanted;
}
