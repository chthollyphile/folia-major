import { useEffect, useRef, useSyncExternalStore } from 'react';
import { selectDisplaySong, usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { liveBeatEffects, liveBeatEffectStrength, visualizerWantsBeats, visualizerWantsDrumHits, visualizerWantsStems } from '../components/visualizer/beatClockTargets';
import { anyDrumBeatEffectOn, beatEffectPartId, resolveBeatEffectPartStrength, resolveBeatEffectSetting, smartBeatMayAnalyse } from '../services/beatFx/beatEffects';
import { beginBeatFxTrack, getBeatFxHeard, setBeatFxEvents, setBeatFxIntensities, setBeatFxLiveEffects, stopBeatFx } from '../services/beatFx/beatFxLive';
import { loadBeatFxTrackBeats, loadBeatFxTrackDrums } from '../services/beatFx/beatFxSource';
import { getPlaybackAnalysisKey, getPlaybackAnalysisTarget } from '../services/playbackRecovery/representationRegistry';
import { modelsPresent, subscribeModelAvailability } from '../services/analysis/modelAvailability';
import { drumHitsSettled, setWantedDrumTrack } from '../services/analysis/drumHits';
import { setStemDrumsWanted } from '../services/analysis/stemRange';

// src/hooks/useBeatFxTrack.ts
// Loads the beat list of the on-screen track into the live beat clock whenever the track changes,
// while 智能动感模式 is on, a live beat effect on screen reads beats
// (components/visualizer/beatClockTargets.ts) and static mode is off. Also hands the clock the
// 轻拍 / 重拍 strengths it scales the envelopes by (the strength of the beat-list effect on screen)
// and every live effect's strength. Only the track identity, those answers and the strengths enter
// React; the per-frame clock lives in services/beatFx/beatFxLive. While a live effect on screen plays
// drum hits (时计's 仿真鼓面), the track's drum hits are read, on their own: a picture with no live
// beat-list effect never runs beat_this, and the clock then only carries the track and its time. A live
// effect that reads the vocal envelope too (雾笺's 疏雨轻车) asks the same separation for the vocal stem.
// A drum separation started for the track stops (at its next segment) when the picture, the track or
// the switch changes, and keeps where it was to carry on from when 时计 is back (see the note at the
// end; until the analysis service's 2b it ran on behind another picture).
// Under 智能动感模式's `cached` both are read from what is stored only (`storedOnly`, see
// services/beatFx/beatFxSource.ts) and nothing is run; switching between `cached` and `on` mid-track
// reloads both, so `on` analyses the track at once and `cached` stops a separation in flight.
// Also tells the stem segments (services/analysis/stemRange.ts) for which tracks the drums automix
// separated are worth keeping for the drum hits (from the PR #750 review).

/** An online track's stream URL is resolved by playback around the same time as the lookup. */
const RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 3000;

/** Whether the beat clock should be stepped; the caller's frame loop reads it. */
export function useBeatFxTrack(): boolean {
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    // A see-through player page draws no background, so the background's effects do not count (beatClockTargets.ts).
    const pageTransparent = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground || state.enablePlayerPageNativeBlur);
    const beatsWanted = useVisualizerSettingsStore(state => visualizerWantsBeats({ ...state, pageTransparent })) && !staticMode;
    const drumsWanted = useVisualizerSettingsStore(state => visualizerWantsDrumHits({ ...state, pageTransparent })) && !staticMode;
    // 雾笺's 疏雨轻车 reads the drum hits and the vocal envelope, which the same separation reads (analysis/vocalEnvelope.ts).
    const vocalsWanted = useVisualizerSettingsStore(state => visualizerWantsStems({ ...state, pageTransparent })) && !staticMode;
    const separationWanted = drumsWanted || vocalsWanted;
    const wanted = beatsWanted || separationWanted;
    // `cached`: read what is stored, never run a model (SmartBeatMode).
    const storedOnly = !useVisualizerSettingsStore(state => smartBeatMayAnalyse(state.smartBeat));
    // Read by the drum hits' retries, which must not restart (and so cancel a separation) when it changes.
    const beatsWantedRef = useRef(beatsWanted);
    beatsWantedRef.current = beatsWanted;
    const beatStrength = useVisualizerSettingsStore(state => liveBeatEffectStrength({ ...state, pageTransparent }, 'beats'));
    // The live effects and their strengths as one string, so the store's other changes do not re-render;
    // an effect's parts each under their own id (beatEffectPartId) beside it.
    const liveEffects = useVisualizerSettingsStore(state => liveBeatEffects({ ...state, pageTransparent })
        .flatMap((effect) => {
            const setting = resolveBeatEffectSetting(state.smartBeat, effect.id);
            return [`${effect.id}=${setting.strength}`, ...(effect.parts ?? [])
                .map(part => `${beatEffectPartId(effect.id, part.key)}=${resolveBeatEffectPartStrength(setting, part.key)}`)];
        })
        .join(','));
    // Asked again when htdemucs_gpu's answer arrives (the startup check; the file ships with the app).
    const drumModel = useSyncExternalStore(subscribeModelAvailability, modelsPresent).htdemucs_gpu;

    // Whether a track's drum hits may still be separated, on any picture (时计 or 凝彩 may come on later): only
    // then are the drums automix's segments leave behind kept (services/analysis/stemRange.ts), and only
    // for a track whose hits are not all in yet. "All in" is drumHits.ts' settled set, drumless tracks
    // included (from the PR #750 review: the hit lists in memory hold neither those nor more than 24).
    // A track whose hits are stored but not read this session still counts as not in: the test is
    // synchronous, and its drums go once they are read (dropStemDrums) or by the cache's own limit.
    const drumsMayRun = useVisualizerSettingsStore(state => smartBeatMayAnalyse(state.smartBeat)
        && anyDrumBeatEffectOn(state.smartBeat)) && drumModel;
    useEffect(() => {
        setStemDrumsWanted(drumsMayRun
            ? (key) => !drumHitsSettled(key)
            : () => false);
    }, [drumsMayRun]);

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
            const { key, beats } = loadBeatFxTrackBeats(song, { storedOnly });
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
    }, [identity, wanted, beatsWanted, storedOnly]);

    useEffect(() => {
        if (!separationWanted || !identity || !song) return undefined;
        let left = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        // The hits are read off getDrumHits by the frame loop once in; a track with none plays nothing.
        const load = (attempt: number) => {
            const { key, drums } = loadBeatFxTrackDrums(song, { storedOnly, vocals: vocalsWanted });
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
            // The separation stops here (at its next segment) and keeps where it was, to carry on from
            // when the track is wanted again (drumHits.ts, DrumResume). See below.
            setWantedDrumTrack(null);
        };
        // Keyed like the lookup above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, separationWanted, vocalsWanted, drumModel, storedOnly]);

    // Until the analysis service's 2b: a separation still running stopped (at its next segment) when the
    // track changed, or 智能动感模式 or static mode was switched off - not when the picture did. Stopped
    // on a picture switch, it dropped the hits it had so far, and coming back to 时计 separated the
    // track again from the start: no drumhead for the seconds that took (2026-10-17, on
    // v0.7.21-rc.1). Left running, it finished and was stored, at the cost of sharing the GPU for a
    // while with whatever the new picture ran; the memory it held was what it held on 时计. Switching
    // to `cached` stops it too: that mode runs nothing.
    // (`storedOnly` is also true while 智能动感模式 is off.)
    // @note That was PR #734's stopgap. Since the analysis service's 2b (docs/analysis-service-plan.md)
    // a picture switch stops it again, in the drum hits' cleanup above, and it no longer starts over: the
    // hits so far and where it was are kept in memory (drumHits.ts, DrumResume), the hits play as soon as
    // 时计 is back, and the separation carries on from the segment it stopped before. The decoded track
    // and the stem are let go meanwhile, and the GPU is the new picture's.

    return wanted;
}
