import { useEffect, useMemo, useRef } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import { getBeatFxBeatPeriod, getBeatFxHeard, isBeatFxReady } from '../../../services/beatFx/beatFxLive';
import { DRUM_HAT, DRUM_KICK, DRUM_SNARE, getDrumHits, type DrumHits } from '../../../services/analysis/drumHits';
import {
    createPendoloBeatCounter,
    resolvePendoloWavePunch,
    createPendoloBeatFxState,
    lightPendoloDials,
    readPendoloBeatTriggers,
    resolvePendoloHaloOpacity,
    resolvePendoloBeatFxColor,
    resolvePendoloShake,
    resolvePendoloWave,
    stepPendoloBeatFx,
    type PendoloBeatFxState,
    type PendoloBeatTriggers,
    type PendoloMeshPoint,
    type PendoloWaveFrame,
} from './pendoloBeatFx';
import { resolvePendoloMeshPoints } from './pendoloBeatFxDraw';

// src/components/visualizer/pendolo/usePendoloBeatFx.ts
// Runs 时计's beat effects (pendoloBeatFx.ts) while 智能动感模式 is on: one frame loop that steps
// the effect state and hands it on - the shockwave on the lyric lines, the shake and the shockwave's
// full-screen halo as MotionValues for the DOM, the rest through `shared` for the clockwork canvas
// to draw.
//
// Off, or until the playing track's beats are in, the loop does not run (or holds everything at
// rest) and every MotionValue stays 0, which the consumers add or multiply in as an exact no-op.
//
// Drum hits (services/analysis/drumHits.ts: htdemucs' drum stem on the GPU, htdemucs_gpu installed):
// once the playing track's hits are in, the clock face is a drumhead seen from above, played by the
// stem's own hits at the heard time - no beat list in between. Kicks and snares light the halo where
// it stands (no wave out of the hub), as bright as each hit on the decibel curve and falling off fast,
// the jewel flares and both dials lit to match. A kick swells the whole head, and a hard one shakes
// the screen. A snare strikes off centre, and a hard one tilts the head that way. A hat lights only
// the tick dial (its ticks and the ring under them). No shockwave and no gear sparks (an earlier pass sent one out of where each snare
// struck; it read too busy). Until they are in - no model, no WebGPU, the separation still running -
// and on a drumless track, which has none, the beat list plays as above.
//
// @note Deprecated 2026-10-17 at the user's word: the beat-list effects above (the shockwave, its
// halo, the gear sparks, the beat-driven shake) are retired from 时计, kept but switched off by
// PENDOLO_BEAT_LIST_FX. Without drum hits - before they are in, past where a track still separating
// has them, a drumless track, no htdemucs_gpu or WebGPU - 时计 now rests.

/** Read by the clockwork canvas every frame. */
export interface PendoloBeatFxShared {
    /** Whether this frame is a beat FX frame: the switch on and the track's beats installed. */
    active: boolean;
    state: PendoloBeatFxState;
    /** The loop's clock (seconds) at its last step; the wave is timed on it. */
    now: number;
    /** The shockwave lens around the wheel centre, or null. */
    wave: PendoloWaveFrame | null;
    color: [number, number, number];
}

export interface PendoloBeatFxLayout {
    centerX: number;
    centerY: number;
    baseRadius: number;
    lyricRingRadius: number;
    viewportWidth: number;
    viewportHeight: number;
}

export interface PendoloBeatFxHandles {
    shared: React.MutableRefObject<PendoloBeatFxShared>;
    waveRadius: MotionValue<number>;
    waveBand: MotionValue<number>;
    waveStrength: MotionValue<number>;
    shakeX: MotionValue<number>;
    shakeY: MotionValue<number>;
    /**
     * The beat halo: a soft glow out of the hub that grows with the shockwave to the far corner of
     * the screen. Scale is its radius over the wave's reach (PENDOLO_WAVE_REACH), opacity 0 when none.
     */
    haloScale: MotionValue<number>;
    haloOpacity: MotionValue<number>;
    /** Where the shockwave travels out from, screen CSS px from the hub; 0 but under drum hits. */
    waveX: MotionValue<number>;
    waveY: MotionValue<number>;
    /** Where the halo is centred, screen CSS px from the hub: the wave's origin, but the hub under drum hits. */
    haloX: MotionValue<number>;
    haloY: MotionValue<number>;
    /** Under drum hits, the swell of the whole face on a kick; 1 otherwise. */
    breath: MotionValue<number>;
    /** The effect colour, 0..255. */
    color: [number, number, number];
}

/** How far the shockwave (and its halo) reaches: past the far corner of the viewport, wherever the wheel sits. */
export const resolvePendoloWaveReach = (layout: PendoloBeatFxLayout): number => Math.hypot(
    Math.max(layout.centerX, layout.viewportWidth - layout.centerX),
    Math.max(layout.centerY, layout.viewportHeight - layout.centerY),
) * 1.05;

/** The retired beat-list effects (see the header): kept, not run. */
const PENDOLO_BEAT_LIST_FX = false;

/** Where the drum hits were read up to. */
interface DrumCursor {
    key: string | null;
    time: number | null;
    next: number;
    /** The list `next` indexes: a track still separating hands over a new one every second or so. */
    list: DrumHits | null;
}
/** The strongest kick, snare and hat heard since the last frame, 0 for none. */
interface DrumFrame {
    kick: number;
    snare: number;
    hat: number;
}
/** A jump further than this (a seek) repositions without firing what it skipped. */
const DRUM_MAX_STEP_SECONDS = 0.25;
/** A snare at least this strong tilts the head toward where it struck, up to DRUM_TILT_PX. */
const DRUM_TILT_SHARE = 0.4;
const DRUM_TILT_PX = 10;
/** The tilt's wobble (Hz) and how fast it settles (1/s). */
const DRUM_TILT_DECAY = 9;
const DRUM_TILT_HZ = 8;
/** A kick swells the whole head by up to this share, wobbling at DRUM_BREATH_HZ, settling over DRUM_BREATH_SECONDS. */
const DRUM_BREATH = 0.035;
const DRUM_BREATH_HZ = 6;
const DRUM_BREATH_SECONDS = 0.15;
/** A kick at least this strong also shakes the screen, as a downbeat does. */
const DRUM_SHAKE_SHARE = 0.6;
/** How fast the drum-lit halo falls after a hit (time constant, seconds). */
const DRUM_GLOW_FALL_SECONDS = 0.15;
/** The halo's size at rest share of its full reach; a full-strength hit grows it to the whole reach. */
const DRUM_GLOW_SCALE = 0.55;
/** How much a hat lights the tick dial (its ticks and the ring under them), times its strength. */
const DRUM_HAT_LIGHT = 0.7;

/** Fills `out` with the drum hits heard since the last frame (none across a seek). */
const readDrumFrame = (hits: DrumHits, key: string | null, time: number | null, cursor: DrumCursor, out: DrumFrame) => {
    out.kick = 0;
    out.snare = 0;
    out.hat = 0;
    if (time === null) {
        cursor.time = null;
        return;
    }
    const seek = cursor.key !== key || cursor.time === null || time < cursor.time || time - cursor.time > DRUM_MAX_STEP_SECONDS;
    if (seek) {
        let next = 0;
        while (next < hits.times.length && hits.times[next] <= time) next += 1;
        cursor.key = key;
        cursor.time = time;
        cursor.next = next;
        cursor.list = hits;
        return;
    }
    if (cursor.list !== hits) {
        // A new pick of the same track: picked up after the last frame's time, so the hits since then
        // still fire and none fires twice, though their indices moved.
        let next = 0;
        while (next < hits.times.length && hits.times[next] <= (cursor.time ?? time)) next += 1;
        cursor.next = next;
        cursor.list = hits;
    }
    while (cursor.next < hits.times.length && hits.times[cursor.next] <= time) {
        const strength = hits.strengths[cursor.next];
        const kind = hits.kinds[cursor.next];
        if (kind === DRUM_KICK) out.kick = Math.max(out.kick, strength);
        else if (kind === DRUM_SNARE) out.snare = Math.max(out.snare, strength);
        else if (kind === DRUM_HAT) out.hat = Math.max(out.hat, strength);
        cursor.next += 1;
    }
    cursor.time = time;
};

export const usePendoloBeatFx = (
    enabled: boolean,
    layout: PendoloBeatFxLayout,
    accentColor: string,
): PendoloBeatFxHandles => {
    const shared = useRef<PendoloBeatFxShared>({
        active: false,
        state: createPendoloBeatFxState(),
        now: 0,
        wave: null,
        color: resolvePendoloBeatFxColor(accentColor),
    });
    const waveRadius = useMotionValue(0);
    const waveBand = useMotionValue(0);
    const waveStrength = useMotionValue(0);
    const shakeX = useMotionValue(0);
    const shakeY = useMotionValue(0);
    const haloScale = useMotionValue(0);
    const haloOpacity = useMotionValue(0);
    const waveX = useMotionValue(0);
    const waveY = useMotionValue(0);
    const haloX = useMotionValue(0);
    const haloY = useMotionValue(0);
    const breath = useMotionValue(1);

    const color = useMemo(() => resolvePendoloBeatFxColor(accentColor), [accentColor]);
    useEffect(() => {
        shared.current.color = color;
    }, [color]);

    // Sparks are kept in viewport px; the canvas offsets them into its box.
    const meshPoints = useMemo<PendoloMeshPoint[]>(
        () => resolvePendoloMeshPoints(layout),
        [layout.baseRadius, layout.centerX, layout.centerY, layout.lyricRingRadius],
    );
    const layoutRef = useRef({ layout, meshPoints });
    layoutRef.current = { layout, meshPoints };

    useEffect(() => {
        const rest = () => {
            shared.current.active = false;
            shared.current.wave = null;
            shared.current.state = createPendoloBeatFxState();
            for (const value of [waveRadius, waveBand, waveStrength, shakeX, shakeY, haloScale, haloOpacity, waveX, waveY, haloX, haloY]) {
                if (value.get() !== 0) value.set(0);
            }
            if (breath.get() !== 1) breath.set(1);
        };
        if (!enabled) {
            rest();
            return undefined;
        }
        const counter = createPendoloBeatCounter();
        const triggers = readPendoloBeatTriggers(counter);
        let last: number | null = null;
        let frame = 0;
        const drumCursor: DrumCursor = { key: null, time: null, next: 0, list: null };
        const drumFrame: DrumFrame = { kick: 0, snare: 0, hat: 0 };
        let glow = 0;
        const tilt = { x: 0, y: 0, amount: 0, at: 0 };
        const swell = { amount: 0, at: 0 };
        const step = (timestamp: number) => {
            frame = window.requestAnimationFrame(step);
            const now = timestamp / 1000;
            const dt = last === null ? 0 : Math.min(0.05, now - last);
            last = now;
            if (!isBeatFxReady()) {
                // Resynced on the frame the beats arrive, so nothing already fired bursts out.
                counter.synced = false;
                if (shared.current.active) rest();
                return;
            }
            const { layout: current, meshPoints: points } = layoutRef.current;
            readPendoloBeatTriggers(counter, triggers);
            const heard = getBeatFxHeard();
            const known = getDrumHits(heard.key);
            // Past where a track still separating has its hits (a seek ahead): its beats until they come.
            const hits = known && (known.until === undefined || heard.time === null || heard.time < known.until) ? known : null;
            const drumHits = hits !== null;
            if (!drumHits && !PENDOLO_BEAT_LIST_FX) {
                // No drum hits, no effects: the beat list no longer plays 时计.
                counter.synced = false;
                glow = 0;
                if (shared.current.active) rest();
                return;
            }
            if (hits) {
                // The beat clock's triggers are dropped and no shockwave travels: kicks and snares
                // light the halo where it stands.
                readDrumFrame(hits, heard.key, heard.time, drumCursor, drumFrame);
                triggers.beats = 0;
                triggers.downbeats = 0;
                triggers.beatAccentGain = 0;
                triggers.downbeatAccentGain = 0;
            }
            const snareStrike = drumHits && drumFrame.snare > drumFrame.kick;
            const state = stepPendoloBeatFx(shared.current.state, triggers, {
                now,
                dt,
                beatPeriod: getBeatFxBeatPeriod(),
                // No sparks off the drum hits: they are the downbeat's, and there are no downbeats here.
                meshPoints: drumHits ? [] : points,
                random: Math.random,
            });
            if (drumHits) {
                // Instant attack, a short fall; a hit as bright as its strength on 时计's decibel curve,
                // the jewels and both dials lit with it, a hat lighting only the tick dial (ticks and ring).
                glow *= Math.exp(-dt / DRUM_GLOW_FALL_SECONDS);
                const hit = Math.max(drumFrame.kick, drumFrame.snare);
                if (hit > 0) {
                    const punch = resolvePendoloWavePunch(hit, 1);
                    glow = Math.max(glow, punch);
                    state.jewelFlare = Math.max(state.jewelFlare, punch);
                    state.smallJewelFlare = Math.max(state.smallJewelFlare, punch);
                    state.tickDialLight = Math.max(state.tickDialLight, punch);
                    state.outerDialLight = Math.max(state.outerDialLight, punch);
                }
                if (snareStrike) {
                    // Struck somewhere off centre: the head tilts that way.
                    const angle = Math.random() * Math.PI * 2;
                    if (drumFrame.snare >= DRUM_TILT_SHARE) Object.assign(tilt, { x: Math.cos(angle), y: Math.sin(angle), amount: drumFrame.snare, at: now });
                } else if (drumFrame.kick > 0) {
                    Object.assign(swell, { amount: drumFrame.kick, at: now });
                    if (drumFrame.kick >= DRUM_SHAKE_SHARE) state.shake = Math.max(state.shake, Math.min(1.5, drumFrame.kick * triggers.downbeatGain));
                }
                if (drumFrame.hat > 0) state.tickDialLight = Math.max(state.tickDialLight, DRUM_HAT_LIGHT * drumFrame.hat);
                if (glow < 0.005) glow = 0;
            }
            const maxRadius = resolvePendoloWaveReach(current);
            const wave = resolvePendoloWave(state, now, current.baseRadius, maxRadius);
            lightPendoloDials(state, wave, current.baseRadius);
            shared.current.active = true;
            shared.current.now = now;
            shared.current.wave = wave;
            waveRadius.set(wave?.radius ?? 0);
            waveBand.set(wave?.band ?? 0);
            waveStrength.set(wave?.strength ?? 0);
            waveX.set(wave?.x ?? 0);
            waveY.set(wave?.y ?? 0);
            haloX.set(drumHits ? 0 : wave?.x ?? 0);
            haloY.set(drumHits ? 0 : wave?.y ?? 0);
            if (drumHits) {
                haloOpacity.set(glow);
                haloScale.set(DRUM_GLOW_SCALE + (1 - DRUM_GLOW_SCALE) * glow);
            } else {
                haloOpacity.set(wave ? resolvePendoloHaloOpacity(state, now) : 0);
                if (wave) haloScale.set(wave.radius / maxRadius);
            }
            const shake = resolvePendoloShake(state, Math.random);
            if (drumHits) {
                // The snare's tilt toward where it struck, on top of a hard kick's shake.
                const since = now - tilt.at;
                const lean = tilt.amount * Math.exp(-DRUM_TILT_DECAY * since) * Math.cos(2 * Math.PI * DRUM_TILT_HZ * since);
                if (Math.abs(lean) >= 0.01) {
                    shake.x += tilt.x * DRUM_TILT_PX * lean;
                    shake.y += tilt.y * DRUM_TILT_PX * lean;
                }
                const grown = now - swell.at;
                const swellNow = swell.amount * Math.exp(-grown / DRUM_BREATH_SECONDS) * Math.cos(2 * Math.PI * DRUM_BREATH_HZ * grown);
                breath.set(Math.abs(swellNow) < 0.01 ? 1 : 1 + DRUM_BREATH * swellNow);
            } else if (breath.get() !== 1) {
                breath.set(1);
            }
            shakeX.set(shake.x);
            shakeY.set(shake.y);
        };
        frame = window.requestAnimationFrame(step);
        return () => {
            window.cancelAnimationFrame(frame);
            rest();
        };
    }, [breath, enabled, haloOpacity, haloScale, shakeX, shakeY, waveBand, waveRadius, waveStrength, waveX, waveY, haloX, haloY]);

    return { shared, waveRadius, waveBand, waveStrength, shakeX, shakeY, haloScale, haloOpacity, waveX, waveY, haloX, haloY, breath, color };
};
