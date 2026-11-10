import { useEffect, useRef } from 'react';
import type { SongResult, VisualizerMode } from '../types';
import { pickRandomVisualizerMode } from '../utils/randomVisualizerModes';
import type { SetVisualizerModeOptions } from '../stores/useVisualizerSettingsStore';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// Applies a different registered lyric animation mode when the active track changes.
export function useRandomVisualizerMode({
    currentSong,
    enabled,
    visualizerMode,
    modes,
    setVisualizerMode,
}: {
    currentSong: SongResult | null;
    enabled: boolean;
    visualizerMode: VisualizerMode;
    modes: readonly VisualizerMode[];
    setVisualizerMode: (mode: VisualizerMode, options?: SetVisualizerModeOptions) => void;
}) {
    const observedSongIdRef = useRef<string | null>(null);
    const pendingChoiceRef = useRef<{ songId: string | null; from: VisualizerMode; modes: readonly VisualizerMode[] } | null>(null);

    useEffect(() => {
        const songId = currentSong ? getPlaybackSongKey(currentSong) : null;
        if (!enabled) {
            observedSongIdRef.current = songId;
            pendingChoiceRef.current = null;
            return;
        }
        const songChanged = songId !== null && observedSongIdRef.current !== null && observedSongIdRef.current !== songId;
        if (songId !== null) observedSongIdRef.current = songId;

        // Keep one choice for the whole song. Enabling random or editing its pool only replaces a
        // style that is outside the selection; StrictMode and refreshed song metadata do not reroll.
        if (!songChanged && modes.includes(visualizerMode)) {
            pendingChoiceRef.current = null;
            return;
        }
        // StrictMode can replay this effect before the selected mode reaches the next render.
        const pending = pendingChoiceRef.current;
        if (pending?.songId === songId && pending.from === visualizerMode && pending.modes === modes) return;
        pendingChoiceRef.current = { songId, from: visualizerMode, modes };

        const nextMode = pickRandomVisualizerMode(modes, visualizerMode);
        if (nextMode !== visualizerMode) {
            setVisualizerMode(nextMode, { notify: false, preserveRandom: true });
        }
    }, [currentSong, enabled, modes, setVisualizerMode, visualizerMode]);
}
