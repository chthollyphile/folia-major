import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
    DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
    DEFAULT_DIORAMA_TUNING,
    DIORAMA_PARTICLE_DENSITY_MAX,
    DIORAMA_PARTICLE_DENSITY_MIN,
    DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
    DIORAMA_PARTICLE_SCALE_MAX,
    DIORAMA_PARTICLE_SCALE_MIN,
} from '@/types';
import {
    buildDioramaPath,
    buildFormation,
    DIORAMA_PARTICLE_AUDIO_SCALE_MAX,
    DIORAMA_STEP_DISTANCE,
    type DioramaFrame,
} from '@/components/visualizer/diorama/cameraPath';
import {
    resolveDioramaUnitFill,
    resolveGradientEnergy,
    resolveTextLife,
    shouldResetDioramaUnitState,
} from '@/components/visualizer/diorama/DioramaScene';
import {
    getDioramaKeywordDisplayedContrastRatio,
    prepareDioramaKeywordMatchers,
    resolveDioramaKeywordUnitColors,
} from '@/components/visualizer/diorama/dioramaKeywordColor';
import { TRANSITION_DISTANCE } from '@/components/visualizer/diorama/dioramaTransition';
import {
    DIORAMA_MOTE_LINES_AHEAD,
    DIORAMA_MOTE_LINES_BEHIND,
    DIORAMA_MOTE_MAX_POINTS,
    DIORAMA_MOTE_WINDOW_LINES,
    dioramaMoteSlot,
    extendDioramaFrame,
    resolveDioramaMoteCircumference,
    resolveDioramaMoteRadial,
    writeDioramaMoteLine,
} from '@/components/visualizer/diorama/dioramaMoteField';
import {
    DIORAMA_CLUSTER_COLLISION_LINE_SPAN,
    selectVisibleDioramaClusters,
    type DioramaParticleClusterAnchor,
} from '@/components/visualizer/diorama/dioramaGeometry';
import {
    buildDioramaCloudGeometryData,
    buildDioramaCorridorGeometryData,
    createDioramaBandTracker,
    createDioramaParticleElasticState,
    DIORAMA_MAX_PARTICLE_POINTS,
    resolveDioramaParticleAudioResponse,
    resolveDioramaPulseTarget,
    resolveWaveNumberMax,
    RIPPLE_BANDS,
    stepDioramaBandTracker,
    stepDioramaParticleElasticResponse,
    type DioramaBandSignal,
} from '@/components/visualizer/diorama/dioramaParticleModel';
import {
    buildDioramaParticleCorridorSpan,
    buildDioramaParticleCorridorWindow,
    DIORAMA_PARTICLE_CORRIDOR_RADIUS,
    type DioramaParticleCorridorSpan,
} from '@/components/visualizer/diorama/dioramaParticleCorridor';
import { appendSegment, createSequencerState } from '@/components/visualizer/diorama/dioramaSequencer';
import { resolveStoredDioramaTuning } from '@/stores/useSettingsUiStore';
import {
    getDioramaParticleContrastRatio,
    getDioramaParticleDisplayedContrastRatio,
    resolveDioramaParticleContrastColors,
} from '@/components/visualizer/diorama/dioramaParticleMaterials';
import {
    DIORAMA_PARTICLE_FRAGMENT_SHADER,
    DIORAMA_PARTICLE_VERTEX_SHADER,
} from '@/components/visualizer/diorama/dioramaParticleShaders';
import { buildDioramaStructuredSurface } from '@/components/visualizer/diorama/dioramaParticleSurfaces';

// test/unit/visualizer/dioramaGeometry.test.ts
// Locks Diorama's two mutually-exclusive point-cloud modes, deterministic buffers, audio shaping caps,
// theme-adaptive contrast, background particles, and tuning migration.
const makeCluster = (
    kind: DioramaParticleClusterAnchor['kind'],
    sourceLine: number,
    x = 4,
): DioramaParticleClusterAnchor => ({
    key: `${sourceLine}-${kind}-${x}`,
    sourceLine,
    particleSeed: `song:${sourceLine}:${kind}`,
    role: 'formation',
    kind,
    position: { x, y: 0, z: 0 },
    scale: 1,
    stretchY: 1,
    upright: false,
    spinSpeed: 0.1,
    colorSlot: 0,
    layer: 'near',
});

const straightSpan = (startZ: number, pathStart = startZ / 8): DioramaParticleCorridorSpan => ({
    start: { x: 0, y: 0, z: startZ },
    end: { x: 0, y: 0, z: startZ + 8 },
    startRight: { x: 1, y: 0, z: 0 },
    endRight: { x: 1, y: 0, z: 0 },
    startUp: { x: 0, y: 1, z: 0 },
    endUp: { x: 0, y: 1, z: 0 },
    pathStart,
    enabled: true,
});

describe('Diorama cloud visibility', () => {
    it('hides everything while the parent switch is off, keeping child preferences', () => {
        const shapes = [makeCluster('box', 0), makeCluster('sphere', 0, 8)];
        const visibility = { ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY, enabled: false, rings: false };

        expect(selectVisibleDioramaClusters(shapes, visibility)).toEqual([]);
        expect(visibility.rings).toBe(false);
    });

    it('hides all formation clouds while corridor mode is active (they are mutually exclusive)', () => {
        const shapes = [makeCluster('box', 0), makeCluster('sphere', 0, 8)];
        const corridorMode = { ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY, mode: 'corridor' as const };

        expect(selectVisibleDioramaClusters(shapes, corridorMode)).toEqual([]);
    });

    it('filters individual particle families in clouds mode', () => {
        const shapes = [makeCluster('box', 0, 4), makeCluster('sphere', 0, 8), makeCluster('cone', 0, 12), makeCluster('torus', 0, 16)];
        const result = selectVisibleDioramaClusters(shapes, {
            ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
            strands: false,
            rings: false,
        });

        expect(result.map((shape) => shape.kind)).toEqual(['sphere', 'cone']);
    });

    it('removes cross-line collisions while preserving intentional same-line formations', () => {
        const active = makeCluster('torus', 10, 5);
        const sameLine = makeCluster('sphere', 10, 5.2);
        const neighbourCollision = makeCluster('cone', 11, 5.3);
        const neighbourClear = makeCluster('box', 11, 10);

        expect(selectVisibleDioramaClusters(
            [active, sameLine, neighbourCollision, neighbourClear],
            DEFAULT_DIORAMA_GEOMETRY_VISIBILITY,
        )).toEqual([active, sameLine, neighbourClear]);
    });

    it('keeps every cluster kept-or-dropped identically wherever the camera is', () => {
        // A song whose lines genuinely collide, so the collision pass has real work to do.
        const song: DioramaParticleClusterAnchor[] = [];
        for (let line = 0; line < 12; line += 1) {
            song.push(makeCluster('box', line, 5));            // stacked - adjacent lines fight
            song.push(makeCluster('torus', line, 20 + line * 6)); // spread - always clear
        }
        // Exactly what DioramaScene mounts: a window around the current line, plus a margin behind it so
        // every possible blocker votes, then the margin dropped again.
        const mountedFrom = (current: number): string[] => {
            const mounted = new Set<number>();
            for (let i = Math.max(0, current - 2); i <= Math.min(11, current + 3); i += 1) mounted.add(i);
            const lowest = Math.min(...mounted) - DIORAMA_CLUSTER_COLLISION_LINE_SPAN;
            const voting = song.filter((cluster) => cluster.sourceLine >= lowest
                && cluster.sourceLine <= Math.max(...mounted));
            return selectVisibleDioramaClusters(voting, DEFAULT_DIORAMA_GEOMETRY_VISIBILITY)
                .filter((cluster) => mounted.has(cluster.sourceLine))
                .map((cluster) => cluster.key);
        };
        const lineOf = (key: string): number => Number(key.split('-')[0]);
        // Lines 5..7 are mounted from every one of these camera positions, so their verdicts must match
        // exactly. Ranking the input by distance from the current line broke precisely this.
        const overlap = (keys: string[]): string[] => keys.filter((key) => lineOf(key) >= 5 && lineOf(key) <= 7);

        expect(overlap(mountedFrom(5))).toEqual(overlap(mountedFrom(6)));
        expect(overlap(mountedFrom(6))).toEqual(overlap(mountedFrom(7)));
        expect(overlap(mountedFrom(5)).length).toBeGreaterThan(0);
        // The pass really is thinning the stacked column, or the equality above would prove nothing.
        expect(mountedFrom(6).filter((key) => key.includes('box')).length)
            .toBeLessThan(mountedFrom(6).filter((key) => key.includes('torus')).length);
    });

    it('builds mirrored formations and scales the complete cloud footprint', () => {
        const frame: DioramaFrame = {
            position: { x: 0, y: 0, z: 0 },
            forward: { x: 0, y: 0, z: 1 },
            right: { x: 1, y: 0, z: 0 },
            up: { x: 0, y: 1, z: 0 },
        };
        const placement = { offsetR: 0, offsetU: 0, scale: 1, roll: 0, yaw: 0, lookR: 0 };
        const normal = buildFormation(0, 'ordered', 'float', frame, placement, 1);
        const enlarged = buildFormation(0, 'ordered', 'float', frame, placement, 1.5);

        expect(normal).toHaveLength(6);
        for (let index = 0; index < normal.length; index += 2) {
            expect(normal[index].position.x).toBeCloseTo(-normal[index + 1].position.x, 5);
            expect(normal[index].position.y).toBeCloseTo(normal[index + 1].position.y, 5);
            expect(enlarged[index].scale / normal[index].scale).toBeCloseTo(1.5, 5);
        }
    });
});

describe('Diorama surface lattices', () => {
    // The GLSL lives in a JS template literal, so a stray backtick in a shader comment silently truncates
    // the string and the build dies somewhere else entirely. Cheap guard, twice-earned.
    it('keeps the shader sources free of backticks', () => {
        expect(DIORAMA_PARTICLE_VERTEX_SHADER).not.toContain('`');
        expect(DIORAMA_PARTICLE_FRAGMENT_SHADER).not.toContain('`');
    });

    /**
     * The other half of the seam fix, and the half that cannot be caught by inspecting a buffer: any
     * function reading the tunnel's RAW angle must close on itself after a full turn, or the wall does not
     * match up where the sampling wraps. Only two constructs do: an integer harmonic of the angle, or an
     * offset wrapped through atan(sin, cos). The old field used sin(w.y * 1.8) and sin(w.y * 2.3) - neither
     * closes, so the wave value stepped ~0.6 across the seam (about two world units at the tunnel radius),
     * which is precisely the reported "rolled sheet". This locks the rule rather than the old numbers.
     */
    it('converts its own output to sRGB', () => {
        // three only auto-converts for its OWN materials; a ShaderMaterial writing gl_FragColor has to do
        // it, and this one did not - it wrote linear values raw into an sRGB framebuffer, so every point
        // rendered ~3x darker than the theme colour (measured: #c8783c came out #932f0c, while a
        // meshBasicMaterial on the same colour read back exactly #c8783c). That is what made the adaptive
        // contrast certify a colour nobody saw. #include <colorspace_fragment> is NOT the fix: it expands
        // to linearToOutputTexel(), which the ShaderMaterial prefix does not define, and compiles to black.
        const fragmentBodies = DIORAMA_PARTICLE_FRAGMENT_SHADER
            .split('\n')
            .filter((line) => line.includes('gl_FragColor = vec4('));
        expect(fragmentBodies.length).toBeGreaterThan(0);
        for (const line of fragmentBodies) {
            expect(line).toContain('dioramaLinearToSRGB(');
        }
        expect(DIORAMA_PARTICLE_FRAGMENT_SHADER).not.toMatch(/#include\s*<colorspace_fragment>/);
    });

    it('only reads the tunnel angle through integer harmonics', () => {
        const multipliers = [...DIORAMA_PARTICLE_VERTEX_SHADER.matchAll(/w\.y\s*\*\s*([0-9]+\.?[0-9]*)/g)]
            .map((match) => Number(match[1]));

        expect(multipliers.length).toBeGreaterThan(0);
        multipliers.forEach((k) => expect(Number.isInteger(k)).toBe(true));
    });

    it('wraps the corridor ripple angle so a crest crosses the seam as if it were not there', () => {
        // The one place a non-integer angular term is legal: an offset put through atan(sin, cos), which
        // is exactly periodic. Ripples measure their angular reach this way, so the seam is not a place -
        // the two sides are simply neighbours, as they physically are on the wall.
        expect(DIORAMA_PARTICLE_VERTEX_SHADER).toContain('atan(sin(dAngle), cos(dAngle))');
        // And the detail field's angular harmonic is floored to an integer at runtime.
        expect(DIORAMA_PARTICLE_VERTEX_SHADER).toContain('float n = max(1.0, floor(k));');
    });

    it('welds the box into one shell instead of six independent plates', () => {
        const box = buildDioramaStructuredSurface('box', 576, 1);
        const half = 0.55;
        const onEdge = (i: number): boolean => {
            const p = [box.positions[i * 3], box.positions[i * 3 + 1], box.positions[i * 3 + 2]];
            // A point on a cube EDGE is at the extreme in two axes at once.
            return p.filter((v) => Math.abs(Math.abs(v) - half) < 1e-4).length >= 2;
        };
        const key = (i: number): string => [0, 1, 2]
            .map((a) => Math.round(box.positions[i * 3 + a] * 1e4)).join(',');

        const seen = new Set<string>();
        let edgePoints = 0;
        let duplicates = 0;
        for (let i = 0; i < box.count; i += 1) {
            if (onEdge(i)) edgePoints += 1;
            if (seen.has(key(i))) duplicates += 1;
            seen.add(key(i));
        }

        // The old sampler built six separate grids, so an edge carried two mismatched rows of points.
        // One shell means every edge point exists exactly once and belongs to both faces at once.
        expect(edgePoints).toBeGreaterThan(0);
        expect(duplicates).toBe(0);
        expect(box.count).toBeLessThanOrEqual(576);
    });

    it('bakes a CONTINUOUS normal field on the sharp-edged primitives, so no face can move on its own', () => {
        // The flat face normal is the whole bug: it jumps 90 degrees across an edge, so displacing along
        // it pulls the two faces apart. Assert that a small step in POSITION only ever turns the normal by
        // a small amount - i.e. the direction the shader displaces along is continuous over the edges.
        // Only the sharp-edged primitives are in scope: the cylinder and torus normals were always smooth
        // fields, and the torus's 0.12 tube legitimately curves fast enough to fail any fixed threshold.
        for (const kind of ['box', 'cone'] as const) {
            const surface = buildDioramaStructuredSurface(kind, 576, 1);
            const at = (i: number, a: Float32Array): [number, number, number] => (
                [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
            );
            const gapBetween = (i: number, j: number): number => {
                const pi = at(i, surface.positions);
                const pj = at(j, surface.positions);
                return Math.hypot(pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2]);
            };
            // Judge only true lattice neighbours, sized from the lattice itself rather than a guess.
            let spacing = Infinity;
            for (let j = 1; j < surface.count; j += 1) {
                const gap = gapBetween(0, j);
                if (gap > 1e-6) spacing = Math.min(spacing, gap);
            }
            const neighbourhood = spacing * 1.6;

            let worstTurn = 0;
            for (let i = 0; i < surface.count; i += 1) {
                const ni = at(i, surface.normals);
                for (let j = i + 1; j < surface.count; j += 1) {
                    if (gapBetween(i, j) > neighbourhood) continue;
                    const nj = at(j, surface.normals);
                    const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
                    worstTurn = Math.max(worstTurn, Math.acos(Math.min(1, Math.max(-1, dot))));
                }
            }
            // Flat face normals put neighbours across an edge a full pi/2 (90 degrees) apart.
            expect(worstTurn, `${kind} neighbours turn ${(worstTurn * 57.3).toFixed(0)} degrees`)
                .toBeLessThan(Math.PI / 4);
        }
    });

    it('gives coincident points an identical normal, so shared edges cannot split', () => {
        // The tetrahedron's four faces deliberately land on the SAME coordinates along their six shared
        // edges. Those twins are only safe because every displacement is a pure function of position: same
        // position + same normal => same movement, forever. A per-face normal gave the twins different
        // directions and pulled the edge open, which is the whole bug.
        const tetra = buildDioramaStructuredSurface('cone', 576, 1);
        const byPosition = new Map<string, [number, number, number]>();
        let twins = 0;
        for (let i = 0; i < tetra.count; i += 1) {
            const key = [0, 1, 2].map((a) => Math.round(tetra.positions[i * 3 + a] * 1e4)).join(',');
            const normal: [number, number, number] = [
                tetra.normals[i * 3], tetra.normals[i * 3 + 1], tetra.normals[i * 3 + 2],
            ];
            const existing = byPosition.get(key);
            if (!existing) {
                byPosition.set(key, normal);
                continue;
            }
            twins += 1;
            normal.forEach((value, axis) => expect(value).toBeCloseTo(existing[axis], 6));
        }
        // The edges really are shared, or the assertion above never ran.
        expect(twins).toBeGreaterThan(0);
    });

    it('keeps a stretched pillar evenly sampled instead of stacking slats', () => {
        // stretchY multiplies the lattice's Y spacing in the shader. A stretch-blind grid spaced a 3.4x
        // pillar's rows 5.3x further apart than its columns, which is what read as detached planes.
        const spacingRatio = (stretchY: number): number => {
            const box = buildDioramaStructuredSurface('box', 576, stretchY);
            const xs = new Set<number>();
            const ys = new Set<number>();
            for (let i = 0; i < box.count; i += 1) {
                xs.add(Math.round(box.positions[i * 3] * 1e4));
                ys.add(Math.round(box.positions[i * 3 + 1] * 1e4));
            }
            const step = (set: Set<number>): number => {
                const sorted = [...set].map((v) => v / 1e4).sort((a, b) => a - b);
                return sorted.length > 1 ? sorted[1] - sorted[0] : 1;
            };
            return (step(ys) * stretchY) / step(xs);
        };

        for (const stretchY of [1, 2, 3.4]) {
            const ratio = spacingRatio(stretchY);
            expect(ratio, `stretchY ${stretchY} => ${ratio.toFixed(2)}x anisotropy`).toBeGreaterThan(0.6);
            expect(ratio, `stretchY ${stretchY} => ${ratio.toFixed(2)}x anisotropy`).toBeLessThan(1.7);
        }
    });
});

describe('Diorama cloud buffers', () => {
    it('builds the same base positions and phases for the same stable song seed', () => {
        const clusters = [makeCluster('box', 3, 4), makeCluster('torus', 3, -4)];
        const randomSpy = vi.spyOn(Math, 'random');
        const first = buildDioramaCloudGeometryData(clusters, 64);
        const replayed = clusters.map((cluster) => ({
            ...cluster,
            key: `loop-${cluster.key}`,
            sourceLine: cluster.sourceLine + 100,
        }));
        const second = buildDioramaCloudGeometryData(replayed, 64);
        const randomCallCount = randomSpy.mock.calls.length;
        randomSpy.mockRestore();

        // Welding and shell topology mean a lattice lands on its own honest count UNDER the budget, so
        // this asserts the invariant (every cluster fits its budget) rather than an incidental number.
        expect(first.pointCount).toBeGreaterThan(0);
        expect(first.pointCount).toBeLessThanOrEqual(clusters.length * 96);
        expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
        expect(Array.from(first.normals)).toEqual(Array.from(second.normals));
        expect(Array.from(first.phases)).toEqual(Array.from(second.phases));
        expect(Array.from(first.waves)).toEqual(Array.from(second.waves));
        expect(first.waves.length).toBe(first.pointCount * 2);
        expect(Array.from(first.anchors.slice(0, 3))).toEqual([4, 0, 0]);
        expect(randomCallCount).toBe(0);
    });

    it('keeps every surface normal unit length for localized audio displacement', () => {
        const clusters = [makeCluster('box', 0), makeCluster('sphere', 1), makeCluster('cone', 2), makeCluster('torus', 3)];
        const data = buildDioramaCloudGeometryData(clusters, DIORAMA_PARTICLE_DENSITY_MAX);

        expect(data.normals.length).toBe(data.positions.length);
        for (let i = 0; i < data.pointCount; i += 1) {
            const offset = i * 3;
            const length = Math.hypot(data.normals[offset], data.normals[offset + 1], data.normals[offset + 2]);
            expect(length).toBeCloseTo(1, 4);
        }
    });

    it('bakes each primitive its own local radius so displacement stays proportional to its size', () => {
        const data = buildDioramaCloudGeometryData(
            [makeCluster('box', 0), makeCluster('sphere', 1, 20), makeCluster('cone', 2, 40), makeCluster('torus', 3, 60)],
            96,
        );

        expect(data.scales.length).toBe(data.pointCount * 3);
        for (let i = 0; i < data.pointCount; i += 1) {
            // The lattice's own mean distance from centre. The shader throws a FRACTION of this, which is
            // what keeps a 0.7-unit cloud readable under the same amplitude that swells a 7.4-unit tunnel.
            const localRadius = data.scales[i * 3 + 2];
            expect(localRadius).toBeGreaterThan(0.2);
            expect(localRadius).toBeLessThan(1.5);
        }
    });

    it('tessellates each cluster identically regardless of how many are mounted', () => {
        const one = buildDioramaCloudGeometryData([makeCluster('box', 0)], DIORAMA_PARTICLE_DENSITY_MAX);
        const many = buildDioramaCloudGeometryData(
            Array.from({ length: 40 }, (_, index) => makeCluster('sphere', index, index * 3)),
            DIORAMA_PARTICLE_DENSITY_MAX,
        );

        // The fix for the abrupt re-tessellation on line advance: per-cluster point count is count-
        // independent, so the overlapping window is identical frame to frame (no jump/deform).
        expect(one.pointsPerUnit).toBe(many.pointsPerUnit);
        expect(one.pointsPerUnit).toBeLessThanOrEqual(DIORAMA_PARTICLE_DENSITY_MAX);
        // A realistic mounted window still fits the global OBS-friendly point budget.
        expect(many.pointCount).toBeLessThanOrEqual(DIORAMA_MAX_PARTICLE_POINTS);
    });
});

/**
 * Wave detail is capped by the LATTICE, not by taste. Under ~4 samples per wavelength, neighbouring points
 * land on opposite phases and a crest stops reading as a surface - it becomes the "random scatter" we are
 * required not to produce. Deriving the ceiling from the real spacing is what makes the density slider a
 * genuine detail budget instead of a number that only happens to hold at one density.
 */
describe('Diorama wave detail ceiling', () => {
    it('reports a lattice spacing that tightens as density rises', () => {
        const sparse = buildDioramaStructuredSurface('box', 200, 1);
        const dense = buildDioramaStructuredSurface('box', 2000, 1);

        expect(dense.spacing).toBeLessThan(sparse.spacing);
        expect(resolveWaveNumberMax(dense.spacing)).toBeGreaterThan(resolveWaveNumberMax(sparse.spacing));
    });

    it('keeps at least four samples per wavelength at the ceiling', () => {
        for (const budget of [128, 512, 2048]) {
            const surface = buildDioramaStructuredSurface('box', budget, 1);
            const wavelength = (Math.PI * 2) / resolveWaveNumberMax(surface.spacing);
            expect(wavelength / surface.spacing).toBeCloseTo(4, 5);
        }
    });

    it('caps the clouds buffer against the COARSEST primitive it draws', () => {
        const kinds: Array<DioramaParticleClusterAnchor['kind']> = ['box', 'sphere', 'cone', 'torus'];
        const clusters = kinds.map((kind, index) => makeCluster(kind, index));
        const data = buildDioramaCloudGeometryData(clusters, 512);
        const worst = Math.max(...kinds.map((kind) => buildDioramaStructuredSurface(kind, 512, 1).spacing));

        // One buffer, one uniform: a fine sphere must not be allowed to alias the tetrahedron beside it.
        expect(data.spacing).toBeCloseTo(worst, 6);
    });
});

describe('Diorama corridor tunnel', () => {
    it('lays every point on a fixed-radius cylinder centred exactly on the path', () => {
        const data = buildDioramaCorridorGeometryData([straightSpan(0), straightSpan(8)], 384);

        expect(data.pointCount).toBeGreaterThan(0);
        for (let i = 0; i < data.pointCount; i += 1) {
            const offset = i * 3;
            // Local offset sits on the ring plane at the constant radius.
            const radius = Math.hypot(data.positions[offset], data.positions[offset + 1], data.positions[offset + 2]);
            expect(radius).toBeCloseTo(DIORAMA_PARTICLE_CORRIDOR_RADIUS, 4);
            // Normal is the unit radial (outward tunnel-wall direction).
            const normalLength = Math.hypot(data.normals[offset], data.normals[offset + 1], data.normals[offset + 2]);
            expect(normalLength).toBeCloseTo(1, 4);
            // The tunnel's own radius rides along, so its swell is the same fraction-of-size the clouds
            // get rather than a world-constant nudge that reads as nothing on a 7.4-unit cylinder.
            expect(data.scales[i * 3 + 2]).toBeCloseTo(DIORAMA_PARTICLE_CORRIDOR_RADIUS, 4);
            // Anchor rides the straight path centre (x=y=0) within the mounted span range.
            expect(data.anchors[offset]).toBeCloseTo(0, 4);
            expect(data.anchors[offset + 1]).toBeCloseTo(0, 4);
            expect(data.anchors[offset + 2]).toBeGreaterThanOrEqual(-0.0001);
            expect(data.anchors[offset + 2]).toBeLessThanOrEqual(16.0001);
        }
    });

    /**
     * THE SEAM. The tunnel's angular coordinate runs 0..2*PI and wraps back to 0. Anything baked per-point
     * off that raw angle is discontinuous there by construction, and no amount of amplitude tuning hides
     * it - it is a seam at rest, with the audio muted. aPhase used to be `longitudinal * 1.7 + angle *
     * 0.35`, which stepped by 2.2 radians across the wrap and drove the whole-body sway, tearing the ring
     * open at exactly one line down its length. A ring must sway as ONE rigid ring.
     */
    it('gives every point on a ring the same phase, so nothing steps across the seam', () => {
        const data = buildDioramaCorridorGeometryData([straightSpan(0), straightSpan(8)], 384);
        const byAnchor = new Map<string, Set<number>>();
        for (let i = 0; i < data.pointCount; i += 1) {
            const key = data.anchors[i * 3 + 2].toFixed(4);
            if (!byAnchor.has(key)) byAnchor.set(key, new Set());
            byAnchor.get(key)!.add(Math.round(data.phases[i] * 1e6));
        }
        expect(byAnchor.size).toBeGreaterThan(1);
        // One distinct phase per ring - i.e. the phase does not vary with the angle at all.
        byAnchor.forEach((phases) => expect(phases.size).toBe(1));
    });

    it('measures along the tunnel in the same radius units the clouds field uses', () => {
        const data = buildDioramaCorridorGeometryData([straightSpan(0), straightSpan(8)], 384);
        const alongs = new Set<number>();
        for (let i = 0; i < data.pointCount; i += 1) alongs.add(Math.round(data.waves[i * 2] * 1e4));
        const sorted = [...alongs].sort((a, b) => a - b).map((v) => v / 1e4);

        // One line of path = DIORAMA_STEP_DISTANCE world units = that many tunnel radii. Sharing the unit
        // space with the clouds is what lets one set of ripple parameters drive both modes. Two spans
        // cover two lines, and the coordinate is absolute (pathStart-keyed), so they run 0 -> 2 lines.
        const perLine = DIORAMA_STEP_DISTANCE / DIORAMA_PARTICLE_CORRIDOR_RADIUS;
        expect(sorted[0]).toBeCloseTo(0, 4);
        expect(sorted[sorted.length - 1] - sorted[0]).toBeCloseTo(perLine * 2, 2);
    });

    it('tessellates each span identically regardless of how many are mounted', () => {
        const one = buildDioramaCorridorGeometryData([straightSpan(0)], 240);
        const three = buildDioramaCorridorGeometryData([straightSpan(0), straightSpan(8), straightSpan(16)], 240);

        // Same fix as the clouds: ring count per span is count-independent, so a sliding window never
        // re-tessellates the tunnel (the source of the corridor "rolling" on line advance).
        expect(one.pointsPerUnit).toBe(three.pointsPerUnit);
    });

    it('is deterministic and drops disabled (outgoing) spans', () => {
        const a = buildDioramaCorridorGeometryData([straightSpan(0)], 240);
        const b = buildDioramaCorridorGeometryData([straightSpan(0)], 240);
        const disabled = buildDioramaCorridorGeometryData([{ ...straightSpan(0), enabled: false }], 240);

        expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
        expect(disabled.pointCount).toBe(0);
    });

    it('builds a line-local span carrying its absolute path coordinate', () => {
        const frame: DioramaFrame = {
            position: { x: 1, y: 2, z: 3 },
            forward: { x: 0, y: 0, z: -1 },
            right: { x: 1, y: 0, z: 0 },
            up: { x: 0, y: 1, z: 0 },
        };
        const span = buildDioramaParticleCorridorSpan(frame, null, 7, true);

        expect(span.start).toEqual({ x: 1, y: 2, z: 3 });
        expect(span.end).toEqual({ x: 1, y: 2, z: -5 });
        expect(span.pathStart).toBe(7);
        expect(span.enabled).toBe(true);
    });
});

const signal = (transient: number, sustained: number): DioramaBandSignal => (
    { transient, sustained, onset: false }
);

describe('Diorama corridor whole-body pulse', () => {
    // uPulse reaches the shader as `displaced *= aScale.x * uPulse`: a uniform scale of every point's
    // offset from its anchor. On the cylinder that IS the radius, so uPulse - 1 is the whole wall moving.
    const CORRIDOR_RADIUS = 7.4;
    const swingOf = (gain: number, isCorridor: boolean) => {
        const state = { value: 1, velocity: 0 };
        let min = Infinity;
        let max = -Infinity;
        for (let f = 0; f < 60 * 8; f += 1) {
            const t = f / 60;
            const sinceKick = t % 0.5;   // four-on-the-floor
            const response = resolveDioramaParticleAudioResponse(
                signal(0.7, Math.exp(-sinceKick * 9)),
                signal(0.5, Math.exp(-sinceKick * 7) * 0.8),
            );
            const pulse = stepDioramaParticleElasticResponse(
                state, resolveDioramaPulseTarget(response.clusterPulse, gain, isCorridor), 1 / 60,
            );
            if (t > 1) { min = Math.min(min, pulse); max = Math.max(max, pulse); }
        }
        return max - min;
    };

    it('keeps the tunnel wall effectively still, so the beat is the ripples and not the wall', () => {
        // Before this share existed, the corridor pumped its whole radius by 9.2% per kick at a response
        // of 1.0 and 13.8% (1.02 world units) at 1.5 - the whole tunnel contracting around the camera.
        for (const gain of [1, 1.5]) {
            expect(swingOf(gain, true) * CORRIDOR_RADIUS).toBeLessThan(0.2); // world units of radius
        }
    });

    it('leaves the clouds their whole-body breath', () => {
        // The clouds are a cluster, not a wall around the lens: breathing on the beat is the point there,
        // and the share must not have quietly flattened them too.
        expect(swingOf(1, false)).toBeGreaterThan(swingOf(1, true) * 4);
    });
});

describe('Diorama audio shaping', () => {
    it('makes loud bands materially stronger while retaining hard response caps', () => {
        const quiet = resolveDioramaParticleAudioResponse(signal(0.05, 0.05), signal(0.05, 0.05));
        const loud = resolveDioramaParticleAudioResponse(signal(1, 1), signal(1, 1));

        expect(loud.flowSpeed).toBeGreaterThan(quiet.flowSpeed * 2);
        expect(loud.flowSpeed).toBeLessThanOrEqual(1.55);
        expect(quiet.clusterPulse).toBeLessThan(1.04);
        // A deliberately gentle whole-body breath - the coordinated wave field carries the real motion.
        expect(loud.clusterPulse).toBeGreaterThan(1.15);
        expect(loud.clusterPulse).toBeLessThanOrEqual(1.25);
    });

    // The drift rides SUSTAINED energy (a loud passage moves the world) while the beat scale rides the
    // TRANSIENT (a kick is an event). Crossing these is how a loud passage erases the beat.
    it('separates the sustained drift from the transient pulse', () => {
        const held = resolveDioramaParticleAudioResponse(signal(0, 1), signal(0, 1));
        const struck = resolveDioramaParticleAudioResponse(signal(1, 0), signal(1, 0));

        expect(held.flowSpeed).toBeGreaterThan(struck.flowSpeed);
        expect(struck.clusterPulse).toBeGreaterThan(held.clusterPulse);
    });

    /**
     * A steady kick: a short 0.9 hit every 0.5s decaying back to a 0.3 floor. This is the exact shape the
     * reported bug lived on - the old `level - EMA(level)` onset faded away under it as its reference
     * climbed toward the mean, so the drums kept playing and the geometry stopped answering.
     */
    const kickTrain = (seconds: number, step: number, level: (t: number) => number) => {
        const tracker = createDioramaBandTracker();
        const frames: Array<{ t: number; signal: DioramaBandSignal }> = [];
        for (let t = 0; t < seconds; t += step) {
            frames.push({ t, signal: stepDioramaBandTracker(tracker, level(t), step) });
        }
        return frames;
    };
    const steadyKick = (t: number): number => (((t % 0.5) < 0.09) ? 0.9 : 0.3);
    const peakTransientBetween = (
        frames: ReturnType<typeof kickTrain>,
        from: number,
        to: number,
    ): number => frames
        .filter((f) => f.t >= from && f.t < to)
        .reduce((peak, f) => Math.max(peak, f.signal.transient), 0);

    it('answers a steady kick just as hard after a minute as it did at the start', () => {
        const frames = kickTrain(60, 1 / 60, steadyKick);
        const early = peakTransientBetween(frames, 2, 6);
        const late = peakTransientBetween(frames, 54, 58);

        expect(early).toBeGreaterThan(0.6);
        // The whole point: no drift. The old model's late response collapsed toward zero here.
        expect(late).toBeGreaterThan(early * 0.85);
        expect(late).toBeLessThan(early * 1.15);
    });

    it('fires one onset per kick rather than one per loud frame', () => {
        const frames = kickTrain(10, 1 / 60, steadyKick);
        const onsets = frames.filter((f) => f.t >= 2 && f.signal.onset).length;
        // 8s of kicks at 2/s = ~16 hits. Anything near the frame count would mean the trigger is
        // re-firing while the band is simply loud, which is what reads as a twitch.
        expect(onsets).toBeGreaterThan(12);
        expect(onsets).toBeLessThan(20);
    });

    /**
     * A sustained hi-hat: dense (~3.7 peaks/s), shallow valleys, never actually silent. This is the case a
     * too-slow floor latches on - it never settles into the gaps, the transient never falls back to the
     * re-arm level, and the trigger fires ONCE and then goes quiet for the rest of the song. The band that
     * needs the most events gets the fewest, which is exactly the high-frequency failure we must not ship.
     */
    it('keeps firing on a dense sustained band instead of latching after the first hit', () => {
        const frames = kickTrain(40, 1 / 60, (t) => 0.4 + 0.4 * Math.abs(Math.sin(t * 11.7)));
        const onsets = frames.filter((f) => f.t >= 5 && f.signal.onset).length;
        const rate = onsets / 35;

        expect(rate).toBeGreaterThan(2);
        expect(rate).toBeLessThan(6);
    });

    it('does not read an inflated transient from its own cold start', () => {
        const frames = kickTrain(3, 1 / 60, steadyKick);
        // Priming onto the signal (instead of starting the reference at 0) is what removes the opening
        // full-scale spike that the rest of the song then appeared to decay away from.
        const firstFrame = frames[0].signal.transient;
        expect(firstFrame).toBeLessThan(0.1);
    });

    it('falls back to rest when the drums stop, rather than latching', () => {
        const frames = kickTrain(30, 1 / 60, (t) => (t < 20 ? steadyKick(t) : 0.04));
        const playing = peakTransientBetween(frames, 15, 20);
        const stopped = peakTransientBetween(frames, 26, 30);

        expect(playing).toBeGreaterThan(0.6);
        expect(stopped).toBeLessThan(0.15);
    });

    it('reads a quiet track and a loud one at comparable strength', () => {
        const loud = kickTrain(30, 1 / 60, steadyKick);
        const quiet = kickTrain(30, 1 / 60, (t) => steadyKick(t) * 0.25);
        const loudPeak = peakTransientBetween(loud, 20, 26);
        const quietPeak = peakTransientBetween(quiet, 20, 26);

        // Normalising against the band's own live range is what keeps a quiet master responding at all.
        expect(quietPeak).toBeGreaterThan(loudPeak * 0.6);
    });

    it('holds a sustained band up instead of adapting it away', () => {
        const frames = kickTrain(40, 1 / 60, () => 0.8);
        const early = frames.find((f) => f.t >= 3)!.signal.sustained;
        const late = frames.find((f) => f.t >= 35)!.signal.sustained;

        expect(early).toBeGreaterThan(0.9);
        expect(late).toBeGreaterThan(0.9);
    });

    it('turns a beat into a bounded elastic pulse that overshoots then settles', () => {
        const state = createDioramaParticleElasticState();
        const attack = Array.from({ length: 90 }, () => (
            stepDioramaParticleElasticResponse(state, DIORAMA_PARTICLE_AUDIO_SCALE_MAX, 1 / 60)
        ));
        const release = Array.from({ length: 150 }, () => (
            stepDioramaParticleElasticResponse(state, 1, 1 / 60)
        ));

        expect(Math.max(...attack)).toBeGreaterThan(1.4);
        expect(Math.max(...attack)).toBeLessThanOrEqual(DIORAMA_PARTICLE_AUDIO_SCALE_MAX);
        expect(release.at(-1)).toBeCloseTo(1, 2);
    });
});

describe('Diorama theme-adaptive contrast', () => {
    it('adapts similar theme colours toward readable contrast on dark and light scenes', () => {
        const darkBackground = new THREE.Color('#351d16');
        const lightBackground = new THREE.Color('#eadfd6');
        const darkColors = resolveDioramaParticleContrastColors({
            primary: new THREE.Color('#42241b'),
            accent: new THREE.Color('#5a2d20'),
            secondary: new THREE.Color('#3e2019'),
        }, darkBackground);
        const lightColors = resolveDioramaParticleContrastColors({
            primary: new THREE.Color('#dfd2c7'),
            accent: new THREE.Color('#e3d6cd'),
            secondary: new THREE.Color('#d8ccc3'),
        }, lightBackground);

        expect(getDioramaParticleContrastRatio(darkColors.primary, darkBackground)).toBeGreaterThanOrEqual(4.5);
        expect(getDioramaParticleContrastRatio(darkColors.accent, darkBackground)).toBeGreaterThanOrEqual(4.0);
        expect(getDioramaParticleContrastRatio(lightColors.primary, lightBackground)).toBeGreaterThanOrEqual(4.5);
        expect(getDioramaParticleContrastRatio(lightColors.secondary, lightBackground)).toBeGreaterThanOrEqual(4.5);
    });

    // The four theme families the point cloud has to stay legible on. Each is checked on the DISPLAYED
    // pixel, not the uniform: the shader dims a calm point to 0.874 and composites it at 0.72 alpha, so a
    // uniform that clears 4.6 does not mean a point that does. Measured on the real material before this
    // was accounted for, the promise and the pixel disagreed wildly - dark promised 14.6 and showed 3.73,
    // near-colour promised 4.6 and showed 1.28, which is a point you cannot see at all (1.0 == background).
    const THEMES = {
        dark: { bg: '#0a0a0c', primary: '#e8dcc8', accent: '#c8a05a', secondary: '#9aa8b4' },
        light: { bg: '#f4f1ea', primary: '#3a3226', accent: '#8a6a2a', secondary: '#5a6470' },
        lowSaturation: { bg: '#2a2c2e', primary: '#b8bcc0', accent: '#9298a0', secondary: '#787e86' },
        nearColour: { bg: '#243044', primary: '#2c3a50', accent: '#33415a', secondary: '#3a4a66' },
    };

    it.each(Object.entries(THEMES))('keeps the DISPLAYED point legible on a %s theme', (_name, theme) => {
        const background = new THREE.Color(theme.bg);
        const adapted = resolveDioramaParticleContrastColors({
            primary: new THREE.Color(theme.primary),
            accent: new THREE.Color(theme.accent),
            secondary: new THREE.Color(theme.secondary),
        }, background);

        expect(getDioramaParticleDisplayedContrastRatio(adapted.primary, background)).toBeGreaterThanOrEqual(4.5);
        expect(getDioramaParticleDisplayedContrastRatio(adapted.accent, background)).toBeGreaterThanOrEqual(4.0);
        expect(getDioramaParticleDisplayedContrastRatio(adapted.secondary, background)).toBeGreaterThanOrEqual(4.5);
    });

    it('reports a LOWER ratio for the displayed pixel than for the raw colour', () => {
        // The whole reason the displayed metric exists. The composite pulls a point back toward the
        // background, so it can only ever cost contrast - if this ever inverted, the model would be wrong.
        const background = new THREE.Color('#0a0a0c');
        const colour = new THREE.Color('#e8dcc8');
        expect(getDioramaParticleDisplayedContrastRatio(colour, background))
            .toBeLessThan(getDioramaParticleContrastRatio(colour, background));
    });

    it('leaves a colour that is already legible on screen alone', () => {
        // "调整幅度必须受限，不能破坏主题配色": adaptation is a correction, not a normalisation. White on
        // near-black is already far past the target and must come back untouched.
        const background = new THREE.Color('#0a0a0c');
        const white = new THREE.Color('#ffffff');
        const adapted = resolveDioramaParticleContrastColors(
            { primary: white, accent: white, secondary: white }, background,
        );
        expect(adapted.primary.getHex()).toBe(white.getHex());
    });

    it('does not blow a point out to pure white to buy contrast', () => {
        // "不能造成过曝". The search stops at the smallest correction that clears the target, so even the
        // hardest case (a point almost exactly the background colour) keeps some of its own hue.
        const background = new THREE.Color('#243044');
        const adapted = resolveDioramaParticleContrastColors({
            primary: new THREE.Color('#253145'),
            accent: new THREE.Color('#253145'),
            secondary: new THREE.Color('#253145'),
        }, background);
        expect(adapted.primary.getHex()).not.toBe(0xffffff);
        expect(getDioramaParticleDisplayedContrastRatio(adapted.primary, background)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('Diorama corridor window', () => {
    const BEHIND = 6;
    const AHEAD = 7;
    const mkLines = (n: number) => Array.from({ length: n }, (_, i) => ({
        startTimeMs: i * 1000, endTimeMs: i * 1000 + 900, fullText: `line ${i}`, words: [],
    })) as never[];
    const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    it("keeps generating tunnel past the song's last lyric", () => {
        // The end bug: the window used to clamp to [0, total-1], so at the last line there was simply
        // nothing to mount ahead - the tunnel stopped at the read head and the camera stared out of a flat
        // open end. The path has no frames out there; it has to be extended.
        const state = createSequencerState();
        appendSegment(state, { seed: 'end', lines: mkLines(10), round: 0, placementOrigin: { x: 0, y: 0, z: 0 } });
        const lastLine = 9;
        const spans = buildDioramaParticleCorridorWindow(state, lastLine, BEHIND, AHEAD);

        expect(spans).toHaveLength(BEHIND + AHEAD + 1);
        const head = state.segments[0].frames[lastLine].position;
        const farEnd = spans[spans.length - 1].end;
        // Fog closes at 30 and the camera can trail the read head by up to ~15, so the far end has to be
        // well past 30 from the head to be genuinely out of sight.
        expect(distance(head, farEnd)).toBeGreaterThan(AHEAD * DIORAMA_STEP_DISTANCE * 0.95);
        expect(distance(head, spans[0].start)).toBeGreaterThan(BEHIND * DIORAMA_STEP_DISTANCE * 0.95);
    });

    it('leaves no gap between rings, across the lyric/extension handover', () => {
        // "相机视锥范围内不能出现圆柱环缺口": every span must start exactly where the previous one ended,
        // including where the real path runs out and the extension takes over.
        const state = createSequencerState();
        appendSegment(state, { seed: 'gap', lines: mkLines(10), round: 0, placementOrigin: { x: 0, y: 0, z: 0 } });
        const spans = buildDioramaParticleCorridorWindow(state, 9, BEHIND, AHEAD);
        for (let i = 1; i < spans.length; i += 1) {
            expect(distance(spans[i - 1].end, spans[i].start)).toBeLessThan(1e-6);
        }
    });

    it('does not change the tunnel where the lyrics stop', () => {
        // "末端处理不能突然改变圆柱半径、点间距、亮度或振幅" - the extension is the same cylinder. Every
        // span covers exactly one step of path, so ring spacing is identical inside and outside the lyrics.
        const state = createSequencerState();
        appendSegment(state, { seed: 'even', lines: mkLines(10), round: 0, placementOrigin: { x: 0, y: 0, z: 0 } });
        const spans = buildDioramaParticleCorridorWindow(state, 9, BEHIND, AHEAD);
        for (const span of spans) {
            expect(distance(span.start, span.end)).toBeCloseTo(DIORAMA_STEP_DISTANCE, 4);
        }
        // ...and the phase stays one-per-line continuous, so the wave cannot jump at the handover.
        for (let i = 1; i < spans.length; i += 1) {
            expect(spans[i].pathStart - spans[i - 1].pathStart).toBe(1);
        }
    });

    it('still fits the point budget with BOTH tunnels mounted at max density', () => {
        // Widening the window and mounting the outgoing tunnel at the same size roughly doubled the
        // corridor's worst case, which is a song change at max 密度 - the one moment two full windows
        // exist at once. That is the number that has to stay inside the OBS-friendly budget.
        const state = createSequencerState();
        appendSegment(state, { seed: 'a', lines: mkLines(20), round: 0, placementOrigin: { x: 0, y: 0, z: 0 } });
        appendSegment(state, {
            seed: 'b', lines: mkLines(20), round: 0, placementOrigin: { x: TRANSITION_DISTANCE, y: 0, z: 0 },
        });
        const spans = [
            ...buildDioramaParticleCorridorWindow(state, 19, BEHIND, AHEAD),
            ...buildDioramaParticleCorridorWindow(state, 20, BEHIND, AHEAD),
        ];
        expect(spans).toHaveLength(2 * (BEHIND + AHEAD + 1));

        const data = buildDioramaCorridorGeometryData(spans, DIORAMA_PARTICLE_DENSITY_MAX);
        expect(data.pointCount).toBeLessThanOrEqual(DIORAMA_MAX_PARTICLE_POINTS);
    });

    it('extends the outgoing corridor rather than reaching into the incoming one', () => {
        // During a song change the read head has already jumped to the new segment, which sits
        // TRANSITION_DISTANCE away. Resolving the outgoing window's indices GLOBALLY walked straight into
        // that new corridor; every span of the departing tunnel must stay with the departing tunnel.
        const state = createSequencerState();
        appendSegment(state, { seed: 'old', lines: mkLines(6), round: 0, placementOrigin: { x: 0, y: 0, z: 0 } });
        appendSegment(state, {
            seed: 'new', lines: mkLines(6), round: 0, placementOrigin: { x: TRANSITION_DISTANCE, y: 0, z: 0 },
        });
        const outgoingIndex = 5; // the old segment's last line
        const spans = buildDioramaParticleCorridorWindow(state, outgoingIndex, BEHIND, AHEAD);

        const oldHead = state.segments[0].frames[5].position;
        for (const span of spans) {
            // Nothing in the departing window may land near the incoming corridor's origin.
            expect(distance(span.start, { x: TRANSITION_DISTANCE, y: 0, z: 0 }))
                .toBeGreaterThan(DIORAMA_STEP_DISTANCE);
            expect(distance(span.start, oldHead)).toBeLessThan((BEHIND + AHEAD + 2) * DIORAMA_STEP_DISTANCE);
        }
    });
});

describe('Diorama lyric distance lifecycle', () => {
    // The scene's fog reaches FOG_FAR = 30; the mounted text window is LINES_AHEAD = 3 lines ahead.
    const FOG_FAR_REACH = 30;
    const LYRIC_WINDOW_REACH = 3 * DIORAMA_STEP_DISTANCE;

    it('drives a lyric to true zero once it is a corridor away', () => {
        // The residue bug: text used to have only a NEAR dissolve, so a line kept full index-based opacity
        // at ANY distance. A song change parks the previous corridor TRANSITION_DISTANCE away and leaves its
        // last lines mounted as the new song's index-adjacent trail, so they rendered on forever. Fog cannot
        // stand in for this - it recolours a fragment toward the background rather than removing it, and a
        // background-coloured glyph over the corridor's points is still a legible ghost.
        expect(resolveTextLife(TRANSITION_DISTANCE)).toBe(0);
        expect(resolveTextLife(FOG_FAR_REACH + 12)).toBe(0);
    });

    it('leaves every distance the scene actually stages a lyric at untouched', () => {
        // The far band has to sit past the mounted window's own reach, or it would dim lines the scene
        // means to show. LINES_AHEAD (3) * DIORAMA_STEP_DISTANCE, plus room for a wide shot's pull-back.
        for (const distance of [3, 5.2, 12, 24, LYRIC_WINDOW_REACH]) {
            expect(resolveTextLife(distance)).toBe(1);
        }
    });

    it('still melts a lyric passing the lens', () => {
        expect(resolveTextLife(0.5)).toBe(0);
        expect(resolveTextLife(1.45)).toBeGreaterThan(0);
        expect(resolveTextLife(1.45)).toBeLessThan(1);
    });
});

describe('渐变跟唱 unit energy', () => {
    // A LONG line - the case the backflow bug needed to show itself: 12s, 8 units of 1.5s.
    const units = Array.from({ length: 8 }, (_, i) => ({ startTime: i * 1.5, endTime: (i + 1) * 1.5 }));
    const sample = (unit: { startTime: number; endTime: number }, from: number, to: number) => {
        const out: { now: number; energy: number }[] = [];
        for (let f = 0; f * (1 / 60) <= to; f += 1) {
            const now = f * (1 / 60);
            if (now >= from) out.push({ now, energy: resolveGradientEnergy(now, unit) });
        }
        return out;
    };

    it('never re-tints a finished unit while the rest of the line is still being sung', () => {
        // THE bug: energy summed a `0.25 * lineProgress` term, so the line's first word decayed to 0.42
        // and then climbed back to 0.60 as the remaining 8s of the line were sung - visible colour
        // flowing backwards into words that had already settled.
        const trace = sample(units[0], units[0].endTime, 14);
        let minSoFar = Infinity;
        let worstRise = 0;
        for (const { energy } of trace) {
            minSoFar = Math.min(minSoFar, energy);
            worstRise = Math.max(worstRise, energy - minSoFar);
        }
        expect(worstRise).toBe(0);
    });

    it('settles every unit back to exactly its base colour, bounded in time', () => {
        // The old floor was 0.35 + 0.25 * lineProgress, released only when a LINE-level gate dropped, so
        // a finished word never reached its own base colour and the line un-tinted all at once.
        for (const unit of units) {
            expect(resolveGradientEnergy(unit.endTime + 2.15, unit)).toBe(0);
            expect(resolveGradientEnergy(unit.endTime + 60, unit)).toBe(0);
        }
    });

    it('runs 出现 / 保持 / 衰减 for each unit off its OWN timing', () => {
        const unit = units[3];
        expect(resolveGradientEnergy(unit.startTime - 0.01, unit)).toBe(0);       // 未唱: untouched
        expect(resolveGradientEnergy(unit.startTime + 0.75, unit)).toBeCloseTo(0.5, 5); // 出现
        expect(resolveGradientEnergy(unit.endTime, unit)).toBe(1);                // peak
        expect(resolveGradientEnergy(unit.endTime + 0.2, unit)).toBe(1);          // 保持
        const decaying = resolveGradientEnergy(unit.endTime + 1.0, unit);
        expect(decaying).toBeGreaterThan(0);
        expect(decaying).toBeLessThan(1);                                          // 衰减
    });

    it('is monotonic: rises only while sung, falls only after', () => {
        const unit = units[2];
        const rise = sample(unit, unit.startTime, unit.endTime);
        for (let i = 1; i < rise.length; i += 1) {
            expect(rise[i].energy).toBeGreaterThanOrEqual(rise[i - 1].energy - 1e-9);
        }
        const fall = sample(unit, unit.endTime, unit.endTime + 4);
        for (let i = 1; i < fall.length; i += 1) {
            expect(fall[i].energy).toBeLessThanOrEqual(fall[i - 1].energy + 1e-9);
        }
    });

    it('holds still while paused and recomputes from the clock alone after a seek', () => {
        // Purity is what buys both. The gate this replaced was an envelope advanced by real frame delta,
        // so with the clock frozen at a pause it kept fading the tint for seconds (measured 1.0 -> 0.008
        // over 3 paused seconds). And with no accumulated state there is nothing a seek can leave stale:
        // scrubbing anywhere yields the same value as playing there.
        const unit = units[1];
        const paused = 3.1;
        for (let i = 0; i < 240; i += 1) {
            expect(resolveGradientEnergy(paused, unit)).toBe(resolveGradientEnergy(paused, unit));
        }
        for (const now of [0, 1.7, 3.4, 6.9, 12, 50]) {
            expect(resolveGradientEnergy(now, unit)).toBe(resolveGradientEnergy(now, unit));
        }
        // Seeking BACK to before the unit was sung must give a clean, untinted word - not a leftover.
        expect(resolveGradientEnergy(0.2, unit)).toBe(0);
    });

    it('never lets one unit\'s wake depend on how long the line or its neighbours are', () => {
        // Same unit timing, wildly different line context: identical energy. This is the property the
        // line-progress term broke.
        const shortLineUnit = { startTime: 4, endTime: 5.5 };
        const longLineUnit = { startTime: 4, endTime: 5.5 };
        for (const now of [4.5, 5.5, 6.0, 7.0, 8.0]) {
            expect(resolveGradientEnergy(now, shortLineUnit)).toBe(resolveGradientEnergy(now, longLineUnit));
        }
    });

    it('survives a zero-length unit without dividing by zero', () => {
        // Timelines do emit these: buildLineGraphemeTimeline gives gap graphemes startTime === endTime.
        const degenerate = { startTime: 2, endTime: 2 };
        for (const now of [1.9, 2, 2.0001, 2.5, 10]) {
            expect(Number.isFinite(resolveGradientEnergy(now, degenerate))).toBe(true);
        }
        expect(resolveGradientEnergy(1.9, degenerate)).toBe(0);   // unsung
        expect(resolveGradientEnergy(2, degenerate)).toBe(0);     // the start instant is not yet sung
        expect(resolveGradientEnergy(2.0001, degenerate)).toBe(1); // no span to ease across: straight to peak
        expect(resolveGradientEnergy(10, degenerate)).toBe(0);    // and still settles back to base
    });
});

describe('Diorama 关键字着色', () => {
    // The diorama renders every CJK character as its OWN unit, so units carry single-char offsets.
    const unitsOf = (line: string) => [...line].map((_, i) => ({ charStart: i, charEnd: i + 1 }));
    const PRIMARY = new THREE.Color('#e8e4dc');
    const ACCENT = new THREE.Color('#c8783c');
    const BG = new THREE.Color('#0d0f14');
    const resolve = (
        line: string,
        wordColors: { word: string; color: string }[],
        enabled = true,
        primary = PRIMARY,
        accent = ACCENT,
        background = BG,
    ) => resolveDioramaKeywordUnitColors(
        line,
        unitsOf(line),
        prepareDioramaKeywordMatchers(wordColors, enabled),
        primary,
        accent,
        background,
    );

    it('colours only the characters that are really part of a keyword', () => {
        // The reason this resolves by RANGE and not by token text like Fume does. Fume matches a token's
        // text with `bidirectional-contains`, which is safe for its whole-word tokens; on the diorama's
        // single-character units it also matches the 火 of 火车 (a train), colouring a character that
        // belongs to no keyword. Measured against the shared matcher: text matching hits indices 0, 4, 5.
        const line = '火车经过花火大会';
        const resolved = resolve(line, [{ word: '花火', color: '#ff5566' }]);
        expect([...resolved.keys()].sort((a, b) => a - b)).toEqual([4, 5]);
    });

    it('keys by UNIT index while matching by CHARACTER offset', () => {
        // The two are not the same number and must not be conflated. The scene's unit builder drops
        // whitespace, so on a latin line unit 2 ("fire") starts at character 9. The map is consumed as
        // keywordUnitColors.get(i) inside activeLineUnits.forEach, so it has to be keyed by unit index
        // even though the matcher works in character space.
        const line = 'burn the fire tonight';
        const units = [
            { charStart: 0, charEnd: 4 },   // burn
            { charStart: 5, charEnd: 8 },   // the
            { charStart: 9, charEnd: 13 },  // fire
            { charStart: 14, charEnd: 21 }, // tonight
        ];
        const resolved = resolveDioramaKeywordUnitColors(
            line,
            units,
            prepareDioramaKeywordMatchers([{ word: 'fire', color: '#ff5566' }], true),
            PRIMARY,
            ACCENT,
            BG,
        );
        expect([...resolved.keys()]).toEqual([2]);
    });

    it('falls back to the scene\'s own colouring when off or when the theme names no keywords', () => {
        const line = '火车经过花火大会';
        expect(resolve(line, [{ word: '花火', color: '#ff5566' }], false).size).toBe(0);
        expect(resolve(line, []).size).toBe(0);
        expect(resolve('', [{ word: '花火', color: '#ff5566' }]).size).toBe(0);
    });

    it('resolves a repeated keyword to one shared colour rather than re-searching per character', () => {
        const resolved = resolve('花火与花火', [{ word: '花火', color: '#ff5566' }]);
        expect([...resolved.keys()].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
        // Same object: the adaptation search runs once per distinct hex, not once per unit.
        expect(resolved.get(0)).toBe(resolved.get(4));
    });

    it.each([
        ['dark', '#0d0f14', '#e8e4dc', '#c8783c'],
        ['light', '#f4f1ea', '#2b2118', '#b4542a'],
        ['lowSaturation', '#3a3d42', '#c9ccd1', '#9aa3ad'],
        ['nearColour', '#2b3a2f', '#31402f', '#35452f'],
    ])('keeps a keyword legible on a %s theme', (_name, bg, primary, accent) => {
        const background = new THREE.Color(bg);
        // A keyword colour deliberately chosen close to the background - the hard case.
        const resolved = resolve(
            '花火',
            [{ word: '花火', color: bg }],
            true,
            new THREE.Color(primary),
            new THREE.Color(accent),
            background,
        );
        const color = resolved.get(0)!;
        expect(getDioramaKeywordDisplayedContrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
        // Corrected, not blown out: a keyword must stay a colour, not become a white blob.
        const srgb = color.clone().convertLinearToSRGB();
        expect(Math.max(srgb.r, srgb.g, srgb.b)).toBeLessThanOrEqual(1);
    });

    it('separates a keyword that would otherwise read as ordinary lyric text', () => {
        // Keyword == the lyric colour: the feature would do nothing at all.
        const primary = new THREE.Color('#e8e4dc');
        const resolved = resolve('花火', [{ word: '花火', color: '#e8e4dc' }], true, primary, ACCENT, BG);
        const color = resolved.get(0)!;
        const separation = Math.abs(color.r - primary.r)
            + Math.abs(color.g - primary.g)
            + Math.abs(color.b - primary.b);
        expect(separation).toBeGreaterThanOrEqual(0.4);
    });

    it('never shows an AI keyword colour before the singing reaches it', () => {
        // THE bug: the keyword colour was the unit's RESTING colour, so every AI-marked word in the line
        // sat there pre-coloured - the line showing its own answers ahead of the read-head. It is a
        // TARGET: what a word becomes when sung, never what it starts as.
        const primary = new THREE.Color('#e8e4dc');
        const keyword = new THREE.Color('#ffcc33');
        const unit = { startTime: 4, endTime: 5.5 };
        const out = new THREE.Color();

        for (const now of [0, 1, 3.9, 3.999, unit.startTime]) {
            resolveDioramaUnitFill(out, primary, keyword, resolveGradientEnergy(now, unit));
            expect(out.getHexString()).toBe(primary.getHexString());
        }
        // ...and once the wake has passed, back to plain - not left holding the keyword colour.
        resolveDioramaUnitFill(out, primary, keyword, resolveGradientEnergy(unit.endTime + 3, unit));
        expect(out.getHexString()).toBe(primary.getHexString());
    });

    it('dyes a keyword to its OWN colour as it is sung, and only then', () => {
        const primary = new THREE.Color('#e8e4dc');
        const keyword = new THREE.Color('#ffcc33');
        const unit = { startTime: 4, endTime: 5.5 };
        const out = new THREE.Color();

        // Peak: the glyph IS the keyword's colour, not a blend of it with the ordinary sung tint.
        resolveDioramaUnitFill(out, primary, keyword, resolveGradientEnergy(unit.endTime, unit));
        expect(out.getHexString()).toBe(keyword.getHexString());

        // Mid-word it is strictly between the two, and moving toward the keyword.
        const early = new THREE.Color();
        const later = new THREE.Color();
        resolveDioramaUnitFill(early, primary, keyword, resolveGradientEnergy(4.4, unit));
        resolveDioramaUnitFill(later, primary, keyword, resolveGradientEnergy(5.2, unit));
        const dist = (c: THREE.Color) => Math.abs(c.r - keyword.r) + Math.abs(c.g - keyword.g) + Math.abs(c.b - keyword.b);
        expect(dist(later)).toBeLessThan(dist(early));
        expect(early.getHexString()).not.toBe(primary.getHexString());
    });

    it('gives two adjacent keywords their own timing rather than lighting the phrase at once', () => {
        // 多个连续关键字应分别根据各自时间进度显示 - the second must still be plain while the first peaks.
        const primary = new THREE.Color('#e8e4dc');
        const keyword = new THREE.Color('#ffcc33');
        const first = { startTime: 4, endTime: 5 };
        const second = { startTime: 5, endTime: 6 };
        const out = new THREE.Color();

        resolveDioramaUnitFill(out, primary, keyword, resolveGradientEnergy(4.9, first));
        expect(out.getHexString()).not.toBe(primary.getHexString());
        resolveDioramaUnitFill(out, primary, keyword, resolveGradientEnergy(4.9, second));
        expect(out.getHexString()).toBe(primary.getHexString());
    });

    it('leaves a keyword colour that already works exactly as the theme set it', () => {
        // Minimal correction: a legible, distinct keyword must survive untouched, or the feature would
        // be quietly overriding palettes that were fine.
        const keyword = new THREE.Color('#ff5566');
        const resolved = resolve('花火', [{ word: '花火', color: '#ff5566' }]);
        const color = resolved.get(0)!;
        expect(color.getHexString()).toBe(keyword.getHexString());
    });
});

describe('Diorama background motes', () => {
    const frame: DioramaFrame = {
        position: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
    };
    const CIRC = 8;
    const RAD = 4;
    const DENSITY = CIRC * RAD;
    const writeOne = (line: number, seed = 'mote-seed'): Float32Array => {
        const out = new Float32Array(DIORAMA_MOTE_WINDOW_LINES * DENSITY * 3);
        writeDioramaMoteLine(out, frame, line, CIRC, RAD, seed);
        return out;
    };
    /** The motes one line owns, as [x,y,z] triples read back out of its ring slot. */
    const moteOf = (buffer: Float32Array, line: number): number[][] => {
        const start = dioramaMoteSlot(line) * DENSITY * 3;
        const points: number[][] = [];
        for (let p = 0; p < DENSITY; p += 1) {
            points.push([buffer[start + p * 3], buffer[start + p * 3 + 1], buffer[start + p * 3 + 2]]);
        }
        return points;
    };

    it('is deterministic and keeps an elliptical clearance around the lyric rail', () => {
        expect(Array.from(writeOne(3))).toEqual(Array.from(writeOne(3)));
        for (const [x, y] of moteOf(writeOne(3), 3)) {
            expect(Math.hypot(x, y / 0.64)).toBeGreaterThanOrEqual(2.4);
        }
    });

    it('gives every line of the resident window its own ring slot', () => {
        // If two resident lines shared a slot, one would silently overwrite the other and leave a gap in
        // the field. Holds for any read-head, including negative lines before a song's first lyric.
        for (const head of [0, 1, 7, 8, 40, -3]) {
            const slots = new Set<number>();
            for (let line = head - DIORAMA_MOTE_LINES_BEHIND; line <= head + DIORAMA_MOTE_LINES_AHEAD; line += 1) {
                slots.add(dioramaMoteSlot(line));
            }
            expect(slots.size).toBe(DIORAMA_MOTE_WINDOW_LINES);
        }
    });

    it('caps the point count however far the two density sliders are dragged', () => {
        expect(resolveDioramaMoteCircumference(1e9) * resolveDioramaMoteRadial(1e9) * DIORAMA_MOTE_WINDOW_LINES)
            .toBeLessThanOrEqual(DIORAMA_MOTE_MAX_POINTS);
        expect(resolveDioramaMoteCircumference(-50)).toBeGreaterThan(0);
        expect(resolveDioramaMoteRadial(-50)).toBeGreaterThan(0);
        expect(resolveDioramaMoteCircumference(Number.NaN)).toBe(DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference);
        expect(resolveDioramaMoteRadial(Number.NaN)).toBe(DEFAULT_DIORAMA_TUNING.backgroundParticleRadial);
    });

    it('extends a frame in a straight line one step per line past the lyrics', () => {
        const ahead = extendDioramaFrame(frame, 3);
        expect(ahead.position.z).toBeCloseTo(DIORAMA_STEP_DISTANCE * 3, 6);
        expect(ahead.forward).toEqual(frame.forward);
        expect(extendDioramaFrame(frame, 0)).toBe(frame);
    });

    it('does not rake each line into a helix (depth stays uncorrelated with radius)', () => {
        // Radius ramps with the point index by construction, so drawing depth from the index too would
        // wind every line into a visible spiral. Depth comes off a radical inverse for exactly that
        // reason - this pins the decorrelation rather than trusting the comment.
        const points = moteOf(writeOne(2), 2);
        const radii = points.map(([x, y]) => Math.hypot(x, y / 0.64));
        const depths = points.map(([, , z]) => z);
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const rBar = mean(radii);
        const dBar = mean(depths);
        const cov = mean(radii.map((r, i) => (r - rBar) * (depths[i] - dBar)));
        const correlation = cov / (
            Math.sqrt(mean(radii.map((r) => (r - rBar) ** 2)))
            * Math.sqrt(mean(depths.map((d) => (d - dBar) ** 2)))
        );
        expect(Math.abs(correlation)).toBeLessThan(0.3);
    });

    it('keeps every resident mote within a bounded distance of the read head', () => {
        // The regression this layer exists for: the field it replaced laid the WHOLE song out at once, so
        // motes hundreds of units away stacked up behind perspective into one bright far knot while the
        // camera had almost nothing near it. A window that cannot reach past its own line count cannot
        // do that, whatever the song's length.
        const frames = buildDioramaPath(60, 'mote-window');
        const circ = 8;
        const rad = 4;
        const buffer = new Float32Array(DIORAMA_MOTE_WINDOW_LINES * circ * rad * 3);
        const head = 20;
        for (let line = head - DIORAMA_MOTE_LINES_BEHIND; line <= head + DIORAMA_MOTE_LINES_AHEAD; line += 1) {
            writeDioramaMoteLine(buffer, frames[line], line, circ, rad, 'mote-window');
        }
        const anchor = frames[head].position;
        let farthest = 0;
        let near = 0;
        for (let i = 0; i < buffer.length; i += 3) {
            const distance = Math.hypot(buffer[i] - anchor.x, buffer[i + 1] - anchor.y, buffer[i + 2] - anchor.z);
            farthest = Math.max(farthest, distance);
            if (distance <= 15) near += 1;
        }
        // Window reach + the shell radius, and nothing beyond it.
        expect(farthest).toBeLessThan((DIORAMA_MOTE_LINES_AHEAD + 1) * DIORAMA_STEP_DISTANCE + 8);
        // ...and the near band is where the motes actually are, which is the other half of the bug.
        expect(near).toBeGreaterThan(circ * rad * 2);
    });
});

describe('Diorama tuning migration', () => {
    it('fills geometry defaults (including the new mode) for legacy saved tuning', () => {
        expect(resolveStoredDioramaTuning({ showParticles: false }).geometryVisibility)
            .toEqual(DEFAULT_DIORAMA_GEOMETRY_VISIBILITY);
        expect(resolveStoredDioramaTuning({
            geometryVisibility: { ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY, rings: false },
        })).toEqual({
            ...DEFAULT_DIORAMA_TUNING,
            geometryVisibility: { ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY, rings: false },
        });
        expect(resolveStoredDioramaTuning({
            geometryVisibility: { ...DEFAULT_DIORAMA_GEOMETRY_VISIBILITY, mode: 'corridor' },
        }).geometryVisibility.mode).toBe('corridor');
    });

    it('fills and clamps the point-cloud density for older or invalid settings', () => {
        expect(resolveStoredDioramaTuning({}).particleDensity).toBe(DEFAULT_DIORAMA_TUNING.particleDensity);
        expect(resolveStoredDioramaTuning({ particleDensity: 64 }).particleDensity)
            .toBe(DIORAMA_PARTICLE_DENSITY_MIN);
        expect(resolveStoredDioramaTuning({ particleDensity: DIORAMA_PARTICLE_DENSITY_MAX + 100 }).particleDensity)
            .toBe(DIORAMA_PARTICLE_DENSITY_MAX);
    });

    it('fills and clamps whole-cloud scale and glow settings', () => {
        const defaults = resolveStoredDioramaTuning({});
        const clamped = resolveStoredDioramaTuning({
            particleScale: DIORAMA_PARTICLE_SCALE_MAX + 2,
            particleGlowEnabled: false,
            particleGlowIntensity: DIORAMA_PARTICLE_GLOW_INTENSITY_MAX + 2,
        });

        expect(defaults.particleScale).toBe(DEFAULT_DIORAMA_TUNING.particleScale);
        expect(defaults.particleGlowEnabled).toBe(DEFAULT_DIORAMA_TUNING.particleGlowEnabled);
        expect(resolveStoredDioramaTuning({ particleScale: 0 }).particleScale).toBe(DIORAMA_PARTICLE_SCALE_MIN);
        expect(clamped.particleScale).toBe(DIORAMA_PARTICLE_SCALE_MAX);
        expect(clamped.particleGlowEnabled).toBe(false);
        expect(clamped.particleGlowIntensity).toBe(DIORAMA_PARTICLE_GLOW_INTENSITY_MAX);
    });
});

describe('Diorama 每字状态 reallocation', () => {
    // The reset used to key on the global index ALONE. updateActiveSegmentLines swaps a line's words in
    // place - same corridor, same globalStart, same index - when a slow load's lyrics land late or a
    // provider reprocesses them. The index does not move, so the envelope arrays kept the PREVIOUS line's
    // length and every unit past it read undefined -> NaN -> a NaN material colour, for the rest of the
    // line. It fails silently (a TypedArray swallows both the out-of-range read and the write), so the
    // length is the only honest thing to key on.
    it('reallocates when the words change under a STABLE global index', () => {
        // 'Hi' (1 unit) reprocessed into '你好世界啊' (5 units) while parked on the same line.
        expect(shouldResetDioramaUnitState(7, 7, 1, 5)).toBe(true);
    });

    it('reallocates on a new line, and on the first frame of all', () => {
        expect(shouldResetDioramaUnitState(6, 7, 4, 4)).toBe(true);
        expect(shouldResetDioramaUnitState(-1, 0, undefined, 3)).toBe(true);
    });

    it('does NOT reallocate every frame of a settled line (the envelopes must survive)', () => {
        // Same index, same unit count: the light/soul envelopes carry frame to frame - reallocating here
        // would zero them every frame and the glow/soul would never rise at all.
        expect(shouldResetDioramaUnitState(7, 7, 5, 5)).toBe(false);
        expect(shouldResetDioramaUnitState(0, 0, 0, 0)).toBe(false);
    });

    it('reallocates when a swap SHRINKS the line too', () => {
        // Not a NaN source (the extra slots are simply ignored), but the stale envelopes belong to words
        // that no longer exist, so the new line's units would inherit the old ones' brightness.
        expect(shouldResetDioramaUnitState(7, 7, 5, 2)).toBe(true);
    });
});

describe('Diorama ripple bands', () => {
    // The pool size is DERIVED from these two (DIORAMA_RIPPLE_COUNT), so "the count matches the bands" is
    // now true by construction and needs no test. What a test CAN still pin is the bands' design intent -
    // that they stay three distinct SCALES of ripple rather than three copies of one.
    it('keeps the bands distinct: bass wide and slow, treble tight and fast', () => {
        const [bass, mid, treble] = RIPPLE_BANDS;
        expect(bass.width).toBeGreaterThan(mid.width);
        expect(mid.width).toBeGreaterThan(treble.width);
        expect(bass.speed).toBeLessThan(mid.speed);
        expect(mid.speed).toBeLessThan(treble.speed);
        expect(bass.strength).toBeGreaterThan(treble.strength);
    });
});
