import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { LYRIC_TEMPLATE_PACK } from '../../../src/stylePacks/code/lyricTemplate';
import { fixtureFrame } from '../../../src/stylePacks/fixtures';
import type { CodeRenderer, CodeScene } from '../../../src/stylePacks/code/contract';

// The portable starter retains anchors across line transitions and does not measure text every frame.
describe('lyric-only template', () => {
    it.each(['glyph', 'line', 'assemble'])('finishes short lines and late glyphs before their deadline (%s)', async release => {
        let renderer!: CodeRenderer;
        const drawn = new Map<string, number>();
        const ctx = { globalAlpha: 1, font: '', textBaseline: '', fillStyle: '', direction: 'ltr', textAlign: 'left',
            clearRect: () => drawn.clear(), measureText: () => ({ width: 15 }),
            fillText(text: string) { drawn.set(text, this.globalAlpha); } };
        runInNewContext(LYRIC_TEMPLATE_PACK.renderer.code, { FoliaStyle: { define(factory: (context: unknown) => CodeRenderer) {
            renderer = factory({ canvas: { getContext: () => ctx }, settings: { release }, assets: {}, palette: LYRIC_TEMPLATE_PACK.palette });
        } } });
        await renderer.update?.({ title: '', artist: '', album: '', duration: 1, lines: ['A', 'B', 'C'].map((text, index) => ({
            text, start: index * .1, end: (index + 1) * .1, translation: '', chorus: false, words: [],
            glyphs: [{ text, start: index * .1 + .09, end: (index + 1) * .1 }],
        })) });
        const render = async (time: number) => {
            const { cover, ...frame } = fixtureFrame(time);
            await renderer.render({ ...frame, time, width: 1280, height: 720, dpr: 1, index: 0, paused: false });
        };
        await render(.1); expect(drawn.get('A')).toBe(1);
        await render(.19); expect(drawn.get('A')).toBe(1);
        await render(.2); expect(drawn.get('B')).toBe(1);
        await render(.3); expect(drawn.get('A')).toBeLessThan(1);
        await renderer.update?.({ title: '', artist: '', album: '', duration: 4, lines: [{
            text: 'مرحبا world', start: 0, end: 2, translation: '', chorus: false, words: [],
            glyphs: Array.from('مرحبا world', text => ({ text, start: 0, end: 2 })),
        }] });
        await render(1);
        expect([...drawn.entries()]).toEqual([['مرحبا world', 1]]);
        expect(ctx.direction).toBe('rtl'); expect(ctx.textAlign).toBe('right');
    });
    it('keeps a line through N+1, fades it at the second nonblank successor and reuses layout measurements', async () => {
        let renderer!: CodeRenderer, measurements = 0;
        const drawn: { text: string; x: number; y: number; alpha: number }[] = [];
        const ctx = { globalAlpha: 1, font: '', textBaseline: '', fillStyle: '',
            clearRect: () => { drawn.length = 0; }, measureText: () => { measurements++; return { width: 15 }; },
            fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, alpha: this.globalAlpha }); } };
        runInNewContext(LYRIC_TEMPLATE_PACK.renderer.code, { FoliaStyle: { define(factory: (context: unknown) => CodeRenderer) {
            renderer = factory({ canvas: { getContext: () => ctx }, settings: {}, assets: {}, palette: LYRIC_TEMPLATE_PACK.palette });
        } } });
        const scene: CodeScene = { title: '', artist: '', album: '', duration: 6, lines: [
            { text: 'A', start: 0 }, { text: 'B', start: 1 }, { text: ' ', start: 1.2 }, { text: 'C', start: 2 },
        ].map(line => ({ ...line, end: line.start + .8, translation: '', chorus: false, words: [], glyphs: [{ text: line.text, start: line.start, end: line.start + .8 }] })) };
        await renderer.update?.(scene);
        const render = async (time: number, width = 1280) => {
            const { cover, ...frame } = fixtureFrame(time);
            await renderer.render({ ...frame, time, width, height: 720, dpr: 1, index: 0, paused: false });
            return drawn.find(unit => unit.text === 'A');
        };
        const first = await render(.5);
        const count = measurements; await render(.6); expect(measurements).toBe(count);
        expect(await render(1.5)).toEqual(first);
        const fade = await render(2.45);
        expect(fade?.x).toBe(first?.x); expect(fade?.y).toBe(first?.y); expect(fade?.alpha).toBeCloseTo(.5);
        expect(await render(3)).toBeUndefined();
        const beforeResize = measurements; await render(.5, 390); expect(measurements).toBeGreaterThan(beforeResize);
        const last = scene.lines[3];
        last.start = 4; last.end = 7; last.glyphs[0].start = 6; last.glyphs[0].end = 7;
        await renderer.update?.(scene);
        expect((await render(5))?.alpha).toBe(1);
        expect((await render(6.45))?.alpha).toBeCloseTo(.5);
    });
});
