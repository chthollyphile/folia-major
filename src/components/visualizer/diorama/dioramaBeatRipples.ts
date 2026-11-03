import { DIORAMA_PARTICLE_AUDIO_SCALE_MAX } from './cameraPath';
import { resolveBeatFxAccentGain, type BeatFxEvent } from '../../../services/beatFx/clock';

// src/components/visualizer/diorama/dioramaBeatRipples.ts
// Diorama's share of 智能动感模式: once the playing track's beats are in (beatFxLive's
// `isBeatFxReady`), beat_this' beats take over from the bass and mid band onsets as what spawns the
// particle ripples, and the beat envelopes drive the whole-body breath. Treble stays on its band
// onset - hi-hats are not beats - and the band trackers keep stepping underneath, so a track that has
// no beats falls back onto trackers that are already settled on it.
//
//   every beat      -> one mid-scale ripple   (RIPPLE_BANDS[1]), strength x 轻拍
//   every downbeat  -> one bass-scale ripple  (RIPPLE_BANDS[0]), strength x 重拍, instead of the mid one
//   breath          <- beat and downbeat envelopes (already scaled by the clock)
//   lyric hop       <- the same envelopes: the word being sung jumps up on each beat, higher on
//                      the downbeat, and falls back as they decay (resolveDioramaLyricHop)
//
// The clock is read as counts of fired beats (beatFxLive's `getBeatFxFiredCounts`), not as the
// envelopes crossing a threshold: one beat is exactly one ripple whatever the frame rate, and a seek -
// where the clock resyncs without firing - spawns nothing.
//
// With accents (analysis/beatAccents.ts) a ripple is as strong as its beat hits
// (`resolveBeatFxAccentGain`), and a plain beat whose hit is mostly low takes the bass scale too.
// Without them both are what they were: full strength, mid scale.

/**
 * Ripple strength a beat hands spawnRipple at strength 1, where a band onset hands its transient
 * (~0.3..1). Well past it on purpose: 智能动感模式 is the exaggerated reading, and at 0.9 / 1 the
 * beat ripples moved the particles no more than the band onsets they replace (镜台 read as too
 * restrained). Only the beat path uses these, so with the mode off nothing changes.
 */
export const DIORAMA_BEAT_RIPPLE_STRENGTH = 1.6;
export const DIORAMA_DOWNBEAT_RIPPLE_STRENGTH = 2.2;

export interface DioramaBeatCounter {
    beats: number;
    downbeats: number;
    /** False until the first step, which only takes the clock's counts and fires nothing. */
    synced: boolean;
}

export const createDioramaBeatCounter = (): DioramaBeatCounter => ({ beats: 0, downbeats: 0, synced: false });

export interface DioramaBeatTriggers {
    /** At least one beat that was not a downbeat fired since the last step. */
    beat: boolean;
    /** At least one downbeat fired since the last step. */
    downbeat: boolean;
}

/**
 * What fired since the last step, from the clock's ever-growing counts. Several beats in one step (a
 * long frame) still spawn one ripple of each kind: the pool has three slots a band, and a burst would
 * evict the ripples still on screen.
 */
export const stepDioramaBeatCounter = (
    counter: DioramaBeatCounter,
    fired: Readonly<{ beats: number; downbeats: number }>,
): DioramaBeatTriggers => {
    const newBeats = counter.synced ? fired.beats - counter.beats : 0;
    const newDownbeats = counter.synced ? fired.downbeats - counter.downbeats : 0;
    counter.beats = fired.beats;
    counter.downbeats = fired.downbeats;
    counter.synced = true;
    // The clock counts a downbeat as a beat too; it is the downbeat's ripple that it spawns.
    return { beat: newBeats - newDownbeats > 0, downbeat: newDownbeats > 0 };
};

/**
 * The whole-body breath from the beat envelopes, in place of the band transients' `clusterPulse`: a
 * clear swell on every beat and a bigger one on the downbeat (+20% / +28% at strength 1; it was +8% /
 * +10%, about what the band transients give, and read as restrained). The envelopes are 0..2 once
 * scaled by the strengths; the cap keeps the spring in range and the clouds clear of the camera.
 */
export const resolveDioramaBeatClusterPulse = (beat: number, downbeat: number): number => Math.min(
    DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
    1 + Math.max(0, beat) * 0.2 + Math.max(0, downbeat) * 0.28,
);

/** A plain beat whose low band carries more than this share of its hit spawns a bass-scale ripple. */
export const DIORAMA_LOW_BEAT_SHARE = 0.5;

export interface DioramaBeatRipple {
    /** RIPPLE_BANDS index: 0 bass scale, 1 mid scale. */
    index: number;
    strength: number;
}

/**
 * The ripple one fired beat spawns: its scale, and its strength from the slider (`intensity`) and the
 * beat's accent. `event` is the beat that fired, null or without accents for the plain mapping.
 */
export const resolveDioramaBeatRipple = (
    kind: 'beat' | 'downbeat',
    event: Pick<BeatFxEvent, 'impact' | 'tone' | 'rhythmic'> | null,
    trackScale: number,
    intensity: number,
): DioramaBeatRipple => {
    const gain = resolveBeatFxAccentGain(event, trackScale);
    if (kind === 'downbeat') return { index: 0, strength: DIORAMA_DOWNBEAT_RIPPLE_STRENGTH * intensity * gain };
    const low = event?.tone && event.tone.low > DIORAMA_LOW_BEAT_SHARE;
    return { index: low ? 0 : 1, strength: DIORAMA_BEAT_RIPPLE_STRENGTH * intensity * gain };
};

/**
 * How far the word being sung jumps up, in line heights, from the beat envelopes (0..2 once scaled
 * by the strengths, so 1 at strength 1): a quarter of a line on a beat, two fifths on a downbeat,
 * falling back as the envelopes decay. Capped so a doubled strength stays a hop, not a leap off the
 * frame.
 */
export const DIORAMA_LYRIC_HOP_BEAT = 0.25;
export const DIORAMA_LYRIC_HOP_DOWNBEAT = 0.4;
const DIORAMA_LYRIC_HOP_MAX = 0.8;

export const resolveDioramaLyricHop = (beat: number, downbeat: number): number => Math.min(
    DIORAMA_LYRIC_HOP_MAX,
    Math.max(0, beat) * DIORAMA_LYRIC_HOP_BEAT + Math.max(0, downbeat) * DIORAMA_LYRIC_HOP_DOWNBEAT,
);
