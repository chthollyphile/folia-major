import { create } from 'zustand';
import type React from 'react';
import { PlayerState, type ActiveLocalLyricsSource, type LyricData, type PlaybackContext, type ReplayGainMode, type SongResult } from '../types';
import { createCoverUrlResolver } from '../components/app/playback/createCoverUrlResolver';
import { applyLyricsTransform } from '../services/hostExtensionHooks';

/** The now-playing picture, frozen for as long as a transition is running. */
export interface TransitionDisplay {
    song: SongResult | null;
    lyrics: LyricData | null;
    /** Held with the song: the cover cache is repointed at the arriving track during the blend. */
    coverUrl: string | null;
    /** Held for the same reason, or the progress bar reads the old position against a new length. */
    duration: number;
}

// src/stores/usePlaybackStore.ts
// What is playing, and what the listener is being shown while it plays.
//
// Two layers, and the distinction is load-bearing:
//
//   raw     — what the machine is doing right now.
//   display — what the listener perceives. During an automix blend the outgoing deck is still
//             audible while the raw state has already moved on to the arriving track.
//
// The display layer is exported as *selectors*, never as stored fields. Keeping a second copy is
// how it drifts, and the drift is not subtle: the command palette once read the raw transport, so
// for the length of every blend its Play command paused and its Pause command did nothing.
//
// Nothing here is a per-frame value. Playback position, the lyric clock and the analyser bands are
// MotionValues in ./motionSignals and must stay there. `currentLineIndex` is the fastest field in
// this store and it only moves when the lyric line changes, guarded by a ref at the call site.

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

type PlaybackStoreState = {
    // ---- raw ----
    currentSong: SongResult | null;
    audioSrc: string | null;
    lyrics: LyricData | null;
    activeLocalLyricsSource: ActiveLocalLyricsSource | null;
    cachedCoverUrl: string | null;
    duration: number;
    playerState: PlayerState;
    currentLineIndex: number;
    playQueue: SongResult[];
    activePlaybackContext: PlaybackContext;
    isFmMode: boolean;
    replayGainMode: ReplayGainMode;
    lyricTimelineOffsetMs: number;
    /**
     * The picture frozen on the outgoing track for the length of a blend.
     *
     * Written synchronously from the session's own block, not from an effect: the session calls
     * `advanceTrack` a few lines later, and an effect-scheduled snapshot would race that advance and
     * capture whichever of the two React had committed. A store write has the ref's timing.
     */
    transitionDisplay: TransitionDisplay | null;

    setCurrentSong: SetState<SongResult | null>;
    setAudioSrc: SetState<string | null>;
    setLyricsState: SetState<LyricData | null>;
    setActiveLocalLyricsSource: SetState<ActiveLocalLyricsSource | null>;
    setCachedCoverUrl: SetState<string | null>;
    setDuration: SetState<number>;
    setPlayerState: SetState<PlayerState>;
    setCurrentLineIndex: SetState<number>;
    setPlayQueue: SetState<SongResult[]>;
    setActivePlaybackContext: SetState<PlaybackContext>;
    setIsFmMode: SetState<boolean>;
    setReplayGainMode: SetState<ReplayGainMode>;
    setLyricTimelineOffsetMs: SetState<number>;
    setTransitionDisplay: SetState<TransitionDisplay | null>;
};

const resolve = <T,>(next: React.SetStateAction<T>, previous: T): T => (
    typeof next === 'function' ? (next as (prev: T) => T)(previous) : next
);

const readStoredReplayGainMode = (): ReplayGainMode => {
    if (typeof window === 'undefined') return 'off';
    const saved = localStorage.getItem('local_replaygain_mode');
    return saved === 'track' || saved === 'album' ? saved : 'off';
};

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
    currentSong: null,
    audioSrc: null,
    lyrics: null,
    activeLocalLyricsSource: null,
    cachedCoverUrl: null,
    duration: 0,
    playerState: PlayerState.IDLE,
    currentLineIndex: -1,
    playQueue: [],
    activePlaybackContext: 'main',
    isFmMode: false,
    replayGainMode: readStoredReplayGainMode(),
    lyricTimelineOffsetMs: 0,
    transitionDisplay: null,

    setCurrentSong: (next) => set({ currentSong: resolve(next, get().currentSong) }),
    setAudioSrc: (next) => set({ audioSrc: resolve(next, get().audioSrc) }),
    // Extension layers (Folium `lyrics.transform`) see every new lyrics object once.
    setLyricsState: (next) => set({ lyrics: applyLyricsTransform(resolve(next, get().lyrics)) }),
    setActiveLocalLyricsSource: (next) => set({ activeLocalLyricsSource: resolve(next, get().activeLocalLyricsSource) }),
    setCachedCoverUrl: (next) => set({ cachedCoverUrl: resolve(next, get().cachedCoverUrl) }),
    setDuration: (next) => set({ duration: resolve(next, get().duration) }),
    setPlayerState: (next) => set({ playerState: resolve(next, get().playerState) }),
    setCurrentLineIndex: (next) => set({ currentLineIndex: resolve(next, get().currentLineIndex) }),
    setPlayQueue: (next) => set({ playQueue: resolve(next, get().playQueue) }),
    setActivePlaybackContext: (next) => set({ activePlaybackContext: resolve(next, get().activePlaybackContext) }),
    setIsFmMode: (next) => set({ isFmMode: resolve(next, get().isFmMode) }),
    setReplayGainMode: (next) => set({ replayGainMode: resolve(next, get().replayGainMode) }),
    setLyricTimelineOffsetMs: (next) => set({ lyricTimelineOffsetMs: resolve(next, get().lyricTimelineOffsetMs) }),
    setTransitionDisplay: (next) => set({ transitionDisplay: resolve(next, get().transitionDisplay) }),
}));

// ---- module-level setters ----
//
// The controller hooks used to be handed these as parameters (59 of them across nine hooks). Their
// identity is stable, so importing one costs nothing and it never has to enter a dependency array.
// Writes are synchronous, which the automix freeze depends on.

export const setCurrentSong: SetState<SongResult | null> = (next) => usePlaybackStore.getState().setCurrentSong(next);
export const setAudioSrc: SetState<string | null> = (next) => usePlaybackStore.getState().setAudioSrc(next);
export const setLyricsState: SetState<LyricData | null> = (next) => usePlaybackStore.getState().setLyricsState(next);
export const setActiveLocalLyricsSource: SetState<ActiveLocalLyricsSource | null> = (next) => usePlaybackStore.getState().setActiveLocalLyricsSource(next);
export const setCachedCoverUrl: SetState<string | null> = (next) => usePlaybackStore.getState().setCachedCoverUrl(next);
export const setDuration: SetState<number> = (next) => usePlaybackStore.getState().setDuration(next);
export const setPlayerState: SetState<PlayerState> = (next) => usePlaybackStore.getState().setPlayerState(next);
export const setCurrentLineIndex: SetState<number> = (next) => usePlaybackStore.getState().setCurrentLineIndex(next);
export const setPlayQueue: SetState<SongResult[]> = (next) => usePlaybackStore.getState().setPlayQueue(next);
export const setActivePlaybackContext: SetState<PlaybackContext> = (next) => usePlaybackStore.getState().setActivePlaybackContext(next);
export const setIsFmMode: SetState<boolean> = (next) => usePlaybackStore.getState().setIsFmMode(next);
export const setReplayGainMode: SetState<ReplayGainMode> = (next) => usePlaybackStore.getState().setReplayGainMode(next);
export const setLyricTimelineOffsetMs: SetState<number> = (next) => usePlaybackStore.getState().setLyricTimelineOffsetMs(next);
export const setTransitionDisplay: SetState<TransitionDisplay | null> = (next) => usePlaybackStore.getState().setTransitionDisplay(next);

// ---- derived: the cover, and the display layer ----

export const selectCoverUrl = (state: PlaybackStoreState) => (
    createCoverUrlResolver(state.cachedCoverUrl, state.currentSong)()
);

/** True while the outgoing deck still owns the picture. */
export const selectIsShowingTail = (state: PlaybackStoreState) => state.transitionDisplay !== null;

export const selectDisplaySong = (state: PlaybackStoreState) => (
    state.transitionDisplay?.song ?? state.currentSong
);

export const selectDisplayLyrics = (state: PlaybackStoreState) => (
    state.transitionDisplay ? state.transitionDisplay.lyrics : state.lyrics
);

export const selectDisplayCoverUrl = (state: PlaybackStoreState) => (
    state.transitionDisplay ? state.transitionDisplay.coverUrl : selectCoverUrl(state)
);

export const selectDisplayDuration = (state: PlaybackStoreState) => (
    state.transitionDisplay ? state.transitionDisplay.duration : state.duration
);

/**
 * The transport the picture belongs to, which is not idle just because the next track is.
 *
 * `playSong` resets the raw state to IDLE for the track it is loading. That is correct for the
 * arriving track and wrong for what is still being heard, so anything user-facing — the controls,
 * the remote, the taskbar, the command palette — must read this rather than `playerState`.
 */
export const selectDisplayPlayerState = (state: PlaybackStoreState) => (
    selectIsShowingTail(state) && state.playerState === PlayerState.IDLE
        ? PlayerState.PLAYING
        : state.playerState
);
