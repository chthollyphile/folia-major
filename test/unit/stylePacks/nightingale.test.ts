import { describe, expect, it } from 'vitest';
import { compileNotes, distanceAt, hummingAt, measureNotes, upperBound, noteFlight, wrapGraphemes } from '../../../style-packs/nightingale/timeline.js';

// Verify timed emission, script grouping and seek-independent stream spacing.
const line = (texts: string[], start = 0) => ({ glyphs: texts.map((text, i) => ({ text, start: start + i * .3, end: start + (i + 1) * .3 })) });
describe('nightingale lyric notes', () => {
    it('preserves repeated CJK syllables, punctuation and grapheme clusters', () => {
        const notes = compileNotes([line(['风', '，', '风', ' ', '👩‍🎤', 'é'])]);
        expect(notes.map(n => n.text)).toEqual(['风', '，', '风', '👩‍🎤', 'é']);
        expect(notes.map(n => n.start)).toEqual([0, .3, .6, 1.2, 1.5]);
    });
    it('keeps alphabetic words intact while retaining their per-glyph timestamps', () => {
        const notes = compileNotes([line(Array.from('soft soft'))]);
        expect(notes.map(n => n.text)).toEqual(['soft', 'soft']);
        expect(notes[1].glyphs.map((g: { start: number }) => g.start)).toEqual([1.5, 1.7999999999999998, 2.1, 2.4]);
        expect(notes[1].seed).not.toEqual(notes[0].seed);
    });
    it('has no humming before lyrics, in a rest or after the last release', () => {
        const notes = compileNotes([line(['风']), line(['光'], 8)]);
        expect(hummingAt(notes, -1)).toBe(0);
        expect(hummingAt(notes, .15)).toBeGreaterThan(.9);
        expect(hummingAt(notes, 2)).toBe(0);
        expect(hummingAt(notes, 10)).toBe(0);
    });
    it('spaces a wide word before its following neighbour and replays seeks exactly', () => {
        const notes = compileNotes([line(Array.from('a spacious word'))]);
        const measured = measureNotes(notes, (text: string) => text.length * 20, 20, 50);
        expect(measured[1].distance - measured[0].distance).toBeGreaterThanOrEqual(measured[1].width + 14);
        const first = distanceAt(measured, 2, 50);
        distanceAt(measured, 30, 50);
        expect(distanceAt(measured, 2, 50)).toBe(first);
        expect(distanceAt(measured, 2.01, 50)).toBeGreaterThan(first);
        expect(measured[1].timings.at(-1)?.right).toBe(measured[1].width);
    });
    it('handles empty data and simultaneous starts deterministically', () => {
        expect(compileNotes([])).toEqual([]);
        expect(distanceAt([], 100, 50)).toBe(0);
        const notes = compileNotes([line(['风']), line(['光'])]);
        expect(upperBound(notes, 0)).toBe(2);
        expect(notes.map(n => n.text)).toEqual(['风', '光']);
        expect(Number.isFinite(distanceAt(measureNotes(notes, () => 20, 20, 50), 0, 50))).toBe(true);
    });
    it('keeps a twelve-second sung word visible through its last glyph', () => {
        const note = { start: 0, end: 12, distance: 0 };
        expect(noteFlight(note, 11.9, 11.9 * 108.8, 640).opacity).toBeGreaterThan(.9);
        expect(noteFlight(note, 12.1, 12.1 * 108.8, 640).opacity).toBeGreaterThan(.9);
        expect(noteFlight(note, 15, 15 * 108.8, 640).opacity).toBe(0);
    });
    it('never splits combining marks, flags or ZWJ emoji at a line boundary', () => {
        const segments = ['A', '👩‍🎤', '🇨🇳', 'é'];
        const counter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        expect(wrapGraphemes(segments.join(''), 1, (text: string) => [...counter.segment(text)].length)).toEqual(segments);
    });
});
