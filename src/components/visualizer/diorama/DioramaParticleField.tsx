import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands, type DioramaGeometryMode } from '../../../types';
import { DIORAMA_STEP_DISTANCE, hashSeed, seededUnit } from './cameraPath';
import { type DioramaParticleClusterAnchor } from './dioramaGeometry';
import {
    DIORAMA_PARTICLE_CORRIDOR_RADIUS,
    type DioramaParticleCorridorSpan,
} from './dioramaParticleCorridor';
import {
    buildDioramaCloudGeometryData,
    buildDioramaCorridorGeometryData,
    createDioramaBufferGeometry,
    createDioramaBandTracker,
    createDioramaParticleElasticState,
    DIORAMA_RIPPLE_COUNT,
    resolveDioramaParticleAudioResponse,
    resolveDioramaPulseTarget,
    resolveWaveNumberMax,
    RIPPLE_BANDS,
    RIPPLE_SLOTS_PER_BAND,
    stepDioramaBandTracker,
    stepDioramaEnvelope,
    stepDioramaParticleElasticResponse,
    type DioramaBandSignal,
} from './dioramaParticleModel';
import {
    createDioramaBeatCounter,
    DIORAMA_BEAT_RIPPLE_STRENGTH,
    DIORAMA_DOWNBEAT_RIPPLE_STRENGTH,
    resolveDioramaBeatClusterPulse,
    stepDioramaBeatCounter,
} from './dioramaBeatRipples';
import { beatImpact, downbeatImpact } from '../../../stores/motionSignals';
import { getBeatFxFiredCounts, getBeatFxIntensities, isBeatFxReady } from '../../../services/beatFx/beatFxLive';
import {
    createDioramaParticleGlowMaterial,
    createDioramaParticleMaterial,
    lerpDioramaParticleMaterialColors,
    resolveDioramaParticleContrastColors,
} from './dioramaParticleMaterials';

// src/components/visualizer/diorama/DioramaParticleField.tsx
// Renders the active geometry mode as one deterministic, self-lit Points draw call plus an optional
// additive glow pass over the same buffer. Audio comes straight from the app's shared bands (the same
// source every other visualizer reads), smoothed with the project's standard fast-attack/slow-release
// envelope - no custom compressor or beat analysis of its own. All reads land on shader uniforms; React
// state never participates frame-by-frame, and the camera is never read into the audio path.
// Under 智能动感模式, once the track's beats are in, beat_this' beats spawn the bass and mid ripples
// and drive the breath instead (dioramaBeatRipples.ts); the treble ripples stay on the band.
interface DioramaParticleFieldProps {
    mode: DioramaGeometryMode;
    clusters: DioramaParticleClusterAnchor[];
    corridorSpans: DioramaParticleCorridorSpan[];
    density: number;
    particleGlowEnabled: boolean;
    particleGlowIntensity: number;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    audioLevel: number;
    primaryColor: string;
    accentColor: string;
    secondaryColor: string;
    backgroundColor: string;
    /** True while a real 3D song-change/loop flight is in progress (the camera has NOT locked on yet). */
    transitionActive: boolean;
    /**
     * The read-head's global line index. The corridor is tens of world units long, so a ripple spawned at
     * an arbitrary point down it would simply never be seen; its sources are placed just ahead of here.
     * Changes once per lyric line, never per frame.
     */
    readHeadLine: number;
    /** Changes on song/round switch so the smoothed audio state restarts cleanly. */
    resetKey: string;
}

/**
 * The pool of live ripple sources. This IS the audio->geometry boundary: a band onset writes one entry
 * here and then never touches the surface again - the shader propagates and settles it on its own clock.
 * That is what makes the motion elastic rather than a per-frame redraw of the current band values.
 */
interface RipplePool {
    /**
     * vec4 per source, w = birth time on the flow clock. xyz is read in the active mode's space:
     * clouds = a point on the shape's unit sphere; corridor = (along, angle) on the tunnel wall.
     */
    sources: Float32Array;
    /** vec4 per source: strength, speed, packet width, wavenumber. */
    shapes: Float32Array;
    /** Per-band round-robin cursor within that band's slot range. */
    cursor: number[];
    /** Monotonic counter that seeds each spawn deterministically. */
    spawned: number;
}

const createRipplePool = (): RipplePool => ({
    sources: new Float32Array(DIORAMA_RIPPLE_COUNT * 4),
    shapes: new Float32Array(DIORAMA_RIPPLE_COUNT * 4),
    cursor: RIPPLE_BANDS.map(() => 0),
    spawned: 0,
});

/** The tunnel's along-coordinate, per lyric line, in radius units - the space aWave.x is baked in. */
const CORRIDOR_UNITS_PER_LINE = DIORAMA_STEP_DISTANCE / DIORAMA_PARTICLE_CORRIDOR_RADIUS;

/**
 * Writes one source and varies its height, width, reach and speed around its band's character -
 * deterministically, never Math.random. Clouds get a point on the unit sphere (where `position /
 * localRadius` lives, so it lands on the surface whatever the primitive); the corridor gets a spot on the
 * wall just ahead of the read-head, at a seeded angle round the ring.
 */
const spawnRipple = (
    pool: RipplePool,
    bandIndex: number,
    strength: number,
    now: number,
    corridor: boolean,
    readHeadAlong: number,
) => {
    const seed = hashSeed(`diorama-ripple:${pool.spawned}`);
    const preset = RIPPLE_BANDS[bandIndex];
    const height = seededUnit(seed + 1);
    const spread = seededUnit(seed + 2);
    const pace = seededUnit(seed + 3);
    const cursor = pool.cursor[bandIndex];
    const offset = (bandIndex * RIPPLE_SLOTS_PER_BAND + cursor) * 4;

    if (corridor) {
        // Ahead of the read-head by 0.4..2.6 radius units (~3..19 world units), i.e. in front of the
        // camera rather than behind it, so the crest opens into view and then sweeps past.
        pool.sources[offset] = readHeadAlong + 0.4 + seededUnit(seed + 4) * 2.2;
        pool.sources[offset + 1] = seededUnit(seed + 5) * Math.PI * 2;
        pool.sources[offset + 2] = 0;
    } else {
        // An even point on the unit sphere.
        const up = seededUnit(seed + 4) * 2 - 1;
        const around = seededUnit(seed + 5) * Math.PI * 2;
        const ring = Math.sqrt(Math.max(0, 1 - up * up));
        pool.sources[offset] = ring * Math.cos(around);
        pool.sources[offset + 1] = up;
        pool.sources[offset + 2] = ring * Math.sin(around);
    }
    pool.sources[offset + 3] = now;
    pool.shapes[offset] = preset.strength * strength * (0.7 + height * 0.6);
    pool.shapes[offset + 1] = preset.speed * (0.8 + pace * 0.45);
    pool.shapes[offset + 2] = preset.width * (0.78 + spread * 0.5);
    pool.shapes[offset + 3] = preset.wavenumber;

    pool.cursor[bandIndex] = (cursor + 1) % RIPPLE_SLOTS_PER_BAND;
    pool.spawned += 1;
};

// Seconds the camera must stay locked on the current lyric before the corridor starts gathering back.
const FORMATION_SETTLE_SECONDS = 0.4;

// Displacement is a FRACTION of each geometry's own radius (see the shader), so every number here reads
// the same on a 0.7-unit cloud and on the radius-7.4 tunnel. These are the swell at an audio-response of
// 1.0; the slider scales them, which is the ONLY place it applies (see the gain note in useFrame).
const CLOUD_SWELL = 0.34;
// The tunnel needs more: a radial swell of up to 0.45 radius (~2.8 world units) reads clearly from inside
// it, where a world-constant number moved the wall ~0.6 units and was simply invisible.
const CORRIDOR_MAX_SWELL = 0.45;
const CORRIDOR_QUIET_SWELL = 0.1;
/**
 * The wave value a full-strength wavefront actually reaches (measured on the GPU, not assumed - the
 * packet's Gaussian, age and distance envelopes multiply most of the nominal strength away).
 */
const MAX_WAVE = 0.85;
/**
 * The DISPLACEMENT that counts as full reach for size/colour/glow, per mode. A constant, so the gradient
 * from a crest outward keeps its shape; and because d is measured against real displacement, an audio
 * response of 0 means no motion AND no glow, rather than a still surface that still lights up.
 */
const CLOUD_MAX_SWELL = MAX_WAVE * CLOUD_SWELL;
const CORRIDOR_MAX_SWELL_REACH = MAX_WAVE * CORRIDOR_MAX_SWELL;

export const DioramaParticleField: React.FC<DioramaParticleFieldProps> = ({
    mode,
    clusters,
    corridorSpans,
    density,
    particleGlowEnabled,
    particleGlowIntensity,
    currentTime,
    audioBands,
    audioLevel,
    primaryColor,
    accentColor,
    secondaryColor,
    backgroundColor,
    transitionActive,
    readHeadLine,
    resetKey,
}) => {
    // The buffer and the detail ceiling its lattice can carry come from one build - the shader must clamp
    // wave detail against the lattice it is actually drawing, so raising density genuinely buys finer
    // ripples instead of aliasing them into scatter.
    const built = useMemo(() => {
        const data = mode === 'corridor'
            ? buildDioramaCorridorGeometryData(corridorSpans, density)
            : buildDioramaCloudGeometryData(clusters, density);
        return {
            geometry: createDioramaBufferGeometry(data),
            waveNumberMax: resolveWaveNumberMax(data.spacing),
        };
    }, [mode, clusters, corridorSpans, density]);
    const { geometry, waveNumberMax } = built;
    const targetColors = useMemo(() => resolveDioramaParticleContrastColors({
        primary: new THREE.Color(primaryColor),
        accent: new THREE.Color(accentColor),
        secondary: new THREE.Color(secondaryColor),
    }, new THREE.Color(backgroundColor)), [primaryColor, accentColor, secondaryColor, backgroundColor]);
    // Materials are created ONCE; their colours chase the theme via lerp each frame (see useFrame), and
    // the glow intensity is pushed by the effect below. Lazy refs, not useMemo: useMemo is a cache React
    // is explicitly allowed to discard and rebuild, and these own GPU resources - "must exist exactly
    // once" is a lifetime, not a performance hint. This is React's own documented pattern for it.
    const materialRef = useRef<ReturnType<typeof createDioramaParticleMaterial> | null>(null);
    if (materialRef.current === null) materialRef.current = createDioramaParticleMaterial(targetColors);
    const material = materialRef.current;
    const glowMaterialRef = useRef<ReturnType<typeof createDioramaParticleGlowMaterial> | null>(null);
    if (glowMaterialRef.current === null) {
        glowMaterialRef.current = createDioramaParticleGlowMaterial(targetColors, particleGlowIntensity);
    }
    const glowMaterial = glowMaterialRef.current;
    // One valley/peak tracker per band. These are what keep a steady beat reading as a beat for the whole
    // song instead of fading into the background - see stepDioramaBandTracker.
    const trackersRef = useRef(RIPPLE_BANDS.map(() => createDioramaBandTracker()));
    // 智能动感模式: the beat clock's fired counts as of the last frame.
    const beatCounterRef = useRef(createDioramaBeatCounter());
    const ripplesRef = useRef<RipplePool>(createRipplePool());
    const flowTimeRef = useRef(0);
    const previousPlaybackTimeRef = useRef<number | null>(null);
    const drawingBufferSizeRef = useRef(new THREE.Vector2());
    const elasticStateRef = useRef(createDioramaParticleElasticState());
    // 1 = formed, 0 = dispersed. Falls while the transition flight runs, gathers back once the camera has
    // locked on to the new scene's lyric and held it for FORMATION_SETTLE_SECONDS.
    const formationRef = useRef(1);
    const lockedSecondsRef = useRef(FORMATION_SETTLE_SECONDS);

    useEffect(() => () => { geometry.dispose(); }, [geometry]);
    useEffect(() => () => {
        material.dispose();
        glowMaterial.dispose();
    }, [glowMaterial, material]);

    useEffect(() => {
        glowMaterial.uniforms.uGlow.value = particleGlowIntensity;
    }, [glowMaterial, particleGlowIntensity]);

    useEffect(() => {
        previousPlaybackTimeRef.current = null;
        elasticStateRef.current = createDioramaParticleElasticState();
        ripplesRef.current = createRipplePool();
        // A new song has its own loudness; the trackers must re-prime onto it rather than carry the last
        // song's floor and peak across (which would mis-read the first seconds in both directions).
        trackersRef.current = RIPPLE_BANDS.map(() => createDioramaBandTracker());
        beatCounterRef.current = createDioramaBeatCounter();
    }, [resetKey]);

    useFrame((frameState, rawDelta) => {
        const delta = Math.min(rawDelta, 0.1);
        // Project-standard shared 0..255 bands, normalised. The audio-response slider is DELIBERATELY not
        // applied here: it used to multiply the bands before onset detection, where it scaled the signal
        // and the reference it was compared against by the same factor - so it barely reached the ripples,
        // and past a point made them WORSE by saturating the bands. Detection stays loudness-invariant and
        // the slider applies once, at the output, as `gain` below.
        const bassTarget = Math.min(1, audioBands.bass.get() / 255);
        const midTarget = Math.min(1, (audioBands.lowMid.get() * 0.5 + audioBands.mid.get() * 0.5) / 255);
        const trebleTarget = Math.min(1, audioBands.treble.get() / 255);
        const trackers = trackersRef.current;
        const bass = stepDioramaBandTracker(trackers[0], bassTarget, delta);
        const mid = stepDioramaBandTracker(trackers[1], midTarget, delta);
        const treble = stepDioramaBandTracker(trackers[2], trebleTarget, delta);
        const bands: DioramaBandSignal[] = [bass, mid, treble];
        const response = resolveDioramaParticleAudioResponse(bass, mid);
        // Stepped every frame, ready or not, so the counts are current the frame the beats arrive.
        const beatTriggers = stepDioramaBeatCounter(beatCounterRef.current, getBeatFxFiredCounts());
        const beatFxActive = isBeatFxReady();
        // The one place the slider lands. 0 disables the audio response entirely; 1 is the designed feel;
        // the top of the range genuinely overdrives it, because it scales the DISPLACEMENT rather than a
        // detection threshold that was already saturated.
        const gain = Math.max(0, audioLevel);

        // Flow time advances with playback (not wall-clock), so a pause freezes drift and a seek/loop
        // jumps rather than smears. Bass accelerates the flow - the music drives the world.
        const playbackTime = Math.max(0, currentTime.get());
        const previousPlaybackTime = previousPlaybackTimeRef.current;
        const playbackDelta = previousPlaybackTime == null ? 0 : playbackTime - previousPlaybackTime;
        const playbackDiscontinuity = previousPlaybackTime == null
            || playbackDelta < -0.05
            || playbackDelta > 0.5;
        if (playbackDiscontinuity) {
            flowTimeRef.current = playbackTime * 0.28;
            // Ripples carry a birth time on this clock, so a seek/loop would otherwise leave sources
            // "born in the future" (or aged by hours) and freeze the surface.
            ripplesRef.current = createRipplePool();
        } else if (playbackDelta > 0) {
            flowTimeRef.current += playbackDelta * response.flowSpeed;
        }
        previousPlaybackTimeRef.current = playbackTime;

        // AUDIO -> GEOMETRY, the only crossing point: a hit crossing its band's trigger spawns ONE ripple
        // of that band's scale, then the shader owns the motion. Nothing downstream reads a band value per
        // frame, which is why the surface cannot twitch or jump. The trigger is a rising edge with
        // hysteresis, so one hit is one ripple - not a new source every frame the band happens to be loud.
        const pool = ripplesRef.current;
        const isCorridor = mode === 'corridor';
        const readHeadAlong = readHeadLine * CORRIDOR_UNITS_PER_LINE;
        if (gain > 0.001) {
            bands.forEach((signal, index) => {
                if (!signal.onset) return;
                // With the beats in, they spawn the bass and mid scales; only treble stays on its band.
                if (beatFxActive && index < 2) return;
                spawnRipple(pool, index, signal.transient, flowTimeRef.current, isCorridor, readHeadAlong);
            });
            if (beatFxActive) {
                const intensities = getBeatFxIntensities();
                if (beatTriggers.downbeat && intensities.downbeat > 0) {
                    spawnRipple(pool, 0, DIORAMA_DOWNBEAT_RIPPLE_STRENGTH * intensities.downbeat, flowTimeRef.current, isCorridor, readHeadAlong);
                }
                if (beatTriggers.beat && intensities.beat > 0) {
                    spawnRipple(pool, 1, DIORAMA_BEAT_RIPPLE_STRENGTH * intensities.beat, flowTimeRef.current, isCorridor, readHeadAlong);
                }
            }
        }

        // The corridor keeps only a trace of the whole-body pulse (see DIORAMA_CORRIDOR_PULSE_SHARE): its
        // motion is the ripple field's, and a uniform scale here pumps the whole tunnel wall around the
        // camera. The clouds keep it in full - a cluster breathing on the beat is the point there.
        const elasticPulse = stepDioramaParticleElasticResponse(
            elasticStateRef.current,
            resolveDioramaPulseTarget(
                beatFxActive ? resolveDioramaBeatClusterPulse(beatImpact.get(), downbeatImpact.get()) : response.clusterPulse,
                gain,
                isCorridor,
            ),
            delta,
        );
        frameState.gl.getDrawingBufferSize(drawingBufferSizeRef.current);
        const colorAmount = 1 - Math.exp(-1.2 * delta);

        // Disperse while the transition flight runs; only gather back once the camera has locked on to the
        // current lyric and held it briefly - so a new corridor forms out of the scattered points.
        lockedSecondsRef.current = transitionActive
            ? 0
            : Math.min(FORMATION_SETTLE_SECONDS, lockedSecondsRef.current + delta);
        const formationTarget = !transitionActive && lockedSecondsRef.current >= FORMATION_SETTLE_SECONDS ? 1 : 0;
        formationRef.current = stepDioramaEnvelope(formationRef.current, formationTarget, 1.5, 3.2, delta);

        // Both modes' dynamics now live in the ripple strengths, so the swell is a fixed conversion from
        // wave to displacement. The corridor keeps a floor plus a slow lift on sustained energy so its
        // walls still breathe with the track between hits, and the geometry-independent `gain` is the
        // slider - the whole of the slider's effect, in one multiply.
        const amplitude = gain * (isCorridor
            ? Math.min(CORRIDOR_MAX_SWELL, CORRIDOR_QUIET_SWELL + bass.sustained * 0.18 + mid.sustained * 0.08)
            : CLOUD_SWELL);
        const flow = isCorridor ? 1 : 0;
        const scatterDistance = isCorridor ? 6 : 1.4;
        // Bigger, sparser points on the tunnel wall (the reference's cylinder uses size 2 vs the box 1.1).
        const sizeBase = isCorridor ? 0.072 : 0.05;
        // The corridor's swell rarely saturates, so pow(d,3) needs a bigger gain for a rolling region to
        // visibly thicken and brighten - that growth is the reference's real signature, not the travel.
        const sizeGain = isCorridor ? 0.34 : 0.3;
        // A simple brightness proxy from treble drives the palette's hot-colour shift (no spectral analysis).
        const centroid = Math.min(1, 0.2 + treble.sustained * 0.8);
        const viewportHeight = drawingBufferSizeRef.current.y;

        for (const target of [material, glowMaterial]) {
            const u = target.uniforms;
            u.uTime.value = flowTimeRef.current;
            u.uCorridor.value = isCorridor ? 1 : 0;
            u.uAmplitude.value = amplitude;
            u.uMaxSwell.value = isCorridor ? CORRIDOR_MAX_SWELL_REACH : CLOUD_MAX_SWELL;
            u.uWaveNumberMax.value = waveNumberMax;
            // Sustained treble sets how much fine texture rides the crests. The shader gates it by the
            // swell already present, so this can only detail an existing wave, never speckle a still one.
            u.uDetail.value = Math.min(1, treble.sustained * gain);
            u.uRippleSource.value = pool.sources;
            u.uRippleShape.value = pool.shapes;
            u.uOffsetGain.value = mid.sustained * gain;
            u.uFlow.value = flow;
            u.uFormation.value = formationRef.current;
            u.uScatter.value = scatterDistance;
            u.uSizeBase.value = sizeBase;
            u.uSizeGain.value = sizeGain;
            u.uPulse.value = elasticPulse;
            u.uSpectralCentroid.value = centroid;
            u.uViewportHeight.value = viewportHeight;
            lerpDioramaParticleMaterialColors(target, targetColors, colorAmount);
        }
    });

    return (
        <>
            {particleGlowEnabled && (
                <points
                    geometry={geometry}
                    material={glowMaterial}
                    frustumCulled={false}
                    renderOrder={3}
                />
            )}
            <points
                geometry={geometry}
                material={material}
                frustumCulled={false}
                renderOrder={4}
            />
        </>
    );
};
