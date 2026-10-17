import { useEffect, useMemo, useRef } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import { getBeatFxBeatPeriod, isBeatFxReady } from '../../../services/beatFx/beatFxLive';
import {
    createPendoloBeatCounter,
    createPendoloBeatFxState,
    lightPendoloDials,
    readPendoloBeatTriggers,
    resolvePendoloHaloOpacity,
    resolvePendoloBeatFxColor,
    resolvePendoloShake,
    resolvePendoloWave,
    stepPendoloBeatFx,
    type PendoloBeatFxState,
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
    /** The effect colour, 0..255. */
    color: [number, number, number];
}

/** How far the shockwave (and its halo) reaches: past the far corner of the viewport, wherever the wheel sits. */
export const resolvePendoloWaveReach = (layout: PendoloBeatFxLayout): number => Math.hypot(
    Math.max(layout.centerX, layout.viewportWidth - layout.centerX),
    Math.max(layout.centerY, layout.viewportHeight - layout.centerY),
) * 1.05;

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
            for (const value of [waveRadius, waveBand, waveStrength, shakeX, shakeY, haloScale, haloOpacity]) {
                if (value.get() !== 0) value.set(0);
            }
        };
        if (!enabled) {
            rest();
            return undefined;
        }
        const counter = createPendoloBeatCounter();
        const triggers = readPendoloBeatTriggers(counter);
        let last: number | null = null;
        let frame = 0;
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
            const state = stepPendoloBeatFx(shared.current.state, triggers, {
                now,
                dt,
                beatPeriod: getBeatFxBeatPeriod(),
                meshPoints: points,
                random: Math.random,
            });
            const maxRadius = resolvePendoloWaveReach(current);
            const wave = resolvePendoloWave(state, now, current.baseRadius, maxRadius);
            lightPendoloDials(state, wave, current.baseRadius);
            shared.current.active = true;
            shared.current.now = now;
            shared.current.wave = wave;
            waveRadius.set(wave?.radius ?? 0);
            waveBand.set(wave?.band ?? 0);
            waveStrength.set(wave?.strength ?? 0);
            haloOpacity.set(wave ? resolvePendoloHaloOpacity(state, now) : 0);
            if (wave) haloScale.set(wave.radius / maxRadius);
            const shake = resolvePendoloShake(state, Math.random);
            shakeX.set(shake.x);
            shakeY.set(shake.y);
        };
        frame = window.requestAnimationFrame(step);
        return () => {
            window.cancelAnimationFrame(frame);
            rest();
        };
    }, [enabled, haloOpacity, haloScale, shakeX, shakeY, waveBand, waveRadius, waveStrength]);

    return { shared, waveRadius, waveBand, waveStrength, shakeX, shakeY, haloScale, haloOpacity, color };
};
