import { describe, expect, it } from 'vitest';
import { sampleMotesMask, MAX_MOTES_PARTICLES } from '@/components/visualizer/motes/motesSampling';
import { drawMotesLine, MOTES_GLYPH_ORBIT_PERIOD, resolveMotesPhase, type MotesDrawOptions } from '@/components/visualizer/motes/motesCanvas';
import type { MotesPreparedLine } from '@/components/visualizer/motes/motesLayout';
import { resolveMotesMaterial } from '@/components/visualizer/motes/motesMaterial';
import { DEFAULT_MOTES_TUNING } from '@/components/visualizer/motes/types';

// Particle budgets and time-addressable motion must hold independently of real-time playback or visual taste.

const mask = (width: number, height: number, alpha = 255) => ({
    width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? alpha : 0),
});

const preparedLine = (): MotesPreparedLine => ({
    line: { fullText: 'go go', startTime: 0, endTime: 2, words: [
        { text: 'go', startTime: 0, endTime: 1 }, { text: 'go', startTime: 1, endTime: 2 },
    ] },
    width: 300, height: 100, fontPx: 40, particleSize: 2,
    timings: [{ char: 'g', startTime: 0, endTime: 0.5, wordIndex: 0 }, { char: 'g', startTime: 1, endTime: 1.5, wordIndex: 1 }],
    x: new Float32Array([50, 150]), y: new Float32Array([50, 50]), alpha: new Float32Array([1, 0.5]),
    scatterX: new Float32Array([15, -20]), scatterY: new Float32Array([-10, 25]),
    phases: new Float32Array([0.3, 0.7]), glyphIndices: new Uint32Array([0, 1]),
});

const captureSettledLine = (parserDisablesMotion = false, prepared = preparedLine(), retainWordTiming = false) => {
    // Hold the line visible; most geometry tests omit cues, while formation tests retain source word timing.
    prepared.line = { ...prepared.line, endTime: 20, words: retainWordTiming ? prepared.line.words : [] };
    if (parserDisablesMotion) {
        prepared.line.renderHints = { rawDuration: 20, timingClass: 'normal', renderEndTime: 20, wordRevealMode: 'instant', lineTransitionMode: 'none' };
    }
    const painted: unknown[] = [];
    let material: ReturnType<typeof resolveMotesMaterial> = null;
    const context = {
        canvas: { ownerDocument: { createElement() {
            const paint = { fillStyle: '', globalCompositeOperation: 'source-over', createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
            return { width: 0, height: 0, getContext: () => paint };
        } } },
        fillStyle: '', globalAlpha: 1, save() {}, restore() {},
        translate(x: number, y: number) { painted.push(['translate', x, y]); },
        scale(x: number, y: number) { painted.push(['scale', x, y]); },
        fillRect() { throw new Error('The prepared material should use drawImage.'); },
        drawImage(sprite: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
            const rect = [sprite.getContext('2d')!.fillStyle, this.globalAlpha, x, y, width, height];
            painted.push(sprite === material?.glowPrimary || sprite === material?.glowAccent ? ['glow', ...rect] : rect);
        },
    };
    return (time: number, options: Partial<MotesDrawOptions> = {}) => {
        painted.length = 0;
        const theme = options.theme ?? { primaryColor: '#ffffff', accentColor: '#ff0000' };
        material = resolveMotesMaterial(context as unknown as CanvasRenderingContext2D, theme.primaryColor, theme.accentColor);
        drawMotesLine(context as unknown as CanvasRenderingContext2D, prepared, {
            time, theme: { primaryColor: '#ffffff', accentColor: '#ff0000' }, tuning: DEFAULT_MOTES_TUNING, ...options,
        });
        return structuredClone(painted);
    };
};

type PaintedRect = [string, number, number, number, number, number];
const lineRects = (painted: unknown[]) => painted.filter(command => Array.isArray(command) && command.length === 6) as PaintedRect[];
// Every original sample must remain a single grain draw; material identity still detects accidental halos.
const lineCores = (painted: unknown[], count = 2) => lineRects(painted).slice(0, count);
const centerOf = (rect: PaintedRect) => ({ x: rect[2] + rect[4] / 2, y: rect[3] + rect[5] / 2 });

const spreadPreparedLine = (count: number): MotesPreparedLine => ({
    ...preparedLine(), width: count * 80 + 100, height: 200, fontPx: 120,
    x: Float32Array.from({ length: count }, (_, index) => 50 + index * 80),
    y: new Float32Array(count).fill(100), alpha: new Float32Array(count).fill(1),
    scatterX: new Float32Array(count), scatterY: new Float32Array(count),
    phases: Float32Array.from({ length: count }, (_, index) => index * 0.37),
    glyphIndices: Uint32Array.from({ length: count }, (_, index) => index % 2),
});

describe('Motes mask sampling', () => {
    it('caps particle allocation and samples the whole mask instead of truncating its last rows', () => {
        const image = mask(400, 240);
        const sampled = sampleMotesMask(image, { step: 1, maxPoints: 100_000, seed: 42 });
        expect(sampled.x.length).toBeLessThanOrEqual(MAX_MOTES_PARTICLES);
        expect(sampled.y.length).toBe(sampled.x.length);
        expect(sampled.alpha.length).toBe(sampled.x.length);
        expect(Math.min(...sampled.y)).toBeLessThan(10);
        expect(Math.max(...sampled.y)).toBeGreaterThan(230);
        expect([...sampled.x].every(x => x >= 0 && x < 400)).toBe(true);
        expect([...sampled.y].every(y => y >= 0 && y < 240)).toBe(true);
        // Reduced budgets still represent the same opaque area with wider sample spacing.
        expect(sampled.x.length * sampled.pointSpacing ** 2).toBeCloseTo(400 * 240, 6);
        const sparse = sampleMotesMask(image, { step: 1, maxPoints: 4000, seed: 42 });
        expect(sparse.x.length).toBeLessThanOrEqual(4000);
        expect(sparse.pointSpacing).toBeGreaterThan(sampled.pointSpacing);
        expect(sparse.x.length * sparse.pointSpacing ** 2).toBeCloseTo(400 * 240, 6);
        // Uniform local coverage prevents the large random holes that erased parts of long lyrics.
        const occupiedTiles = new Set([...sparse.x].map((x, index) =>
            Math.floor(x / 10) + Math.floor(sparse.y[index] / 10) * 40));
        expect(occupiedTiles.size).toBe(40 * 24);
        // A visible majority must leave pixel centers, without losing the local coverage above.
        for (const positions of [sparse.x, sparse.y]) {
            expect([...positions].filter(value => Math.abs(value % 1 - 0.5) > 0.05).length)
                .toBeGreaterThan(positions.length / 2);
        }
        expect(image.data).toEqual(mask(400, 240).data);
    });

    it('reproduces the same target field and changes selection with a different seed', () => {
        const image = mask(100, 80);
        const first = sampleMotesMask(image, { maxPoints: 40, seed: 7 });
        expect(sampleMotesMask(image, { maxPoints: 40, seed: 7 })).toEqual(first);
        expect(sampleMotesMask(image, { maxPoints: 40, seed: 8 }).x).not.toEqual(first.x);
    });

    it('jitters within sampling cells while keeping thin mask edges covered and seeded', () => {
        const solid = mask(32, 24);
        const jittered = sampleMotesMask(solid, { step: 4, maxPoints: 1000, seed: 7 });
        expect(jittered.x).toHaveLength(48);
        expect(jittered.pointSpacing).toBe(4);
        expect([...jittered.x].some((x, index) => Math.abs(x - (index % 8 * 4 + 2)) > 1)).toBe(true);
        for (let index = 0; index < jittered.x.length; index += 1) {
            expect(Math.floor(jittered.x[index] / 4)).toBe(index % 8);
            expect(Math.floor(jittered.y[index] / 4)).toBe(Math.floor(index / 8));
        }
        expect(sampleMotesMask(solid, { step: 4, maxPoints: 1000, seed: 7 })).toEqual(jittered);
        expect(sampleMotesMask(solid, { step: 4, maxPoints: 1000, seed: 8 }).x).not.toEqual(jittered.x);
        const thin = mask(32, 24, 0);
        for (let y = 2; y < thin.height; y += 4) for (let x = 2; x < thin.width; x += 4) {
            thin.data[(y * thin.width + x) * 4 + 3] = 128;
        }
        const edge = sampleMotesMask(thin, { step: 4, maxPoints: 1000, seed: 7 });
        expect(edge.x.length).toBe(jittered.x.length);
        for (let index = 0; index < edge.x.length; index += 1) {
            const pixel = (Math.floor(edge.y[index]) * thin.width + Math.floor(edge.x[index])) * 4 + 3;
            expect(thin.data[pixel]).toBeGreaterThan(38);
            expect(edge.alpha[index]).toBeCloseTo(thin.data[pixel] / 255, 6);
        }
        const budgetedEdge = sampleMotesMask(thin, { step: 4, maxPoints: 8, seed: 7 });
        expect(budgetedEdge.x.length).toBeGreaterThan(0);
        expect(budgetedEdge.x.length).toBeLessThanOrEqual(8);
        expect(sampleMotesMask(thin, { step: 4, maxPoints: 8, seed: 7 })).toEqual(budgetedEdge);
        for (let index = 0; index < budgetedEdge.x.length; index += 1) {
            const pixel = (Math.floor(budgetedEdge.y[index]) * thin.width + Math.floor(budgetedEdge.x[index])) * 4 + 3;
            expect(thin.data[pixel]).toBeGreaterThan(38);
            expect(budgetedEdge.alpha[index]).toBeCloseTo(thin.data[pixel] / 255, 6);
        }
    });

    it('ignores transparent pixels and accepts empty or zero-budget masks', () => {
        expect(sampleMotesMask(mask(20, 20, 0)).x).toHaveLength(0);
        expect(sampleMotesMask(mask(0, 0)).x).toHaveLength(0);
        expect(sampleMotesMask(mask(20, 20), { maxPoints: 0 }).x).toHaveLength(0);
        expect(sampleMotesMask(mask(20, 20, 0), { step: 4 }).pointSpacing).toBe(4);
        expect(sampleMotesMask(mask(20, 20), { step: 4, maxPoints: 0 }).pointSpacing).toBe(4);
        const faint = sampleMotesMask(mask(20, 20, 128));
        expect(faint.alpha.length).toBeGreaterThan(0);
        expect([...faint.alpha].every(alpha => Math.abs(alpha - 128 / 255) < 1e-6)).toBe(true);
    });
});

describe('Motes lyric timing', () => {
    it.each([0.04, 0.2, 0.7, 5])('finishes gathering before a %s-second lyric ends', duration => {
        const line = { startTime: 10, endTime: 10 + duration, transition: 0.8 };
        const before = resolveMotesPhase({ ...line, time: 9.9 });
        expect(before.opacity).toBe(0);
        const readable = resolveMotesPhase({ ...line, time: 10 + duration / 2 });
        expect(readable).toEqual({ assembly: 1, scatter: 0, opacity: 1 });
    });

    it('scatters on the outgoing boundary, with static and reduced-motion alternatives', () => {
        const options = { startTime: 0, endTime: 3, transition: 0.4, exitStart: 3 };
        expect(resolveMotesPhase({ ...options, time: 3.2 }).scatter).toBeGreaterThan(0);
        expect(resolveMotesPhase({ ...options, time: 3.5 }).opacity).toBe(0);
        expect(resolveMotesPhase({ ...options, time: 3.2, staticMode: true })).toEqual({ assembly: 1, scatter: 0, opacity: 1 });
        expect(resolveMotesPhase({ ...options, time: 1, reducedMotion: true })).toEqual({ assembly: 1, scatter: 0, opacity: 1 });
        expect(resolveMotesPhase({ ...options, time: 3.2, reducedMotion: true }).opacity).toBe(0);
    });

    it('paints the same frame after a backwards seek without mutating prepared geometry', () => {
        const prepared = preparedLine();
        const original = structuredClone(prepared);
        const painted: unknown[] = [];
        const context = {
            fillStyle: '', globalAlpha: 1, save() {}, restore() {},
            fillRect(x: number, y: number, width: number, height: number) {
                painted.push([this.fillStyle, this.globalAlpha, x, y, width, height]);
            },
        };
        const draw = (time: number) => {
            painted.length = 0;
            drawMotesLine(context as unknown as CanvasRenderingContext2D, prepared, {
                time, theme: { primaryColor: '#ffffff', accentColor: '#ff0000' }, tuning: { ...DEFAULT_MOTES_TUNING, drift: 0 },
            });
            return structuredClone(painted);
        };
        const early = draw(0.2);
        draw(1.5);
        draw(0);
        expect(draw(0.2)).toEqual(early);
        const settled = draw(1.5) as [string, number, number, number, number, number][];
        expect(settled.find(point => Math.abs(centerOf(point).x - 150) < 1e-8)?.[0]).toBe('#ff0000');
        expect(settled.find(point => Math.abs(centerOf(point).x - 50) < 1e-8)?.[0]).toBe('#ffffff');
        expect(prepared).toEqual(original);
    });

    it('animates a settled lyric and reproduces the complete frame after a seek', () => {
        const draw = captureSettledLine();
        const first = draw(1);
        // Ignore whole-line transforms: the particles themselves must move within the glyph field.
        expect(lineCores(draw(10)).map(centerOf)).not.toEqual(lineCores(first).map(centerOf));
        draw(0); draw(19);
        expect(draw(1)).toEqual(first);
    });

    it('moves every core inside its stroke on a closed orbit without separating neighboring samples', () => {
        const prepared = spreadPreparedLine(4);
        prepared.fontPx = 40; prepared.width = 300;
        prepared.x = new Float32Array([50, 51, 52, 52]);
        prepared.y = new Float32Array([100, 100, 100, 101]);
        const draw = captureSettledLine(false, prepared);
        const centers = (painted: unknown[]) => lineCores(painted, prepared.x.length).map(centerOf);
        const first = centers(draw(1));
        const later = centers(draw(2));
        expect(first).toHaveLength(4);
        expect(later).toHaveLength(4);
        for (let index = 0; index < first.length; index += 1) {
            expect(Math.hypot(later[index].x - first[index].x, later[index].y - first[index].y)).toBeGreaterThan(0.05);
        }
        centers(draw(1 + MOTES_GLYPH_ORBIT_PERIOD)).forEach((point, index) => {
            expect(point.x).toBeCloseTo(first[index].x, 8);
            expect(point.y).toBeCloseTo(first[index].y, 8);
        });
        for (const drift of [DEFAULT_MOTES_TUNING.drift, 1]) for (const time of [1, 2, 3, 4]) {
            const displacements = centers(draw(time, { tuning: { ...DEFAULT_MOTES_TUNING, drift } }))
                .map((point, index) => ({ x: point.x - prepared.x[index], y: point.y - prepared.y[index] }));
            expect(displacements.every(point => Math.hypot(point.x, point.y) <= 1)).toBe(true);
            for (let index = 1; index < displacements.length; index += 1) {
                const neighborDelta = Math.hypot(displacements[index].x - displacements[index - 1].x, displacements[index].y - displacements[index - 1].y);
                expect(neighborDelta).toBeGreaterThan(1e-6);
                expect(neighborDelta).toBeLessThan(0.2);
            }
        }
        const changedMetadata = {
            ...prepared,
            phases: Float32Array.from(prepared.phases, (value, index) => value + 5 + index * 3),
            glyphIndices: Uint32Array.from(prepared.glyphIndices, value => 1 - value),
        };
        const withOtherSeeds = captureSettledLine(false, changedMetadata);
        for (const [time, expected] of [[1, first], [2, later]] as const) {
            centers(withOtherSeeds(time)).forEach((point, index) => {
                expect(point.x).toBeCloseTo(expected[index].x, 8);
                expect(point.y).toBeCloseTo(expected[index].y, 8);
            });
        }
    });

    it('keeps every row anchored to its original baseline', () => {
        const prepared = spreadPreparedLine(2);
        prepared.fontPx = 40; prepared.width = 300;
        prepared.x.fill(50); prepared.y = new Float32Array([30, 130]);
        const draw = captureSettledLine(false, prepared);
        for (const time of [1, 1.6, 2.2, 2.8, 3.4, 4]) {
            const centers = lineCores(draw(time)).map(centerOf);
            centers.forEach((point, index) => {
                expect(Math.hypot(point.x - prepared.x[index], point.y - prepared.y[index])).toBeLessThanOrEqual(1);
            });
        }
    });

    it('keeps a fully bright anchored majority while its few roaming grains return', () => {
        const prepared = spreadPreparedLine(64);
        prepared.line.words = [{ text: 'go', startTime: 1, endTime: 3 }];
        prepared.glyphIndices.fill(0);
        const original = structuredClone(prepared);
        const draw = captureSettledLine(false, prepared, true);
        for (const time of [0.8, 1, 1.3, 1.8, 4, 8.5, 13]) {
            const painted = draw(time, { tuning: { ...DEFAULT_MOTES_TUNING, drift: 1 } });
            const grains = lineRects(painted);
            expect(painted).toHaveLength(prepared.x.length);
            expect(grains).toHaveLength(prepared.x.length);
            grains.forEach((rect, index) => {
                expect(rect.slice(1).every(value => typeof value === 'number' && Number.isFinite(value))).toBe(true);
                expect(rect[1]).toBeGreaterThan(0);
                expect(rect[1]).toBeLessThanOrEqual(1);
                expect(rect[4]).toBeLessThanOrEqual(prepared.particleSize * 1.35);
                expect(rect[5]).toBeLessThanOrEqual(prepared.particleSize * 1.35);
                const center = centerOf(rect);
                const distance = Math.hypot(center.x - prepared.x[index], center.y - prepared.y[index]);
                expect(distance).toBeLessThanOrEqual(29);
                if (time <= 1) {
                    expect(rect[1]).toBeGreaterThanOrEqual(0.5);
                    if (distance <= 1) expect(rect[1]).toBe(1);
                    else expect(rect[1]).toBeLessThan(1);
                } else if (time >= 1.8) {
                    expect(distance).toBeLessThanOrEqual(1);
                    expect(rect[1]).toBe(1);
                }
            });
            const brightAnchors = grains.filter((rect, index) => {
                const center = centerOf(rect);
                return rect[1] === 1 && Math.hypot(center.x - prepared.x[index], center.y - prepared.y[index]) <= 1;
            });
            expect(brightAnchors.length).toBeGreaterThanOrEqual(prepared.x.length - Math.floor(prepared.x.length / 10));
        }
        expect(prepared.x).toEqual(original.x);
        expect(prepared.y).toEqual(original.y);
    });

    it('varies waiting-grain brightness and size without altering the anchored majority or adding draws', () => {
        const prepared = spreadPreparedLine(60);
        prepared.fontPx = 40;
        prepared.line.words = [{ text: 'go', startTime: 10, endTime: 12 }];
        prepared.glyphIndices.fill(0);
        const draw = captureSettledLine(false, prepared, true);
        const formed = lineRects(draw(11));
        const changed = new Set<number>();
        let sawBrightLargerGrain = false;
        const first = draw(0.5);
        for (const time of [0.5, 1.5, 3, 5.5, 8, 10.2]) {
            const painted = draw(time);
            expect(painted).toHaveLength(prepared.x.length);
            lineRects(painted).forEach((rect, index) => {
                expect(rect[1]).toBeGreaterThanOrEqual(0.5);
                expect(rect[1]).toBeLessThanOrEqual(1);
                expect(rect[4]).toBeGreaterThanOrEqual(formed[index][4]);
                expect(rect[4]).toBeLessThanOrEqual(formed[index][4] * 1.35);
                expect(rect[5]).toBe(rect[4]);
                if (rect[1] !== formed[index][1] || rect[4] !== formed[index][4]) changed.add(index);
                if (rect[1] > 0.75 && rect[4] > formed[index][4] * 1.15) sawBrightLargerGrain = true;
            });
        }
        expect(changed.size).toBeGreaterThan(0);
        expect(changed.size).toBeLessThanOrEqual(Math.floor(prepared.x.length / 10));
        expect(sawBrightLargerGrain).toBe(true);
        expect(draw(0.5)).toEqual(first);
        expect(lineRects(draw(15)).map(rect => [rect[1], rect[4], rect[5]]))
            .toEqual(formed.map(rect => [rect[1], rect[4], rect[5]]));
    });

    it('does not scatter the anchored majority or shrink roaming paths during the line entrance', () => {
        const waiting = spreadPreparedLine(30);
        waiting.fontPx = 40;
        waiting.line.words = [{ text: 'go', startTime: 1, endTime: 3 }];
        waiting.glyphIndices.fill(0);
        waiting.scatterX.fill(50); waiting.scatterY.fill(50);
        const cloud = lineRects(captureSettledLine(false, waiting, true)(0.001));
        expect(cloud).toHaveLength(waiting.x.length);
        const wandering = cloud.filter((rect, index) => {
            const center = centerOf(rect);
            return Math.hypot(center.x - waiting.x[index], center.y - waiting.y[index]) > 1;
        });
        expect(wandering).toHaveLength(Math.floor(waiting.x.length / 10));
        cloud.forEach((rect, index) => {
            const center = centerOf(rect);
            expect(Math.hypot(center.x - waiting.x[index], center.y - waiting.y[index])).toBeLessThanOrEqual(29);
        });
        for (const duration of [0.05, 0.2]) {
            const early = spreadPreparedLine(30);
            early.line.words = [{ text: 'go', startTime: 0, endTime: duration }];
            early.glyphIndices.fill(0);
            early.scatterX.fill(50); early.scatterY.fill(50);
            const grains = lineRects(captureSettledLine(false, early, true)(duration));
            expect(grains).toHaveLength(early.x.length);
            grains.forEach((rect, index) => {
                const center = centerOf(rect);
                expect(Math.hypot(center.x - early.x[index], center.y - early.y[index])).toBeLessThanOrEqual(1);
            });
        }
    });

    it('moves low-coverage edges less than the interior of a stroke', () => {
        const prepared = spreadPreparedLine(3);
        prepared.x.fill(50); prepared.y.fill(100); prepared.alpha = new Float32Array([1, 0.2, 0]);
        const cores = lineCores(captureSettledLine(false, prepared)(1), prepared.x.length).map(centerOf);
        const radius = (point: { x: number; y: number }) => Math.hypot(point.x - prepared.x[0], point.y - prepared.y[0]);
        expect(radius(cores[1])).toBeGreaterThan(0);
        expect(radius(cores[1])).toBeLessThan(radius(cores[0]) * 0.6);
    });

    it('keeps the settled text weight and brightness fixed while its grains orbit', () => {
        const prepared = spreadPreparedLine(3);
        const draw = captureSettledLine(false, prepared);
        const appearance = (time: number) => lineCores(draw(time), prepared.x.length).map(rect => [rect[0], rect[1], rect[4], rect[5]]);
        const first = appearance(1);
        expect(first).toHaveLength(prepared.x.length);
        for (const time of [1.2, 2, 3.4, 5.8, 10, 13]) expect(appearance(time)).toEqual(first);
    });

    it('does not duplicate roaming grains at their anchors or add extra halos', () => {
        const prepared = spreadPreparedLine(30);
        prepared.fontPx = 40;
        prepared.line.words = [{ text: 'go', startTime: 1, endTime: 3 }];
        prepared.glyphIndices.fill(0);
        const draw = captureSettledLine(false, prepared, true);
        const painted = draw(0.8);
        const grains = lineRects(painted);
        expect(painted).toHaveLength(prepared.x.length);
        expect(grains).toHaveLength(prepared.x.length);
        const roaming = grains.map((rect, index) => ({ index, center: centerOf(rect) }))
            .filter(({ index, center }) => Math.hypot(center.x - prepared.x[index], center.y - prepared.y[index]) > 1);
        expect(roaming).toHaveLength(Math.floor(prepared.x.length / 10));
        for (const { index } of roaming) {
            expect(grains.some(rect => {
                const center = centerOf(rect);
                return Math.hypot(center.x - prepared.x[index], center.y - prepared.y[index]) <= 1;
            })).toBe(false);
        }
        const assembled = lineRects(draw(1.8));
        assembled.forEach((rect, index) => {
            const center = centerOf(rect);
            expect(Math.hypot(center.x - prepared.x[index], center.y - prepared.y[index])).toBeLessThanOrEqual(1);
        });
    });

    it.each(['static', 'reduced', 'drift-disabled', 'parser-disabled'])('leaves settled glyphs stationary with %s motion', mode => {
        const prepared = spreadPreparedLine(30);
        prepared.line.words = [{ text: 'go', startTime: 10, endTime: 12 }];
        prepared.glyphIndices.fill(0);
        const draw = captureSettledLine(mode === 'parser-disabled', prepared, true);
        const options = {
            staticMode: mode === 'static', reducedMotion: mode === 'reduced',
            tuning: { ...DEFAULT_MOTES_TUNING, ...(mode === 'drift-disabled' ? { drift: 0 } : {}) },
        };
        const first = draw(1.2, options);
        expect(first).toHaveLength(prepared.x.length);
        expect(draw(1.8, options)).toEqual(first);
    });
});
