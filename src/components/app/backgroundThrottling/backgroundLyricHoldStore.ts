import { create } from 'zustand';
import { lyricCurrentTime } from '../../../stores/motionSignals';

// src/components/app/backgroundThrottling/backgroundLyricHoldStore.ts
// Whether the lyric animation is held: 后台节流 is in force and the window is minimised or hidden,
// or the performance check is measuring the GPU from its own window (components/perfCheck/). The
// playback bridge reads it every frame and stops moving the lyric clock and the audio bands; the
// visualizer model reads it to draw as if playback were paused.

type BackgroundLyricHoldState = {
    held: boolean;
    /** The two reasons to hold, kept apart so neither lets go of the other's hold. */
    background: boolean;
    perfCheck: boolean;
};

export const useBackgroundLyricHoldStore = create<BackgroundLyricHoldState>(() => ({
    held: false,
    background: false,
    perfCheck: false,
}));

/** Sets one reason to hold; `held` is either. */
export const setLyricHoldReason = (reason: 'background' | 'perfCheck', on: boolean) => {
    const state = useBackgroundLyricHoldStore.getState();
    if (state[reason] === on) return;
    const next = { ...state, [reason]: on };
    useBackgroundLyricHoldStore.setState({ [reason]: on, held: next.background || next.perfCheck });
};

/** For the frame loop, which must not subscribe through React. */
export const isBackgroundLyricHeld = () => useBackgroundLyricHoldStore.getState().held;

// While held, lyricCurrentTime stands still and the bridge keeps what it would read here, so turning
// a lyric time into a playback position (a mod's global shortcut that seeks to a line, say) stays right.
let heldLyricTimeSec: number | null = null;

/** The bridge, every pass: what the lyric clock reads while held, or null. */
export const setHeldLyricTime = (seconds: number | null) => {
    heldLyricTimeSec = seconds;
};

/** The lyric clock as playback stands now: lyricCurrentTime, or while held what it would read. */
export const readLiveLyricTime = () => heldLyricTimeSec ?? lyricCurrentTime.get();
