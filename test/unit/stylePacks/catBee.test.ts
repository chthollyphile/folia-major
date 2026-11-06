import { describe, expect, it } from 'vitest';
import type { CodeLine } from '../../../src/stylePacks/code/contract';
import { chooseMode, compile, unitsFor, rhythmAt, activePhrases, phraseOpacity } from '../../../style-packs/catBee/phrases.mjs';
import { buildFlight, flightAt, FLIGHT } from '../../../style-packs/catBee/flight.mjs';
import { createTrail } from '../../../style-packs/catBee/trail.mjs';
import { overlap } from '../../../style-packs/lyricImprint/anchors.mjs';
import { createImprints } from '../../../style-packs/lyricImprint/motion.mjs';
import { emitterAt } from '../../../style-packs/nightingale/coordinates.mjs';
import { fixtureScene } from '../../../src/stylePacks/fixtures';

// Assert the user's stationary-lyric contract rather than the superseded moving-trail implementation.
const line = (start = 0, end = 4, text = '轻快地唱起一首歌'): CodeLine => ({ text, translation: '', start, end, words: [], glyphs: [], chorus: false });
const scene = (lines = [line()], duration = 50) => ({ lines, duration, title: 'Cat and Bee' });
const frame = { time: 0, width: 1280, height: 720, dpr: 1, fontFamily: 'Arial', fontWeight: 500, fontScale: 1, reducedMotion: false };
const context = () => {
    const ctx: any = { font: '', calls: 0, save() {}, restore() {}, measureText(text: string) {
        ctx.calls++; return { width: Array.from(text).length * Number(ctx.font.split(' ')[1].slice(0, -2)) * .85 };
    } }; return ctx;
};
const meanSpeed = (flight: any, start: number, end: number) => {
    let sum = 0, count = 0;
    for (let time = start; time < end; time += .02) { sum += flightAt(flight, time).speed; count++; }
    return sum / count;
};

describe('Stationary lyrics, three entrances and N+2 retirement', () => {
    it('starts fading only when the second following nonempty lyric starts appearing', () => {
        const program = compile(scene([line(0, 2, '甲'), line(2.5, 3, '  '), line(5, 7, '乙'),
            { ...line(12, 15, '丙'), glyphs: [{ text: '丙', start: 13, end: 15 }] }]));
        expect(program.phrases).toHaveLength(3);
        const first = program.phrases[0];
        expect(first.fadeAt).toBe(13);
        for (const time of [2, 5, 7, 12.99, 13]) expect(phraseOpacity(first, time)).toBe(1);
        expect(phraseOpacity(first, 13.45)).toBeCloseTo(.5);
        expect(phraseOpacity(first, 13.9)).toBeCloseTo(0);
        expect(activePhrases(program, 8).map((p: any) => p.text)).toEqual(['甲', '乙']);
    });
    it('retains the last two phrases through an instrumental ending until the scene changes', () => {
        const program = compile(scene([line(0, 2, '甲'), line(5, 7, '乙')], 100));
        expect(activePhrases(program, 95)).toHaveLength(2);
        for (const phrase of program.phrases) expect(phraseOpacity(phrase, 95)).toBe(1);
        expect(rhythmAt(program, 95).active).toBe(0);
    });
    it('freezes each glyph near its birth source and only permits bounded local float', () => {
        const program = compile(scene()), flight = buildFlight(program), planner = createTrail(context());
        const a = planner({ ...frame, time: 5 }, program, flight), b = planner({ ...frame, time: 20 }, program, flight);
        expect(a.items).toHaveLength(unitsFor(program.phrases[0]).filter((u: any) => !u.blank).length);
        expect(b.items).toHaveLength(a.items.length);
        for (let i = 0; i < a.items.length; i++) {
            const first = a.items[i], next = b.items[i], source = flightAt(flight, first.start);
            expect(next.anchorX).toBe(first.anchorX); expect(next.anchorY).toBe(first.anchorY);
            expect(first.origin.x).toBeCloseTo(source.x * frame.width); expect(first.origin.y).toBeCloseTo(source.y * frame.height);
            expect(Math.hypot(first.anchorX - first.origin.x, first.anchorY - first.origin.y)).toBeLessThanOrEqual(Math.min(frame.width, frame.height) * .22 + 1e-7);
            expect(Math.hypot(next.x - first.x, next.y - first.y)).toBeLessThanOrEqual(first.float * 2 * Math.SQRT2 + 1e-7);
            expect(next.alpha).toBe(1);
        }
        expect(Math.hypot((flightAt(flight, 5).x - flightAt(flight, 20).x) * frame.width, (flightAt(flight, 5).y - flightAt(flight, 20).y) * frame.height)).toBeGreaterThan(40);
    });
    it('does not reflow older text when a new glyph or phrase appears', () => {
        const program = compile(scene([line(0, 4), line(5, 8, '新的歌声')]), { lyricMode: 'glyph' });
        const flight = buildFlight(program), planner = createTrail(context());
        const a = planner({ ...frame, time: 4.99 }, program, flight), b = planner({ ...frame, time: 6 }, program, flight);
        for (const unit of a.items) {
            const next = b.items.find((p: any) => p.phrase === unit.phrase && p.index === unit.index);
            expect(next).toBeDefined(); expect(next.anchorX).toBe(unit.anchorX); expect(next.anchorY).toBe(unit.anchorY);
        }
    });
    it('gives glyph, line and assemble different event structures and spatial entrances', () => {
        const get = (mode: string, time: number) => {
            const program = compile(scene([line(0, 6, '轻轻唱一首歌')]), { lyricMode: mode });
            return createTrail(context())({ ...frame, time }, program, buildFlight(program)).items;
        };
        const glyph = get('glyph', .2), whole = get('line', .2), gather = get('assemble', .45);
        expect(glyph).toHaveLength(1); expect(whole).toHaveLength(6);
        expect(new Set(whole.map((u: any) => u.birth)).size).toBe(1);
        expect(new Set(whole.map((u: any) => u.alpha)).size).toBe(1);
        expect(new Set(gather.map((u: any) => u.alpha)).size).toBeGreaterThan(2);
        expect(gather.some((u: any) => Math.abs(u.y - u.anchorY) > u.float + .1)).toBe(true);
        for (const unit of get('assemble', 2)) expect(Math.hypot(unit.x - unit.anchorX, unit.y - unit.anchorY)).toBeLessThanOrEqual(unit.float * Math.SQRT2 + 1e-6);
    });
    it('keeps full held phrases and their local entrance envelopes disjoint', () => {
        for (const mode of ['glyph', 'line', 'assemble']) for (const [width, height] of [[1280, 720], [390, 844]]) {
            const program = compile(scene([line(0, 3, '风在轻轻地唱'), line(4, 7, '听见窗边的微光'), line(9, 12, '字迹留在这里')]), { lyricMode: mode });
            const flight = buildFlight(program, width / height), planner = createTrail(context());
            let count = 0;
            for (let time = .05; time < 14; time += .1) {
                const plan = planner({ ...frame, time, width, height, fontScale: 1.5 }, program, flight);
                count += plan.items.length;
                for (let i = 0; i < plan.items.length; i++) {
                    const a = plan.items[i].box;
                    expect(a.left).toBeGreaterThanOrEqual(plan.bounds.left); expect(a.right).toBeLessThanOrEqual(plan.bounds.right);
                    expect(a.top).toBeGreaterThanOrEqual(plan.bounds.top); expect(a.bottom).toBeLessThanOrEqual(plan.bounds.bottom);
                    for (let j = i + 1; j < plan.items.length; j++) expect(overlap(a, plan.items[j].box)).toBe(false);
                }
            }
            expect(count).toBeGreaterThan(100);
            const held = planner({ ...frame, time: 8, width, height, fontScale: 1.5 }, program, flight).items;
            expect(held.filter((u: any) => u.phrase.order === 0)).toHaveLength(6);
            expect(held.filter((u: any) => u.phrase.order === 1)).toHaveLength(7);
        }
    });
    it('is seek deterministic, caches measurement and invalidates on font/viewport/scene changes', () => {
        const ctx = context(), planner = createTrail(ctx), program = compile(scene()), flight = buildFlight(program);
        const a = planner({ ...frame, time: 5 }, program, flight).items, calls = ctx.calls;
        planner({ ...frame, time: 35 }, program, flight); planner({ ...frame, time: 1 }, program, flight);
        expect(planner({ ...frame, time: 5 }, program, flight).items).toEqual(a); expect(ctx.calls).toBe(calls);
        planner({ ...frame, time: 5, fontWeight: 700 }, program, flight); expect(ctx.calls).toBeGreaterThan(calls);
        const changed = compile(scene([line(0, 4, '别的歌')]), { lyricMode: 'line' });
        expect(planner({ ...frame, time: 5, width: 390, height: 844 }, changed, buildFlight(changed, 390 / 844)).items.map((u: any) => u.text).join('')).toBe('别的歌');
    });
    it('keeps reduced-motion held text completely stationary and fully readable', () => {
        const program = compile(scene()), flight = buildFlight(program), planner = createTrail(context());
        const a = planner({ ...frame, time: 1, reducedMotion: true }, program, flight).items;
        const b = planner({ ...frame, time: 2, reducedMotion: true }, program, flight).items;
        expect(a).toHaveLength(8);
        expect(a.map((u: any) => [u.x, u.y, u.alpha, u.reveal])).toEqual(b.map((u: any) => [u.x, u.y, u.alpha, u.reveal]));
    });
    it('preserves whole words and adapts long input without silently clipping a held tail', () => {
        const program = compile(scene([line(0, 6, 'Supercalifragilisticexpialidocious'), line(7, 15, '这是需要在屏幕上完整保留的较长歌词'.repeat(3))]));
        const planner = createTrail(context()), plan = planner({ ...frame, time: 20, width: 390, height: 844, fontScale: 2 }, program, buildFlight(program, 390 / 844));
        expect(plan.items[0].text).toBe('Supercalifragilisticexpialidocious');
        expect(plan.items).toHaveLength(program.phrases.reduce((n: number, p: any) => n + unitsFor(p).filter((u: any) => !u.blank).length, 0));
    });
    it('lets Nightingale use an independent stationary gathering layout near its head-bound emitter', () => {
        const program = compile(scene([line(0, 5, '窗边留下轻轻的歌声')]), { artStyle: 'atmospheric-light' });
        expect(program.phrases[0].mode).toBe('assemble');
        const planner = createImprints(context(), { bounds: (f: any) => ({ left: f.width * .06, right: f.width * .94, top: f.height * .11, bottom: f.height * .4 }) });
        const source = { key: 'night', at: (time: number) => emitterAt(frame, time, .5, 1) };
        const a = planner({ ...frame, time: 2 }, program, source), b = planner({ ...frame, time: 18 }, program, source);
        expect(a.items.map((u: any) => [u.anchorX, u.anchorY])).toEqual(b.items.map((u: any) => [u.anchorX, u.anchorY]));
        expect(emitterAt(frame, 1, .5, 0)).toEqual(emitterAt(frame, 10, .5, 0));
        expect(emitterAt(frame, 1, .5, 1)).not.toEqual(emitterAt(frame, 10, .5, 1));
    });
    it('fully reveals a 10ms lyric by its end in every entrance mode', () => {
        for (const lyricMode of ['glyph', 'line', 'assemble']) {
            const program = compile(scene([line(0, .01, '春')]), { lyricMode });
            const item = createTrail(context())({ ...frame, time: .01 }, program, buildFlight(program)).items[0];
            expect(item.alpha).toBe(1); expect(item.reveal).toBe(1); expect(item.scale).toBe(1);
        }
    });
    it('delegates mixed bidi text to a single correctly directed Canvas run', () => {
        for (const [text, rtl] of [['I love العربية music', false], ['مرحبا world', true]] as const) {
            const program = compile(scene([line(0, 5, text)]));
            const items = createTrail(context())({ ...frame, time: 2 }, program, buildFlight(program)).items;
            expect(items).toHaveLength(1); expect(items[0].text).toBe(text); expect(items[0].rtl).toBe(rtl);
        }
    });
    it('splits slow glyph phrases by real birth-space span instead of failing on a fixed six-character group', () => {
        for (const duration of [8, 12, 30]) for (const [width, height] of [[1280, 720], [390, 844]]) {
            const program = compile(scene([line(0, duration, '风在轻轻地唱')]), { lyricMode: 'glyph' });
            const flight = buildFlight(program, width / height), planner = createTrail(context());
            expect(() => planner({ ...frame, time: 0, width, height }, program, flight)).not.toThrow();
            const plan = planner({ ...frame, time: duration + 1, width, height }, program, flight);
            expect(plan.items).toHaveLength(6);
            for (const unit of plan.items) expect(Math.hypot(unit.anchorX - unit.origin.x, unit.anchorY - unit.origin.y)).toBeLessThanOrEqual(Math.min(width, height) * .22 + 1e-6);
        }
    });
    it('fits the actual long-text fixture at double font scale in portrait, including reduced-motion switching', () => {
        const program = compile(fixtureScene('long')), planner = createTrail(context()), flight = buildFlight(program, 390 / 844);
        for (const reducedMotion of [false, true, false]) {
            const plan = planner({ ...frame, time: 11.8, width: 390, height: 844, fontScale: 2, reducedMotion }, program, flight);
            expect(plan.items.filter((unit: any) => unit.phrase.order === 0).map((unit: any) => unit.text).join('')).toBe(program.phrases[0].text.replace(/\s/g, ''));
        }
    });
});

describe('Lyric timing and the bee flight remain independent of retained ink', () => {
    it('restores singing after short overlaps while visual lifetime uses N+2', () => {
        const program = compile(scene([line(0, 10, 'AAAA'), line(1, 2, 'BBBB'), line(3, 4, 'CCCC'), line(5, 6, 'DDDD')]));
        expect(rhythmAt(program, 2.5).phrase.text).toBe('AAAA'); expect(rhythmAt(program, 4.5).active).toBe(1);
        expect(activePhrases(program, 5).map((p: any) => p.text)).not.toContain('AAAA');
    });
    it('chooses from artwork evidence and preserves emoji/complete word timings', () => {
        expect(chooseMode({ artStyle: 'line-art' })).toBe('glyph'); expect(chooseMode({ artStyle: 'graphic-poster' })).toBe('line');
        expect(chooseMode({ artStyle: 'atmospheric-light' })).toBe('assemble'); expect(chooseMode({ lyricMode: 'glyph' }, 'مرحبا بالعالم')).toBe('line');
        const program = compile(scene([{ ...line(0, 8, '你👩‍👩‍👧‍👦Hello'), glyphs: [{ text: '你', start: 0, end: .1 }, { text: '👩‍👩‍👧‍👦', start: 2, end: 3 }, ...Array.from('Hello', (text, i) => ({ text, start: 3 + i, end: 4 + i }))] }]));
        expect(unitsFor(program.phrases[0]).map((u: any) => u.text)).toEqual(['你', '👩‍👩‍👧‍👦', 'Hello']);
        expect(unitsFor(program.phrases[0])[2]).toMatchObject({ start: 3, end: 8 });
    });
    it('slows during silence without freezing even though the last lyrics remain visible', () => {
        const flight = buildFlight(compile(scene([line(10, 16)])));
        expect(meanSpeed(flight, 11, 16)).toBeGreaterThan(meanSpeed(flight, 30, 40) * 2);
        expect(meanSpeed(flight, 30, 40)).toBeGreaterThan(.005);
        const instrumental = buildFlight(compile(scene([], 60)));
        expect(meanSpeed(instrumental, 10, 50)).toBeLessThan(.035); expect(flightAt(instrumental, 10)).not.toEqual(flightAt(instrumental, 50));
    });
    it('bounds speed and acceleration through overlap and 10ms cues in both orientations', () => {
        for (const aspect of [16 / 9, 390 / 844]) {
            const flight = buildFlight(compile(scene([line(0, .01), line(.02, .07), line(1, 5), line(4, 9), line(20, 30)])), aspect);
            let previous = flightAt(flight, 0);
            for (let time = .005; time < 40; time += .005) {
                const current = flightAt(flight, time);
                expect(current.speed).toBeLessThan(FLIGHT.maxSpeed * 1.01);
                expect(Math.hypot((current.vx - previous.vx) * flight.sx, (current.vy - previous.vy) * flight.sy) / .005).toBeLessThan(FLIGHT.maxAcceleration * 1.06);
                previous = current;
            }
        }
    });
    it('samples deterministically and caps long-recording trajectory memory', () => {
        const program = compile(scene()), a = buildFlight(program), b = buildFlight(program);
        expect(flightAt(a, 12.345)).toEqual(flightAt(b, 12.345)); expect(flightAt(a, 2, true)).toEqual(flightAt(a, 30, true));
        const long = buildFlight(compile(scene([], 7200))); expect(long.steps).toBeLessThanOrEqual(FLIGHT.maxSamples); expect(Number.isFinite(flightAt(long, 7000).x)).toBe(true);
    });
});
