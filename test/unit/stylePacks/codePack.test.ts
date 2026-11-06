import { describe, expect, it } from 'vitest';
import { RENDERER_PACK } from '../../../src/stylePacks/code/example';
import { EXAMPLE_PACK } from '../../../src/stylePacks/example';
import { formatStylePack, parseStylePack, validateStylePack } from '../../../src/stylePacks/validate';
import { makeCodeScene } from '../../../src/stylePacks/code/scene';
import { referenceTimes } from '../../../src/stylePacks/video/videoReference';

// New executable inputs stay bounded; lyric timing and video evidence preserve their source coordinates.
describe('renderer pack v2', () => {
    it('round trips executable content as data without executing it during validation', () => {
        const pack = { ...RENDERER_PACK, renderer: { apiVersion: 2, code: 'throw new Error("must not run in validator")' } };
        expect(parseStylePack(JSON.stringify(pack))).toEqual(pack);
    });
    it.each([
        { renderer: { apiVersion: 3, code: 'x' } },
        { renderer: { apiVersion: 2, code: '' } },
        { renderer: { apiVersion: 2, code: 'x'.repeat(1048577) } },
        { settings: { extra: { nested: true } } },
        { settings: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`key${i}`, 1])) },
        { assets: [{ id: 'picture', mime: 'image/svg+xml', data: 'AA==' }] },
        { assets: [{ id: 'picture', mime: 'image/png', data: 'http://example.com/a.png' }] },
        { assets: [{ id: 'picture', mime: 'image/png', data: 'A' }] },
        { assets: Array(2).fill({ id: 'same', mime: 'image/png', data: 'AA==' }) },
    ])('rejects invalid code-pack fields %#', patch => {
        expect(validateStylePack({ ...RENDERER_PACK, ...patch }).length).toBeGreaterThan(0);
    });
    it('rejects prototype-shaped settings', () => {
        expect(() => parseStylePack(JSON.stringify(RENDERER_PACK).replace('"settings":{', '"settings":{"__proto__":true,'))).toThrow();
    });
    it('retains a valid export for dense Unicode v1 packs that only fit as compact JSON', () => {
        const layer = { id: 'x', kind: 'text' as const, x: 0, y: 0, width: 100, height: 100, color: '#ffffff', source: 'literal' as const, text: '🎵'.repeat(200), opacity: .85, radius: 2 };
        const layers = Array.from({ length: 32 }, (_, i) => ({ ...layer, id: `item${i}` }));
        const pack = { ...EXAMPLE_PACK, layers, portraitLayers: layers };
        expect(new TextEncoder().encode(JSON.stringify(pack, null, 2)).length).toBeGreaterThan(65536);
        expect(parseStylePack(formatStylePack(pack))).toEqual(pack);
    });
    it('passes only visual metadata and preserves word boundary timing', () => {
        const scene = makeCodeScene([{ fullText: 'AB', startTime: 10, endTime: 15, words: [{ text: 'A', startTime: 10, endTime: 11 }, { text: 'B', startTime: 13, endTime: 15 }], sourceToken: 'private' } as any]);
        expect(scene.lines[0].glyphs).toEqual([{ text: 'A', start: 10, end: 11 }, { text: 'B', start: 13, end: 15 }]);
        expect(JSON.stringify(scene)).not.toContain('private');
    });
    it('samples the selected video interval without losing absolute timestamps', () => {
        const times = referenceTimes(12, 26);
        expect(times).toHaveLength(8); expect(times[0]).toBe(12); expect(times.at(-1)).toBe(26);
        expect(() => referenceTimes(26, 12)).toThrow();
        expect(() => referenceTimes(0, 61)).toThrow();
        expect(() => referenceTimes(NaN, 2)).toThrow();
    });
});
