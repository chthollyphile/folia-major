import { motionValue, type MotionValue } from 'framer-motion';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX } from '../utils/playerBottomBarLayout';

// src/stores/motionSignals.ts
// The app's per-frame signals, held as MotionValue instances rather than React state.
//
// These are the values that change every frame while a song plays: playback position, the lyric
// clock, and the analyser's band energies. They must never become reactive store state — writing
// `currentTime.get()` into a store would re-render the tree at frame rate. See
// skills/frontend-runtime-guardrails.
// 全局底部基线也在这里：拖动期间它是 pointer-move 频率的信号，不能进入 React/store state。
//
// What this module owns is only the *instances*. Their identity is stable for the process
// lifetime, so reading one here costs nothing and never triggers a render; consumers subscribe
// with useTransform / useMotionValueEvent, or read `.get()` inside their own RAF loop.
//
// Created at module scope rather than by a hook because App.tsx used to own them and hand them
// down: every consumer then had to be given the instance as a prop, and the instances had to sit
// in dependency arrays that could never actually change.

export type AudioBandSignals = {
    bass: MotionValue<number>;
    lowMid: MotionValue<number>;
    mid: MotionValue<number>;
    vocal: MotionValue<number>;
    treble: MotionValue<number>;
    spectrum: MotionValue<Uint8Array<ArrayBuffer>>;
};

/** Playback position of the deck the listener actually hears, in seconds. */
export const currentTime = motionValue(0);

/** The lyric clock. Separate from `currentTime`: it carries the per-song timeline offset. */
export const lyricCurrentTime = motionValue(0);

/**
 * The song hand-off of an automix/crossfade blend, as the main window's visualizer draws it: how far
 * it has come (0..1, transitionCue's getTransitionHandoffProgress), and the incoming track's lyric
 * clock. Written by the visualizer bridge while a blend holds the picture on the outgoing track.
 */
export const handoffProgress = motionValue(0);
export const handoffLyricCurrentTime = motionValue(0);

/** Overall analyser energy, 0..1. */
export const audioPower = motionValue(0);

export const bass = motionValue(0);
export const lowMid = motionValue(0);
export const mid = motionValue(0);
export const vocal = motionValue(0);
export const treble = motionValue(0);
export const spectrum = motionValue(new Uint8Array(0));

/**
 * Beat-synchronous impact envelopes, decaying after each beat / downbeat of the playing track:
 * 0..1, times 智能动感模式's 轻拍 / 重拍 strengths (0..2). Only driven while 智能动感模式 is on and
 * something on screen draws beat FX (see src/services/beatFx); they stay at 0 otherwise, so
 * consumers can read them unconditionally.
 */
export const beatImpact = motionValue(0);
export const downbeatImpact = motionValue(0);

/** The band set as one stable object, so it can be passed straight to a visualizer. */
export const audioBands: AudioBandSignals = { bass, lowMid, mid, vocal, treble, spectrum };

/** Global bottom baseline offset in px; positioning writes it at pointer-move frequency. */
export const playerBottomBarLiveOffset = motionValue(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);

/**
 * 思索提示胶囊跟随的光标位置，px。
 *
 * 悬停在可教学区域期间由 pointermove 写入，频率与指针事件同步。放在这里而不是
 * usePonderStore，理由和上面那条底部基线一样：它是每帧值，进 React state 就等于
 * 让整棵树按指针移动频率重渲染。store 那边只留「悬停的是哪个目标」这个离散事实。
 */
export const ponderPointerX = motionValue(0);
export const ponderPointerY = motionValue(0);
