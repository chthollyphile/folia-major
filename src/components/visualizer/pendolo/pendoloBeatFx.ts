import { parseColorChannels } from '../colorMix';
import {
    getBeatFxFiredCounts,
    getBeatFxIntensities,
    getBeatFxLastBeat,
    getBeatFxLastDownbeat,
    getBeatFxTrackScale,
} from '../../../services/beatFx/beatFxLive';
import { BEAT_FX_WEAK_BEAT_FLOOR, resolveBeatFxAccentGain, type BeatFxEvent } from '../../../services/beatFx/clock';

// src/components/visualizer/pendolo/pendoloBeatFx.ts
// 时计's share of 智能动感模式: the clockwork's beat effects, as state stepped once per frame and read
// by both renderers (WebGL and Canvas2D) and by the lyric wheel. Pure apart from
// `readPendoloBeatTriggers`, which reads the live beat clock.
//
//   jewel flare       every beat     every jewel bearing flares, as strong as the halo (the beat's
//                                    accent read as decibels: resolvePendoloWavePunch)
//   mesh sparks       downbeat       a burst of sparks flies off where the gears mesh, as the two
//                                    lower gears spin a whole turn (pendoloClockworkMotion.ts)
//   hub shockwave     every beat     a transparent lens wave from the hub across the screen, faster
//                                    the further out it gets: what it passes is pushed out and lit,
//                                    nothing of its own is drawn (no ring, no line); with it a filled
//                                    soft halo grows out of the hub to the far corner of the screen
//                                    and fades (VisualizerPendolo); as strong as the beat's accent
//   dial light        every beat     as the wave passes the inner dial its 60 ticks light up, as it
//                                    passes the outermost dial the whole ring lights up; both fade
//   shake             downbeat       the screen shakes a few pixels
//
// The beats are beat_this' as filtered by the rhythm gate (beat_this + HPSS, beatAccents.ts'
// `rhythmic`): a beat in a bar with no rhythm fires nothing. The gears, sparks and shake fire every
// other beat in full, accents unread; the shockwave (and its halo and dial lights) and the jewel
// flares follow the accents (`resolveBeatFxAccentGain`: the beat's impact and the track's dynamics scale),
// as the user asked (2026-10-17). The sweep that once turned round the hub every beat, lighting the
// ticks, is gone at the user's word. The wheel itself - main gear and lyrics - keeps to the lyrics: the beats move the two
// lower gears instead (pendoloClockworkMotion.ts).
//
// Values were first tuned in the standalone demo (folia-header-mock/pendolo-beat-demo); the
// shockwave's look is the one the user chose there over a glowing ring with an echo. Seen in the app
// they read too weak and were raised: bigger, faster, longer-lived spark bursts, a lens that pushes
// twice as far, lights twice as much and tints what it passes with the effect colour.
//
// Strengths: every effect scales by the 轻拍 / 重拍 strength, so both at 0 draw nothing while the
// gears still step.

const FLARE_DECAY_SECONDS = 0.25;

export const PENDOLO_MAX_SPARKS = 192;
/** Per spark: x, y, vx, vy (CSS px, px/s), life left, life at birth. */
export const PENDOLO_SPARK_STRIDE = 6;
const SPARK_GRAVITY = 120;
const SPARK_DRAG = 3;

/**
 * How long a wave takes to cross the screen: most of a beat, so it is out past the clock before the
 * next beat's wave starts over from the hub (a longer one was cut short inside the clock every beat),
 * between a floor and this longest. The longest was 1.1 s, which a slow song (李玉刚's 新贵妃醉酒)
 * reached and read as sluggish: the wave keeps one punchy speed however slow the beat, and only a
 * fast song shortens it.
 */
export const PENDOLO_WAVE_SECONDS = 0.5;
const WAVE_SHARE_OF_BEAT = 0.85;
const WAVE_MIN_SECONDS = 0.3;
/** The dials the wave lights as it passes (shares of the wheel's radius): the ticks' and the outermost. */
export const PENDOLO_TICK_DIAL = 1.15;
export const PENDOLO_OUTER_DIAL = 1.4;
const DIAL_LIGHT_DECAY_SECONDS = 0.45;
const SHAKE_DECAY = 9;
const SHAKE_PX = 8;

/** What the beat clock fired since the last frame (beats in bars with rhythm only), with their gains. */
export interface PendoloBeatTriggers {
    beats: number;
    downbeats: number;
    /** Gain of a plain beat / downbeat: the 轻拍 / 重拍 strength, no accent. */
    beatGain: number;
    downbeatGain: number;
    /** The same with the beat's accent (impact x track scale), for the shockwave. */
    beatAccentGain: number;
    downbeatAccentGain: number;
}

export interface PendoloBeatCounter {
    beats: number;
    downbeats: number;
    /** False until the first read, which only takes the clock's counts and fires nothing. */
    synced: boolean;
}

export const createPendoloBeatCounter = (): PendoloBeatCounter => ({ beats: 0, downbeats: 0, synced: false });

const NO_TRIGGERS: PendoloBeatTriggers = {
    beats: 0, downbeats: 0, beatGain: 0, downbeatGain: 0, beatAccentGain: 0, downbeatAccentGain: 0,
};

type FiredBeat = Pick<BeatFxEvent, 't' | 'rhythmic' | 'impact'>;

/** Of the last plain beat and the last downbeat, the one that fired last. */
const latestOf = (beat: FiredBeat | null, downbeat: FiredBeat | null): FiredBeat | null => {
    if (!beat) return downbeat;
    if (!downbeat) return beat;
    return downbeat.t >= beat.t ? downbeat : beat;
};

/**
 * The triggers for fired counts and the beats that fired, from the clock's ever-growing counts. A
 * beat the rhythm gate turned off (`rhythmic: false`) is not counted at all - not even a gear step.
 * The plain-beat count includes downbeats (the clock counts a downbeat as a beat too), so it is gated
 * on whichever fired last: the clock's last plain beat alone missed a downbeat, and a track opening
 * on one in a gated bar fired its first beat while there was no plain beat yet.
 */
export const resolvePendoloBeatTriggers = (
    counter: PendoloBeatCounter,
    fired: Readonly<{ beats: number; downbeats: number }>,
    lastBeat: FiredBeat | null,
    lastDownbeat: FiredBeat | null,
    trackScale: number,
    intensities: Readonly<{ beat: number; downbeat: number }>,
    out: PendoloBeatTriggers = { ...NO_TRIGGERS },
): PendoloBeatTriggers => {
    const beats = counter.synced ? Math.max(0, fired.beats - counter.beats) : 0;
    const downbeats = counter.synced ? Math.max(0, fired.downbeats - counter.downbeats) : 0;
    counter.beats = fired.beats;
    counter.downbeats = fired.downbeats;
    counter.synced = true;
    const latest = latestOf(lastBeat, lastDownbeat);
    out.beats = latest?.rhythmic === false ? 0 : beats;
    out.downbeats = lastDownbeat?.rhythmic === false ? 0 : downbeats;
    out.beatGain = intensities.beat;
    out.downbeatGain = intensities.downbeat;
    out.beatAccentGain = resolveBeatFxAccentGain(latest, trackScale) * intensities.beat;
    out.downbeatAccentGain = resolveBeatFxAccentGain(lastDownbeat, trackScale) * intensities.downbeat;
    return out;
};

/** `resolvePendoloBeatTriggers` on the live beat clock. */
export const readPendoloBeatTriggers = (counter: PendoloBeatCounter, out?: PendoloBeatTriggers): PendoloBeatTriggers =>
    resolvePendoloBeatTriggers(
        counter,
        getBeatFxFiredCounts(),
        getBeatFxLastBeat(),
        getBeatFxLastDownbeat(),
        getBeatFxTrackScale(),
        getBeatFxIntensities(),
        out,
    );

/** A point where two gears mesh, with the tangent sparks fly along (CSS px, renderer's space). */
export interface PendoloMeshPoint {
    x: number;
    y: number;
    tx: number;
    ty: number;
}

export interface PendoloBeatFxState {
    jewelFlare: number;
    smallJewelFlare: number;
    sparks: Float32Array;
    /** Next pool slot to write; the pool is a ring, the oldest spark gives way. */
    sparkCursor: number;
    waveStart: number;
    /** Seconds the current wave takes to cross the screen. */
    waveDuration: number;
    waveGain: number;
    /** Where the current wave started, CSS px from the hub (0, 0 but under 时计's drum hits). */
    waveX: number;
    waveY: number;
    /** How much the current wave's halo, dial lights and jewel flares show (resolvePendoloWavePunch). */
    wavePunch: number;
    /** Which dials the current wave has passed (bit 1 the ticks', bit 2 the outermost). */
    waveDials: number;
    /** How lit the ticks' dial / the outermost dial are, set as the wave passes them. */
    tickDialLight: number;
    outerDialLight: number;
    shake: number;
}

export const createPendoloBeatFxState = (): PendoloBeatFxState => ({
    jewelFlare: 0,
    smallJewelFlare: 0,
    sparks: new Float32Array(PENDOLO_MAX_SPARKS * PENDOLO_SPARK_STRIDE),
    sparkCursor: 0,
    waveStart: -1,
    waveDuration: PENDOLO_WAVE_SECONDS,
    waveGain: 0,
    waveX: 0,
    waveY: 0,
    wavePunch: 0,
    waveDials: 0,
    tickDialLight: 0,
    outerDialLight: 0,
    shake: 0,
});

export interface PendoloBeatFxStepContext {
    /** Seconds, any monotonic clock; the wave is timed on it. */
    now: number;
    dt: number;
    /** Seconds between beats, which the wave's crossing fits in. */
    beatPeriod: number;
    /** Where sparks start; empty draws none. */
    meshPoints: readonly PendoloMeshPoint[];
    random: () => number;
    /** Under drum hits (usePendoloBeatFx): the wave's crossing time instead of one fitted to the beat. */
    waveSeconds?: number;
}

const spawnSparks = (state: PendoloBeatFxState, points: readonly PendoloMeshPoint[], gain: number, random: () => number) => {
    const perPoint = Math.round(10 + 10 * Math.min(1.5, gain));
    for (const point of points) {
        const length = Math.hypot(point.tx, point.ty) || 1;
        const tx = point.tx / length;
        const ty = point.ty / length;
        for (let index = 0; index < perPoint; index += 1) {
            const direction = random() < 0.5 ? 1 : -1;
            const speed = 180 + random() * 320;
            const spread = (random() - 0.5) * 0.9;
            const life = 0.18 + random() * 0.22;
            const at = state.sparkCursor * PENDOLO_SPARK_STRIDE;
            state.sparks[at] = point.x;
            state.sparks[at + 1] = point.y;
            state.sparks[at + 2] = (tx * direction + ty * spread) * speed;
            state.sparks[at + 3] = (ty * direction - tx * spread) * speed;
            state.sparks[at + 4] = life;
            state.sparks[at + 5] = life;
            state.sparkCursor = (state.sparkCursor + 1) % PENDOLO_MAX_SPARKS;
        }
    }
};

/** Fires what `triggers` asks for and advances every effect by `dt`. */
export const stepPendoloBeatFx = (
    state: PendoloBeatFxState,
    triggers: PendoloBeatTriggers,
    context: PendoloBeatFxStepContext,
): PendoloBeatFxState => {
    const { now, dt } = context;
    // The shockwave and the jewel flares start on every beat, as strong as its accent; a downbeat is a
    // beat too.
    const waveGain = triggers.downbeats > 0 ? triggers.downbeatAccentGain : triggers.beats > 0 ? triggers.beatAccentGain : 0;
    if (waveGain > 0) {
        state.waveStart = now;
        state.waveDuration = context.waveSeconds
            ?? Math.min(PENDOLO_WAVE_SECONDS, Math.max(WAVE_MIN_SECONDS, WAVE_SHARE_OF_BEAT * context.beatPeriod));
        state.waveGain = Math.min(1.5, waveGain);
        state.waveX = 0;
        state.waveY = 0;
        state.waveDials = 0;
        // The accent and the 轻拍 / 重拍 strength apart: the strength only scales what the accent shows.
        const strength = triggers.downbeats > 0 ? triggers.downbeatGain : triggers.beatGain;
        const punch = strength > 0 ? resolvePendoloWavePunch(waveGain / strength, strength) : resolvePendoloWavePunch(waveGain, 1);
        state.wavePunch = punch;
        state.jewelFlare = Math.max(state.jewelFlare, punch);
        state.smallJewelFlare = Math.max(state.smallJewelFlare, punch);
    }
    // The rest is the downbeat's, in full; a plain beat also steps the gears (pendoloClockworkMotion.ts).
    const gain = triggers.downbeatGain;
    if (triggers.downbeats > 0 && gain > 0) {
        spawnSparks(state, context.meshPoints, gain, context.random);
        state.shake = Math.max(state.shake, Math.min(1.5, gain));
    }

    const flareDecay = Math.exp(-dt / FLARE_DECAY_SECONDS * 2.3);
    state.jewelFlare *= flareDecay;
    state.smallJewelFlare *= flareDecay;
    state.shake *= Math.exp(-SHAKE_DECAY * dt);
    const dialDecay = Math.exp(-dt / DIAL_LIGHT_DECAY_SECONDS * 2.3);
    state.tickDialLight *= dialDecay;
    state.outerDialLight *= dialDecay;
    if (state.tickDialLight < 1e-3) state.tickDialLight = 0;
    if (state.outerDialLight < 1e-3) state.outerDialLight = 0;
    // Settled values snap to exactly 0, so between beats nothing downstream changes frame to frame.
    if (state.jewelFlare < 1e-3) state.jewelFlare = 0;
    if (state.smallJewelFlare < 1e-3) state.smallJewelFlare = 0;
    if (state.shake < 0.01) state.shake = 0;
    if (state.waveStart >= 0 && now - state.waveStart > state.waveDuration) state.waveStart = -1;

    const drag = Math.exp(-SPARK_DRAG * dt);
    for (let at = 0; at < state.sparks.length; at += PENDOLO_SPARK_STRIDE) {
        if (state.sparks[at + 4] <= 0) continue;
        state.sparks[at] += state.sparks[at + 2] * dt;
        state.sparks[at + 1] += state.sparks[at + 3] * dt;
        state.sparks[at + 2] *= drag;
        state.sparks[at + 3] = state.sparks[at + 3] * drag + SPARK_GRAVITY * dt;
        state.sparks[at + 4] -= dt;
    }
    return state;
};

export interface PendoloWaveFrame {
    /** Distance of the lens' crest from the hub, CSS px. */
    radius: number;
    /** Width of the lens, CSS px; it has no visible edge. */
    band: number;
    /** 0..1.5 how strong the lens is now (fades as it travels). */
    strength: number;
    /** Where it travels out from, CSS px from the hub; 0, 0 but under the drum hits. */
    x: number;
    y: number;
}

/** Where the shockwave is, travelling from the hub to `maxRadius`; null when none is on. */
export const resolvePendoloWave = (
    state: PendoloBeatFxState,
    now: number,
    baseRadius: number,
    maxRadius: number,
): PendoloWaveFrame | null => {
    if (state.waveStart < 0) return null;
    const progress = (now - state.waveStart) / state.waveDuration;
    if (progress < 0 || progress > 1) return null;
    // Speeding up as it spreads: ~5x as fast at the far corner as out of the hub. Every wave reaches
    // the far corner in the same time; a weak beat's only shows less. (Weak ones once stopped about
    // halfway, which over the same time made them crawl and linger mid-screen.)
    const eased = 0.3 * progress + 0.7 * progress * progress;
    const start = baseRadius * 0.08;
    return {
        radius: start + (maxRadius - start) * eased,
        band: 200 + 140 * state.waveGain,
        strength: (1 - progress) ** 0.8 * Math.min(1.3, 1.3 * state.waveGain),
        x: state.waveX,
        y: state.waveY,
    };
};

/**
 * The halo's opacity: the wave's punch (a weak beat faint, a strong one full), held while it spreads
 * and fading only toward its end, so it is seen out past the clock and not only inside it. Exactly 0
 * when no wave is on.
 */
export const resolvePendoloHaloOpacity = (state: PendoloBeatFxState, now: number): number => {
    if (state.waveStart < 0) return 0;
    const progress = (now - state.waveStart) / state.waveDuration;
    if (progress < 0 || progress > 1) return 0;
    return state.wavePunch * (1 - progress) ** 0.5;
};

/**
 * The span the accent is read over as decibels: the weak-beat floor (BEAT_FX_WEAK_BEAT_FLOOR) this
 * far under the strongest beat. Brightness is seen roughly on a log scale, so the accent squared
 * (punch 0.35 / 0.65 / 0.85 at the tracks' p10 / median / p90 beat) read as much the same halo;
 * at 30 dB they show 0.1 / 0.4 / 0.75.
 */
const PUNCH_RANGE_DB = 30;

/**
 * How much a wave's beat shows - its halo, the dial lights and the jewel flares - from its accent
 * gain (`accent`, resolveBeatFxAccentGain: the floor 0.35 up to 1, times the track scale) read as
 * decibels, times the 轻拍 / 重拍 strength (`strength`, 0..2), at most 1.
 */
export const resolvePendoloWavePunch = (accent: number, strength: number): number => {
    const a = Math.min(1, Math.max(0, accent));
    if (!(a > 0) || !(strength > 0)) return 0;
    const below = (1 - a) / (1 - BEAT_FX_WEAK_BEAT_FLOOR);
    return Math.min(1, strength * 10 ** (-(PUNCH_RANGE_DB / 20) * below));
};

/** Lights each dial once, the frame the wave's crest passes it, as strong as the wave's downbeat. */
export const lightPendoloDials = (state: PendoloBeatFxState, wave: Pick<PendoloWaveFrame, 'radius' | 'band' | 'strength'> | null, baseRadius: number) => {
    if (!wave) return;
    const light = state.wavePunch;
    if (!(state.waveDials & 1) && wave.radius >= baseRadius * PENDOLO_TICK_DIAL) {
        state.waveDials |= 1;
        state.tickDialLight = Math.max(state.tickDialLight, light);
    }
    if (!(state.waveDials & 2) && wave.radius >= baseRadius * PENDOLO_OUTER_DIAL) {
        state.waveDials |= 2;
        state.outerDialLight = Math.max(state.outerDialLight, light);
    }
};

/** The lens' bell (0 outside, 1 at the crest) at `distance` from the hub. */
export const resolvePendoloWaveBump = (wave: Pick<PendoloWaveFrame, 'radius' | 'band' | 'strength'>, distance: number): number => {
    const u = (distance - (wave.radius - wave.band)) / wave.band;
    if (u <= 0 || u >= 1) return 0;
    const s = Math.sin(Math.PI * u);
    return s * s;
};

/** How far the lens pushes what it passes (a share of its distance from the hub) and how much it lights it. */
// Raised from 0.09 (and the band widened) once the wave fit in a beat: crossing that fast, what it
// passed barely moved before it was gone.
export const PENDOLO_WAVE_PUSH = 0.2;
export const PENDOLO_WAVE_LIGHT = 1.8;
/** How far the lens tints what it lights toward the effect colour (times its light, capped at 1). */
export const PENDOLO_WAVE_TINT = 0.5;

/**
 * How far the lens pushes a point `dx, dy` from the hub (CSS px), exactly as the mesh shader moves a
 * vertex there: for what sits on the clockwork in the DOM (the balance's icon) and has to move with it.
 */
export const resolvePendoloPointWave = (
    dx: number,
    dy: number,
    radius: number,
    band: number,
    strength: number,
): { x: number; y: number } => {
    if (strength <= 0 || band <= 0) return { x: 0, y: 0 };
    const bump = resolvePendoloWaveBump({ radius, band, strength }, Math.hypot(dx, dy));
    if (bump <= 0) return { x: 0, y: 0 };
    const push = PENDOLO_WAVE_PUSH * strength * bump;
    return { x: dx * push, y: dy * push };
};

/** Where a lyric line's anchor sits relative to the line's text centre, CSS px along the radius. */
const LINE_TEXT_REACH = 40;

/**
 * The lens on one lyric line `dx, dy` from the hub (CSS px): how far it pushes the line outward and
 * how much it lights it (0..1). Lines outside the lens get exactly { x: 0, y: 0, light: 0 }.
 */
export const resolvePendoloLineWave = (
    dx: number,
    dy: number,
    radius: number,
    band: number,
    strength: number,
): { x: number; y: number; light: number } => {
    if (strength <= 0 || band <= 0) return { x: 0, y: 0, light: 0 };
    const length = Math.hypot(dx, dy);
    const bump = resolvePendoloWaveBump({ radius, band, strength }, length + LINE_TEXT_REACH);
    if (bump <= 0 || length === 0) return { x: 0, y: 0, light: 0 };
    const push = (length + LINE_TEXT_REACH) * PENDOLO_WAVE_PUSH * strength * bump;
    return {
        x: (dx / length) * push,
        y: (dy / length) * push,
        light: Math.min(1, PENDOLO_WAVE_LIGHT * strength * bump),
    };
};

/** A line's opacity lit by the lens; a line hidden off the arc stays hidden. */
export const resolvePendoloLitOpacity = (opacity: number, light: number): number => (
    light > 0 ? opacity + (1 - opacity) * light * Math.min(1, opacity * 4) : opacity
);

/** Screen shake offset for this frame, CSS px. */
export const resolvePendoloShake = (state: PendoloBeatFxState, random: () => number): { x: number; y: number } => {
    if (state.shake < 0.01) return { x: 0, y: 0 };
    const amount = SHAKE_PX * state.shake;
    return { x: (random() - 0.5) * 2 * amount, y: (random() - 0.5) * 2 * amount };
};

/** Whether anything is still moving or lit, so a renderer can skip the overlay pass entirely. */
export const isPendoloBeatFxIdle = (state: PendoloBeatFxState, now: number): boolean => {
    if (state.jewelFlare > 0.01 || state.smallJewelFlare > 0.01 || state.shake > 0.01) return false;
    if (state.tickDialLight > 0 || state.outerDialLight > 0) return false;
    if (state.waveStart >= 0) return false;
    for (let at = 4; at < state.sparks.length; at += PENDOLO_SPARK_STRIDE) if (state.sparks[at] > 0) return false;
    return true;
};

const GOLD: [number, number, number] = [243, 196, 107];

const toHsl = (r: number, g: number, b: number): [number, number, number] => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    return [h / 6, s, l];
};

const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
    if (s === 0) return [l, l, l].map(v => Math.round(v * 255)) as [number, number, number];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t0: number) => {
        const t = ((t0 % 1) + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => Math.round(v * 255)) as [number, number, number];
};

/**
 * The effects' colour from the theme accent: lifted to at least 60% saturation and 70% lightness so
 * it glows on a dark background; gold when the accent is near grey (a black-and-white theme).
 */
export const resolvePendoloBeatFxColor = (accent: string): [number, number, number] => {
    const channels = parseColorChannels(accent);
    if (!channels) return GOLD;
    const [h, s, l] = toHsl(channels.r, channels.g, channels.b);
    if (s < 0.12) return GOLD;
    return fromHsl(h, Math.max(s, 0.6), Math.max(l, 0.7));
};

/** `color` pushed toward white by `heat` (0..1): the white-hot core of a spark or a flare. */
export const heatPendoloBeatFxColor = (color: readonly [number, number, number], heat: number): [number, number, number] => [
    Math.round(color[0] + (255 - color[0]) * heat),
    Math.round(color[1] + (255 - color[1]) * heat),
    Math.round(color[2] + (255 - color[2]) * heat),
];
