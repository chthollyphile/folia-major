import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
} from '@/stores/usePlaybackStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { currentTime } from '@/stores/motionSignals';
import type { VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';
import { isModsBridgeAvailable, pushRuntimeSnapshot } from '../ipc';
import type { FoliumPlaybackState } from './contract';
import { toFoliumLines, toFoliumSong, toFoliumTheme } from './dto';
import { useFoliumParamStore } from './paramStore';
import { emitFoliumEvent } from './events';

// src/mods/folium/hostBridge.ts
// Publishes what the host is showing to the main process, always (not only
// while the mods panel is open, which is where this used to live and why an
// export started from anywhere else rendered stale lyrics). Main-side mods read
// the public half through runtime.getPlaybackSnapshot; the export service
// replays the internal half.
//
// Uses the *display* selectors: during a crossfade the picture belongs to the
// outgoing track, and a snapshot must describe what is on screen.

const PUSH_DEBOUNCE_MS = 120;
// A position change this far from where playback should be counts as a seek.
const SEEK_JUMP_SEC = 1.5;

const toFoliumPlaybackState = (state: PlayerState): FoliumPlaybackState => {
    if (state === PlayerState.PLAYING) return 'playing';
    if (state === PlayerState.PAUSED) return 'paused';
    return 'stopped';
};

export const useFoliumHostBridge = (theme: Theme, isDaylight: boolean) => {
    const song = usePlaybackStore(selectDisplaySong);
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const playerState = usePlaybackStore(selectDisplayPlayerState);
    const duration = usePlaybackStore(selectDisplayDuration);
    const visualizerMode = useVisualizerSettingsStore((state) => state.visualizerMode);
    // Lift the current visualizer tunings from the settings store so exports can
    // reproduce the song's animation verbatim (rather than the default settings).
    const visualizerTunings = useVisualizerSettingsStore(useShallow((state) => ({
        classic: state.classicTuning,
        cadenza: state.cadenzaTuning,
        partita: state.partitaTuning,
        fume: state.fumeTuning,
        claddagh: state.claddaghTuning,
        cappella: state.cappellaTuning,
        tilt: state.tiltTuning,
        diorama: state.dioramaTuning,
        monet: state.monetTuning,
        pendolo: state.pendoloTuning,
        sonnet: state.sonnetTuning,
        tempera: state.temperaTuning,
    })));
    const foliumParams = useFoliumParamStore((state) => state.byScope);
    // Bumped on seeks: position jumps are the one change no store dependency reflects.
    const [seekRevision, setSeekRevision] = useState(0);

    useEffect(() => {
        let last = currentTime.get();
        let lastAt = performance.now();
        return currentTime.on('change', (value) => {
            const now = performance.now();
            const expected = last + (now - lastAt) / 1000;
            last = value;
            lastAt = now;
            if (Math.abs(value - expected) > SEEK_JUMP_SEC) {
                setSeekRevision((revision) => revision + 1);
                emitFoliumEvent('playback.seeked', { position: value });
            }
        });
    }, []);

    // theme.changed lives here because the theme is App state, not a store.
    const themePrimedRef = useRef(false);
    useEffect(() => {
        if (!themePrimedRef.current) {
            themePrimedRef.current = true;
            return;
        }
        emitFoliumEvent('theme.changed', { theme: toFoliumTheme(theme, isDaylight) });
    }, [theme, isDaylight]);

    useEffect(() => {
        if (!isModsBridgeAvailable()) return undefined;
        const timer = window.setTimeout(() => {
            const songMeta = {
                title: song?.name ?? '',
                artist: (song?.artists ?? []).map((artist) => artist?.name).filter(Boolean).join(' / '),
            };
            void pushRuntimeSnapshot({
                capturedAt: Date.now(),
                public: {
                    song: toFoliumSong(song),
                    state: toFoliumPlaybackState(playerState),
                    position: currentTime.get(),
                    duration: Number.isFinite(duration) ? duration : 0,
                    lines: [...toFoliumLines(lyrics?.lines)],
                    theme: toFoliumTheme(theme, isDaylight),
                    visualizerMode: visualizerMode ?? null,
                },
                internal: {
                    lyricData: lyrics ?? null,
                    visualizerMode: visualizerMode ?? null,
                    visualizerTunings: visualizerTunings as VisualizerTuningBundle,
                    theme,
                    songMeta,
                    foliumParams,
                },
            });
        }, PUSH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [song, lyrics, playerState, duration, theme, isDaylight, visualizerMode, visualizerTunings, foliumParams, seekRevision]);
};
