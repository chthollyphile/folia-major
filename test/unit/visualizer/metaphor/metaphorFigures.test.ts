import { describe, expect, it } from 'vitest';
import { createVisualizerRng } from '@/components/visualizer/visualizerSeedHash';
import {
    drawMetaphorFigure,
    layoutMetaphorNotes,
    METAPHOR_FIGURE_KINDS,
    planMetaphorBackdrop,
    planMetaphorFigures,
} from '@/components/visualizer/metaphor/metaphorFigures';
import { buildMetaphorLayout, buildMetaphorTextTokens, type MetaphorRect } from '@/components/visualizer/metaphor/metaphorLayout';
import {
    METAPHOR_SHAPE_ARC,
    METAPHOR_SHAPE_BAR,
    METAPHOR_SHAPE_BLOB,
    METAPHOR_SHAPE_CAPACITY,
    METAPHOR_SHAPE_STRIDE,
    METAPHOR_SHAPE_WAVE,
    planMetaphorShapes,
    staticMetaphorShape,
    writeMetaphorShapes,
} from '@/components/visualizer/metaphor/metaphorShapes';

// test/unit/visualizer/metaphor/metaphorFigures.test.ts
// 隐喻的线稿和版面（都是纯函数）：每种图各自画得出来、落在自己那一块里；一个 cue 的几张图摆在字外面；
// 版面的网点层和规线、注记；注记排成字；一笔一笔冒出来；齐行的排版。

const bounds: MetaphorRect = { x0: -3, y0: -1.5, x1: 3, y1: 1.5 };
const inside = (x: number, y: number, pad = 0) => x > bounds.x0 - pad && x < bounds.x1 + pad && y > bounds.y0 - pad && y < bounds.y1 + pad;

describe('各种线稿', () => {
    it.each(METAPHOR_FIGURE_KINDS)('%s：画得出来，图形和注记都落在图自己那一块里', (kind) => {
        for (const seed of ['a', 'b', 'c', 'd']) {
            const figure = drawMetaphorFigure(kind, createVisualizerRng(`${kind}:${seed}`), 10, -4, 2);
            expect(figure.shapes.length).toBeGreaterThan(5);
            expect(figure.shapes.length).toBeLessThan(70);
            for (const shape of figure.shapes) {
                expect([shape.x, shape.y, shape.sx, shape.sy, shape.rot, shape.param, shape.born].every(Number.isFinite)).toBe(true);
                expect(shape.ink).toBe(1);
                // 细线、波浪线、点整个在图里；圆弧那一格的圆心可以在图外（探测器里弯的径迹、彗星的远轨道）
                if (shape.shape !== METAPHOR_SHAPE_ARC) expect(Math.hypot(shape.x - 10, shape.y + 4)).toBeLessThan(2 * 1.6);
            }
            expect(figure.notes.length).toBeGreaterThan(0);
            for (const note of figure.notes) {
                expect(note.text.length).toBeGreaterThan(0);
                expect(Math.hypot(note.x - 10, note.y + 4)).toBeLessThan(2 * 1.8);
            }
        }
    });

    it('用到了线、弧、波浪线、点这几种图元', () => {
        const used = new Set(METAPHOR_FIGURE_KINDS.flatMap(kind => drawMetaphorFigure(kind, createVisualizerRng(kind)).shapes.map(shape => shape.shape)));
        expect([...used].sort()).toEqual([METAPHOR_SHAPE_BLOB, METAPHOR_SHAPE_BAR, METAPHOR_SHAPE_ARC, METAPHOR_SHAPE_WAVE]);
    });

    it('一笔一笔冒出来：越往后的笔越晚，三笔一组隔 0.2 秒', () => {
        const figure = drawMetaphorFigure('detector', createVisualizerRng('born'), 0, 0, 1, 0, 1.5);
        const borns = figure.shapes.map(shape => shape.born);
        expect(borns[0]).toBe(1.5);
        expect([...borns].sort((a, b) => a - b)).toEqual(borns);
        expect(borns[3] - borns[0]).toBeCloseTo(0.2);
    });

    it('垫在字后面的那种：只进半调，线更粗，不带注记', () => {
        const toned = drawMetaphorFigure('lattice', createVisualizerRng('toned'), 0, 0, 1, 0, 0, true);
        const inked = drawMetaphorFigure('lattice', createVisualizerRng('toned'));
        expect(toned.notes).toHaveLength(0);
        expect(toned.shapes.every(shape => shape.ink === 0 && shape.tone > 0)).toBe(true);
        const bar = (shapes: typeof toned.shapes) => shapes.find(shape => shape.shape === METAPHOR_SHAPE_BAR)?.sy ?? 0;
        expect(bar(toned.shapes)).toBeGreaterThan(bar(inked.shapes) * 2);
    });
});

describe('planMetaphorFigures', () => {
    it('调到 0 就没有；同一个种子画出来一样；不超过上限', () => {
        expect(planMetaphorFigures(bounds, createVisualizerRng('none'), 0, false)).toEqual({ shapes: [], notes: [] });
        expect(planMetaphorFigures(bounds, createVisualizerRng('same'), 1, false)).toEqual(planMetaphorFigures(bounds, createVisualizerRng('same'), 1, false));
        for (const interlude of [false, true]) {
            const figures = planMetaphorFigures(bounds, createVisualizerRng('many'), 2, interlude);
            expect(figures.shapes.length).toBeGreaterThan(40);
            expect(figures.shapes.length).toBeLessThanOrEqual(240);
        }
    });

    it('歌词：墨画的点和注记都在字的包围盒外面，压在字后面的只有半调', () => {
        for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
            const figures = planMetaphorFigures(bounds, createVisualizerRng(`out:${seed}`), 1.5, false);
            expect(figures.shapes.some(shape => shape.ink === 0 && shape.tone > 0)).toBe(true);
            for (const shape of figures.shapes) {
                if (shape.ink > 0 && shape.shape === METAPHOR_SHAPE_BLOB) expect(inside(shape.x, shape.y)).toBe(false);
            }
            for (const note of figures.notes) expect(inside(note.x, note.y)).toBe(false);
        }
    });

    it('间奏：图排在舞台里', () => {
        const stage: MetaphorRect = { x0: -4.5, y0: -2.6, x1: 4.5, y1: 2.6 };
        const figures = planMetaphorFigures(stage, createVisualizerRng('stage'), 1, true);
        const dots = figures.shapes.filter(shape => shape.ink > 0 && shape.shape === METAPHOR_SHAPE_BLOB);
        expect(dots.length).toBeGreaterThan(0);
        for (const dot of dots) expect(Math.abs(dot.x)).toBeLessThan(4.5 + 2.5);
    });
});

describe('planMetaphorBackdrop', () => {
    const info = { index: 7, time: 83.4 };

    it('网点层只进半调；间奏没有版面零件', () => {
        for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
            const backdrop = planMetaphorBackdrop(bounds, createVisualizerRng(`bg:${seed}`), 1, true, info);
            expect(backdrop.notes).toHaveLength(0);
            expect(backdrop.shapes.every(shape => shape.ink === 0 && shape.accent === 0 && shape.tone > 0)).toBe(true);
            expect(backdrop.shapes.length).toBeLessThanOrEqual(48);
        }
    });

    it('歌词：规线、裁切标记都在字的包围盒外面；注记写的是行号和时间码', () => {
        const texts = new Set<string>();
        for (let seed = 0; seed < 24; seed += 1) {
            const backdrop = planMetaphorBackdrop(bounds, createVisualizerRng(`page:${seed}`), 1, false, info);
            for (const shape of backdrop.shapes) {
                if (shape.ink > 0) expect(inside(shape.x, shape.y)).toBe(false);
            }
            for (const note of backdrop.notes) {
                expect(inside(note.x, note.y)).toBe(false);
                texts.add(note.text);
            }
        }
        expect([...texts].sort()).toEqual(['01:23', '07', '07 / 01:23', '07 — 01:23']);
    });

    it('融球调到 0：没有网点层，版面零件还在', () => {
        let furnished = 0;
        for (let seed = 0; seed < 12; seed += 1) {
            const backdrop = planMetaphorBackdrop(bounds, createVisualizerRng(`bare:${seed}`), 0, false, info);
            expect(backdrop.shapes.every(shape => shape.ink > 0)).toBe(true);
            if (backdrop.shapes.length > 0) furnished += 1;
        }
        expect(furnished).toBeGreaterThan(0);
    });
});

describe('layoutMetaphorNotes', () => {
    const measure = () => 0.5;
    const note = { text: 'a = b', x: 2, y: 1, size: 0.4, rot: 0, born: 0.6 };

    it('靠左、居中、靠右；空格占宽度不出字', () => {
        const left = layoutMetaphorNotes([{ ...note, align: 0 }], measure);
        expect(left.map(glyph => glyph.char).join('')).toBe('a=b');
        expect(left[0].x).toBeCloseTo(2.1);
        expect(left[2].x).toBeCloseTo(2.9);
        expect(left.every(glyph => glyph.y === 1 && glyph.size === 0.4 && glyph.born === 0.6)).toBe(true);
        const centred = layoutMetaphorNotes([{ ...note, align: 0.5 }], measure);
        expect(centred[0].x + centred[2].x).toBeCloseTo(4);
        const right = layoutMetaphorNotes([{ ...note, align: 1 }], measure);
        expect(right[2].x).toBeCloseTo(1.9);
    });

    it('转了角度的注记沿自己的方向排', () => {
        const upright = layoutMetaphorNotes([{ ...note, align: 0, rot: Math.PI / 2 }], measure);
        expect(upright[0].x).toBeCloseTo(2);
        expect(upright[2].y).toBeCloseTo(1.9);
    });
});

describe('writeMetaphorShapes 写线稿', () => {
    it('还没到时候的不写；形状的参数写在第 10 个数上', () => {
        const shapes = [
            staticMetaphorShape(METAPHOR_SHAPE_BAR, { param: 7, born: 0 }),
            staticMetaphorShape(METAPHOR_SHAPE_ARC, { param: 0.5, born: 1 }),
        ];
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        expect(writeMetaphorShapes(shapes, 0, 0, 1, data, 0.5)).toBe(1);
        expect(data[9]).toBe(7);
        expect(writeMetaphorShapes(shapes, 0, 0, 1, data, 1)).toBe(2);
        expect(data[METAPHOR_SHAPE_STRIDE + 8]).toBe(METAPHOR_SHAPE_ARC);
        expect(data[METAPHOR_SHAPE_STRIDE + 9]).toBe(0.5);
        expect(writeMetaphorShapes(shapes, 0, 0, 1, data)).toBe(2);
    });

    it('行星绕着自己的圆心匀速转，离圆心一样远', () => {
        const planet = staticMetaphorShape(METAPHOR_SHAPE_BLOB, { x: 3, y: -2, orbit: 1.5, orbitSpeed: 0.1, steady: true });
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const angles: number[] = [];
        for (const time of [0, 10, 20]) {
            writeMetaphorShapes([planet], time, 1, 2, data);
            expect(Math.hypot(data[0] - 3, data[1] + 2)).toBeCloseTo(1.5);
            angles.push(Math.atan2(data[1] + 2, data[0] - 3));
        }
        expect(angles[1] - angles[0]).toBeCloseTo(1);
        expect(angles[2] - angles[1]).toBeCloseTo(1);
    });

    it('版面、融球、线稿加起来不超过容量的八成（剩下的留给对撞和字放出的粒子）', () => {
        for (const interlude of [false, true]) {
            const total = planMetaphorBackdrop(bounds, createVisualizerRng('cap'), 2, interlude, { index: 1, time: 0 }).shapes.length
                + planMetaphorShapes(bounds, createVisualizerRng('cap'), 2, interlude).length
                + planMetaphorFigures(bounds, createVisualizerRng('cap'), 2, interlude).shapes.length;
            expect(total).toBeLessThan(METAPHOR_SHAPE_CAPACITY * 0.8);
        }
    });
});

describe('齐行的排版', () => {
    const measure = (char: string) => (/[一-鿿]/u.test(char) ? 1 : 0.6);

    it('短的行字大，每一行差不多一样宽', () => {
        const layout = buildMetaphorLayout({
            tokens: buildMetaphorTextTokens('Light falls on the empty stage tonight', 1), composition: 'justify', measure, rng: createVisualizerRng('justify'),
        });
        const rows = new Map<number, { x0: number; x1: number; size: number }>();
        for (const glyph of layout.glyphs) {
            const key = Math.round(glyph.y * 100);
            const row = rows.get(key) ?? { x0: Infinity, x1: -Infinity, size: glyph.size };
            row.x0 = Math.min(row.x0, glyph.x - glyph.size * 0.3);
            row.x1 = Math.max(row.x1, glyph.x + glyph.size * 0.3);
            rows.set(key, row);
        }
        expect(rows.size).toBeGreaterThan(1);
        const widths = [...rows.values()].map(row => row.x1 - row.x0);
        const sizes = [...rows.values()].map(row => row.size);
        expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes));
        expect(Math.min(...sizes)).toBe(1);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(Math.max(...widths) * 0.12);
    });
});
