import { useEffect, useRef } from 'react';
import type { SongResult, VisualizerMode } from '../types';
import { VISUALIZER_REGISTRY } from '../components/visualizer/registry';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// Applies a different registered lyric animation mode when the active track changes.
export function useRandomVisualizerMode({
    currentSong,
    enabled,
    visualizerMode,
    setVisualizerMode,
}: {
    currentSong: SongResult | null;
    enabled: boolean;
    visualizerMode: VisualizerMode;
    setVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean }) => void;
}) {
    const observedSongIdRef = useRef<string | null>(null);
    const wasEnabledRef = useRef(enabled);

    useEffect(() => {
        const songId = currentSong ? getPlaybackSongKey(currentSong) : null;
        const wasEnabled = wasEnabledRef.current;
        wasEnabledRef.current = enabled;

        if (!enabled) {
            observedSongIdRef.current = songId;
            return;
        }

        if (!wasEnabled) {
            observedSongIdRef.current = songId;
            return;
        }

        if (songId === null) {
            return;
        }

        if (observedSongIdRef.current === null) {
            observedSongIdRef.current = songId;
            return;
        }

        if (observedSongIdRef.current === songId) {
            return;
        }

        observedSongIdRef.current = songId;
        const candidates = VISUALIZER_REGISTRY
            .map(entry => entry.mode)
            .filter(mode => mode !== visualizerMode);
        const nextMode = candidates[Math.floor(Math.random() * candidates.length)] ?? visualizerMode;
        setVisualizerMode(nextMode, { notify: false });
    }, [currentSong, enabled, setVisualizerMode, visualizerMode]);
}
