// src/components/visualizer/diorama/cameraPath.ts
// Pure helpers for a procedural 3D lyric flythrough. The stack of ideas:
//
// 1. A WINDING PATH (buildDioramaPath): a "turtle" walks forward one step per lyric line while its
//    heading yaws/pitches by seeded oscillations, so the corridor banks and snakes (never doubling
//    back). Each line gets a local FRAME (forward/right/up) that text, camera and geometry compose in.
//
// 2. FREE TEXT PLACEMENT (getDioramaTextPlacement): a lyric line is NOT pinned to the path centerline -
//    it gets a seeded offset off the path, its own scale, an in-plane roll and a slight yaw, plus a
//    compositional look-offset so it can sit off-centre in frame. The camera aims at wherever the line
//    actually landed and the formation is grown around it, so everything still frames the words - but
//    the corridor reads as staged typography in space, not a teleprompter.
//
// 3. SHOT LANGUAGE (getDioramaShot / resolveShotOffset): each line is assigned one cinematic move
//    (10 kinds: push-in / pull-back / orbit / track / crane / hold / swell / spiral / pendulum /
//    flyby) chosen from the line's own character (chorus, length, section, note lengths), expressed as
//    a camera offset in the line's local frame. The CameraRig SmoothDamps between shots, so the
//    techniques stay varied but the transitions stay smooth. Audio does NOT drive the camera - the
//    move curves stay clean; audio expresses itself in the geometry/light instead.
//
// 4. PROCEDURAL FORMATIONS (buildFormation): each line grows a deliberate geometric set-piece matched
//    to its shot (ring for orbit, gate pillars for push-in, colonnade for track, arch for crane, helix
//    for spiral, ...). Formation pieces share one primitive family per line (architectural consistency,
//    not primitive soup), get vertical stretch for pillars/rods, are pushed apart when they overlap,
//    keep a lateral clearance belt around the text, and always sit at/behind the text plane so they can
//    never cover the words. Deterministic per line/seed, like a game seeding a level.
//
// 5. LIFECYCLE (resolveShapeLifeOpacity): shapes are born out of the distance haze (fade in as they
//    approach) and gracefully dissolve if the camera flies too close - so there is no pop-in at the
//    window edge and never a mesh smearing across the lens during a pass-through.
//
// Kept free of Three.js objects so the math stays unit-testable; the R3F components consume these each
// frame. All motion scales come from DioramaMotionParams (tuning + theme sub-modes).

import { DEFAULT_DIORAMA_TUNING, type DioramaTuning, type Line, type Theme } from '../../../types';

/** Distance advanced along the path per lyric line. */
export const DIORAMA_STEP_DISTANCE = 8;
/** Max heading yaw / pitch (radians) the path bends by. Bounded so the corridor snakes smoothly and
 * always keeps moving forward (never a switchback), which keeps passed lines receding behind you. */
export const DIORAMA_MAX_YAW = 0.5;
export const DIORAMA_MAX_PITCH = 0.32;
/** Distance the camera trails behind the read-head (its hero framing distance). Below the step distance
 * so a line is passed once its move completes rather than staying stacked in front. */
export const DIORAMA_HERO_DISTANCE = 5.2;
/** Base height the camera rides above the read-head (in the line's local up). */
export const DIORAMA_CAMERA_LIFT = 0.5;
/** Fraction of the visible frame the camera may use to truck after the sung word while still keeping a
 * short line fully in view. */
export const DIORAMA_SAFE_FRAME_FRACTION = 0.92;
/** Base amplitudes (world units) of the faint idle drift added ON TOP of the active shot as a hand-held
 * breath. Kept small - the distinct SHOT is the main motion. */
export const DIORAMA_SWAY_AMP = 0.4;
export const DIORAMA_LIFT_AMP = 0.4;
export const DIORAMA_DIST_AMP = 0.5;
/** If the camera falls this far behind its pose (a seek jumps the read-head many lines), snap instead
 * of flying across the whole song to catch up. */
export const DIORAMA_SNAP_DISTANCE = 24;
/** Per-line lyric text transform bounds (see getDioramaTextPlacement): lateral/vertical offset off the
 * path centerline, in-plane roll, slight yaw, and the off-centre compositional look offset. */
export const DIORAMA_TEXT_OFFSET_R = 1.8;
export const DIORAMA_TEXT_OFFSET_U = 1.2;
export const DIORAMA_TEXT_ROLL = 0.2;
export const DIORAMA_TEXT_YAW = 0.16;
export const DIORAMA_TEXT_LOOK = 1.1;
/** Shape lifecycle distances (world units from the camera): born out of the haze between FADE_IN_END ->
 * FADE_IN_START, and dissolved between DISSOLVE_START -> DISSOLVE_END as the camera closes in, so a
 * near pass never shows a mesh clipping through the lens. */
export const DIORAMA_SHAPE_FADE_IN_START = 20;
export const DIORAMA_SHAPE_FADE_IN_END = 27;
export const DIORAMA_SHAPE_DISSOLVE_START = 3.0;
export const DIORAMA_SHAPE_DISSOLVE_END = 1.2;

const DEG_TO_RAD = Math.PI / 180;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface DioramaVec {
    x: number;
    y: number;
    z: number;
}
/** Kept as an alias so existing "waypoint" call sites read naturally - it is just a 3D point. */
export type DioramaWaypoint = DioramaVec;

const vsub = (a: DioramaVec, b: DioramaVec): DioramaVec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vcross = (a: DioramaVec, b: DioramaVec): DioramaVec => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const vnorm = (a: DioramaVec): DioramaVec => {
    const len = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / len, y: a.y / len, z: a.z / len };
};
const vadd = (a: DioramaVec, b: DioramaVec): DioramaVec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

// Deterministic pseudo-random in [0, 1) so a line index always maps to the same value - seeking never
// re-randomizes the corridor, the shots or the formations.
export const seededUnit = (seed: number): number => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
};

export const hashSeed = (seed: string | number | undefined): number => {
    if (typeof seed === 'number') return seed;
    if (!seed) return 1;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
    }
    return hash || 1;
};

/**
 * Unity-style critically-damped SmoothDamp for one scalar. Unlike plain exponential lerp (which is
 * fastest the instant the target moves and only ever decelerates - "snap then coast"), this carries
 * velocity and eases both in and out, so a stepped target (the read-head jumping to the next line) is
 * followed as a smooth accelerate-then-settle move with no kink. The caller owns the per-axis velocity.
 */
export const smoothDamp = (
    current: number,
    target: number,
    velocity: number,
    smoothTime: number,
    deltaSeconds: number
): { value: number; velocity: number } => {
    const t = Math.max(0.0001, smoothTime);
    const omega = 2 / t;
    const x = omega * deltaSeconds;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = (velocity + omega * change) * deltaSeconds;
    const newVelocity = (velocity - omega * temp) * exp;
    const value = target + (change + temp) * exp;
    return { value, velocity: newVelocity };
};

/** World half-width visible at `distance` from a perspective camera (three.js `fov` is VERTICAL). */
export const frameHalfWidth = (distance: number, verticalFovDeg: number, aspect: number): number =>
    distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect;

// ─── Motion params: tuning + sub-modes -> one scale bundle ─────────────────────────────────────

export type DioramaSubMode = 'calm' | 'normal' | 'chaotic';

export interface DioramaMotionParams {
    /** Scales every shot's excursion (how far a move swings) and the read-head framing deviations. */
    moveScale: number;
    /** Absolute amplitude scalar for the faint idle drift. */
    driftScale: number;
    /** SmoothDamp time constant (seconds) for the camera follow - smaller is snappier. */
    smoothTime: number;
    /** Scales the GEOMETRY's audio reaction (glow/flow/surface pulse). Never applied to the camera. */
    audioLevel: number;
    /** Scales the per-line text placement variety (offsets/roll/yaw/look). */
    weaveScale: number;
    /** The theme's animation intensity resolved to a sub-mode: also biases WHICH cinematic shots get
     * chosen (calm -> gentle/composed, chaotic -> dynamic/varied), so the mode changes the character of
     * the move set, not just its speed and amplitude. */
    subMode: DioramaSubMode;
}

const DIORAMA_SUB_MODE_PRESETS = {
    normal: { move: 1, drift: 0.62, smooth: 0.42, audio: 1, weave: 1 },
    calm: { move: 0.6, drift: 0.4, smooth: 0.56, audio: 0.5, weave: 0.5 },
    chaotic: { move: 1.35, drift: 0.85, smooth: 0.33, audio: 1.35, weave: 1.35 },
} as const;

/**
 * Resolve tuning + theme into the motion scale bundle every diorama component consumes. The camera
 * STYLE always follows the theme's animationIntensity - the same single state the player panel's
 * intensity chip cycles and AI themes set - exactly like every other visualizer style. Sliders
 * (cameraSpeed / motionAmount / audioReactivity) multiply on top.
 */
export const resolveDioramaMotionParams = (
    tuning: DioramaTuning | undefined,
    themeIntensity?: Theme['animationIntensity']
): DioramaMotionParams => {
    const t = tuning ?? DEFAULT_DIORAMA_TUNING;
    const mode: DioramaSubMode = themeIntensity === 'calm' ? 'calm' : themeIntensity === 'chaotic' ? 'chaotic' : 'normal';
    const preset = DIORAMA_SUB_MODE_PRESETS[mode];
    const motion = clamp(t.motionAmount, 0.4, 1.6);
    const speed = clamp(t.cameraSpeed, 0.55, 1.85);
    const audio = clamp(t.audioReactivity, 0, 1.5);
    return {
        moveScale: preset.move * motion,
        driftScale: preset.drift * motion,
        smoothTime: preset.smooth / speed,
        audioLevel: preset.audio * audio,
        weaveScale: preset.weave * motion,
        subMode: mode,
    };
};

// ─── Winding path with per-line frames ─────────────────────────────────────────────────────────

export interface DioramaFrame {
    /** World position of the line's path anchor (text adds its placement offset on top). */
    position: DioramaVec;
    /** Unit travel direction (toward the next line). The camera trails along -forward; text faces it. */
    forward: DioramaVec;
    /** Unit right in the line's local frame (the text's reading direction). */
    right: DioramaVec;
    /** Unit up in the line's local frame. */
    up: DioramaVec;
}

const WORLD_UP: DioramaVec = { x: 0, y: 1, z: 0 };
const DEFAULT_FRAME: DioramaFrame = {
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
};

/**
 * Build the whole corridor once for a song: a turtle walks forward one step per line while its heading
 * yaws/pitches by bounded seeded oscillations. The heading's forward (-z) component stays negative, so
 * the path always advances. Each line then gets a local frame from the travel tangent (right = travel x
 * world-up so it matches the text's left-to-right reading direction; up completes the frame).
 */
export const buildDioramaPath = (count: number, seed?: string | number): DioramaFrame[] => {
    const base = hashSeed(seed);
    const n = Math.max(count, 1);

    // One extra position so the last real line still has a forward tangent (positions[i+1] - positions[i]).
    const positions: DioramaVec[] = [];
    let pos: DioramaVec = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= n; i += 1) {
        positions.push({ ...pos });
        const yaw =
            DIORAMA_MAX_YAW * (Math.sin(i * 0.23 + base * 0.017) * 0.62 + Math.sin(i * 0.11 + base * 0.041 + 1.3) * 0.38);
        const pitch = DIORAMA_MAX_PITCH * Math.sin(i * 0.17 + base * 0.029 + 0.7);
        const cp = Math.cos(pitch);
        const dir: DioramaVec = { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
        pos = {
            x: pos.x + dir.x * DIORAMA_STEP_DISTANCE,
            y: pos.y + dir.y * DIORAMA_STEP_DISTANCE,
            z: pos.z + dir.z * DIORAMA_STEP_DISTANCE,
        };
    }

    const frames: DioramaFrame[] = [];
    for (let i = 0; i < n; i += 1) {
        const forward = vnorm(vsub(positions[i + 1], positions[i]));
        // right = forward x worldUp gives +x for a -z forward, matching the text's reading direction.
        // (pitch is bounded well under 90deg, so forward is never parallel to worldUp - cross is stable.)
        const right = vnorm(vcross(forward, WORLD_UP));
        const up = vnorm(vcross(right, forward));
        frames.push({ position: positions[i], forward, right, up });
    }
    return frames;
};

/** Safe frame lookup - clamps to range and falls back to a straight frame if the path is empty. */
export const getFrame = (frames: DioramaFrame[], index: number): DioramaFrame => {
    if (frames.length === 0) return DEFAULT_FRAME;
    const i = Math.min(Math.max(index, 0), frames.length - 1);
    return frames[i] ?? DEFAULT_FRAME;
};

/**
 * Rigidly move a freshly-built corridor to a new world origin. Pure translation - only the anchor
 * positions shift; the per-line forward/right/up directions are unchanged - so the corridor keeps its
 * exact winding shape and upright bases, just placed elsewhere in the world. The diorama transition
 * spawns each new song's corridor at a deliberate OFFSET from the current one (see dioramaTransition.ts)
 * so the two scenes coexist in one space and the camera physically flies the gap between them.
 */
export const translateFrames = (frames: DioramaFrame[], offset: DioramaVec): DioramaFrame[] =>
    frames.map((f) => ({ position: vadd(f.position, offset), forward: f.forward, right: f.right, up: f.up }));

/** Compose a local (right, up, depth) offset in a frame into a world point. Positive depth is ahead
 * along the path, away from the trailing camera and behind the text. */
export const composeLocal = (frame: DioramaFrame, right: number, up: number, depth: number): DioramaVec => ({
    x: frame.position.x + frame.right.x * right + frame.up.x * up + frame.forward.x * depth,
    y: frame.position.y + frame.right.y * right + frame.up.y * up + frame.forward.y * depth,
    z: frame.position.z + frame.right.z * right + frame.up.z * up + frame.forward.z * depth,
});

/**
 * Lateral truck offset (along the frame's right) so the camera follows the sung word along a line. A
 * SMOOTH saturating curve (tanh), not a hard clamp: a short line that fits the frame saturates quickly
 * (only a gentle follow); a long line follows further to keep the sung word framed - with no derivative
 * kink at the limit (a hard clamp corner is what reads as jerky).
 */
export const resolveReadHeadTruck = (
    wordProgress: number,
    trackWidth: number,
    visibleHalfWidth: number
): number => {
    if (trackWidth <= 0) return 0;
    const wordOffset = (clamp01(wordProgress) - 0.5) * trackWidth;
    const allowed = Math.max(Math.abs(visibleHalfWidth - trackWidth / 2), 0.001);
    return allowed * Math.tanh(wordOffset / allowed);
};

// ─── Free per-line text placement ──────────────────────────────────────────────────────────────

export interface DioramaTextPlacement {
    /** Offset off the path centerline, in the frame's right/up (world units). */
    offsetR: number;
    offsetU: number;
    /** Per-line extra scale on top of the frame-fit scale (0.82..1.28). */
    scale: number;
    /** In-plane roll tilt (radians) - staged typography, not a level teleprompter. */
    roll: number;
    /** Slight yaw so some lines face the camera a touch obliquely (perspective feel). */
    yaw: number;
    /** Compositional look offset: the camera aims this far to the side of the text, so the line sits
     * off-centre in frame (rule of thirds) with the formation filling the rest. */
    lookR: number;
}

/**
 * Where and how a lyric line sits relative to its path frame. Low-frequency sines of the index keep
 * consecutive lines flowing (the weave reads as intentional layout) with a seeded per-line jitter on
 * top; scale/roll/yaw/look are per-line seeded. All variety scales with `weave` (sub-mode/slider) and
 * is deterministic per line/seed. weave=0 collapses to a centered, straight, uniform layout.
 */
export const getDioramaTextPlacement = (
    lineIndex: number,
    seed: string | number | undefined,
    weave = 1
): DioramaTextPlacement => {
    const base = hashSeed(seed);
    const i = Math.max(lineIndex, 0);
    const jitterR = (seededUnit(base + i * 11 + 2) - 0.5) * 0.6;
    const jitterU = (seededUnit(base + i * 11 + 4) - 0.5) * 0.6;
    const wanderR = Math.sin(i * 0.47 + base * 0.019) * 0.7 + jitterR;
    const wanderU = Math.sin(i * 0.29 + base * 0.027 + 0.9) * 0.7 + jitterU;
    return {
        offsetR: wanderR * DIORAMA_TEXT_OFFSET_R * weave,
        offsetU: wanderU * DIORAMA_TEXT_OFFSET_U * weave,
        scale: 0.82 + seededUnit(base + i * 11 + 5) * 0.46,
        roll: (seededUnit(base + i * 11 + 6) - 0.5) * 2 * DIORAMA_TEXT_ROLL * weave,
        yaw: (seededUnit(base + i * 11 + 7) - 0.5) * 2 * DIORAMA_TEXT_YAW * weave,
        lookR: (seededUnit(base + i * 11 + 8) - 0.5) * 2 * DIORAMA_TEXT_LOOK * weave,
    };
};

// ─── Shot language: distinct cinematic moves ("运镜手法") ──────────────────────────────────────

export type DioramaShotKind =
    | 'pushIn'
    | 'pullBack'
    | 'orbit'
    | 'track'
    | 'crane'
    | 'hold'
    | 'swell'
    | 'spiral'
    | 'pendulum'
    | 'flyby'
    | 'arc'
    | 'float'
    | 'glide';

const SHOT_KINDS: DioramaShotKind[] = [
    'pushIn', 'pullBack', 'orbit', 'track', 'crane', 'hold', 'swell', 'spiral', 'pendulum', 'flyby',
    'arc', 'float', 'glide',
];

// Smoothstep 0..1 - eases a shot's arc in and out so even linear progress reads as a hand-operated move
// (accelerate off the mark, settle onto it) rather than a constant-velocity mechanical slide.
const easeInOut = (p: number): number => {
    const c = clamp01(p);
    return c * c * (3 - 2 * c);
};

type ShotWeights = Record<DioramaShotKind, number>;

const CHORUS_PART = /chorus|hook|refrain|drop/i;

// The left/right handedness of a line's shot (which side an orbit swings, a flyby passes, ...). Shared
// by resolveShotOffset AND buildFormation so the set-piece is built on the side the camera will use.
const getShotDir = (lineIndex: number, seed: string | number | undefined): 1 | -1 =>
    seededUnit(hashSeed(seed) + lineIndex * 7 + 3) < 0.5 ? -1 : 1;

// Longest / average sung-note duration on a line, from its word timings. A long held note wants a grand
// slow move (swell/spiral); a run of short staccato notes wants a snappy track/flyby. Zeros when no
// per-word timing exists so note features stay neutral.
const getLineNoteProfile = (line: Line | undefined): { maxNote: number; avgNote: number; noteCount: number } => {
    let maxNote = 0;
    let sum = 0;
    let noteCount = 0;
    for (const word of line?.words ?? []) {
        const d = word.endTime - word.startTime;
        if (d > 0) {
            maxNote = Math.max(maxNote, d);
            sum += d;
            noteCount += 1;
        }
    }
    return { maxNote, avgNote: noteCount > 0 ? sum / noteCount : 0, noteCount };
};

// Weight each archetype by the line's character so the KIND of move suits the moment. Never lets a
// weight hit zero, so every shot stays reachable - variety over rigid rules.
const computeShotWeights = (lineIndex: number, lines: Line[], subMode: DioramaSubMode = 'normal'): ShotWeights => {
    const line = lines[lineIndex];
    const prev = lineIndex > 0 ? lines[lineIndex - 1] : undefined;
    const wordCount = line?.words?.length ?? 0;
    const isChorus = !!line?.isChorus || CHORUS_PART.test(line?.songPart ?? '');
    const sectionStart =
        !!line && !!prev && (line.blockIndex !== prev.blockIndex || (line.songPart ?? '') !== (prev.songPart ?? ''));
    const { maxNote, avgNote, noteCount } = getLineNoteProfile(line);
    const hasLongNote = maxNote >= 1.3;
    const staccato = noteCount >= 4 && avgNote > 0 && avgNote <= 0.34;

    // Flatter base than before (rare shots raised) so no handful of archetypes dominates - combined with
    // the last-two anti-repetition below, every move gets meaningful screen time.
    const w: ShotWeights = {
        pushIn: 1, pullBack: 1, orbit: 1, track: 1, crane: 1, hold: 1, swell: 0.85,
        spiral: 0.9, pendulum: 1, flyby: 0.9, arc: 1, float: 0.9, glide: 1,
    };
    if (isChorus) {
        w.orbit += 2.4;
        w.pushIn += 1.8;
        w.spiral += 1.2;
        w.crane += 0.8;
        w.flyby += 0.6;
        w.arc += 1.0;
        w.glide += 0.6;
        w.hold -= 0.6;
        w.track -= 0.2;
    } else {
        w.track += 1.1;
        w.crane += 0.9;
        w.hold += 0.9;
        w.pendulum += 0.8;
        w.float += 0.8;
        w.glide += 0.6;
        w.arc += 0.4;
    }
    if (wordCount >= 8) {
        w.track += 1.6;
        w.pullBack += 1;
        w.orbit -= 0.4;
        w.pushIn -= 0.3;
    } else if (wordCount <= 3) {
        w.pushIn += 1.4;
        w.orbit += 0.9;
        w.hold += 0.5;
        w.track -= 0.8;
    }
    if (sectionStart) {
        w.pullBack += 2.2;
        w.crane += 1.4;
        w.glide += 1.0;
        w.pushIn -= 0.4;
    }
    if (hasLongNote) {
        w.swell += 2.4;
        w.spiral += 1.0;
        w.float += 1.2;
        w.pendulum += 0.6;
        w.orbit += 0.8;
        w.arc += 0.6;
        w.hold += 0.3;
        w.track -= 0.5;
    }
    if (staccato) {
        w.track += 1.4;
        w.flyby += 1.5;
        w.pushIn += 0.8;
        w.swell -= 1.6;
        w.hold -= 0.8;
        w.crane -= 0.4;
    }

    // Sub-mode character: calm favours composed, gentle, near-still moves and damps the big spatial
    // swings; chaotic favours dynamic, spatial, varied moves and suppresses stillness (its larger
    // amplitude/quicker follow come from the motion presets). Standard leaves the character untouched.
    if (subMode === 'calm') {
        w.hold += 1.4;
        w.float += 1.3;
        w.swell += 0.9;
        w.glide += 0.8;
        w.arc += 0.5;
        w.crane += 0.4;
        w.orbit *= 0.4;
        w.spiral *= 0.35;
        w.flyby *= 0.3;
        w.pendulum *= 0.5;
        w.pushIn *= 0.7;
    } else if (subMode === 'chaotic') {
        w.orbit += 1.3;
        w.spiral += 1.3;
        w.flyby += 1.2;
        w.pendulum += 1.0;
        w.pushIn += 0.8;
        w.arc += 0.6;
        w.crane += 0.4;
        w.hold *= 0.35;
        w.float *= 0.55;
        w.swell *= 0.7;
    }

    SHOT_KINDS.forEach((key) => {
        w[key] = Math.max(0.05, w[key]);
    });
    return w;
};

const weightedPickShot = (weights: ShotWeights, u: number): DioramaShotKind => {
    const total = SHOT_KINDS.reduce((sum, k) => sum + weights[k], 0);
    let acc = clamp01(u) * total;
    for (const k of SHOT_KINDS) {
        acc -= weights[k];
        if (acc <= 0) return k;
    }
    return 'hold';
};

const basePickShot = (
    lineIndex: number,
    lines: Line[],
    seed: string | number | undefined,
    subMode: DioramaSubMode = 'normal'
): DioramaShotKind => {
    if (!lines[lineIndex]) return 'hold';
    const u = seededUnit(hashSeed(seed) + lineIndex * 101 + 7);
    return weightedPickShot(computeShotWeights(lineIndex, lines, subMode), u);
};

// The shot archetype for a line: the weighted pick, but if it matches EITHER of the previous two lines'
// picks, bump to a different archetype - so the same few moves never cluster and the full vocabulary
// gets used. The dedupe only peeks at basePickShot(prev) - it never recurses into getDioramaShot - so it
// stays O(1). `subMode` (from the theme intensity) biases which archetypes the pick draws from.
export const getDioramaShot = (
    lineIndex: number,
    lines: Line[],
    seed?: string | number,
    subMode: DioramaSubMode = 'normal'
): DioramaShotKind => {
    const pick = basePickShot(lineIndex, lines, seed, subMode);
    const prev1 = lineIndex > 0 ? basePickShot(lineIndex - 1, lines, seed, subMode) : null;
    const prev2 = lineIndex > 1 ? basePickShot(lineIndex - 2, lines, seed, subMode) : null;
    if (pick === prev1 || pick === prev2) {
        const others = SHOT_KINDS.filter((k) => k !== pick && k !== prev1 && k !== prev2);
        const pool = others.length > 0 ? others : SHOT_KINDS.filter((k) => k !== pick);
        const alt = seededUnit(hashSeed(seed) + lineIndex * 53 + 19);
        return pool[Math.floor(clamp01(alt) * pool.length) % pool.length];
    }
    return pick;
};

export interface DioramaShotOffset {
    /** Camera offset along the frame's right / up (world scale). */
    right: number;
    up: number;
    /** How far the camera trails the read-head, along -forward (the hero framing distance, modulated). */
    back: number;
}

export interface DioramaShotContext {
    /** 0..1 time-progress through the line (0 at its start, 1 once fully sung / held in a gap). */
    progress: number;
    /** 0..1 sung-word reveal fraction - used by the tracking shot for its lateral lean. */
    wordProgress: number;
    hero: number;
    lift: number;
    seed?: string | number;
    lineIndex: number;
    /** Scales the move's excursion away from the neutral trailing pose (sub-modes / motion slider). */
    moveScale: number;
}

// Map a shot archetype + its progress to a camera offset in the line's LOCAL frame (right / up / back).
// The CameraRig composes it with the frame vectors, so a move like "orbit" swings through the path's
// actual local horizontal plane. The excursion away from the neutral trailing pose scales with
// moveScale, so sub-modes make the same shot language gentler or bolder without changing its grammar.
export const resolveShotOffset = (kind: DioramaShotKind, ctx: DioramaShotContext): DioramaShotOffset => {
    const { hero, lift, seed, lineIndex } = ctx;
    const e = easeInOut(ctx.progress);
    const dir = getShotDir(lineIndex, seed);

    let right = 0;
    let up = lift;
    let back = hero;

    switch (kind) {
        case 'pushIn':
            // Close the distance over the line so the text grows and fills the frame - intimacy / climax.
            back = hero * (1.5 - 0.8 * e);
            up = lift * (1.2 - 0.5 * e) + 0.15;
            break;
        case 'pullBack':
            // Retreat and rise, opening the surrounding formation into view - a reveal / section breath.
            back = hero * (0.85 + 1.15 * e);
            up = lift + 1.7 * e;
            break;
        case 'orbit': {
            // Arc around the line at a near-constant distance so the ring formation sweeps across behind
            // the centered text - the clearest "camera moving through a 3D world" move.
            const theta = dir * 0.55 * (2 * e - 1);
            right = hero * Math.sin(theta);
            back = hero * Math.cos(theta);
            up = lift + 0.4;
            break;
        }
        case 'track':
            // Slide with the sung word (the read-head already trucks with it) while leaning out to a
            // slight profile angle mid-line, so the colonnade streaks past - a dolly tracking shot.
            right = dir * hero * 0.34 * Math.sin(Math.PI * clamp01(ctx.wordProgress));
            back = hero * 1.06;
            up = lift + 0.12;
            break;
        case 'crane': {
            // Boom vertically past the line (low-angle look-up, or high look-down) under the arch, aim
            // held on the line so the framing tilts through the move.
            const from = dir > 0 ? -1.5 : 2.4;
            const to = dir > 0 ? 2.4 : -1.4;
            up = from + (to - from) * e;
            back = hero * 1.05;
            break;
        }
        case 'swell': {
            // A long sustained note: a slow grand glide that blooms over the whole note - a gentle arc
            // while craning up and easing back, the "held breath" move.
            const theta = dir * 0.4 * e;
            right = hero * Math.sin(theta) * 1.1;
            back = hero * (1.0 + 0.35 * e);
            up = lift + 1.2 * e + 0.3;
            break;
        }
        case 'spiral': {
            // A rising corkscrew: arc sideways like an orbit while climbing from below the line to above
            // it - the helix formation wraps past behind the text as the camera coils up.
            const theta = dir * 0.7 * (2 * e - 1);
            right = hero * Math.sin(theta) * 0.85;
            back = hero * (1.05 - 0.1 * e);
            up = lift - 0.8 + 2.4 * e;
            break;
        }
        case 'pendulum': {
            // A hanging-camera swing: sweep across the line while dipping through the bottom of the arc
            // at mid-line, high at both ends - reads as a cable-cam pass under the canopy formation.
            right = dir * hero * 0.45 * (2 * e - 1);
            up = lift + 0.9 - 0.9 * Math.sin(Math.PI * e);
            back = hero * 1.02;
            break;
        }
        case 'flyby': {
            // A close lateral fly-past: start off to one side slightly ahead, cross the line's face
            // closer than the hero distance, exit the other side - the rail formation streaks by.
            right = dir * hero * (0.7 - 1.4 * e);
            back = hero * (0.78 + 0.12 * Math.sin(Math.PI * e));
            up = lift + 0.05;
            break;
        }
        case 'arc': {
            // A wide, graceful lateral arc that swings out past the line and back, staying frontal and
            // composed - broader and gentler than an orbit, the elegant "sweep" move.
            const theta = dir * 0.5 * Math.sin(Math.PI * e);
            right = hero * Math.sin(theta) * 1.3;
            back = hero * (1.05 + 0.12 * (1 - Math.cos(theta)));
            up = lift + 0.5 * Math.sin(Math.PI * e);
            break;
        }
        case 'float': {
            // A dreamy suspended bob: a slow lissajous of gentle vertical and lateral drift that barely
            // translates, so the line seems to hang weightless - for long, held, floating moments.
            right = dir * hero * 0.16 * Math.sin(e * Math.PI * 2);
            up = lift + 0.6 + 0.5 * Math.sin(e * Math.PI * 2 + 1.0);
            back = hero * (1.05 + 0.06 * Math.sin(e * Math.PI));
            break;
        }
        case 'glide': {
            // An elegant ascending diagonal: cranes up while easing a touch closer, a composed rising
            // drift that opens a section or lifts into a line.
            right = dir * hero * 0.22 * e;
            up = lift + 1.4 * e;
            back = hero * (1.15 - 0.25 * e);
            break;
        }
        case 'hold':
        default:
            // A near-locked shot - deliberate stillness for contrast (variety includes NOT moving).
            up = lift + 0.3 * Math.sin(ctx.progress * Math.PI);
            back = hero;
            break;
    }

    // Scale the excursion away from the neutral trailing pose (right 0 / up lift / back hero), so sub-
    // modes soften or amplify every move uniformly without breaking its framing.
    const m = ctx.moveScale;
    return {
        right: right * m,
        up: lift + (up - lift) * m,
        back: hero + (back - hero) * m,
    };
};

/** How long a finished line is held before its shot starts resolving, and how long the resolve takes.
 *
 * 3s is not a taste number: `attachInterludes` fills every gap longer than 3s with an interlude line,
 * and the diorama holds the read-head through interludes instead of framing them. So a hold that
 * outlasts 3s is exactly a hold the lyric file itself calls a gap, and a shorter one cannot happen -
 * the next line is already on its way. Below the threshold this returns exactly 1, so ordinary
 * line-to-line playback is untouched to the pixel. */
const HOLD_SETTLE_DELAY = 3;
const HOLD_SETTLE_EASE = 5;

/**
 * How much of a line's READING COMPOSITION still applies, `secondsHeld` after its reading window
 * closed. 1 through the line and through any normal gap, easing to 0 once the camera has been parked
 * on a finished line longer than the shot language has anything to say.
 *
 * The composition is three things that all point the same way: the shot's excursion away from the
 * neutral trailing pose, the truck that follows the sung word out to the END of the line, and the
 * rule-of-thirds look offset that deliberately pushes the line off-centre. Each is right while the
 * line is live - the camera is moving and the next line is seconds away. Held through an instrumental
 * they stop being composition: `progress` is pinned at 1, so the shot freezes at its most extreme
 * pose and the two lateral offsets park the lyric hard against the edge of frame with nothing moving
 * to justify it. Measured over the shot language at default settings, 21.7% of held frames have an
 * end of the current line off screen, against 3.3% mid-line; releasing all three takes it to 0%
 * (test/manual/diorama_hold_framing.mts).
 */
export const resolveHoldSettle = (secondsHeld: number): number => {
    const t = clamp01((secondsHeld - HOLD_SETTLE_DELAY) / HOLD_SETTLE_EASE);
    return 1 - t * t * (3 - 2 * t);
};

export interface DioramaCameraDrift {
    swayX: number;
    swayY: number;
    lift: number;
    dist: number;
}

/**
 * Faint continuous idle drift added on top of the shot as a hand-held breath, driven by slow layered
 * sines so even a locked shot is alive. Composed in the line's local frame by the CameraRig. `scale` is
 * the absolute drift amplitude (params.driftScale); the seed offsets the phases per song.
 */
export const resolveCameraDrift = (time: number, seed: string | number | undefined, scale: number): DioramaCameraDrift => {
    const ph = hashSeed(seed) * 0.017;
    return {
        swayX: (Math.sin(time * 0.11 + ph) * 0.6 + Math.sin(time * 0.047 + ph * 1.7) * 0.4) * DIORAMA_SWAY_AMP * scale,
        swayY: Math.sin(time * 0.09 + ph * 0.7) * DIORAMA_SWAY_AMP * 0.5 * scale,
        lift: (Math.sin(time * 0.13 + ph * 1.3) * 0.6 + Math.sin(time * 0.061 + ph * 2.1) * 0.4) * DIORAMA_LIFT_AMP * scale,
        dist: Math.sin(time * 0.05 + ph * 1.1) * DIORAMA_DIST_AMP * scale,
    };
};

// ─── Procedural geometry ───────────────────────────────────────────────────────────────────────

export interface DioramaShapePlacement {
    kind: 'box' | 'sphere' | 'cone' | 'torus';
    position: DioramaVec;
    scale: number;
    /** Vertical stretch (Y scale multiplier) - pillars/rods are stretched boxes, not cubes. */
    stretchY: number;
    /** Upright pieces stay vertical and only slowly yaw (architecture); non-upright ones tumble slowly. */
    upright: boolean;
    spinSpeed: number;
    colorSlot: 0 | 1;
    /** Parallax layer: 'near' shapes read as foreground the camera sweeps past, 'far' as deep backdrop. */
    layer: 'near' | 'far';
}

export const DIORAMA_PARTICLE_AUDIO_SCALE_MAX = 1.44;

// Local-space spec a formation is designed in (right/up/depth relative to the line's frame + text
// offset), so overlap separation and the text clearance belt can run in one consistent space before
// composing to world.
interface FormationSpec {
    kind: DioramaShapePlacement['kind'];
    r: number;
    u: number;
    d: number;
    scale: number;
    stretchY: number;
    upright: boolean;
    colorSlot?: 0 | 1;
}

const getSpecClearanceRadius = (spec: FormationSpec): number => {
    const familyRadius = spec.kind === 'box'
        ? 0.5
        : spec.kind === 'sphere'
            ? 0.74
            : spec.kind === 'cone'
                ? 0.68
                : 0.9;
    return spec.scale * Math.max(familyRadius, spec.stretchY * 0.55);
};

// Push apart any two pieces closer than their visual footprints, then re-clamp depth behind the text
// plane. The old scale-only radius underestimated torus/ribbon silhouettes and created nested highlights.
const separateSpecs = (specs: FormationSpec[]): void => {
    for (let iter = 0; iter < 6; iter += 1) {
        for (let a = 0; a < specs.length; a += 1) {
            for (let b = a + 1; b < specs.length; b += 1) {
                const A = specs[a];
                const B = specs[b];
                const minDist = (getSpecClearanceRadius(A) + getSpecClearanceRadius(B)) * 1.3;
                let dr = B.r - A.r;
                let du = B.u - A.u;
                let dd = B.d - A.d;
                let dist = Math.hypot(dr, du, dd);
                if (dist >= minDist) continue;
                if (dist < 0.001) {
                    dr = 1;
                    du = 0.5;
                    dd = 0.25;
                    dist = Math.hypot(dr, du, dd);
                }
                const push = (minDist - dist) / 2 / dist;
                A.r -= dr * push;
                A.u -= du * push;
                A.d -= dd * push;
                B.r += dr * push;
                B.u += du * push;
                B.d += dd * push;
            }
        }
    }
    specs.forEach((s) => {
        s.d = Math.max(s.d, 1);
    });
};

// Keep a lateral clearance belt around the text row: any piece sitting at text height is pushed out
// past the longest line's half-width, so even a full-width line never visually collides with a pillar.
// Sized for the worst case: frame-fraction fit x the max per-line staging scale (~1.28) ~= 4.5 half
// width, plus margin - long lyrics stay readable instead of poking into gate pillars/colonnades.
const TEXT_CLEAR_LATERAL = 5.2;
const TEXT_CLEAR_VERTICAL = 1.4;
const enforceTextClearance = (specs: FormationSpec[]): void => {
    specs.forEach((s, i) => {
        const radius = getSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX;
        if (
            Math.abs(s.u) - radius < TEXT_CLEAR_VERTICAL
            && Math.abs(s.r) - radius < TEXT_CLEAR_LATERAL
        ) {
            const side = s.r === 0 ? (i % 2 === 0 ? 1 : -1) : Math.sign(s.r);
            s.r = side * (TEXT_CLEAR_LATERAL + radius + 0.35);
        }
    });
};

// Keep the complete cloud footprint outside the camera/lyric rail, not only its anchor point.
const enforceRailClearance = (specs: FormationSpec[]): void => {
    specs.forEach((s, i) => {
        const radius = getSpecClearanceRadius(s) * DIORAMA_PARTICLE_AUDIO_SCALE_MAX;
        const minimum = 2.8 + radius;
        const distance = Math.hypot(s.r, s.u);
        if (distance >= minimum) return;
        const fallbackAngle = (i % 2 === 0 ? 1 : -1) * Math.PI * 0.16;
        const directionR = distance > 0.001 ? s.r / distance : Math.cos(fallbackAngle);
        const directionU = distance > 0.001 ? s.u / distance : Math.sin(fallbackAngle);
        s.r = directionR * minimum;
        s.u = directionU * minimum;
    });
};

/**
 * Grow a procedural geometric formation for a line, shaped to match its camera move so the geometry and
 * the shot perform together: a RING for an orbit to sweep around, GATE pillars for a push-in to fly
 * between, a COLONNADE for a track to streak past, an ARCH for a crane to rise under, a HELIX for a
 * spiral to coil past, a hanging CANOPY for a pendulum to swing beneath, a RAIL for a flyby to skim, a
 * TOTEM for a swell, a revealed CLUSTER for a pull-back, a sparse scatter for a hold. Each formation
 * sticks to one primitive family (architectural consistency), uses vertical stretch for pillars/rods,
 * runs overlap separation plus a text clearance belt, and keeps depth >= 0.25 (at/behind the text
 * plane, never between text and camera). Centered on the line's actual text placement offsets.
 */
export const buildFormation = (
    lineIndex: number,
    seed: string | number | undefined,
    shot: DioramaShotKind,
    frame: DioramaFrame,
    placement: DioramaTextPlacement,
    volumeScale = 1,
): DioramaShapePlacement[] => {
    const salt = hashSeed(seed) + lineIndex * 97;
    const rnd = (k: number): number => seededUnit(salt + k);
    const dir = getShotDir(lineIndex, seed);
    const specs: FormationSpec[] = [];
    const safeVolumeScale = Math.min(1.6, Math.max(0.65, volumeScale));
    const add = (kind: DioramaShapePlacement['kind'], r: number, u: number, d: number, scale: number, stretchY = 1, colorSlot?: 0 | 1): void => {
        specs.push({ kind, r, u, d, scale: scale * safeVolumeScale, stretchY, upright: stretchY > 1.2, colorSlot });
    };
    const addPair = (kind: DioramaShapePlacement['kind'], lateral: number, u: number, d: number, scale: number, stretchY = 1, colorSlot: 0 | 1 = 0): void => {
        add(kind, -Math.abs(lateral), u, d, scale, stretchY, colorSlot);
        add(kind, Math.abs(lateral), u, d, scale, stretchY, colorSlot);
    };

    switch (shot) {
        case 'orbit': {
            // A sparse orbit of liquid beads with one ring accent; repeated rings read as nested glare.
            const count = 6;
            const radius = 4.4 + rnd(1) * 0.6;
            for (let j = 0; j < count; j += 1) {
                const a = (j / count) * Math.PI * 2 + rnd(2) * 0.6;
                add(j === 0 ? 'torus' : 'sphere', Math.cos(a) * radius, Math.sin(a) * radius, 0.6 + rnd(10 + j) * 1.4, 0.42 + rnd(20 + j) * 0.32);
            }
            break;
        }
        case 'pushIn': {
            // Two flanking gate pillars the push-in drives between, plus two taller far uprights.
            const gate = 4.3 + rnd(1) * 0.5;
            [-1, 1].forEach((side, idx) => {
                add('box', side * gate, -0.6, 0.5 + rnd(idx) * 0.5, 0.55 + rnd(2 + idx) * 0.2, 2.8 + rnd(6 + idx) * 0.8);
                add('box', side * (gate + 1.6), 0.6, 4.5 + rnd(3 + idx) * 2, 0.7 + rnd(4 + idx) * 0.3, 3.4);
            });
            break;
        }
        case 'track': {
            // A colonnade receding down both sides that a lateral track streaks past - even rhythm.
            for (let si = 0; si < 2; si += 1) {
                const side = si === 0 ? -1 : 1;
                for (let j = 0; j < 3; j += 1) {
                    add('box', side * (4.2 + rnd(si * 5 + j) * 0.4), -0.4 + (rnd(si * 7 + j) - 0.5) * 0.6, 0.5 + j * 2.4, 0.5 + rnd(si * 3 + j) * 0.15, 2.6 + rnd(si + j) * 0.6);
                }
            }
            break;
        }
        case 'crane': {
            // An overhead arch the crane rises under (kept above the text so it never covers it).
            const count = 5;
            const radius = 3.6 + rnd(1) * 0.5;
            for (let j = 0; j < count; j += 1) {
                const a = Math.PI * (0.15 + 0.7 * (j / (count - 1)));
                add('box', Math.cos(a) * radius, Math.abs(Math.sin(a)) * radius + 1.2, 0.6 + rnd(30 + j) * 0.8, 0.45 + rnd(40 + j) * 0.25, 1.4);
            }
            break;
        }
        case 'swell': {
            // Mirrored rising totems keep the swell grand without massing every cloud on one side.
            const lat = 4.2 + rnd(2) * 0.5;
            for (let j = 0; j < 2; j += 1) {
                addPair('box', lat, -1.5 + j * 2.1, 1 + j * 1.2, 0.48 - j * 0.06, 1.45, (j % 2) as 0 | 1);
            }
            addPair('sphere', lat, 2.65, 3.4, 0.5, 1, 0);
            break;
        }
        case 'spiral': {
            // A helix of beads coiling up behind the text, matching the corkscrew climb.
            const count = 7;
            const radius = 4.3;
            for (let j = 0; j < count; j += 1) {
                const frac = j / (count - 1);
                const a = dir * frac * Math.PI * 2.2 + rnd(1) * 0.5;
                add('sphere', Math.cos(a) * radius, -2.2 + frac * 5.2, 0.5 + frac * 2.2, 0.32 + rnd(20 + j) * 0.2);
            }
            break;
        }
        case 'pendulum': {
            // A hanging canopy of rods above the line the swing passes beneath.
            for (let j = 0; j < 4; j += 1) {
                add('box', -3.9 + j * 2.6 + (rnd(j) - 0.5) * 0.5, 3.0 + rnd(j * 2) * 1.2, 0.5 + rnd(j * 3) * 1.2, 0.3 + rnd(j * 4) * 0.12, 2.2 + rnd(j * 5) * 0.8);
            }
            break;
        }
        case 'flyby': {
            // Mirrored rails preserve a clear flight channel and a regular cadence on both sides.
            for (let j = 0; j < 3; j += 1) {
                addPair('box', 4.25 + rnd(j) * 0.25, -0.45 + j * 0.45, 1 + j * 2.1, 0.42 + rnd(j * 3) * 0.1, 2.2, (j % 2) as 0 | 1);
            }
            break;
        }
        case 'pullBack': {
            // A balanced deep reveal replaces the former one-sided pile and oversized hero blob.
            addPair('sphere', 5.8 + rnd(9) * 0.5, 1.25, 6.8 + rnd(11), 1.25 + rnd(12) * 0.25, 1, 0);
            for (let j = 0; j < 2; j += 1) {
                addPair(j === 0 ? 'box' : 'cone', 4.4 + j * 1.15, -1.4 + j * 2.2, 2.2 + j * 2.1, 0.58 + rnd(j * 4) * 0.18, j === 0 ? 1.5 : 1, 1);
            }
            break;
        }
        case 'arc': {
            // A shallow curved colonnade the wide arc sweeps past, spread across the far side.
            const count = 5;
            const radius = 5.2 + rnd(1) * 0.6;
            for (let j = 0; j < count; j += 1) {
                const a = (-0.5 + j / (count - 1)) * 1.5 * dir;
                add(j === Math.floor(count / 2) ? 'torus' : 'sphere', Math.sin(a) * radius, 0.3 + Math.cos(a) * 0.7, 1.0 + rnd(20 + j) * 1.6, 0.45 + rnd(30 + j) * 0.32);
            }
            break;
        }
        case 'float': {
            // Three mirrored orb rows feel weightless without random clumps around the lyric rail.
            for (let j = 0; j < 3; j += 1) {
                addPair('sphere', 4.1 + j * 0.85, -1.2 + j * 1.35, 1.2 + j * 1.55, 0.42 + rnd(j * 4) * 0.22, 1, (j % 2) as 0 | 1);
            }
            break;
        }
        case 'glide': {
            // Mirrored ascending pylons frame the glide instead of forming a single crowded wall.
            for (let j = 0; j < 3; j += 1) {
                addPair('box', 4.25 + rnd(j) * 0.3, -1.5 + j * 1.7, 1 + j * 1.7, 0.46 + rnd(j * 2) * 0.12, 1.85, (j % 2) as 0 | 1);
            }
            break;
        }
        case 'hold':
        default: {
            // A calm pair of rings and a nearer pair of beads make a quiet, ordered frame.
            addPair('torus', 5.6, 1.55, 7.2 + rnd(1), 1.05 + rnd(2) * 0.2, 1, 0);
            addPair('sphere', 4.45, -1.1, 2.1 + rnd(4), 0.58 + rnd(5) * 0.16, 1, 1);
            break;
        }
    }

    enforceRailClearance(specs);
    enforceTextClearance(specs);
    separateSpecs(specs);
    enforceRailClearance(specs);
    enforceTextClearance(specs);

    return specs.map((s, j) => ({
        kind: s.kind,
        position: composeLocal(frame, placement.offsetR + s.r, placement.offsetU + s.u, s.d),
        scale: s.scale,
        stretchY: s.stretchY,
        upright: s.upright,
        spinSpeed: 0.04 + rnd(j * 13 + 5) * 0.1,
        colorSlot: s.colorSlot ?? (j % 2) as 0 | 1,
        layer: s.d > 3.5 ? 'far' : 'near',
    }));
};

/**
 * Distance-based lifecycle opacity for a shape: 0 beyond the far haze (so newly mounted formations are
 * BORN invisible and fade in as they approach - no pop-in), 1 through the mid-range, and dissolving
 * back to 0 as the camera closes within the dissolve radius (so a near pass melts the shape away
 * instead of clipping through it). Both ends are smoothstepped.
 */
export const resolveShapeLifeOpacity = (distanceToCamera: number): number => {
    const farT = clamp01(
        (DIORAMA_SHAPE_FADE_IN_END - distanceToCamera) / (DIORAMA_SHAPE_FADE_IN_END - DIORAMA_SHAPE_FADE_IN_START)
    );
    const nearT = clamp01(
        (distanceToCamera - DIORAMA_SHAPE_DISSOLVE_END) / (DIORAMA_SHAPE_DISSOLVE_START - DIORAMA_SHAPE_DISSOLVE_END)
    );
    const farS = farT * farT * (3 - 2 * farT);
    const nearS = nearT * nearT * (3 - 2 * nearT);
    return farS * nearS;
};
