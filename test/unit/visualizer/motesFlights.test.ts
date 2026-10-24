import { describe, expect, it } from 'vitest';
import { createMotesFlightFrame, resolveMotesFlight } from '@/components/visualizer/motes/motesFlights';
import type { MotesPreparedLine } from '@/components/visualizer/motes/motesLayout';
import { drawMotesLine } from '@/components/visualizer/motes/motesCanvas';
import { DEFAULT_MOTES_TUNING } from '@/components/visualizer/motes/types';

// A readable glyph keeps most samples anchored while a small original subset roams and returns at its word cue.
const preparedLine = (count = 60): MotesPreparedLine => ({
    line: { fullText: 'go', startTime: 0, endTime: 30, words: [{ text: 'go', startTime: 1, endTime: 3 }] },
    width: 640, height: 240, fontPx: 40, particleSize: 2,
    timings: [{ char: 'g', startTime: 1, endTime: 3, wordIndex: 0 }],
    x: Float32Array.from({ length: count }, (_, index) => 80 + index % 20 * 12),
    y: Float32Array.from({ length: count }, (_, index) => 120 + index % 3 * 3),
    alpha: new Float32Array(count).fill(1), phases: new Float32Array(count),
    scatterX: new Float32Array(count), scatterY: new Float32Array(count), glyphIndices: new Uint32Array(count),
});

const offsetsAt = (prepared: MotesPreparedLine, time: number, strength = 1) => {
    const frame = createMotesFlightFrame(prepared, time, strength);
    return Array.from(prepared.x, (x, index) => {
        const offset = { x: 100, y: 100, lift: 100, sparkle: 100, wordTimed: false };
        resolveMotesFlight(frame, index, x, prepared.y[index], offset);
        return offset;
    });
};
const distanceOf = (offset: { x: number; y: number }) => Math.hypot(offset.x, offset.y);
const dispersedAt = (prepared: MotesPreparedLine, time: number) => offsetsAt(prepared, time).filter(offset => distanceOf(offset) > 1e-6);
const formed = { x: 0, y: 0, lift: 0, sparkle: 0, wordTimed: true };

const repeatedWords = () => {
    const prepared = preparedLine();
    prepared.line.fullText = 'go go';
    prepared.line.words = [{ text: 'go', startTime: 1, endTime: 2 }, { text: 'go', startTime: 4, endTime: 5 }];
    prepared.timings = [{ char: 'g', startTime: 1, endTime: 2, wordIndex: 0 }, { char: 'g', startTime: 4, endTime: 5, wordIndex: 1 }];
    // Deliberately put the late word on the left: source time, not layout order, chooses assembly.
    prepared.glyphIndices.fill(0);
    prepared.glyphIndices[7] = 1;
    return prepared;
};

describe('Motes word-cued glyph formation', () => {
    it('keeps at least ninety percent of glyph samples anchored across sparse, partial and dense masks', () => {
        for (const count of [1, 4, 9, 10, 19, 20, 60, 1000, 8000]) {
            const prepared = preparedLine(count);
            const original = structuredClone(prepared);
            const waiting = offsetsAt(prepared, 0.5);
            const roaming = waiting.filter(offset => offset.lift === 1);
            expect(waiting).toHaveLength(count);
            expect(roaming).toHaveLength(Math.floor(count / 10));
            expect(roaming.every(offset => distanceOf(offset) > 0.1 && distanceOf(offset) <= 28)).toBe(true);
            expect(waiting.filter(offset => offset.lift === 0).every(offset => offset.x === 0 && offset.y === 0)).toBe(true);
            expect(waiting.every(offset => offset.wordTimed)).toBe(true);
            expect(waiting.slice(count - count % 10).every(offset => offset.lift === 0)).toBe(true);
            expect(offsetsAt(prepared, 0.5)).toEqual(waiting);
            expect(prepared).toEqual(original);
        }
    });

    it('lets its small seeded subset roam visibly in several directions while the remaining stroke stays fixed', () => {
        const prepared = preparedLine(200);
        prepared.line.words[0] = { text: 'go', startTime: 10, endTime: 12 };
        const early = offsetsAt(prepared, 0.5);
        const later = offsetsAt(prepared, 6.5);
        const roaming = early.filter(offset => offset.lift === 1);
        for (const xSign of [-1, 1]) for (const ySign of [-1, 1]) {
            expect(roaming.some(offset => offset.x * xSign > 1 && offset.y * ySign > 1)).toBe(true);
        }
        const travel = early.map((offset, index) => Math.hypot(offset.x - later[index].x, offset.y - later[index].y));
        expect(travel.some(distance => distance > 1)).toBe(true);
        expect(travel.filter(distance => distance > 0).length).toBeLessThanOrEqual(Math.floor(prepared.x.length / 10));
        prepared.phases.fill(5);
        expect(offsetsAt(prepared, 0.5)).not.toEqual(early);
    });

    it('shimmers only waiting wanderers and fades the shimmer completely on return', () => {
        const prepared = preparedLine();
        prepared.line.words[0] = { text: 'go', startTime: 10, endTime: 12 };
        const first = offsetsAt(prepared, 0.5);
        const frames = [first, offsetsAt(prepared, 1.5), offsetsAt(prepared, 3), offsetsAt(prepared, 5.5)];
        for (const frame of frames) {
            expect(frame.filter(offset => offset.sparkle > 0).length).toBeLessThanOrEqual(Math.floor(prepared.x.length / 10));
            frame.forEach(offset => {
                expect(offset.sparkle).toBeGreaterThanOrEqual(0);
                expect(offset.sparkle).toBeLessThanOrEqual(offset.lift);
            });
        }
        expect(first.some((offset, index) => Math.abs(offset.sparkle - frames[2][index].sparkle) > 0.25)).toBe(true);
        expect(offsetsAt(prepared, 10.6).every(offset => offset.sparkle === 0)).toBe(true);
        expect(offsetsAt(prepared, 0.5)).toEqual(first);
    });

    it('returns the roaming subset at its word cue and leaves the complete word formed afterwards', () => {
        const prepared = preparedLine(200);
        prepared.line.words[0].endTime = 8;
        for (const time of [0.1, 0.5, 0.999, 1]) {
            const offsets = offsetsAt(prepared, time);
            expect(offsets.filter(offset => offset.lift === 1)).toHaveLength(20);
            expect(offsets.filter(offset => offset.lift === 0)).toHaveLength(180);
        }
        const gathering = offsetsAt(prepared, 1.3);
        const returning = gathering.filter(offset => offset.lift > 0);
        expect(returning).toHaveLength(20);
        expect(returning.every(offset => offset.lift < 1)).toBe(true);
        expect(new Set(returning.map(offset => offset.lift.toFixed(4))).size).toBeGreaterThan(5);
        for (const time of [1.6, 3, 7.9, 8, 15, 29]) {
            expect(offsetsAt(prepared, time).every(offset => offset.x === 0 && offset.y === 0 && offset.lift === 0)).toBe(true);
        }
    });

    it('uses explicit repeated-word mappings even when spatial order disagrees with timing', () => {
        const prepared = repeatedWords();
        const early = offsetsAt(prepared, 1.8);
        expect(early[7].lift).toBe(1);
        expect(distanceOf(early[7])).toBeGreaterThan(1);
        expect(early[17]).toEqual(formed);
        const late = offsetsAt(prepared, 4.2);
        expect(late[7].lift).toBeGreaterThan(0);
        expect(late[7].lift).toBeLessThan(1);
        expect(late[17]).toEqual(formed);
        expect(dispersedAt(prepared, 4.6)).toHaveLength(0);
        // Parser grapheme subdivision does not invent a second cue within a source Word.
        prepared.timings[0].startTime = 1.9;
        expect(offsetsAt(prepared, 1.8)).toEqual(early);
    });

    it('keeps the cue, gathering and drifting-noise boundaries continuous', () => {
        const prepared = preparedLine();
        let previous = offsetsAt(prepared, 0.95);
        for (let step = 1; step <= 70; step += 1) {
            const current = offsetsAt(prepared, 0.95 + step / 100);
            current.forEach((offset, index) => {
                expect(Math.hypot(offset.x - previous[index].x, offset.y - previous[index].y)).toBeLessThan(3);
                expect(Math.abs(offset.lift - previous[index].lift)).toBeLessThan(0.06);
                expect(Math.abs(offset.sparkle - previous[index].sparkle)).toBeLessThan(0.08);
            });
            previous = current;
        }
        expect(previous.every(offset => offset.lift === 0)).toBe(true);
        prepared.line.words[0] = { text: 'go', startTime: 10, endTime: 12 };
        let drifting = offsetsAt(prepared, 0);
        for (let step = 1; step < 1000; step += 1) {
            const current = offsetsAt(prepared, step / 100);
            current.forEach((offset, index) => {
                expect(Math.hypot(offset.x - drifting[index].x, offset.y - drifting[index].y)).toBeLessThan(0.2);
                expect(Math.abs(offset.sparkle - drifting[index].sparkle)).toBeLessThan(0.04);
            });
            drifting = current;
        }
    });

    it('restores either scattered or formed geometry directly after arbitrary seeks', () => {
        const prepared = repeatedWords();
        const waiting = offsetsAt(prepared, 0.5);
        const middle = offsetsAt(prepared, 4.2);
        offsetsAt(prepared, 20); offsetsAt(prepared, 1.2); offsetsAt(prepared, 0);
        expect(offsetsAt(prepared, 4.2)).toEqual(middle);
        expect(offsetsAt(prepared, 0.5)).toEqual(waiting);
        expect(offsetsAt(prepared, 5).every(offset => offset.lift === 0)).toBe(true);
    });

    it('keeps source timestamps and waiting drift aligned when the whole lyric shifts in the song', () => {
        const prepared = repeatedWords();
        const shifted = structuredClone(prepared);
        shifted.line.startTime += 100; shifted.line.endTime += 100;
        shifted.line.words.forEach(word => { word.startTime += 100; word.endTime += 100; });
        shifted.timings.forEach(glyph => { glyph.startTime += 100; glyph.endTime += 100; });
        for (const time of [0.5, 1.3, 4.2, 5]) {
            const original = offsetsAt(prepared, time);
            offsetsAt(shifted, time + 100).forEach((offset, index) => {
                expect(offset.x).toBeCloseTo(original[index].x, 9);
                expect(offset.y).toBeCloseTo(original[index].y, 9);
                expect(offset.lift).toBeCloseTo(original[index].lift, 9);
                expect(offset.sparkle).toBeCloseTo(original[index].sparkle, 9);
            });
        }
    });

    it('keeps roaming samples bounded even on narrow or tiny viewports', () => {
        for (const [width, height] of [[320, 180], [100, 60], [24, 24]]) {
            const prepared = preparedLine();
            Object.assign(prepared, { width, height });
            prepared.x.fill(width / 2); prepared.y.fill(height / 2);
            for (const time of [0.1, 0.5, 0.99, 1.05, 1.3, 1.55]) {
                offsetsAt(prepared, time, 2).forEach((offset, index) => {
                    expect(prepared.x[index] + offset.x).toBeGreaterThanOrEqual(4);
                    expect(prepared.x[index] + offset.x).toBeLessThanOrEqual(width - 4);
                    expect(prepared.y[index] + offset.y).toBeGreaterThanOrEqual(4);
                    expect(prepared.y[index] + offset.y).toBeLessThanOrEqual(height - 4);
                    expect(distanceOf(offset)).toBeLessThanOrEqual(28);
                    expect(offset.lift).toBeGreaterThanOrEqual(0);
                    expect(offset.lift).toBeLessThanOrEqual(1);
                });
            }
        }
        for (const [x, y] of [[1, 120], [639, 120], [80, 1], [80, 239]]) {
            const edge = preparedLine(); edge.x.fill(x); edge.y.fill(y);
            expect(dispersedAt(edge, 0.5)).toHaveLength(0);
        }
    });

    it('finishes quick and final words inside their available sung duration', () => {
        for (const duration of [0.01, 0.05, 0.2, 0.6]) {
            const prepared = preparedLine();
            prepared.line.words[0] = { text: 'go', startTime: 1, endTime: 1 + duration };
            expect(offsetsAt(prepared, 0.9).filter(offset => offset.lift === 1)).toHaveLength(Math.floor(prepared.x.length / 10));
            expect(offsetsAt(prepared, 1 + duration * 0.9).every(offset => offset.lift === 0)).toBe(true);
        }
        const final = preparedLine();
        final.line.endTime = 5;
        final.line.words[0] = { text: 'go', startTime: 4.9, endTime: 6 };
        expect(offsetsAt(final, 4.89).filter(offset => offset.lift === 1)).toHaveLength(Math.floor(final.x.length / 10));
        expect(offsetsAt(final, 4.99).every(offset => offset.lift === 0)).toBe(true);
        expect(dispersedAt(final, 5)).toHaveLength(0);
        final.line.startTime = 4;
        final.line.words[0] = { text: 'go', startTime: 3.5, endTime: 4.5 };
        expect(offsetsAt(final, 4.4).every(offset => offset.lift === 0)).toBe(true);
    });

    it('keeps words without a usable source cue fully formed', () => {
        const noWords = preparedLine(); noWords.line.words = [];
        expect(createMotesFlightFrame(noWords, 0.5, 1)).toBeNull();
        const unmapped = preparedLine(); unmapped.timings[0].wordIndex = undefined;
        expect(offsetsAt(unmapped, 0.5).every(offset => offset.lift === 0)).toBe(true);
        const absent = preparedLine(); absent.glyphIndices.fill(100);
        expect(offsetsAt(absent, 0.5).every(offset => offset.lift === 0)).toBe(true);
        for (const [startTime, endTime] of [[1, 1], [2, 1], [NaN, 3], [1, Infinity], [-2, -1], [31, 32]]) {
            const invalid = preparedLine(); invalid.line.words[0] = { text: 'go', startTime, endTime };
            expect(offsetsAt(invalid, 0.5).every(offset => offset.lift === 0)).toBe(true);
        }
    });

    it('clears reused offsets for disabled, invalid, empty and off-viewport inputs', () => {
        const prepared = preparedLine();
        for (const strength of [0, -1, NaN, Infinity]) expect(createMotesFlightFrame(prepared, 0.5, strength)).toBeNull();
        for (const time of [NaN, Infinity, -Infinity, -1, 30]) expect(createMotesFlightFrame(prepared, time, 1)).toBeNull();
        for (const invalid of [{ width: 0 }, { height: 12 }, { width: NaN }, { height: Infinity }, { fontPx: NaN }, { fontPx: 0 }]) {
            expect(createMotesFlightFrame({ ...prepared, ...invalid }, 0.5, 1)).toBeNull();
        }
        expect(createMotesFlightFrame(preparedLine(0), 0.5, 1)).toBeNull();
        const frame = createMotesFlightFrame(prepared, 0.5, 1);
        const reusable = { x: 1, y: 1, lift: 1, sparkle: 1, wordTimed: true };
        for (const [x, y] of [[NaN, 120], [80, Infinity]]) {
            resolveMotesFlight(frame, 0, x, y, reusable);
            expect(reusable).toEqual({ ...formed, wordTimed: false });
        }
        resolveMotesFlight(frame, 7, 80, 120, reusable);
        expect(reusable.sparkle).toBeGreaterThan(0);
        resolveMotesFlight(frame, 0, 80, 120, reusable);
        expect(reusable).toEqual(formed);
        resolveMotesFlight(null, 0, 80, 120, reusable);
        expect(reusable).toEqual({ ...formed, wordTimed: false });
        prepared.phases.fill(NaN);
        expect(offsetsAt(prepared, 0.5).every(offset => [offset.x, offset.y, offset.lift].every(Number.isFinite))).toBe(true);
    });

    it('preserves original grains and word colors through fallback scattering and assembly', () => {
        const prepared = preparedLine();
        const painted: { color: string; alpha: number; x: number; y: number }[] = [];
        const context = {
            fillStyle: '', globalAlpha: 1, save() {}, restore() {},
            fillRect(x: number, y: number, width: number, height: number) {
                painted.push({ color: this.fillStyle, alpha: this.globalAlpha, x: x + width / 2, y: y + height / 2 });
            },
        };
        for (const palette of [
            { primaryColor: '#f8fafc', accentColor: '#67e8f9' },
            { primaryColor: '#172033', accentColor: '#be123c' },
            { primaryColor: 'rgb(10 20 30)', accentColor: '' },
        ]) for (const time of [0.5, 1.3, 1.8, 4]) {
            painted.length = 0;
            drawMotesLine(context as unknown as CanvasRenderingContext2D, prepared, {
                time, theme: palette, tuning: DEFAULT_MOTES_TUNING,
            });
            expect(painted).toHaveLength(prepared.x.length);
            const color = time >= 1 && time < 3 ? palette.accentColor || palette.primaryColor : palette.primaryColor;
            expect(painted.every(point => point.color === color)).toBe(true);
            if (time < 1) {
                expect(painted.filter(point => point.alpha < 1)).toHaveLength(Math.floor(prepared.x.length / 10));
                expect(painted.every(point => point.alpha >= 0.5 && point.alpha <= 1)).toBe(true);
                const displaced = painted.filter((point, index) => Math.hypot(point.x - prepared.x[index], point.y - prepared.y[index]) > 1);
                expect(displaced).toHaveLength(Math.floor(prepared.x.length / 10));
                expect(painted.filter(point => point.alpha === 1)).toHaveLength(prepared.x.length - displaced.length);
            } else if (time >= 1.8) {
                expect(painted.every(point => point.alpha === 1)).toBe(true);
                expect(painted.every((point, index) => Math.hypot(point.x - prepared.x[index], point.y - prepared.y[index]) <= 1)).toBe(true);
            }
        }
    });
});
