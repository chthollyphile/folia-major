import { useEffect } from 'react';
import { selectDisplaySong, usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { visualizerWantsBeatClock } from '../components/visualizer/beatClockTargets';
import { beginBeatFxTrack, setBeatFxEvents, setBeatFxIntensities, stopBeatFx } from '../services/beatFx/beatFxLive';
import { loadBeatFxTrackBeats } from '../services/beatFx/beatFxSource';
import { getPlaybackAnalysisKey } from '../services/playbackRecovery/representationRegistry';

// src/hooks/useBeatFxTrack.ts
// Loads the beat list of the on-screen track into the live beat clock whenever the track changes,
// while 智能动感模式 is on, the visualizer or background on screen draws beat FX
// (components/visualizer/beatClockTargets.ts) and static mode is off. Also hands the clock the
// 轻拍 / 重拍 strengths it scales the envelopes by. Only the track identity, that answer and the two
// strengths enter React; the per-frame clock lives in services/beatFx/beatFxLive.

/** Whether the beat clock should be stepped; the caller's frame loop reads it. */
export function useBeatFxTrack(): boolean {
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    const wanted = useVisualizerSettingsStore(state => visualizerWantsBeatClock(state))
        && !staticMode;
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
        const { key, beats } = loadBeatFxTrackBeats(song);
        beginBeatFxTrack(key);
        let cancelled = false;
        void beats.then((result) => {
            if (cancelled) return;
            setBeatFxEvents(key, result.events, result.source, result.note, result.trackScale);
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
        return () => {
            cancelled = true;
        };
        // Keyed on the track identity and the switch only; the song object changes for unrelated reasons.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, wanted]);

    return wanted;
}
