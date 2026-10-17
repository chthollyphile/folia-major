import type { PendoloMotionProfile } from './pendoloMotionProfile';

// src/components/visualizer/pendolo/pendoloClockworkMotion.ts
// Balance-wheel phase + seconds-gear spring simulation for Pendolo clockwork.
//
// 智能动感模式 (`beat` below, see pendoloBeatFx.ts): once the playing track's beats are in, the two
// gears side by side under the wheel - the transmission gear and the seconds gear - turn against each
// other on the beats: one tooth each per beat, a whole turn each per downbeat, on a springy escapement
// that overshoots a little and settles (the jolt). The seconds gear stops counting seconds; the transmission
// gear adds this to its usual turn with the wheel (`transBeatAngle`). The balance wheel swings to the
// other side on every beat instead of running with the bass. The phase keeps running either way: the
// decor gear turns with it. Only beats in bars with rhythm (beat_this + HPSS, beatAccents.ts) count.
// Without `beat` every output is the one it was before.

export interface PendoloClockworkMotionState {
    phase: number;
    smoothedBass: number;
    secondGearElapsed: number;
    secondGearStep: number;
    secondGearAngle: number;
    secondGearVelocity: number;
    /** Metronome swing (智能动感模式): which side the balance swings to, how far, where it is. */
    balanceDirection: number;
    balanceAmplitude: number;
    balanceAngle: number;
    balanceVelocity: number;
    /** The transmission gear's beat turn (智能动感模式): target, angle and spring velocity, rad. */
    transBeatTarget: number;
    transBeatAngle: number;
    transBeatVelocity: number;
}

/** What the beat clock fired since the last step (rhythmic beats only); gains are the strengths. */
export interface PendoloClockworkBeatInput {
    beats: number;
    downbeats: number;
    beatGain: number;
    downbeatGain: number;
}

export interface PendoloClockworkMotionStepResult {
    bass: number;
    bassOscillation: number;
    secondGearAngle: number;
    /** Added to the transmission gear's turn; exactly 0 without beats. */
    transBeatAngle: number;
    phase: number;
}

/** Creates the mutable simulation state carried across RAF frames. */
export const createPendoloClockworkMotionState = (): PendoloClockworkMotionState => ({
    phase: 0,
    smoothedBass: 0.15,
    secondGearElapsed: 0,
    secondGearStep: 0,
    secondGearAngle: 0,
    secondGearVelocity: 0,
    balanceDirection: 1,
    balanceAmplitude: 0,
    balanceAngle: 0,
    balanceVelocity: 0,
    transBeatTarget: 0,
    transBeatAngle: 0,
    transBeatVelocity: 0,
});

/** Teeth of the transmission and seconds gears (pendoloClockworkMeshes.ts): one step is one tooth. */
const TRANS_TEETH = 24;
const SECOND_TEETH = 15;
/**
 * The beat escapement: stiff and a little underdamped (damping ratio ~0.6), so a step lands in ~0.1 s
 * and overshoots by under a tenth before it settles - a light jolt (the user found ~0.43, a fifth's
 * overshoot, too strong). A whole turn takes ~0.3 s.
 */
const BEAT_GEAR_STIFFNESS = 260;
const BEAT_GEAR_DAMPING = 19;
/** Metronome swing: amplitude at gain 0 and the share the gain adds, before the profile multiplier. */
const SWING_BASE = 0.25;
const SWING_GAIN = 0.6;
const SWING_STIFFNESS = 140;
const SWING_DAMPING = 9;

/** Normalizes analyser bass values that may arrive as 0..1 or 0..255. */
export const normalizePendoloBass = (value: number): number => {
    const norm = value > 1 ? value / 255 : value;
    return Math.max(0, Math.min(1, norm));
};

/**
 * Advances balance-wheel phase and seconds-gear spring toward the next tooth.
 * When paused, only returns derived oscillation from the frozen phase.
 */
export const stepPendoloClockworkMotion = (
    state: PendoloClockworkMotionState,
    dt: number,
    rawBass: number,
    paused: boolean,
    profile: PendoloMotionProfile,
    beat?: PendoloClockworkBeatInput | null,
): PendoloClockworkMotionStepResult => {
    // Fetch real-time audio bass value directly from MotionValue (handling 0..255 byte scale)
    const clampedBass = normalizePendoloBass(rawBass);
    state.smoothedBass += (clampedBass - state.smoothedBass)
        * Math.min(0.24, 0.12 * profile.bassResponseMultiplier);
    const bass = state.smoothedBass;

    // 1. Balance wheel phase accumulation & harmonic swing (Audio Bass regulator)
    if (!paused) {
        state.phase += dt
            * (2.8 + bass * 3.5 * profile.bassResponseMultiplier)
            * profile.balanceSpeedMultiplier;
        if (beat) {
            // Against each other: the transmission gear forward, the seconds gear back. A downbeat
            // is a beat too; it turns both a whole turn instead of a tooth. The per-second count
            // waits where it is.
            if (beat.downbeats > 0) {
                state.transBeatTarget += Math.PI * 2;
                state.secondGearStep -= SECOND_TEETH;
            } else if (beat.beats > 0) {
                state.transBeatTarget += (Math.PI * 2) / TRANS_TEETH;
                state.secondGearStep -= 1;
            }
            const secondTarget = state.secondGearStep * (Math.PI * 2 / SECOND_TEETH);
            const damping = Math.exp(-BEAT_GEAR_DAMPING * dt);
            state.secondGearVelocity += (secondTarget - state.secondGearAngle) * BEAT_GEAR_STIFFNESS * dt;
            state.secondGearVelocity *= damping;
            state.secondGearAngle += state.secondGearVelocity * dt;
            state.transBeatVelocity += (state.transBeatTarget - state.transBeatAngle) * BEAT_GEAR_STIFFNESS * dt;
            state.transBeatVelocity *= damping;
            state.transBeatAngle += state.transBeatVelocity * dt;
            if (beat.beats > 0 || beat.downbeats > 0) {
                state.balanceDirection = -state.balanceDirection;
                const gain = beat.downbeats > 0 ? beat.downbeatGain : beat.beatGain;
                state.balanceAmplitude = (SWING_BASE + SWING_GAIN * Math.min(1, gain)) * profile.balanceAmplitudeMultiplier;
            }
            const target = state.balanceDirection * state.balanceAmplitude;
            state.balanceVelocity += (target - state.balanceAngle) * SWING_STIFFNESS * dt;
            state.balanceVelocity *= Math.exp(-SWING_DAMPING * dt);
            state.balanceAngle += state.balanceVelocity * dt;
        } else {
            state.secondGearElapsed += dt;
            const completedSteps = Math.floor(state.secondGearElapsed);
            if (completedSteps > 0) {
                state.secondGearStep += completedSteps;
                state.secondGearElapsed -= completedSteps;
            }
            const secondGearTarget = state.secondGearStep * (Math.PI * 2 / 15);
            const displacement = secondGearTarget - state.secondGearAngle;
            state.secondGearVelocity += displacement * 92 * profile.escapementSpringMultiplier * dt;
            state.secondGearVelocity *= Math.exp(-13 * profile.escapementDampingMultiplier * dt);
            state.secondGearAngle += state.secondGearVelocity * dt;
        }
    }

    const bassOscillation = beat
        ? state.balanceAngle
        : Math.sin(state.phase)
            * (0.15 + bass * 0.70 * profile.bassResponseMultiplier)
            * profile.balanceAmplitudeMultiplier;

    return {
        bass,
        bassOscillation,
        secondGearAngle: state.secondGearAngle,
        transBeatAngle: beat ? state.transBeatAngle : 0,
        phase: state.phase,
    };
};
