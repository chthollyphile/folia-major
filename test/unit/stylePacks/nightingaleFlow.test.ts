import { describe, expect, it } from 'vitest';
import { compile } from '../../../style-packs/lyricImprint/timeline.mjs';
import { overlap } from '../../../style-packs/lyricImprint/anchors.mjs';
import { createNightingalePlan } from '../../../style-packs/nightingale/lyrics.js';
import { emitterAt } from '../../../style-packs/nightingale/coordinates.mjs';
import { fixtureScene } from '../../../src/stylePacks/fixtures';
import { journeyPose } from '../../../style-packs/nightingale/journey.mjs';

// Guard retained text, interval reservation and deterministic birth anchors independently of subjective art direction.
const frame = { width: 1280, height: 720, dpr: 1, fontFamily: 'Arial', fontWeight: 500, fontScale: 1, reducedMotion: false, time: 0 };
const line = (start: number, end: number, text: string) => ({ start, end, text, words: [], glyphs: [], translation: '', chorus: false });
const lines = [line(0, 5.7, '听，风在轻轻唱'), line(7, 10.5, '追着光穿过午后的窗，轻快的心跳一直响'), line(13, 25, '让这一刻，慢一点'), line(27, 32, '小小世界，也有自己的歌')];
const context = () => {
    const ctx: any = { font: '', calls: 0, save() {}, restore() {}, measureText(text: string) {
        ctx.calls++; return { width: Array.from(text).length * Number(ctx.font.split(' ')[1].slice(0, -2)) * .95 };
    } }; return ctx;
};
const source = (f = frame) => ({ key: 'night', at: (time: number) => emitterAt(f, time, .5, 1) });
const make = (mode = 'assemble', input = lines) => compile({ lines: input, duration: 45, title: 'Night' }, { lyricMode: mode });

describe('Nightingale breath ribbons', () => {
    it('retains every sung word through N+1, then fades the entire phrase at N+2 without moving old anchors', () => {
        const program = make(), planner = createNightingalePlan(context()), emitter = source();
        const a = planner({ ...frame, time: 6 }, program, emitter), b = planner({ ...frame, time: 12.9 }, program, emitter);
        expect(a.items.map((u: any) => u.text).join('')).toBe(lines[0].text);
        const held = b.items.filter((u: any) => u.phrase.order === 0);
        expect(held.map((u: any) => [u.anchorX, u.anchorY])).toEqual(a.items.map((u: any) => [u.anchorX, u.anchorY]));
        expect(held.every((u: any) => u.alpha === 1)).toBe(true);
        const fading = planner({ ...frame, time: 13.45 }, program, emitter).items.filter((u: any) => u.phrase.order === 0);
        expect(fading).toHaveLength(held.length); fading.forEach((u: any) => expect(u.alpha).toBeCloseTo(.5));
        expect(planner({ ...frame, time: 14 }, program, emitter).items.some((u: any) => u.phrase.order === 0)).toBe(false);
    });
    it('reserves disjoint settled imprints while flight uses the singer-to-anchor region', () => {
        for (const mode of ['glyph', 'line', 'assemble']) for (const [width, height] of [[1280, 720], [390, 844]]) {
            const f = { ...frame, width, height, fontScale: 2 }, program = make(mode), planner = createNightingalePlan(context()), emitter = source(f);
            let collisions = 0, outside = 0, maxDriftRatio = 0;
            for (let time = .07; time < 34; time += .17) {
                const plan = planner({ ...f, time }, program, emitter);
                for (let i = 0; i < plan.items.length; i++) {
                    const a = plan.items[i];
                    if (mode === 'assemble' && !a.landed) continue;
                    if (a.box.left < plan.bounds.left || a.box.right > plan.bounds.right || a.box.top < plan.bounds.top || a.box.bottom > plan.bounds.bottom) outside++;
                    for (let j = i + 1; j < plan.items.length; j++) if ((mode !== 'assemble' || plan.items[j].landed) && overlap(a.box, plan.items[j].box)) collisions++;
                    if (time > a.birth + (a.travelDuration || 1)) maxDriftRatio = Math.max(maxDriftRatio, Math.hypot(a.x - a.anchorX, a.y - a.anchorY) / (a.float * Math.SQRT2));
                }
            }
            expect(collisions).toBe(0); expect(outside).toBe(0); expect(maxDriftRatio).toBeLessThanOrEqual(1.000001);
        }
    });
    it('shows each real glyph near the singer before travelling, then settles continuously without following her', () => {
        const program = make(), planner = createNightingalePlan(context()), emitter = source();
        const plan = planner({ ...frame, time: 1 }, program, emitter);
        for (const unit of plan.groups.get(program.phrases[0])) {
            const birth = journeyPose(unit, unit.birth), middle = journeyPose(unit, unit.birth + unit.travelDuration * .5);
            const end = journeyPose(unit, unit.birth + unit.travelDuration), before = journeyPose(unit, unit.birth + unit.travelDuration - 1e-5);
            expect(birth.alpha).toBeGreaterThan(.7); expect(birth.scale).toBeGreaterThanOrEqual(.5);
            expect(Math.hypot(birth.x - emitter.at(unit.birth).x, birth.y - emitter.at(unit.birth).y)).toBeLessThan(720 * .03);
            expect(Math.hypot(birth.x - unit.anchorX, birth.y - unit.anchorY)).toBeGreaterThan(40);
            expect(Math.hypot(middle.x - birth.x, middle.y - birth.y)).toBeGreaterThan(20);
            expect(Math.hypot(end.x - before.x, end.y - before.y)).toBeLessThan(.01);
            expect(end.x).toBeCloseTo(unit.anchorX); expect(end.y).toBeCloseTo(unit.anchorY);
            expect(unit.birth + unit.travelDuration).toBeLessThanOrEqual(unit.phrase.end + 1e-9);
        }
    });
    it('seeks identically, measures only on cache changes and fully shows reduced motion text', () => {
        const ctx = context(), planner = createNightingalePlan(ctx), program = make(), emitter = source();
        const a = planner({ ...frame, time: 2 }, program, emitter).items, calls = ctx.calls;
        planner({ ...frame, time: 28 }, program, emitter);
        expect(planner({ ...frame, time: 2 }, program, emitter).items).toEqual(a); expect(ctx.calls).toBe(calls);
        const still = planner({ ...frame, reducedMotion: true, time: .1 }, program, emitter).items;
        expect(still.map((u: any) => u.text).join('')).toBe(lines[0].text);
        expect(planner({ ...frame, reducedMotion: true, time: 3 }, program, emitter).items).toEqual(still);
        planner({ ...frame, fontWeight: 700 }, program, emitter); expect(ctx.calls).toBeGreaterThan(calls);
    });
    it('reserves fading phrases when a delayed first glyph changes actual release order', () => {
        const timed = (start: number, end: number, text: string, first: number) => ({ ...line(start, end, text),
            glyphs: Array.from(text, (text, i) => ({ text, start: first + i * .1, end: first + (i + 1) * .1 })) });
        const program = compile({ lines: [timed(0, 2, '听', 0), timed(1, 6, '风吹过窗边', 5), timed(3, 5, '听', 3), timed(7, 9, '夜空', 7)], duration: 12 }, { lyricMode: 'glyph' });
        const items = createNightingalePlan(context())({ ...frame, time: 3.4 }, program, source()).items;
        const old = items.find((u: any) => u.phrase.order === 0), next = items.find((u: any) => u.phrase.order === 2);
        expect(old).toBeDefined(); expect(next).toBeDefined(); expect(old.alpha).toBeGreaterThan(0);
        expect(overlap(old.box, next.box)).toBe(false);
    });
    it('completes even a 10ms entrance and preserves long or mixed-direction text', () => {
        for (const mode of ['glyph', 'line', 'assemble']) {
            const program = make(mode, [line(0, .01, '春天')]), planner = createNightingalePlan(context());
            for (const item of planner({ ...frame, time: .01 }, program, source()).items) { expect(item.alpha).toBe(1); expect(item.reveal).toBe(1); }
        }
        for (const reducedMotion of [false, true]) {
            const f = { ...frame, width: 390, height: 844, fontScale: 2, reducedMotion, time: 11.8 };
            const program = compile(fixtureScene('long'), { lyricMode: 'assemble' });
            const items = createNightingalePlan(context())(f, program, source(f)).items;
            expect(items.filter((u: any) => u.phrase.order === 0).map((u: any) => u.text).join('')).toBe(program.phrases[0].text.replace(/\s/g, ''));
        }
        const mixed = make('assemble', [line(0, 5, 'I love العربية music')]);
        const items = createNightingalePlan(context())({ ...frame, time: 3 }, mixed, source()).items;
        expect(items).toHaveLength(1); expect(items[0].text).toBe('I love العربية music'); expect(items[0].rtl).toBe(false);
    });
    it('keeps a feasible birth region when a narrow portrait puts the safe corridor far above the head', () => {
        const dense = [0, 5, 10].map(start => line(start, start + 4, '风'.repeat(50)));
        for (const [width, height] of [[240, 1600], [300, 1800], [1600, 240]]) for (const mode of ['glyph', 'line', 'assemble']) for (const input of [[line(0, 4, '春风')], lines, dense]) {
            const f = { ...frame, width, height, time: 6 }, program = make(mode, input);
            const plan = createNightingalePlan(context())(f, program, source(f));
            expect(plan.items.filter((u: any) => u.phrase.order === 0).map((u: any) => u.text).join('')).toBe(input[0].text);
            const root = plan.items[0];
            expect(Math.hypot(root.anchorX - root.origin.x, root.anchorY - root.origin.y)).toBeLessThanOrEqual(root.sourceRadius);
            for (const item of plan.items.filter((u: any) => !u.route || u.landed)) { expect(item.box.top).toBeGreaterThanOrEqual(plan.bounds.top); expect(item.box.bottom).toBeLessThanOrEqual(plan.bounds.bottom); }
        }
    });
});
