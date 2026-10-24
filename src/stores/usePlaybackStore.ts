import { create } from 'zustand';
import type React from 'react';
import { PlayerState, type ActiveLocalLyricsSource, type LyricData, type PlaybackContext, type ReplayGainMode, type SongResult } from '../types';
import { createCoverUrlResolver } from '../components/app/playback/createCoverUrlResolver';
import type { AutomixTransitionEnd } from '../services/automix/automixSession';

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
    /**
     * The state is IDLE because a song is loading to play, not because anything stopped.
     *
     * Set with the IDLE each play route writes when it hands the player a new song to start, and
     * ended by any later write of the state (the song starting, a pause, a stop) or by the song's
     * source failing. The display layer shows it as playing; the raw state stays IDLE for the code
     * that has to know the new song has not started yet.
     */
    isLoadingToPlay: boolean;
    currentLineIndex: number;
    /**
     * The incoming track's lyric line while a blend holds the picture; -1 from the blend's start until
     * the line is known, and the last line after it, until the next blend. Guarded like currentLineIndex.
     */
    handoffLineIndex: number;
    playQueue: SongResult[];
    activePlaybackContext: PlaybackContext;
    isFmMode: boolean;
    replayGainMode: ReplayGainMode;
    /** The gain the playing song is played at, in dB, whatever the mode took it from. */
    replayGainAppliedDb: number;
    /** True while 智能平衡 plays the song on a stand-in reading, until the song is read whole. */
    replayGainEstimated: boolean;
    lyricTimelineOffsetMs: number;
    /**
     * The picture frozen on the outgoing track for the length of a blend.
     *
     * Written synchronously from the session's own block, not from an effect: the session calls
     * `advanceTrack` a few lines later, and an effect-scheduled snapshot would race that advance and
     * capture whichever of the two React had committed. A store write has the ref's timing.
     */
    transitionDisplay: TransitionDisplay | null;
    /**
     * How the last blend let go of the picture, written in the same update that clears
     * `transitionDisplay`. Only meaningful at that change: it is left as it was until the next blend ends.
     */
    transitionEnd: AutomixTransitionEnd | null;

    setCurrentSong: SetState<SongResult | null>;
    setAudioSrc: SetState<string | null>;
    setLyricsState: SetState<LyricData | null>;
    setActiveLocalLyricsSource: SetState<ActiveLocalLyricsSource | null>;
    setCachedCoverUrl: SetState<string | null>;
    setDuration: SetState<number>;
    setPlayerState: SetState<PlayerState>;
    startLoadingToPlay: () => void;
    endLoadingToPlay: () => void;
    setCurrentLineIndex: SetState<number>;
    setHandoffLineIndex: SetState<number>;
    setPlayQueue: SetState<SongResult[]>;
    setActivePlaybackContext: SetState<PlaybackContext>;
    setIsFmMode: SetState<boolean>;
    setReplayGainMode: SetState<ReplayGainMode>;
    setReplayGainAppliedDb: SetState<number>;
    setReplayGainEstimated: SetState<boolean>;
    setLyricTimelineOffsetMs: SetState<number>;
    setTransitionDisplay: SetState<TransitionDisplay | null>;
    /** Lets go of the frozen picture, saying how the blend ended - one update, so a subscriber sees both. */
    releaseTransitionDisplay: (end: AutomixTransitionEnd) => void;
    /** Puts a whole new queue in and sets Personal FM in the same update, so a subscriber sees both at once. */
    replacePlayQueue: (queue: SongResult[], isFmMode: boolean) => void;
};

const resolve = <T,>(next: React.SetStateAction<T>, previous: T): T => (
    typeof next === 'function' ? (next as (prev: T) => T)(previous) : next
);

const readStoredReplayGainMode = (): ReplayGainMode => {
    if (typeof window === 'undefined') return 'off';
    const saved = localStorage.getItem('local_replaygain_mode');
    return saved === 'track' || saved === 'album' || saved === 'auto' ? saved : 'off';
};

export const usePlaybackStore = create<PlaybackStoreState>((set, get) => ({
    currentSong: null,
    audioSrc: null,
    lyrics: null,
    activeLocalLyricsSource: null,
    cachedCoverUrl: null,
    duration: 0,
    playerState: PlayerState.IDLE,
    isLoadingToPlay: false,
    currentLineIndex: -1,
    handoffLineIndex: -1,
    playQueue: [],
    activePlaybackContext: 'main',
    isFmMode: false,
    replayGainMode: readStoredReplayGainMode(),
    replayGainAppliedDb: 0,
    replayGainEstimated: false,
    lyricTimelineOffsetMs: 0,
    transitionDisplay: null,
    transitionEnd: null,

    setCurrentSong: (next) => set({ currentSong: resolve(next, get().currentSong) }),
    setAudioSrc: (next) => set({ audioSrc: resolve(next, get().audioSrc) }),
    // Plain setter: the extension transform (Folium `lyrics.transform`) runs in the lyrics
    // pipeline (createLyricsSetter), so functional updates here never re-transform.
    setLyricsState: (next) => set({ lyrics: resolve(next, get().lyrics) }),
    setActiveLocalLyricsSource: (next) => set({ activeLocalLyricsSource: resolve(next, get().activeLocalLyricsSource) }),
    setCachedCoverUrl: (next) => set({ cachedCoverUrl: resolve(next, get().cachedCoverUrl) }),
    setDuration: (next) => set({ duration: resolve(next, get().duration) }),
    setPlayerState: (next) => set({ playerState: resolve(next, get().playerState), isLoadingToPlay: false }),
    startLoadingToPlay: () => set({ playerState: PlayerState.IDLE, isLoadingToPlay: true }),
    endLoadingToPlay: () => set({ isLoadingToPlay: false }),
    setCurrentLineIndex: (next) => set({ currentLineIndex: resolve(next, get().currentLineIndex) }),
    setHandoffLineIndex: (next) => set({ handoffLineIndex: resolve(next, get().handoffLineIndex) }),
    setPlayQueue: (next) => set({ playQueue: resolve(next, get().playQueue) }),
    setActivePlaybackContext: (next) => set({ activePlaybackContext: resolve(next, get().activePlaybackContext) }),
    setIsFmMode: (next) => set({ isFmMode: resolve(next, get().isFmMode) }),
    setReplayGainMode: (next) => set({ replayGainMode: resolve(next, get().replayGainMode) }),
    setReplayGainAppliedDb: (next) => set({ replayGainAppliedDb: resolve(next, get().replayGainAppliedDb) }),
    setReplayGainEstimated: (next) => set({ replayGainEstimated: resolve(next, get().replayGainEstimated) }),
    setLyricTimelineOffsetMs: (next) => set({ lyricTimelineOffsetMs: resolve(next, get().lyricTimelineOffsetMs) }),
    setTransitionDisplay: (next) => set({ transitionDisplay: resolve(next, get().transitionDisplay) }),
    releaseTransitionDisplay: (end) => set({ transitionDisplay: null, transitionEnd: end }),
    replacePlayQueue: (queue, isFmMode) => set({ playQueue: queue, isFmMode }),
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
export const startLoadingToPlay = () => usePlaybackStore.getState().startLoadingToPlay();
export const endLoadingToPlay = () => usePlaybackStore.getState().endLoadingToPlay();
export const setCurrentLineIndex: SetState<number> = (next) => usePlaybackStore.getState().setCurrentLineIndex(next);
export const setHandoffLineIndex: SetState<number> = (next) => usePlaybackStore.getState().setHandoffLineIndex(next);
export const setPlayQueue: SetState<SongResult[]> = (next) => usePlaybackStore.getState().setPlayQueue(next);
export const setActivePlaybackContext: SetState<PlaybackContext> = (next) => usePlaybackStore.getState().setActivePlaybackContext(next);
export const setIsFmMode: SetState<boolean> = (next) => usePlaybackStore.getState().setIsFmMode(next);
export const setReplayGainMode: SetState<ReplayGainMode> = (next) => usePlaybackStore.getState().setReplayGainMode(next);
export const setReplayGainAppliedDb: SetState<number> = (next) => usePlaybackStore.getState().setReplayGainAppliedDb(next);
export const setReplayGainEstimated: SetState<boolean> = (next) => usePlaybackStore.getState().setReplayGainEstimated(next);
export const setLyricTimelineOffsetMs: SetState<number> = (next) => usePlaybackStore.getState().setLyricTimelineOffsetMs(next);
export const setTransitionDisplay: SetState<TransitionDisplay | null> = (next) => usePlaybackStore.getState().setTransitionDisplay(next);
export const replacePlayQueue = (queue: SongResult[], isFmMode: boolean) => usePlaybackStore.getState().replacePlayQueue(queue, isFmMode);

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
 *
 * Nor is it idle while that track loads to play on: every ordinary song change passes through
 * IDLE for as long as the next song takes to start, and read raw that showed as a pause on every
 * change - the play button, the system media controls, the visualizer.
 */
export const selectDisplayPlayerState = (state: PlaybackStoreState) => (
    state.playerState === PlayerState.IDLE && (selectIsShowingTail(state) || state.isLoadingToPlay)
        ? PlayerState.PLAYING
        : state.playerState
);
