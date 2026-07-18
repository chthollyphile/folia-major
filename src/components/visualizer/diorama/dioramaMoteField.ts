import {
    DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    DIORAMA_MOTE_CIRCUMFERENCE_MIN,
    DIORAMA_MOTE_RADIAL_MAX,
    DIORAMA_MOTE_RADIAL_MIN,
    DEFAULT_DIORAMA_TUNING,
} from '../../../types';
import {
    composeLocal,
    DIORAMA_STEP_DISTANCE,
    hashSeed,
    seededUnit,
    type DioramaFrame,
} from './cameraPath';

// src/components/visualizer/diorama/dioramaMoteField.ts
// The background mote field: fine dust drifting through the corridor, giving the flight something to
// parallax against.
//
// It is a SLIDING WINDOW, not a song. The field this replaced laid every line of the whole song out at
// once into one static buffer, which put the camera in the wrong place twice over: nothing was ever near
// it (six motes per 8-unit step, so ~5 in the whole 5-15 unit band), while the far end of the path -
// dozens of lines, hundreds of motes - stacked up behind perspective into a single bright knot. Both
// symptoms were the same buffer seen from its two ends.
//
// So: only a short window of lines around the read head is ever resident, in a RING BUFFER keyed by line
// index (slot = line mod WINDOW). As the read head advances, the line falling off the back is overwritten
// in place by the line entering at the front - that is the whole recycling mechanism, and it costs one
// line's worth of writes per line advance. Nothing outside the window exists to clump.
//
// The window's ends are chosen so that recycling is never SEEN: a line is born at +5 (40 units ahead,
// past the fog's 30-unit reach, so it fades up out of the haze) and retired at -3 (24 units behind the
// camera, out of frustum). Fog is load-bearing for that - see DioramaScene's scene.fog.

/** Lines of motes kept resident behind / ahead of the read head. */
export const DIORAMA_MOTE_LINES_BEHIND = 2;
export const DIORAMA_MOTE_LINES_AHEAD = 5;
export const DIORAMA_MOTE_WINDOW_LINES = DIORAMA_MOTE_LINES_BEHIND + DIORAMA_MOTE_LINES_AHEAD + 1;

/** Worst-case points the layer can ever draw - the density cap's whole reason for existing. */
export const DIORAMA_MOTE_MAX_POINTS = DIORAMA_MOTE_WINDOW_LINES
    * DIORAMA_MOTE_CIRCUMFERENCE_MAX * DIORAMA_MOTE_RADIAL_MAX;

/** Clamp a requested 圆周 count (motes around each ring) into its safe range. */
export const resolveDioramaMoteCircumference = (requested: number): number => Math.round(Math.min(
    DIORAMA_MOTE_CIRCUMFERENCE_MAX,
    Math.max(
        DIORAMA_MOTE_CIRCUMFERENCE_MIN,
        Number.isFinite(requested) ? requested : DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    ),
));

/** Clamp a requested 径向 count (layers across the shell thickness) into its safe range. */
export const resolveDioramaMoteRadial = (requested: number): number => Math.round(Math.min(
    DIORAMA_MOTE_RADIAL_MAX,
    Math.max(
        DIORAMA_MOTE_RADIAL_MIN,
        Number.isFinite(requested) ? requested : DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    ),
));

/** Motes drawn per line = 圆周 x 径向, both already clamped. */
export const resolveDioramaMoteCount = (circumference: number, radial: number): number =>
    resolveDioramaMoteCircumference(circumference) * resolveDioramaMoteRadial(radial);

/** Which ring-buffer slot a line owns. Consecutive lines always land in distinct slots. */
export const dioramaMoteSlot = (line: number): number => (
    ((line % DIORAMA_MOTE_WINDOW_LINES) + DIORAMA_MOTE_WINDOW_LINES) % DIORAMA_MOTE_WINDOW_LINES
);

// Motes sit in an elliptical shell around the path axis. The inner clearance is what keeps them off the
// lyrics and out of the camera's own rail - the camera flies down the axis and the text hangs near it, so
// an empty tube around it is the whole "don't obscure, don't sit dead ahead" rule. The outer radius stays
// inside the corridor's 7.4 wall, so in corridor mode the dust reads as air inside the tunnel.
const MOTE_INNER_RADIUS = 2.4;
const MOTE_RADIAL_SPAN = 5.2;
const MOTE_VERTICAL_SQUASH = 0.64;

/**
 * Radical inverse (van der Corput) - a low-discrepancy sequence that is stratified but NOT correlated
 * with the linear order of the index. Depth needs that: radius already ramps with `p`, so drawing depth
 * from `p` too would rake every line's motes into a visible helix instead of a cloud.
 */
const radicalInverse = (index: number, base: number): number => {
    let result = 0;
    let fraction = 1 / base;
    let i = index;
    while (i > 0) {
        result += (i % base) * fraction;
        i = Math.floor(i / base);
        fraction /= base;
    }
    return result;
};

/**
 * Straight procedural extension of a path frame, `steps` lines past its own position. The path's frames
 * only exist where lyrics do; this carries the same heading onward so a field (or a tunnel) can keep
 * going past the last line instead of ending on a cut.
 */
export const extendDioramaFrame = (frame: DioramaFrame, steps: number): DioramaFrame => (steps === 0 ? frame : {
    position: {
        x: frame.position.x + frame.forward.x * DIORAMA_STEP_DISTANCE * steps,
        y: frame.position.y + frame.forward.y * DIORAMA_STEP_DISTANCE * steps,
        z: frame.position.z + frame.forward.z * DIORAMA_STEP_DISTANCE * steps,
    },
    forward: frame.forward,
    right: frame.right,
    up: frame.up,
});

/**
 * Writes one line's motes into that line's ring-buffer slot. Deterministic per (seed, line): the same
 * line always regenerates the same dust, so a loop or a re-entry into the window does not reshuffle it.
 *
 * The placement is a phyllotaxis disc crossed with a Hammersley depth: the golden angle spreads the
 * motes around the ring and keeps CONSECUTIVE lines out of phase with each other (the sample index runs
 * across the whole field, not per line), sqrt-stratified radius makes the shell area-uniform rather than
 * centre-heavy, and the radical inverse spreads depth across the step. Seeded jitter on each breaks the
 * lattice up so the regularity never reads as a pattern.
 */
export const writeDioramaMoteLine = (
    out: Float32Array,
    frame: DioramaFrame,
    line: number,
    circumference: number,
    radial: number,
    seed: string | number | undefined,
): void => {
    const base = hashSeed(seed);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const twoPi = Math.PI * 2;
    const phase = seededUnit(base + 991) * twoPi;
    const total = circumference * radial;
    let write = dioramaMoteSlot(line) * total * 3;
    // Two INDEPENDENT axes: `radial` layers across the shell thickness, `circumference` motes around each.
    // The layer index drives the radius (sqrt-stratified so the shell stays area-uniform, not centre-heavy);
    // the segment index drives the angle (evenly spaced round the ring). Decorrelation keeps it from ever
    // reading as a rigid grid: each LINE and each LAYER is rotated by the golden angle (so consecutive lines
    // and stacked layers never align into spokes), plus a seeded half-cell jitter on angle and radius.
    for (let ri = 0; ri < radial; ri += 1) {
        for (let ci = 0; ci < circumference; ci += 1) {
            const p = ri * circumference + ci;
            const s = base + line * 131 + p * 17;
            const stratum = (ri + 0.35 + seededUnit(s + 4) * 0.3) / radial;
            const radius = MOTE_INNER_RADIUS + Math.sqrt(stratum) * MOTE_RADIAL_SPAN;
            const angle = phase + (line + ri) * goldenAngle
                + (ci / circumference) * twoPi
                + (seededUnit(s + 3) - 0.5) * (twoPi / circumference);
            const depth = (radicalInverse(p + 1, 2) + (seededUnit(s + 2) - 0.5) / total - 0.5)
                * DIORAMA_STEP_DISTANCE;
            const point = composeLocal(
                frame,
                Math.cos(angle) * radius,
                Math.sin(angle) * radius * MOTE_VERTICAL_SQUASH,
                depth,
            );
            out[write] = point.x;
            out[write + 1] = point.y;
            out[write + 2] = point.z;
            write += 3;
        }
    }
};
