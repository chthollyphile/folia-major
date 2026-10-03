import * as THREE from 'three';
import {
    DIORAMA_PARTICLE_DENSITY_MAX,
    DIORAMA_PARTICLE_DENSITY_MIN,
    DIORAMA_PARTICLE_DENSITY_STEP,
} from '../../../types';
import {
    DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
    DIORAMA_STEP_DISTANCE,
    hashSeed,
    seededUnit,
    type DioramaVec,
} from './cameraPath';
import { type DioramaParticleClusterAnchor } from './dioramaGeometry';
import {
    DIORAMA_PARTICLE_CORRIDOR_RADIUS,
    type DioramaParticleCorridorSpan,
} from './dioramaParticleCorridor';
import { buildDioramaStructuredSurface } from './dioramaParticleSurfaces';
import {
    type BandOnsetSignal,
    type BandOnsetTracker,
    createBandOnsetTracker,
    stepBandOnsetTracker,
    stepEnvelopeToward,
} from '../bandOnsetTracker';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// src/components/visualizer/diorama/dioramaParticleModel.ts
// Builds the deterministic point buffers for BOTH geometry modes (formation clouds and the path tunnel)
// against one shared attribute layout, and owns the shared audio-response shaping + performance cap.
// Keeping one layout means a single shader/material renders whichever mode is active.
export const DIORAMA_MAX_PARTICLE_POINTS = 65536;
// Per-unit point counts are FIXED (they only follow the density slider), NOT divided by how many units
// are currently mounted. That is the fix for the abrupt re-tessellation on every line advance: a given
// cloud/tunnel-section tessellates identically no matter how many neighbours are on screen, so the
// overlapping region is pixel-identical frame to frame and the mounted window can slide without a jump.
const DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER = 1024;
const DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN = 2048;

const FAMILY_INDEX: Record<DioramaParticleClusterAnchor['kind'], number> = {
    box: 0,
    sphere: 1,
    cone: 2,
    torus: 3,
};

// Shared attribute layout consumed by dioramaParticleShaders.ts. Every point carries a base local
// offset from its anchor, a unit displacement direction, the anchor it breathes around, a scale pair,
// a palette/noise phase and a small style triple. Nothing mode-specific leaks into the shader.
export interface DioramaParticleGeometryData {
    positions: Float32Array;   // vec3 base local offset from anchor
    normals: Float32Array;     // vec3 unit displacement direction
    anchors: Float32Array;     // vec3 world centre to translate + pulse around
    // vec3 (uniformScale, yStretch, localRadius). localRadius is the primitive's OWN size in its local
    // units (~0.7 for a cloud lattice, the tunnel radius for the corridor). The shader displaces by a
    // fraction of it, so one amplitude number reads the same on a small cloud and on the tunnel.
    scales: Float32Array;
    phases: Float32Array;      // float palette + ripple phase
    styles: Float32Array;      // vec3 (familyIndex, colorSlot, isFar)
    // vec2 wave coordinate (w1, w2). Neighbouring points get near-identical values, so the shader's
    // coherent travelling-wave field moves them together instead of scattering them independently.
    // Corridor: (longitudinal-along-tunnel, ring-angle). Clouds: (in-cluster plane projections).
    waves: Float32Array;
    pointCount: number;
    pointsPerUnit: number;     // points per cluster (clouds) or per span (corridor)
    /**
     * The coarsest neighbour gap in this buffer, in the unit space the shader reads its ripple field in
     * (radius-normalised for both modes). Drives the shader's wavenumber ceiling - see resolveWaveNumberMax.
     */
    spacing: number;
}

const normalizeDensity = (density: number): number => {
    const clamped = Math.min(DIORAMA_PARTICLE_DENSITY_MAX, Math.max(DIORAMA_PARTICLE_DENSITY_MIN, density));
    return Math.max(
        DIORAMA_PARTICLE_DENSITY_MIN,
        Math.floor(clamped / DIORAMA_PARTICLE_DENSITY_STEP) * DIORAMA_PARTICLE_DENSITY_STEP,
    );
};

/**
 * The shortest wavelength a lattice of this spacing can carry, as a wavenumber (k = 2*PI/wavelength).
 * Four samples per wavelength is the practical floor: at two (true Nyquist) neighbouring points land on
 * opposite phases and a crest reads as scattered dots, which is exactly the artefact we must not produce.
 * Because it is derived from the ACTUAL lattice, the density slider now raises and lowers the detail
 * ceiling honestly instead of us hard-coding a number that only holds at one density.
 */
export const resolveWaveNumberMax = (spacing: number): number => (
    (Math.PI * 2) / Math.max(1e-4, spacing * 4)
);

const allocate = (pointCount: number, pointsPerUnit: number, spacing: number): DioramaParticleGeometryData => ({
    positions: new Float32Array(pointCount * 3),
    normals: new Float32Array(pointCount * 3),
    anchors: new Float32Array(pointCount * 3),
    scales: new Float32Array(pointCount * 3),
    phases: new Float32Array(pointCount),
    styles: new Float32Array(pointCount * 3),
    waves: new Float32Array(pointCount * 2),
    pointCount,
    pointsPerUnit,
    spacing,
});

const writeStyle = (data: DioramaParticleGeometryData, index: number, family: number, colorSlot: number, isFar: number) => {
    const offset = index * 3;
    data.styles[offset] = family;
    data.styles[offset + 1] = colorSlot;
    data.styles[offset + 2] = isFar;
};

/** Expands each visible formation anchor into a deterministic surface lattice (the 'clouds' mode). */
export const buildDioramaCloudGeometryData = (
    clusters: DioramaParticleClusterAnchor[],
    density: number,
): DioramaParticleGeometryData => {
    // The BUDGET stays count-independent (it only follows the density slider), but each welded lattice
    // lands on its own honest point count under it, so the buffer is sized from the surfaces themselves.
    const budget = normalizeDensity(Math.min(density, DIORAMA_MAX_CLOUD_POINTS_PER_CLUSTER));
    const surfaces = clusters.map((cluster) => (
        buildDioramaStructuredSurface(cluster.kind, budget, cluster.stretchY)
    ));
    const pointCount = surfaces.reduce((sum, surface) => sum + surface.count, 0);
    // One shared buffer draws every cluster, so the detail ceiling has to satisfy the COARSEST lattice
    // present - a fine sphere must not be allowed to alias the tetrahedron drawn alongside it.
    const spacing = surfaces.reduce((widest, surface) => Math.max(widest, surface.spacing), 0);
    const data = allocate(pointCount, budget, spacing);

    let target = 0;
    clusters.forEach((cluster, clusterIndex) => {
        const surface = surfaces[clusterIndex];
        const seed = hashSeed(`${cluster.particleSeed}|${cluster.kind}`);
        // One shared phase keeps every vertex of a cluster inside the same coherent ripple field.
        const clusterPhase = seededUnit(seed + 31) * Math.PI * 2;
        const family = FAMILY_INDEX[cluster.kind];
        const isFar = cluster.layer === 'far' ? 1 : 0;
        for (let pointIndex = 0; pointIndex < surface.count; pointIndex += 1, target += 1) {
            const v = target * 3;
            const s = target * 3;
            const px = surface.positions[pointIndex * 3];
            const py = surface.positions[pointIndex * 3 + 1];
            const pz = surface.positions[pointIndex * 3 + 2];
            data.positions[v] = px;
            data.positions[v + 1] = py;
            data.positions[v + 2] = pz;
            data.normals[v] = surface.normals[pointIndex * 3];
            data.normals[v + 1] = surface.normals[pointIndex * 3 + 1];
            data.normals[v + 2] = surface.normals[pointIndex * 3 + 2];
            data.anchors[v] = cluster.position.x;
            data.anchors[v + 1] = cluster.position.y;
            data.anchors[v + 2] = cluster.position.z;
            data.scales[s] = cluster.scale;
            data.scales[s + 1] = cluster.stretchY;
            data.scales[s + 2] = surface.radius;
            data.phases[target] = clusterPhase;
            // Clouds no longer wave off this coordinate - their ripple field is a pure function of
            // position (see the shader). It survives only as the per-point seed the dissolve scatters by,
            // since aPhase alone is constant across a whole cluster.
            data.waves[target * 2] = clusterPhase + (px + pz * 0.6) * 2.2;
            data.waves[target * 2 + 1] = clusterPhase * 0.7 + py * 2.6;
            writeStyle(data, target, family, cluster.colorSlot, isFar);
        }
    });
    return data;
};

const normalizeVec = (x: number, y: number, z: number): DioramaVec => {
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
};

// Ring segment count grows with the per-span budget so the tunnel wall stays evenly tessellated at
// every density without ever exceeding it.
const resolveRingSegments = (pointsPerSpan: number): number => (
    Math.max(12, Math.min(256, Math.round(Math.sqrt(pointsPerSpan * 2.4))))
);

/**
 * Sweeps a regular ring grid straight along the mounted path spans (the 'corridor' mode). Ring centres
 * ride the exact path centres and the radius is constant, so the tunnel is a true cylinder that can
 * never drift, tilt off the path or morph. Deterministic: identical spans yield identical buffers.
 */
export const buildDioramaCorridorGeometryData = (
    spans: DioramaParticleCorridorSpan[],
    density: number,
    radius = DIORAMA_PARTICLE_CORRIDOR_RADIUS,
): DioramaParticleGeometryData => {
    const activeSpans = spans.filter((span) => span.enabled);
    const spanCount = activeSpans.length;
    const pointsPerSpan = normalizeDensity(Math.min(density, DIORAMA_MAX_CORRIDOR_POINTS_PER_SPAN));
    const ringSegments = resolveRingSegments(pointsPerSpan);
    const rings = Math.max(1, Math.floor(pointsPerSpan / ringSegments));
    const perSpan = ringSegments * rings;
    const pointCount = spanCount * perSpan;
    // One span spans DIORAMA_STEP_DISTANCE of path; expressed in radius units (the field's space) that is
    // spanUnits, cut into `rings`. Around, the gap is the ring arc. The coarser of the two is the ceiling.
    const spanUnits = DIORAMA_STEP_DISTANCE / radius;
    const spacing = Math.max(spanUnits / Math.max(1, rings), (Math.PI * 2) / ringSegments);
    const data = allocate(pointCount, perSpan, spacing);

    let target = 0;
    activeSpans.forEach((span) => {
        for (let ring = 0; ring < rings; ring += 1) {
            // Depth along this span; a whole ring shares one centre and basis so it stays circular.
            const t = rings > 1 ? ring / (rings - 1) : 0.5;
            const cx = span.start.x + (span.end.x - span.start.x) * t;
            const cy = span.start.y + (span.end.y - span.start.y) * t;
            const cz = span.start.z + (span.end.z - span.start.z) * t;
            const right = normalizeVec(
                span.startRight.x + (span.endRight.x - span.startRight.x) * t,
                span.startRight.y + (span.endRight.y - span.startRight.y) * t,
                span.startRight.z + (span.endRight.z - span.startRight.z) * t,
            );
            const up = normalizeVec(
                span.startUp.x + (span.endUp.x - span.startUp.x) * t,
                span.startUp.y + (span.endUp.y - span.startUp.y) * t,
                span.startUp.z + (span.endUp.z - span.startUp.z) * t,
            );
            // ABSOLUTE longitudinal (global path coordinate), so the wave phase at a given world section is
            // identical no matter where the mounted window starts - the tunnel never rolls when it slides.
            const longitudinal = span.pathStart + t;
            for (let segment = 0; segment < ringSegments; segment += 1) {
                const angle = (segment / ringSegments) * Math.PI * 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const radial = normalizeVec(
                    right.x * cos + up.x * sin,
                    right.y * cos + up.y * sin,
                    right.z * cos + up.z * sin,
                );
                const v = target * 3;
                const s = target * 3;
                data.positions[v] = radial.x * radius;
                data.positions[v + 1] = radial.y * radius;
                data.positions[v + 2] = radial.z * radius;
                data.normals[v] = radial.x;
                data.normals[v + 1] = radial.y;
                data.normals[v + 2] = radial.z;
                data.anchors[v] = cx;
                data.anchors[v + 1] = cy;
                data.anchors[v + 2] = cz;
                data.scales[s] = 1;
                data.scales[s + 1] = 1;
                // The tunnel's own size, so its swell is the same fraction-of-radius the clouds get.
                data.scales[s + 2] = radius;
                // Phase carries NO angular term. It used to be `longitudinal * 1.7 + angle * 0.35`, and
                // since angle jumps 2*PI back to 0 at the seam, that alone stepped the phase by 2.2 rad
                // there - which the whole-body sway below then turned into a visible ring-wide offset. A
                // ring shares one phase now, so it sways as one rigid ring, which is what a tunnel does.
                data.phases[target] = longitudinal * 1.7;
                // Wave coordinate = (along the tunnel, angle around it), the tunnel's surface parameters.
                // `along` is in RADIUS UNITS so it is the same unit space the clouds' field lives in and
                // one set of ripple parameters drives both modes. The angle stays raw; the shader wraps it
                // (see corridorSurfaceDelta) rather than us baking a discontinuity into the buffer.
                data.waves[target * 2] = longitudinal * spanUnits;
                data.waves[target * 2 + 1] = angle;
                // A slow colour band alternates along the tunnel so loud regions read as coloured waves.
                // Keyed off the absolute path coordinate so the banding is stable as the window slides.
                writeStyle(data, target, 3, (Math.round(span.pathStart) + ring) % 2, 0);
                target += 1;
            }
        }
    });
    return data;
};

/** Single draw-call geometry for either mode; the owner disposes it when replaced or unmounted. */
export const createDioramaBufferGeometry = (data: DioramaParticleGeometryData): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('aAnchor', new THREE.BufferAttribute(data.anchors, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(data.scales, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(data.phases, 1));
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(data.styles, 3));
    geometry.setAttribute('aWave', new THREE.BufferAttribute(data.waves, 2));
    geometry.setDrawRange(0, data.pointCount);
    return geometry;
};

// 频段起音检测已提到公共层（波环的「重拍透视」也要用），这里只保留 diorama 的别名，
// 让本模块原有的导出与调用点一个都不用改。
export type DioramaBandTracker = BandOnsetTracker;
export type DioramaBandSignal = BandOnsetSignal;
export const createDioramaBandTracker = createBandOnsetTracker;
export const stepDioramaBandTracker = stepBandOnsetTracker;
export const stepDioramaEnvelope = stepEnvelopeToward;

/**
 * Each band spawns its OWN SCALE of ripple, so a track never reads as one size of bump at one speed:
 * bass throws slow, wide, long-wavelength swells across the whole shape; treble flicks small, fast, tight
 * ones. Widths and speeds are in units of the geometry's own radius, and the corridor's surface distance
 * is measured in the same units, so one set of numbers drives both modes.
 *
 * Strengths are stated BEFORE the packet's own envelopes, which measurably swallow ~80% of them (the
 * Gaussian width, the age decay and the distance decay all multiply in), so they read far higher than the
 * swell they actually produce - a peak here lands near a full-strength wavefront, not 4x one.
 *
 * Wavenumbers are a REQUEST, not a promise: the shader clamps each against the buffer's real lattice
 * spacing (uWaveNumberMax), because a wavelength under ~4 lattice steps puts neighbouring points on
 * opposite phases and the crest breaks into what reads as random scatter. The bands stay distinct through
 * speed, width and strength regardless, which is where the difference actually shows anyway.
 */
export const RIPPLE_BANDS = [
    { band: 'bass' as const, strength: 1.45, speed: 0.9, width: 0.66, wavenumber: 3.4 },
    { band: 'mid' as const, strength: 0.9, speed: 1.6, width: 0.36, wavenumber: 5.5 },
    { band: 'treble' as const, strength: 0.5, speed: 2.5, width: 0.22, wavenumber: 9 },
];

/**
 * Slots each band owns in the pool. Round-robin across ONE shared pool let a busy hi-hat evict a bass
 * swell that was still at full height - a pop. With a private range, a ripple can only ever be replaced
 * by the next ripple of its OWN band, so a bass wave lives ~3 kicks (well past its own decay) whatever
 * the treble is doing. This is also the cap on new sources per unit time that the geometry can carry.
 */
export const RIPPLE_SLOTS_PER_BAND = 3;

/**
 * Live ripple sources carried at once. DERIVED, never written by hand: the shader's uniform array, the
 * material's uniform buffers and the CPU pool must all be this long, and a band spawning at slot
 * `bandIndex * RIPPLE_SLOTS_PER_BAND + cursor` indexes straight into it. A hand-written count that
 * disagreed with the bands would put a whole band's writes past the end of the Float32Array, where
 * TypedArrays swallow them silently - no error, no crash, just a band that stops moving the geometry.
 * Deriving it means adding a band or a slot cannot desynchronise anything.
 */
export const DIORAMA_RIPPLE_COUNT = RIPPLE_BANDS.length * RIPPLE_SLOTS_PER_BAND;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
    const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return amount * amount * (3 - 2 * amount);
};

export interface DioramaParticleAudioResponse {
    flowSpeed: number;
    clusterPulse: number;
}

/**
 * The two whole-body behaviours, each fed by the signal that actually belongs to it: the tunnel's drift
 * rides SUSTAINED bass (a loud passage moves the world along), while the beat scale rides the TRANSIENT
 * (a kick is an event, not a level). Feeding the pulse a sustained value would hold it up through a loud
 * passage and erase the beat, which is the same mistake the old baseline made one layer down.
 */
export const resolveDioramaParticleAudioResponse = (
    bass: DioramaBandSignal,
    mid: DioramaBandSignal,
): DioramaParticleAudioResponse => ({
    flowSpeed: Math.min(1.55, 0.3 + clamp01(bass.sustained) * 1.25),
    // A gentle whole-body breath on the beat - deliberately small so the wave field, not an overall scale
    // pump, carries the motion (the previous 1.44 pump read as "too exaggerated").
    clusterPulse: Math.min(
        DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
        1 + smoothstep(0.1, 0.9, bass.transient) * 0.14 + smoothstep(0.15, 0.95, mid.transient) * 0.05,
    ),
});

/**
 * How much of the whole-body beat pulse the CORRIDOR keeps. The shader applies uPulse as
 * `displaced *= aScale.x * uPulse` - a uniform scale of every point's offset from its anchor, which on a
 * cylinder is exactly the radius. A cluster of clouds pulsing on the beat reads as a cluster breathing;
 * a tunnel doing it pumps its whole wall in and out at once, AROUND the camera, which reads as the
 * corridor mechanically contracting. Measured on this chain: the wall swung 9.2% of its radius per kick
 * at an audio response of 1.0, and 13.8% (1.02 world units) at 1.5.
 *
 * The corridor's amplitude belongs to its ripple field, which is local by construction. This keeps a
 * trace so the tunnel is not inert between hits, while leaving the MEAN radius effectively where it is -
 * the beat is carried by crests travelling across the wall, not by moving the wall.
 */
export const DIORAMA_CORRIDOR_PULSE_SHARE = 0.12;

/**
 * The whole-body scale the beat asks for this frame, per mode. Kept whole for the clouds; on the
 * corridor only DIORAMA_CORRIDOR_PULSE_SHARE of it survives.
 */
export const resolveDioramaPulseTarget = (
    clusterPulse: number,
    gain: number,
    isCorridor: boolean,
): number => 1 + (clusterPulse - 1) * gain * (isCorridor ? DIORAMA_CORRIDOR_PULSE_SHARE : 1);

export interface DioramaParticleElasticState {
    value: number;
    velocity: number;
}

export const createDioramaParticleElasticState = (): DioramaParticleElasticState => ({
    value: 1,
    velocity: 0,
});

/**
 * An under-damped spring so a beat lands as a bounce that overshoots and settles, not a stiff snap or a
 * dead value. The wide range (down to 0.9, up to the audio scale cap) is what restores the "elastic"
 * feel the previous over-clamped version had lost.
 */
export const stepDioramaParticleElasticResponse = (
    state: DioramaParticleElasticState,
    target: number,
    delta: number,
): number => {
    let remaining = Math.min(0.1, Math.max(0, delta));
    const safeTarget = Math.min(DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, target));
    while (remaining > 0) {
        const step = Math.min(1 / 240, remaining);
        const acceleration = (safeTarget - state.value) * 150 - state.velocity * 15;
        state.velocity += acceleration * step;
        state.value += state.velocity * step;
        remaining -= step;
    }
    state.value = Math.min(DIORAMA_PARTICLE_AUDIO_SCALE_MAX, Math.max(0.9, state.value));
    return state.value;
};
