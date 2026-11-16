import { describe, expect, it } from 'vitest';
import type { Line, Theme } from '@/types';
import { createVisualizerRng } from '@/components/visualizer/visualizerSeedHash';
import {
    METAPHOR_FOV,
    resolveMetaphorMelt,
    resolveMetaphorPose,
    resolveMetaphorStillPose,
    resolveMetaphorTransitionFx,
} from '@/components/visualizer/metaphor/metaphorCamera';
import {
    buildMetaphorLayout,
    buildMetaphorTextTokens,
    buildMetaphorTokens,
    type MetaphorComposition,
    type MetaphorLayout,
} from '@/components/visualizer/metaphor/metaphorLayout';
import { resolveMetaphorKeywordColor, resolveMetaphorPalette } from '@/components/visualizer/metaphor/metaphorPalette';
import type { MetaphorCue, MetaphorProgram, MetaphorShot, MetaphorShotKind } from '@/components/visualizer/metaphor/metaphorProgram';
import {
    METAPHOR_COLLISION_APPROACH,
    METAPHOR_COLLISION_LIFE,
    METAPHOR_DYNAMIC_RESERVE,
    METAPHOR_SHAPE_CAPACITY,
    METAPHOR_SHAPE_STRIDE,
    joinMetaphorShapes,
    planMetaphorCollisions,
    planMetaphorShapes,
    staticMetaphorShape,
    writeMetaphorCollisions,
    writeMetaphorPairs,
    writeMetaphorShapes,
} from '@/components/visualizer/metaphor/metaphorShapes';
import { normalizeMetaphorTuning } from '@/components/visualizer/metaphor/tuning';
import { DEFAULT_METAPHOR_TUNING, METAPHOR_LIMITS } from '@/components/visualizer/metaphor/types';

// test/unit/visualizer/metaphor/metaphorStage.test.ts
// 隐喻里按排版算的那几样（都是纯函数）：排版（每种构图）、机位（每种镜头，正对画面、极慢、大位移分档跳切）、转场的量、
// 融球规划、对撞和字放出的粒子、配色、tuning 的归一化。

const COMPOSITIONS: MetaphorComposition[] = ['block', 'stair', 'hero', 'column', 'scatter', 'justify'];

/** 每个字宽 0.6 em（中文 1 em）。 */
const measure = (char: string) => (/[一-鿿]/u.test(char) ? 1 : 0.6);

const layoutOf = (text: string, composition: MetaphorComposition, isAccent?: (text: string) => boolean): MetaphorLayout => (
    buildMetaphorLayout({ tokens: buildMetaphorTextTokens(text, 1), composition, measure, rng: createVisualizerRng(`layout:${composition}`), isAccent })
);

describe('buildMetaphorLayout', () => {
    it.each(COMPOSITIONS)('%s：每个字都在，不出字的空白不占字，整句居中', (composition) => {
        const text = 'Light falls on the empty stage';
        const layout = layoutOf(text, composition);
        expect(layout.glyphs.map(glyph => glyph.char).join('')).toBe(text.replace(/\s/gu, ''));
        expect(layout.words).toHaveLength(6);
        expect(layout.bounds.x0 + layout.bounds.x1).toBeCloseTo(0);
        expect(layout.bounds.y0 + layout.bounds.y1).toBeCloseTo(0);
        for (const glyph of layout.glyphs) {
            expect(Number.isFinite(glyph.x) && Number.isFinite(glyph.y)).toBe(true);
            expect(glyph.x).toBeGreaterThanOrEqual(layout.bounds.x0);
            expect(glyph.x).toBeLessThanOrEqual(layout.bounds.x1);
            expect(glyph.word).toBeLessThan(layout.words.length);
        }
    });

    it('主词构图把最宽的那个词放大', () => {
        const layout = layoutOf('Light falls on the empty stage', 'hero');
        const sizes = new Set(layout.glyphs.map(glyph => glyph.size));
        expect(Math.max(...sizes)).toBeGreaterThan(1.5);
        expect(Math.min(...sizes)).toBe(1);
    });

    it('竖排一列最多六个字，从右往左', () => {
        const layout = layoutOf('落叶数着每一拍的声音', 'column');
        const columns = new Map<number, number>();
        layout.glyphs.forEach(glyph => columns.set(glyph.x, (columns.get(glyph.x) ?? 0) + 1));
        expect(columns.size).toBe(2);
        expect([...columns.values()].every(count => count <= 6)).toBe(true);
        // 第一个字在最右边那一列的最上面
        expect(layout.glyphs[0].x).toBe(Math.max(...columns.keys()));
        expect(layout.glyphs[0].y).toBe(Math.max(...layout.glyphs.map(glyph => glyph.y)));
    });

    it('关键词的字标成强调色', () => {
        const layout = layoutOf('Light falls on the empty stage', 'block', text => text === 'empty');
        expect(layout.glyphs.filter(glyph => glyph.accent).map(glyph => glyph.char).join('')).toBe('empty');
    });

    it('带逐词时间的一句：每个字拿到自己所在那个词的时间，字不多不少', () => {
        const line = {
            fullText: 'Hold this 音符',
            startTime: 2,
            endTime: 5,
            words: [
                { text: 'Hold ', startTime: 2, endTime: 3 },
                { text: 'this ', startTime: 3, endTime: 4 },
                { text: '音符', startTime: 4, endTime: 5 },
            ],
        } as Line;
        const tokens = buildMetaphorTokens(line);
        expect(tokens.flatMap(token => token.chars.map(item => item.char)).join('')).toBe(line.fullText);
        const layout = buildMetaphorLayout({ tokens, composition: 'block', measure, rng: () => 0.5 });
        expect(layout.glyphs.map(glyph => glyph.char).join('')).toBe('Holdthis音符');
        for (const glyph of layout.glyphs) {
            expect(glyph.t0).toBeGreaterThanOrEqual(2);
            expect(glyph.t1).toBeLessThanOrEqual(5);
            expect(glyph.t1).toBeGreaterThanOrEqual(glyph.t0);
        }
        // 先唱的字时间不晚于后唱的
        layout.glyphs.slice(1).forEach((glyph, index) => expect(glyph.t0).toBeGreaterThanOrEqual(layout.glyphs[index].t0));
        expect(layout.glyphs[0].t0).toBe(2);
        expect(layout.glyphs.at(-1)!.t0).toBeGreaterThanOrEqual(4);
    });

    it('没有能出字的 token：一个空的小舞台', () => {
        const layout = buildMetaphorLayout({ tokens: buildMetaphorTextTokens('   ', 0), composition: 'block', measure, rng: () => 0.5 });
        expect(layout.glyphs).toEqual([]);
        expect(layout.bounds).toEqual({ x0: -1, y0: -0.5, x1: 1, y1: 0.5 });
    });
});

const KINDS: MetaphorShotKind[] = ['wide', 'close', 'follow', 'macro', 'dutch', 'void', 'pullback', 'pushin'];

const shotOf = (kind: MetaphorShotKind, patch: Partial<MetaphorShot> = {}): MetaphorShot => ({
    start: 0, end: 2, kind, roll: 0, offsetX: 0, offsetY: 0, invert: false, screenAngle: 0.5, seed: 0.3, ...patch,
});

/** 三个词各在 2、3、4 秒开唱的一句。 */
const timedLayout = (): MetaphorLayout => buildMetaphorLayout({
    tokens: buildMetaphorTokens({
        fullText: 'Hold this note',
        startTime: 2,
        endTime: 5,
        words: [
            { text: 'Hold ', startTime: 2, endTime: 3 },
            { text: 'this ', startTime: 3, endTime: 4 },
            { text: 'note', startTime: 4, endTime: 5 },
        ],
    } as Line),
    composition: 'stair',
    measure,
    rng: () => 0.5,
});

describe('resolveMetaphorPose', () => {
    const layout = layoutOf('Light falls on the empty stage', 'block');
    const empty: MetaphorLayout = { composition: 'block', glyphs: [], words: [], bounds: { x0: -4, y0: -2, x1: 4, y1: 2 } };

    it.each(KINDS)('%s：有字、没字（间奏）都算得出机位，离画面有距离', (kind) => {
        for (const target of [layout, empty]) {
            for (const time of [0, 0.7, 2]) {
                const pose = resolveMetaphorPose({ shot: shotOf(kind), layout: target, time, aspect: 16 / 9, motion: 1 });
                expect(Object.values(pose).every(Number.isFinite)).toBe(true);
                expect(pose.distance).toBeGreaterThan(0.1);
            }
        }
    });

    it('全景装得下整句：竖屏比横屏退得远', () => {
        const distance = (aspect: number) => resolveMetaphorPose({ shot: shotOf('wide'), layout, time: 0, aspect, motion: 0 }).distance;
        const wide = distance(16 / 9);
        const height = layout.bounds.y1 - layout.bounds.y0;
        const width = layout.bounds.x1 - layout.bounds.x0;
        const visibleHeight = 2 * wide * Math.tan((METAPHOR_FOV * Math.PI) / 360);
        expect(visibleHeight).toBeGreaterThanOrEqual(height);
        expect(visibleHeight * (16 / 9)).toBeGreaterThanOrEqual(width);
        expect(distance(9 / 16)).toBeGreaterThan(wide);
    });

    it('一个镜头里机位只极慢地蠕动：两秒里远近变不到一成，位置挪不到画面的百分之二', () => {
        for (const kind of ['wide', 'close', 'macro', 'dutch', 'void'] as const) {
            const at = (time: number) => resolveMetaphorPose({ shot: shotOf(kind, { end: 6 }), layout, time, aspect: 16 / 9, motion: 2 });
            for (let time = 0; time < 4; time += 0.5) {
                const from = at(time);
                const to = at(time + 2);
                const visible = 2 * from.distance * Math.tan((METAPHOR_FOV * Math.PI) / 360);
                expect(Math.abs(to.distance / from.distance - 1)).toBeLessThan(0.1);
                expect(Math.hypot(to.x - from.x, to.y - from.y) / visible).toBeLessThan(0.02);
                expect(Math.abs(to.roll - from.roll)).toBeLessThan(0.05);
            }
        }
    });

    it('拉远不滑：分三档在词开唱（词不够就均分）的时刻上跳，档与档之间一动不动', () => {
        const at = (time: number) => resolveMetaphorPose({ shot: shotOf('pullback'), layout, time, aspect: 16 / 9, motion: 0 });
        // 这句的字都在第 1 秒开唱，镜头里凑不够三个词：0.5、1、1.5 秒各跳一档
        const levels = new Set<number>();
        for (let time = 0; time <= 2; time += 0.01) levels.add(at(time).distance);
        expect(levels.size).toBe(4);
        expect(at(0.45)).toEqual(at(0.05));
        expect(at(0.95)).toEqual(at(0.55));
        expect(at(0.55).distance).toBeGreaterThan(at(0.45).distance);
        expect(at(2).distance).toBeGreaterThan(at(0).distance * 1.5);

        // 有三个词时卡在词上：第二、第三个词开唱的时刻各跳一档（第一个词和镜头同时开始，不算）
        const timed = timedLayout();
        const shot = shotOf('pullback', { start: 2, end: 6 });
        const timedAt = (time: number) => resolveMetaphorPose({ shot, layout: timed, time, aspect: 16 / 9, motion: 0 }).distance;
        expect(timedAt(2.99)).toBe(timedAt(2));
        expect(timedAt(3)).toBeGreaterThan(timedAt(2.99));
        expect(timedAt(3.99)).toBe(timedAt(3));
        expect(timedAt(4)).toBeGreaterThan(timedAt(3.99));
    });

    it('冲镜连跳三格落到第一个词上，之后不再动', () => {
        const at = (time: number) => resolveMetaphorPose({ shot: shotOf('pushin'), layout, time, aspect: 16 / 9, motion: 0 });
        const levels = new Set<number>();
        for (let time = 0; time <= 2; time += 0.01) levels.add(at(time).distance);
        expect(levels.size).toBe(4);
        expect(at(2).distance).toBeLessThan(at(0).distance * 0.6);
        expect(at(2)).toEqual(at(0.6));
    });

    it('跟字不滑：换词的那一刻直接跳过去', () => {
        const timed = timedLayout();
        const shot = shotOf('follow', { start: 2, end: 5 });
        const at = (time: number) => resolveMetaphorPose({ shot, layout: timed, time, aspect: 16 / 9, motion: 0 });
        expect(at(2.99)).toEqual(at(2));
        expect(at(3)).not.toEqual(at(2.99));
        expect(at(3.99)).toEqual(at(3));
        expect(at(4).y).toBeLessThan(at(3).y);
    });

    it('运镜幅度是 0 时，固定机位的镜头一动不动', () => {
        const at = (time: number) => resolveMetaphorPose({ shot: shotOf('wide'), layout, time, aspect: 1.5, motion: 0 });
        expect(at(1.7)).toEqual(at(0.2));
    });

    it('静态模式的机位：对着整句的中心、不转', () => {
        const pose = resolveMetaphorStillPose(layout, 16 / 9);
        expect(pose.roll).toBe(0);
        expect(pose.x).toBeCloseTo(0);
        expect(pose.y).toBeCloseTo(0);
        expect(pose.distance).toBeGreaterThan(0);
    });
});

const cueOf = (patch: Partial<MetaphorCue>): MetaphorCue => ({
    lineIndex: 0, start: 0, end: 4, singStart: 0.35, singEnd: 3, composition: 'block', shots: [shotOf('wide', { end: 4 })],
    transition: 'cut', chorus: false, text: '', loop: 0, ...patch,
});

describe('转场和化开', () => {
    const fx = { flood: 0 };
    const program = (transition: MetaphorCue['transition']): MetaphorProgram => ({
        cues: [cueOf({}), cueOf({ start: 4, end: 8, transition })],
    });

    it('硬切什么都不加', () => {
        expect(resolveMetaphorTransitionFx(program('cut'), 0, 3.99, fx)).toEqual({ flood: 0 });
        expect(resolveMetaphorTransitionFx(program('cut'), 1, 4, fx)).toEqual({ flood: 0 });
    });

    it('漫墨：切点前后墨最满，两头是 0', () => {
        expect(resolveMetaphorTransitionFx(program('flood'), 0, 3, fx).flood).toBe(0);
        expect(resolveMetaphorTransitionFx(program('flood'), 0, 3.99, fx).flood).toBeGreaterThan(1);
        expect(resolveMetaphorTransitionFx(program('flood'), 1, 4, fx).flood).toBeGreaterThan(1);
        expect(resolveMetaphorTransitionFx(program('flood'), 1, 5, fx).flood).toBe(0);
        // 漫进来、退下去都不急：切点前后半秒墨还没退完
        expect(resolveMetaphorTransitionFx(program('flood'), 0, 3.6, fx).flood).toBeGreaterThan(0);
        expect(resolveMetaphorTransitionFx(program('flood'), 1, 4.5, fx).flood).toBeGreaterThan(0);
    });


    it('唱完后留着尾巴的句子才化开；紧跟下一句的不化', () => {
        const tailed = cueOf({ singEnd: 2.5, end: 4 });
        expect(resolveMetaphorMelt(tailed, 2.5)).toBe(0);
        expect(resolveMetaphorMelt(tailed, 4)).toBe(1);
        expect(resolveMetaphorMelt(cueOf({ singEnd: 3.9, end: 4 }), 4)).toBe(0);
        expect(resolveMetaphorMelt(cueOf({ lineIndex: -1 }), 4)).toBe(0);
    });
});

describe('融球和装饰', () => {
    const bounds = { x0: -3, y0: -1.2, x1: 3, y1: 1.2 };

    it('大墨团和绕着它转的小墨滴，阈值以上的那块始终不压在字上（流体开到最大、音量最大、任何时刻）', () => {
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        let checked = 0;
        for (let seed = 0; seed < 60; seed += 1) {
            const shapes = planMetaphorShapes(bounds, createVisualizerRng(`shapes:${seed}`), 1, false);
            for (let time = 0; time < 60; time += 1.7) {
                expect(writeMetaphorShapes(shapes, time, 1, METAPHOR_LIMITS.flow.max, data)).toBe(shapes.length);
                shapes.forEach((shape, index) => {
                    // 大墨团是带着小墨滴的那几个；贴着字的小墨滴（没有父、也没有子）本来就挨着字，不算
                    const big = shape.parent < 0 && shapes.some(other => other.parent === index);
                    if (shape.shape !== 0 || shape.ink === 0 || !(big || shape.parent >= 0)) return;
                    const at = index * METAPHOR_SHAPE_STRIDE;
                    const outside = Math.max(Math.abs(data[at]) - bounds.x1, Math.abs(data[at + 1]) - bounds.y1);
                    expect(outside).toBeGreaterThan(data[at + 2] * 0.55);
                    checked += 1;
                });
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('融球调到 0 就没有图形；调大就更多；不超过容量', () => {
        const count = (amount: number) => planMetaphorShapes(bounds, createVisualizerRng('amount'), amount, false).length;
        expect(count(0)).toBe(0);
        expect(count(2)).toBeGreaterThan(count(1));
        expect(planMetaphorShapes(bounds, createVisualizerRng('amount'), 2, true).length).toBeLessThan(METAPHOR_SHAPE_CAPACITY / 2);
    });

    it('同一个时刻写出来的一样（拖进度不走样）', () => {
        const shapes = planMetaphorShapes(bounds, createVisualizerRng('same'), 1, false);
        const first = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const second = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        writeMetaphorShapes(shapes, 12.5, 0.4, 1, first);
        writeMetaphorShapes(shapes, 3, 0, 1, second);
        writeMetaphorShapes(shapes, 12.5, 0.4, 1, second);
        expect(second).toEqual(first);
    });

    it('漂得很慢：一秒里墨团挪不到自己半径的一成', () => {
        const shapes = planMetaphorShapes(bounds, createVisualizerRng('slow'), 1, false);
        const from = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const to = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        for (let time = 0; time < 40; time += 3.3) {
            writeMetaphorShapes(shapes, time, 0, 1, from);
            writeMetaphorShapes(shapes, time + 1, 0, 1, to);
            shapes.forEach((shape, index) => {
                if (shape.shape !== 0 || shape.parent >= 0 || shape.sx < 0.6) return;
                const at = index * METAPHOR_SHAPE_STRIDE;
                expect(Math.hypot(to[at] - from[at], to[at + 1] - from[at + 1])).toBeLessThan(shape.sx * 0.1 + 0.05);
            });
        }
    });

    it('刚唱到的字放出一对粒子，朝相反的两边去，不是往下掉；过一会儿就没了；写不出容量', () => {
        const layout = layoutOf('Light falls', 'block');
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        expect(writeMetaphorPairs(layout.glyphs, 0.5, data, 3)).toBe(3);
        expect(writeMetaphorPairs(layout.glyphs, 2.4, data, 3)).toBe(3 + layout.glyphs.length * 2);
        let upward = 0;
        layout.glyphs.forEach((glyph, index) => {
            const first = (3 + index * 2) * METAPHOR_SHAPE_STRIDE;
            const second = first + METAPHOR_SHAPE_STRIDE;
            const a = [data[first] - glyph.x, data[first + 1] - glyph.y];
            const b = [data[second] - glyph.x, data[second + 1] - glyph.y];
            // 一对粒子关于出发的那条轴镜像：沿轴一正一反、离轴一样远（各往相反的一边打转），离字一样远
            const axis = [Math.cos(glyph.seed * Math.PI * 2), Math.sin(glyph.seed * Math.PI * 2)];
            expect(a[0] * axis[0] + a[1] * axis[1]).toBeCloseTo(-(b[0] * axis[0] + b[1] * axis[1]));
            expect(a[0] * axis[1] - a[1] * axis[0]).toBeCloseTo(b[0] * axis[1] - b[1] * axis[0]);
            expect(Math.hypot(a[0], a[1])).toBeGreaterThan(glyph.size * 0.4);
            if (a[1] > 0) upward += 1;
            if (b[1] > 0) upward += 1;
        });
        // 往上走的和往下走的都有
        expect(upward).toBeGreaterThan(0);
        expect(upward).toBeLessThan(layout.glyphs.length * 2);
        expect(writeMetaphorPairs(layout.glyphs, 9, data, 3)).toBe(3);
        expect(writeMetaphorPairs(layout.glyphs, 2.4, data, METAPHOR_SHAPE_CAPACITY - 3)).toBe(METAPHOR_SHAPE_CAPACITY);
    });
});

describe('对撞', () => {
    const bounds = { x0: -3, y0: -1.2, x1: 3, y1: 1.2 };
    const plan = (seed: string, interlude = false) => planMetaphorCollisions(bounds, createVisualizerRng(seed), [10], 1, interlude);
    const write = (hits: ReturnType<typeof plan>, time: number) => {
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const count = writeMetaphorCollisions(hits, time, data, 0);
        return { data, count };
    };
    const far = (data: Float32Array, index: number, hit: { x: number; y: number }) => (
        Math.hypot(data[index * METAPHOR_SHAPE_STRIDE] - hit.x, data[index * METAPHOR_SHAPE_STRIDE + 1] - hit.y)
    );

    it('融球调到 0 就不撞；撞的地方在字的包围盒外面（间奏在舞台里）', () => {
        expect(planMetaphorCollisions(bounds, createVisualizerRng('none'), [10], 0, false)).toEqual([]);
        for (let seed = 0; seed < 40; seed += 1) {
            const [hit] = plan(`place:${seed}`);
            expect(Math.max(Math.abs(hit.x) - bounds.x1, Math.abs(hit.y) - bounds.y1)).toBeGreaterThan(0.5);
            expect(hit.fragments.length).toBeGreaterThanOrEqual(3);
            const [inside] = plan(`place:${seed}`, true);
            expect(Math.abs(inside.x)).toBeLessThanOrEqual(bounds.x1);
            expect(Math.abs(inside.y)).toBeLessThanOrEqual(bounds.y1);
        }
    });

    it('撞之前：两颗墨球在撞点两边对称，相向而来，越来越快；更早什么都没有', () => {
        const hits = plan('approach');
        const [hit] = hits;
        expect(write(hits, 10 - METAPHOR_COLLISION_APPROACH - 0.1).count).toBe(0);
        const lead = (time: number) => {
            const { data, count } = write(hits, time);
            expect(count).toBeGreaterThanOrEqual(2);
            // 领头的两颗写在最前面，关于撞点对称
            expect(data[0] + data[METAPHOR_SHAPE_STRIDE]).toBeCloseTo(hit.x * 2);
            expect(data[1] + data[METAPHOR_SHAPE_STRIDE + 1]).toBeCloseTo(hit.y * 2);
            return far(data, 0, hit);
        };
        const [a, b, c, d] = [lead(8), lead(8.6), lead(9.2), lead(9.8)];
        expect(a).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(c);
        expect(c).toBeGreaterThan(d);
        expect(c - d).toBeGreaterThan(a - b);
        expect(lead(9.999)).toBeLessThan(hit.unit * 0.05);
    });

    it('撞之后：碎片沿螺旋线甩出去，越走越慢，走不出各自的射程；最后散完', () => {
        const hits = plan('burst');
        const [hit] = hits;
        const longest = Math.max(...hit.fragments.map(fragment => fragment.range));
        let previous = 0;
        let previousStep = Number.POSITIVE_INFINITY;
        for (const since of [1, 2, 3]) {
            const { data, count } = write(hits, 10 + since);
            expect(count).toBeGreaterThan(hit.fragments.length);
            let farthest = 0;
            for (let index = 0; index < count; index += 1) {
                // 冲击环的圆心在撞点上，不算进碎片
                if (data[index * METAPHOR_SHAPE_STRIDE + 8] === 0) farthest = Math.max(farthest, far(data, index, hit));
            }
            expect(farthest).toBeLessThanOrEqual(longest);
            expect(farthest).toBeGreaterThan(previous);
            expect(farthest - previous).toBeLessThan(previousStep);
            previousStep = farthest - previous;
            previous = farthest;
        }
        // 不是直线：同一颗碎片先后两个时刻，从撞点看过去的方向转了
        const fragment = hit.fragments[0];
        const turned = Math.abs(fragment.curl * fragment.range * (Math.exp(-0.5 * 0.6) - Math.exp(-3 * 0.6))) / hit.unit;
        expect(turned).toBeGreaterThan(0.2);
        expect(write(hits, 10 + METAPHOR_COLLISION_LIFE).count).toBe(0);
    });

    it('同一个时刻写出来的一样；写不出容量', () => {
        const hits = planMetaphorCollisions(bounds, createVisualizerRng('many'), [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5], 2, true);
        const first = write(hits, 13.8);
        write(hits, 3);
        const second = write(hits, 13.8);
        expect(second.data).toEqual(first.data);
        expect(first.count).toBeLessThanOrEqual(METAPHOR_SHAPE_CAPACITY);
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        expect(writeMetaphorCollisions(hits, 13.8, data, METAPHOR_SHAPE_CAPACITY - 2)).toBe(METAPHOR_SHAPE_CAPACITY);
    });
});

describe('resolveMetaphorPalette', () => {
    const theme = (patch: Partial<Theme>) => ({
        backgroundColor: '#09090b', primaryColor: '#f4f4f5', accentColor: '#e11d48', secondaryColor: '#71717a', ...patch,
    }) as Theme;
    const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    it('纸是背景色，墨是主色', () => {
        const palette = resolveMetaphorPalette(theme({}));
        expect(palette.paper.map(value => Math.round(value * 255))).toEqual([9, 9, 11]);
        expect(palette.ink.map(value => Math.round(value * 255))).toEqual([244, 244, 245]);
        expect(palette.accent.map(value => Math.round(value * 255))).toEqual([225, 29, 72]);
    });

    it('画面反相：纸和墨对调，网点和强调色仍然和新的纸分得开', () => {
        const palette = resolveMetaphorPalette(theme({}), true);
        expect(palette.paper.map(value => Math.round(value * 255))).toEqual([244, 244, 245]);
        expect(palette.ink.map(value => Math.round(value * 255))).toEqual([9, 9, 11]);
        expect(distance(palette.tone, palette.paper)).toBeGreaterThanOrEqual(0.22);
        expect(distance(palette.accent, palette.paper)).toBeGreaterThanOrEqual(0.25);
    });

    it('关键字的颜色：照主题写的用；和纸分不开的往墨那边拉；坏的色值用强调色', () => {
        const palette = resolveMetaphorPalette(theme({}));
        expect(resolveMetaphorKeywordColor('#22c55e', palette).map(value => Math.round(value * 255))).toEqual([34, 197, 94]);
        expect(distance(resolveMetaphorKeywordColor('#0a0a0c', palette), palette.paper)).toBeGreaterThanOrEqual(0.25);
        expect(resolveMetaphorKeywordColor('not a color', palette)).toEqual(palette.accent);
    });

    it('强调色和墨同色（默认主题）：换成和纸、墨都分得开的一档', () => {
        const palette = resolveMetaphorPalette(theme({ accentColor: '#f4f4f5' }));
        expect(distance(palette.accent, palette.ink)).toBeGreaterThan(0.25);
        expect(distance(palette.accent, palette.paper)).toBeGreaterThan(0.25);
    });

    it('主色和背景分不开：墨换成纸的反面；网点、强调色和纸拉开', () => {
        const dark = resolveMetaphorPalette(theme({ primaryColor: '#101012', secondaryColor: '#0a0a0c', accentColor: '#0b0b0d' }));
        expect(dark.ink[0]).toBeGreaterThan(0.8);
        expect(distance(dark.tone, dark.paper)).toBeGreaterThan(0.2);
        expect(distance(dark.accent, dark.paper)).toBeGreaterThan(0.2);
        const light = resolveMetaphorPalette(theme({ backgroundColor: '#fafafa', primaryColor: '#f0f0f0' }));
        expect(light.ink[0]).toBeLessThan(0.2);
    });

    it('读不出来的颜色用回退值', () => {
        const palette = resolveMetaphorPalette(theme({ backgroundColor: 'nope', primaryColor: '', accentColor: 'x', secondaryColor: 'y' }));
        expect(Object.values(palette).flat().every(Number.isFinite)).toBe(true);
    });
});

describe('normalizeMetaphorTuning', () => {
    it('空的、不是对象的读成默认', () => {
        for (const stored of [undefined, null, 5, 'text', []]) expect(normalizeMetaphorTuning(stored)).toEqual(DEFAULT_METAPHOR_TUNING);
    });

    it('数值夹进范围，类型不对的用默认', () => {
        const tuning = normalizeMetaphorTuning({ cutPace: 99, cameraMotion: -3, flow: '1.5', blobs: Number.NaN, halftone: 0, grain: 1.25, negative: 'yes', transitions: false });
        expect(tuning).toMatchObject({
            cutPace: METAPHOR_LIMITS.cutPace.max, cameraMotion: METAPHOR_LIMITS.cameraMotion.min, flow: DEFAULT_METAPHOR_TUNING.flow,
            blobs: DEFAULT_METAPHOR_TUNING.blobs, halftone: METAPHOR_LIMITS.halftone.min, grain: 1.25,
            negative: DEFAULT_METAPHOR_TUNING.negative, transitions: false,
        });
    });

    it('不认识的字段不留', () => {
        expect(Object.keys(normalizeMetaphorTuning({ somethingElse: 1 })).sort()).toEqual(Object.keys(DEFAULT_METAPHOR_TUNING).sort());
    });
});

describe('关键字的颜色进排版', () => {
    it('有颜色的 token 整个词是强调墨、带着那个颜色；别的词不是', () => {
        const tokens = buildMetaphorTextTokens('light falls here', 1);
        const tints = tokens.map(token => (token.text.trim() === 'falls' ? '#22c55e' : null));
        const layout = buildMetaphorLayout({ tokens, composition: 'block', measure, rng: createVisualizerRng('tints'), tints });
        const tinted = layout.glyphs.filter(glyph => glyph.accent);
        expect(tinted.map(glyph => glyph.char).join('')).toBe('falls');
        expect(tinted.every(glyph => glyph.tint === '#22c55e')).toBe(true);
        expect(layout.glyphs.filter(glyph => !glyph.accent).every(glyph => glyph.tint === null)).toBe(true);
    });

    it('不给颜色时没有强调墨', () => {
        const layout = buildMetaphorLayout({ tokens: buildMetaphorTextTokens('light falls here', 1), composition: 'block', measure, rng: createVisualizerRng('tints') });
        expect(layout.glyphs.some(glyph => glyph.accent)).toBe(false);
    });
});

describe('joinMetaphorShapes / 容量', () => {
    const bounds = { x0: -3, y0: -1, x1: 3, y1: 1 };
    const front = Array.from({ length: 7 }, (_, index) => staticMetaphorShape(2, { x: index }));

    it('拼在别的规划后面时，小墨滴还是绕着自己的大墨团', () => {
        const blobs = planMetaphorShapes(bounds, createVisualizerRng('join'), 1, false);
        const joined = joinMetaphorShapes(front, blobs);
        blobs.forEach((shape, index) => {
            const moved = joined[front.length + index];
            if (shape.parent < 0) expect(moved).toBe(shape);
            else expect(joined[moved.parent]).toBe(blobs[shape.parent]);
        });
        expect(blobs.some(shape => shape.parent >= 0)).toBe(true);
        // 写出来的位置和单独写融球时一样（只是排在后面）
        const alone = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const together = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        const count = writeMetaphorShapes(blobs, 12.3, 0, 1, alone);
        writeMetaphorShapes(joined, 12.3, 0, 1, together);
        expect(Array.from(together.subarray(front.length * METAPHOR_SHAPE_STRIDE, (front.length + count) * METAPHOR_SHAPE_STRIDE)))
            .toEqual(Array.from(alone.subarray(0, count * METAPHOR_SHAPE_STRIDE)));
    });

    it('规划写到容量减去留给对撞和小环的名额为止', () => {
        const many = Array.from({ length: METAPHOR_SHAPE_CAPACITY }, (_, index) => staticMetaphorShape(0, { x: index }));
        const data = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
        expect(writeMetaphorShapes(many, 0, 0, 1, data)).toBe(METAPHOR_SHAPE_CAPACITY - METAPHOR_DYNAMIC_RESERVE);
    });
});
