import { useEffect, useRef, useState } from 'react';
import type { Theme } from '@/types';
import { PlayerState } from '@/types';
import {
    usePlaybackStore,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
    selectIsShowingTail,
} from '@/stores/usePlaybackStore';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { currentTime } from '@/stores/motionSignals';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { clampMediaVolume } from '@/utils/appPlaybackHelpers';
import type { VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';
import { useVisualizerTunings } from '@/components/visualizer/useVisualizerTunings';
import { isModsBridgeAvailable, pushRuntimeSnapshot } from '../ipc';
import type { FoliumPlaybackState } from '../folium/contract';
import { toFoliumLines, toFoliumSong, toFoliumTheme } from '../folium/dto';
import { useFoliumParamStore } from '../params/paramStore';
import { emitFoliumEvent } from '../folium/events';

// src/mods/runtime/hostBridge.ts
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
    // Folium 1.5 snapshot fields. The store is written on commit (not while a slider drags), so
    // each change re-pushes the snapshot once.
    const volume = useAudioSettingsStore((state) => state.volume);
    const muted = useAudioSettingsStore((state) => state.isMuted);
    const loopMode = useAudioSettingsStore((state) => state.loopMode);
    // Lift the current visualizer tunings from the settings store so exports can
    // reproduce the song's animation verbatim (rather than the default settings).
    const visualizerTunings = useVisualizerTunings();
    const foliumParams = useFoliumParamStore((state) => state.byScope);
    // Bumped on seeks: position jumps are the one change no store dependency reflects.
    const [seekRevision, setSeekRevision] = useState(0);

    /*
     * Seek detection: a position change that does not match how far playback
     * should have moved. Time only advances while playing, and the baseline is
     * re-taken whenever the transport state, the displayed song or the automix
     * hold changes, so resuming after a pause is not a seek.
     *
     * A new track resets the position in the same tick it swaps the song (in
     * either order), so a jump is confirmed a microtask later against the song
     * that was displayed before the tick, compared by playback key. Only a net
     * change of track drops it: an automix blend cancelled by a seek flips the
     * displayed song away and back within the tick, and that seek must still
     * be reported.
     *
     * While an automix blend holds the picture the clock is the outgoing deck's,
     * and its only jumps are the host's own corrections at the edges of the hold
     * (App.tsx re-reads the displayed deck there). A seek during a blend cancels
     * it first, so ignoring the clock for the hold loses no seek. When the hold
     * ends on the arriving track, its first position write is a resync too.
     * Same rule the remote window and the media session follow: during a blend,
     * trust the displayed deck. This hook only observes; it never touches playback.
     */
    useEffect(() => {
        const displaySongKey = () => {
            const displayed = selectDisplaySong(usePlaybackStore.getState());
            return displayed ? getPlaybackSongKey(displayed) : null;
        };
        let last = currentTime.get();
        let lastAt = performance.now();
        // The displayed song as of the last settled tick; refreshed a microtask after a change.
        let settledSongKey = displaySongKey();
        let settlePending = false;
        let holdEndedThisTick = false;
        let resyncPending = false;
        const rebase = () => {
            last = currentTime.get();
            lastAt = performance.now();
        };
        const settle = () => {
            settlePending = false;
            const songKey = displaySongKey();
            if (holdEndedThisTick && songKey !== settledSongKey) resyncPending = true;
            holdEndedThisTick = false;
            settledSongKey = songKey;
        };
        const unsubscribeStore = usePlaybackStore.subscribe((state, previous) => {
            const songChanged = selectDisplaySong(state) !== selectDisplaySong(previous);
            const holdChanged = selectIsShowingTail(state) !== selectIsShowingTail(previous);
            if (holdChanged && !selectIsShowingTail(state)) holdEndedThisTick = true;
            if ((songChanged || holdChanged) && !settlePending) {
                settlePending = true;
                queueMicrotask(settle);
            }
            if (
                songChanged || holdChanged
                || selectDisplayPlayerState(state) !== selectDisplayPlayerState(previous)
                || state.isLoadingToPlay !== previous.isLoadingToPlay
            ) {
                rebase();
            }
        });
        const unsubscribeTime = currentTime.on('change', (value) => {
            const now = performance.now();
            const state = usePlaybackStore.getState();
            // A song loading to play is shown as playing, but its clock has not started yet.
            const expected = selectDisplayPlayerState(state) === PlayerState.PLAYING && !state.isLoadingToPlay
                ? last + (now - lastAt) / 1000
                : last;
            last = value;
            lastAt = now;
            if (selectIsShowingTail(state)) return;
            if (resyncPending) {
                resyncPending = false;
                return;
            }
            if (Math.abs(value - expected) <= SEEK_JUMP_SEC) return;
            const songKeyBefore = settledSongKey;
            queueMicrotask(() => {
                if (displaySongKey() !== songKeyBefore) return;
                setSeekRevision((revision) => revision + 1);
                emitFoliumEvent('playback.seeked', { position: value });
            });
        });
        return () => {
            unsubscribeStore();
            unsubscribeTime();
        };
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
                duration: Number.isFinite(duration) ? duration : 0,
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
                    volume: clampMediaVolume(volume),
                    muted,
                    loopMode,
                },
                internal: {
                    lyricData: lyrics ?? null,
                    visualizerMode: visualizerMode ?? null,
                    visualizerTunings,
                    theme,
                    songMeta,
                    foliumParams,
                },
            });
        }, PUSH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [song, lyrics, playerState, duration, theme, isDaylight, visualizerMode, visualizerTunings, foliumParams, seekRevision, volume, muted, loopMode]);
};
