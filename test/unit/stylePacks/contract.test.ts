import { describe, expect, it } from 'vitest';
import { EXAMPLE_PACK } from '../../../src/stylePacks/example';
import { RENDERER_PACK } from '../../../src/stylePacks/code/example';
import { MAX_PACK_BYTES, parseStylePack, validateStylePack } from '../../../src/stylePacks/validate';
import { layerTransform, resolvePackTypography } from '../../../src/stylePacks/render';
import { fixtureFrame } from '../../../src/stylePacks/fixtures';
import tuning from '../../../src/components/visualizer/stylePack/tuning';

// Adversarial imports and deterministic seeking are part of the public pack contract.
const copy = () => structuredClone(EXAMPLE_PACK);
describe('style pack contract', () => {
    it('round-trips a self-contained pack and its appearance tuning', () => {
        const pack = parseStylePack(JSON.stringify(EXAMPLE_PACK));
        expect(pack).toEqual(EXAMPLE_PACK);
        expect(tuning.storage!.read({ pack })).toEqual({ pack });
    });
    it.each([
        ['future version', (p: any) => { p.schemaVersion = 99; }, '$.schemaVersion'],
        ['unknown executable field', (p: any) => { p.script = 'fetch("/secrets")'; }, '$.script'],
        ['remote color', (p: any) => { p.palette.accent = 'url(https://example.com)'; }, '$.palette.accent'],
        ['duplicate layer', (p: any) => { p.layers.push(p.layers[0]); }, '$.layers[9].id'],
        ['offscreen layout', (p: any) => { p.layers[0].x = 99; }, '$.layers[0]'],
        ['infinite speed', (p: any) => { p.layers[0].motion.period = 0; }, '$.layers[0].motion.period'],
        ['too many layers', (p: any) => { p.layers = Array(33).fill(p.layers[0]); }, '$.layers'],
        ['missing source', (p: any) => { delete p.layers[2].source; }, '$.layers[2].source'],
        ['bad portrait', (p: any) => { p.portraitLayers[0].height = -1; }, '$.portraitLayers[0].height'],
    ])('rejects %s with a field path', (_name, mutate, path) => {
        const pack = copy(); mutate(pack);
        expect(validateStylePack(pack).some(issue => issue.path === path)).toBe(true);
        expect(() => parseStylePack(JSON.stringify(pack))).toThrow();
    });
    it('rejects malformed, prototype-shaped and oversized input', () => {
        for (const text of ['{', 'null', '[]', '{"__proto__": {}}', ' '.repeat(MAX_PACK_BYTES + 1)]) expect(() => parseStylePack(text)).toThrow();
    });
    it('recovers a corrupted saved selection', () => {
        expect(tuning.storage!.read({ pack: { schemaVersion: 99 } })).toEqual({ pack: RENDERER_PACK });
    });
    it('evaluates motion from seek time, with no accumulated history', () => {
        const layer = { ...EXAMPLE_PACK.layers[0], motion: { kind: 'float' as const, amount: 2, period: 4, signal: 'time' as const } };
        const at = (time: number) => layerTransform(layer, { time, audio: 0, reducedMotion: false });
        expect(at(1).y).toBeCloseTo(2);
        at(12); at(0);
        expect(at(1)).toEqual(at(1));
        expect(at(3).y).toBeCloseTo(-2);
        expect(layerTransform(layer, { time: 1, audio: 1, reducedMotion: true })).toEqual({ y: 0, scale: 1, rotation: 0 });
    });
    it('keeps subtitle typography distinct while applying both lyric and subtitle scales', () => {
        const frame = { ...fixtureFrame(0), fontScale: 1.2, subtitleFontScale: 1.5, subtitleFontFamily: 'serif', subtitleFontWeight: 700 };
        const translation = EXAMPLE_PACK.layers.find(layer => layer.source === 'translation')!;
        const current = EXAMPLE_PACK.layers.find(layer => layer.source === 'current')!;
        expect(resolvePackTypography(translation, frame)).toMatchObject({ family: 'serif', weight: 700 });
        expect(resolvePackTypography(translation, frame).scale).toBeCloseTo(1.8);
        expect(resolvePackTypography(current, frame)).toEqual({ family: frame.fontFamily, weight: 500, scale: 1.2 });
    });
});
