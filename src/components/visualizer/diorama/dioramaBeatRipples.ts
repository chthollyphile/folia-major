import { DIORAMA_PARTICLE_AUDIO_SCALE_MAX } from './cameraPath';

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
//
// The clock is read as counts of fired beats (beatFxLive's `getBeatFxFiredCounts`), not as the
// envelopes crossing a threshold: one beat is exactly one ripple whatever the frame rate, and a seek -
// where the clock resyncs without firing - spawns nothing.

/** Ripple strength a beat hands spawnRipple at strength 1, where a band onset hands its transient. */
export const DIORAMA_BEAT_RIPPLE_STRENGTH = 0.9;
export const DIORAMA_DOWNBEAT_RIPPLE_STRENGTH = 1;

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
 * The whole-body breath from the beat envelopes, in place of the band transients' `clusterPulse`: the
 * same small scale (see resolveDioramaParticleAudioResponse), a little on every beat and more on the
 * downbeat. The envelopes are 0..2 once scaled by the strengths; the cap keeps the spring in range.
 */
export const resolveDioramaBeatClusterPulse = (beat: number, downbeat: number): number => Math.min(
    DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
    1 + Math.max(0, beat) * 0.08 + Math.max(0, downbeat) * 0.1,
);
