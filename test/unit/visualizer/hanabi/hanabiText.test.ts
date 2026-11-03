// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import type { Line, Theme } from '@/types';
import type { BlockStyle, EnterFx, ExitFx, HanabiPalette, SingFx, TextLayout, TextSpec } from '@/components/visualizer/hanabi/types';
import {
    ENTER_FX, EXIT_FX, SING_FX, enterPose, exitPose, restPose, scheduleEnter, scheduleExit, singPose, type FxContext,
} from '@/components/visualizer/hanabi/text/animations';
import { blockLayoutParams } from '@/components/visualizer/hanabi/text/blocks';
import {
    estimateAdvance, isUprightGlyph, resolveGlyphAtlasLimit, setHanabiGlyphTextureLimit, type BuildGlyphAtlas,
} from '@/components/visualizer/hanabi/text/glyphs';
import { layoutText, wordScales, type PlacedGlyph, type TextPlacement } from '@/components/visualizer/hanabi/text/layout';
import { buildHanabiText, lineWords } from '@/components/visualizer/hanabi/text/lyricText';
import { splitLyricGraphemes } from '@/utils/lyrics/graphemeTiming';

// test/unit/visualizer/hanabi/hanabiText.test.ts
// 花火文字引擎：排版不越界、scatter 不重叠、竖排方向、入场 / 退场曲线收敛、时间表、确定性，以及用假 Pixi 跑一遍整行。（取自 lumisynth）

const LAYOUTS: TextLayout[] = ['center', 'left', 'right', 'stagger', 'diagonal', 'scatter', 'vertical', 'vertical-split', 'arc'];
const BLOCKS: BlockStyle[] = ['none', 'tile', 'band', 'slant', 'double', 'pill', 'split', 'ticket', 'marker', 'outline', 'circle', 'stair'];

const makeLine = (text: string, start = 10, perChar = 0.25): Line => {
    const segments = text.split(/(\s+)/).filter(Boolean);
    let t = start;
    const words = segments.filter(segment => segment.trim()).map(segment => {
        const length = splitLyricGraphemes(segment).length;
        const word = { text: segment, startTime: t, endTime: t + length * perChar };
        t += length * perChar + 0.05;
        return word;
    });
    return { words, startTime: start, endTime: t, fullText: text };
};

const SAMPLES = [
    '夜空に咲いた大きな花火',
    '君と見上げた夏の終わりの空をずっと忘れないよ、たとえ遠く離れても',
    'Shine on me tonight',
    '花火',
    '僕らの Summer Night 光る',
];

const placeLine = (text: string, layout: TextLayout, block: BlockStyle, region = { w: 900, h: 420 }, emphasis = 0.8, tilt = 0): TextPlacement => {
    const line = makeLine(text);
    const chars = splitLyricGraphemes(text);
    const words = lineWords(line, chars.length);
    const scales = wordScales(words, emphasis, 'seed');
    words.forEach((word, index) => { word.scale = scales[index]!; });
    const glyphWord = new Array<number>(chars.length).fill(0);
    words.forEach((word, index) => { for (let g = word.start; g < word.end; g += 1) glyphWord[g] = index; });
    return layoutText(
        chars.map((char, index) => ({ char, advance: estimateAdvance(char), blank: char.trim() === '', upright: isUprightGlyph(char), word: glyphWord[index]! })),
        words,
        { layout, regionWidth: region.w, regionHeight: region.h, fontPx: 150, tilt, seed: `${text}:${layout}`, ...blockLayoutParams(block, true) },
    );
};

/** 字框（按字的转角）在屏幕上的外接矩形。 */
const glyphAabb = (glyph: PlacedGlyph, pad = 0) => {
    const hw = glyph.boxW / 2 + pad, hh = glyph.boxH / 2 + pad;
    const c = Math.abs(Math.cos(glyph.rotation)), s = Math.abs(Math.sin(glyph.rotation));
    const ex = hw * c + hh * s, ey = hw * s + hh * c;
    return { minX: glyph.x - ex, maxX: glyph.x + ex, minY: glyph.y - ey, maxY: glyph.y + ey };
};

describe('hanabi text layout', () => {
    it('keeps every glyph inside the text region for all layouts and block styles', () => {
        const region = { w: 900, h: 420 };
        for (const layout of LAYOUTS) {
            for (const block of BLOCKS) {
                for (const text of SAMPLES) {
                    const placement = placeLine(text, layout, block, region, 1, layout === 'center' ? 0.08 : 0);
                    placement.glyphs.forEach(glyph => {
                        if (glyph.blank) return;
                        const box = glyphAabb(glyph);
                        expect(box.minX, `${layout}/${block}/${text}`).toBeGreaterThanOrEqual(-region.w / 2 - 0.5);
                        expect(box.maxX, `${layout}/${block}/${text}`).toBeLessThanOrEqual(region.w / 2 + 0.5);
                        expect(box.minY, `${layout}/${block}/${text}`).toBeGreaterThanOrEqual(-region.h / 2 - 0.5);
                        expect(box.maxY, `${layout}/${block}/${text}`).toBeLessThanOrEqual(region.h / 2 + 0.5);
                        expect(Number.isFinite(glyph.x) && Number.isFinite(glyph.y) && glyph.size > 0).toBe(true);
                    });
                    expect(placement.bounds.width).toBeLessThanOrEqual(region.w + 0.5);
                    expect(placement.bounds.height).toBeLessThanOrEqual(region.h + 0.5);
                }
            }
        }
    });

    it('aligns left / right layouts to the region edges', () => {
        const left = placeLine('夜空に咲いた', 'left', 'none');
        const right = placeLine('夜空に咲いた', 'right', 'none');
        expect(left.bounds.x).toBeCloseTo(-450, 3);
        expect(right.bounds.x + right.bounds.width).toBeCloseTo(450, 3);
    });

    it('wraps long lines instead of only shrinking, and staggers rows', () => {
        const long = placeLine(SAMPLES[1]!, 'center', 'none');
        expect(long.rows.length).toBeGreaterThan(1);
        const stagger = placeLine('夜空に咲いた大きな花火', 'stagger', 'band');
        expect(stagger.rows.length).toBeGreaterThanOrEqual(2);
        const firstX = (row: number[]) => stagger.glyphs[row[0]!]!.x;
        expect(firstX(stagger.rows[0]!)).not.toBeCloseTo(firstX(stagger.rows[1]!), 0);
    });

    it('scatters word blocks without overlap', () => {
        for (const text of SAMPLES) {
            for (const block of ['none', 'pill', 'stair', 'ticket'] as BlockStyle[]) {
                const placement = placeLine(text, 'scatter', block);
                const boxes = placement.rows.map(row => {
                    const list = row.map(index => placement.glyphs[index]!).filter(glyph => !glyph.blank).map(glyph => glyphAabb(glyph));
                    return {
                        minX: Math.min(...list.map(b => b.minX)), maxX: Math.max(...list.map(b => b.maxX)),
                        minY: Math.min(...list.map(b => b.minY)), maxY: Math.max(...list.map(b => b.maxY)),
                    };
                });
                for (let a = 0; a < boxes.length; a += 1) {
                    for (let b = a + 1; b < boxes.length; b += 1) {
                        const A = boxes[a]!, B = boxes[b]!;
                        const overlap = A.minX < B.maxX - 0.01 && B.minX < A.maxX - 0.01 && A.minY < B.maxY - 0.01 && B.minY < A.maxY - 0.01;
                        expect(overlap, `${text}/${block}: ${a} vs ${b}`).toBe(false);
                    }
                }
            }
        }
    });

    it('turns latin sideways and keeps CJK upright in vertical layouts, columns right to left', () => {
        for (const layout of ['vertical', 'vertical-split'] as TextLayout[]) {
            const placement = placeLine('僕らの Summer Night 光る', layout, 'none');
            placement.glyphs.forEach(glyph => {
                if (glyph.blank) return;
                if (/[A-Za-z]/.test(glyph.char)) expect(glyph.rotation).toBeCloseTo(Math.PI / 2, 6);
                else expect(glyph.rotation).toBeCloseTo(0, 6);
                expect(glyph.angle).toBeCloseTo(Math.PI / 2, 6);
            });
            expect(placement.vertical).toBe(true);
        }
        const long = placeLine(SAMPLES[1]!, 'vertical', 'none', { w: 900, h: 420 });
        expect(long.rows.length).toBeGreaterThan(1);
        const columnX = long.rows.map(row => long.glyphs[row[0]!]!.x);
        for (let i = 1; i < columnX.length; i += 1) expect(columnX[i]!).toBeLessThan(columnX[i - 1]!);
        long.rows.forEach(row => {
            const ys = row.filter(index => !long.glyphs[index]!.blank).map(index => long.glyphs[index]!.y);
            for (let i = 1; i < ys.length; i += 1) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
        });
    });

    it('bends arc rows upward and slopes diagonal rows', () => {
        const arc = placeLine('夜空に咲いた大きな花火', 'arc', 'band');
        const visible = arc.rows[0]!.map(index => arc.glyphs[index]!).filter(glyph => !glyph.blank);
        const mid = visible[Math.floor(visible.length / 2)]!;
        expect(mid.y).toBeLessThan(visible[0]!.y);
        expect(mid.y).toBeLessThan(visible[visible.length - 1]!.y);
        expect(visible[0]!.rotation).toBeLessThan(0);
        const diagonal = placeLine('夜空に咲いた花火', 'diagonal', 'tile');
        const dv = diagonal.rows[0]!.map(index => diagonal.glyphs[index]!).filter(glyph => !glyph.blank);
        expect(dv[dv.length - 1]!.y).toBeLessThan(dv[0]!.y);
    });

    it('is deterministic', () => {
        for (const layout of LAYOUTS) {
            expect(placeLine(SAMPLES[4]!, layout, 'pill')).toEqual(placeLine(SAMPLES[4]!, layout, 'pill'));
        }
    });

    it('enlarges the key word with emphasis', () => {
        const words = [{ text: '夜空', blank: false, space: false }, { text: 'の', blank: false, space: false }, { text: '大花火', blank: false, space: false }];
        const flat = wordScales(words, 0, 's');
        const strong = wordScales(words, 1, 's');
        expect(flat).toEqual([1, 1, 1]);
        expect(strong[2]).toBeCloseTo(1.8, 6);
        expect(strong[1]!).toBeLessThan(1);
    });
});

const ctxFor = (overrides: Partial<FxContext> = {}): FxContext => ({
    index: 2, count: 6, rand: [0.2, 0.7, 0.4, 0.9], toCenterX: 1.5, toCenterY: -0.4, dirX: 1, dirY: 0, time: 0.3, motion: 1, ...overrides,
});

describe('hanabi text animations', () => {
    it('lands every EnterFx exactly on the rest pose', () => {
        for (const fx of ENTER_FX) {
            for (const motion of [0, 1, 2]) {
                expect(enterPose(fx, 1, ctxFor({ motion })), fx).toEqual(restPose());
                expect(enterPose(fx, 1.5, ctxFor({ motion })), fx).toEqual(restPose());
            }
            // 终点附近已经很接近静止（不会在最后一帧跳一下）。
            const near = enterPose(fx, 0.995, ctxFor());
            expect(Math.abs(near.dx) + Math.abs(near.dy), fx).toBeLessThan(0.05);
            expect(Math.abs(near.scaleX - 1) + Math.abs(near.scaleY - 1), fx).toBeLessThan(0.06);
            expect(near.alpha, fx).toBeGreaterThan(0.95);
        }
    });

    it('starts every ExitFx at rest and ends fully transparent', () => {
        for (const fx of EXIT_FX) {
            for (const motion of [0, 1, 2]) {
                expect(exitPose(fx, 0, ctxFor({ motion })), fx).toEqual(restPose());
                expect(exitPose(fx, 1, ctxFor({ motion })).alpha, fx).toBe(0);
            }
            const early = exitPose(fx, 0.002, ctxFor());
            expect(Math.abs(early.dx) + Math.abs(early.dy), fx).toBeLessThan(0.03);
        }
    });

    it('produces finite poses everywhere', () => {
        for (let p = 0; p <= 1.0001; p += 0.01) {
            for (const fx of ENTER_FX) {
                const pose = enterPose(fx, p, ctxFor({ time: p }));
                Object.values(pose).forEach(value => { if (typeof value === 'number') expect(Number.isFinite(value), fx).toBe(true); });
                expect(pose.alpha).toBeGreaterThanOrEqual(0);
                expect(pose.alpha).toBeLessThanOrEqual(1);
            }
            for (const fx of EXIT_FX) {
                const pose = exitPose(fx, p, ctxFor({ time: p }));
                Object.values(pose).forEach(value => { if (typeof value === 'number') expect(Number.isFinite(value), fx).toBe(true); });
            }
        }
    });

    it('is deterministic (scramble / glitch frames depend only on time)', () => {
        for (const fx of ['scramble', 'glitch'] as EnterFx[]) {
            expect(enterPose(fx, 0.3, ctxFor({ time: 0.21 }))).toEqual(enterPose(fx, 0.3, ctxFor({ time: 0.21 })));
        }
        expect(enterPose('scramble', 0.3, ctxFor({ time: 0.21 })).scramble).toBeGreaterThanOrEqual(0);
        expect(enterPose('glitch', 0.2, ctxFor({ time: 0.1 })).rgbSplit).toBeGreaterThan(0);
    });

    it('returns every SingFx to rest long after the word', () => {
        for (const fx of SING_FX) {
            const late = singPose(fx, 5, 0.3, 0.4, 1);
            expect(late.dx, fx).toBeCloseTo(0, 6);
            expect(late.dy, fx).toBeCloseTo(0, 6);
            expect(late.scale * late.scaleX * late.scaleY, fx).toBeCloseTo(1, 6);
            expect(late.flash + late.glow, fx).toBeCloseTo(0, 6);
            expect(singPose(fx, -0.1, 0.3, 0.4, 1).dy).toBe(0);
        }
        expect(singPose('color', 5, 0.3, 0.4, 1).color).toBe(1);
    });

    it('lands the last glyph no later than the first sung glyph', () => {
        const cases: Array<[EnterFx, number, number, number]> = [
            ['pop', 20, 0.06, 2], ['spiral', 30, 0.08, 0.6], ['elastic', 8, 0.1, 0.3], ['type', 40, 0.05, 1], ['burst', 12, 0.05, 0.5],
        ];
        for (const [fx, count, stagger, window] of cases) {
            const ranks = Array.from({ length: count }, (_, index) => index);
            const schedule = scheduleEnter(fx, ranks, 10, stagger, 10 + window);
            expect(Math.max(...schedule.landed), fx).toBeLessThanOrEqual(10 + window + 1e-9);
            expect(schedule.start[0]).toBe(10);
        }
        // 时间充裕时不压缩。
        const relaxed = scheduleEnter('pop', [0, 1, 2], 10, 0.1, 20);
        expect(relaxed.start).toEqual([10, 10.1, 10.2]);
        const exit = scheduleExit([0, 1, 2, -1], 30, 0.8);
        expect(Math.max(...exit.end.filter(Number.isFinite))).toBeCloseTo(30.8, 9);
        expect(Number.isNaN(exit.start[3]!)).toBe(true);
    });
});

// ─── 假 Pixi：只实现文字引擎用到的部分 ───

class FakeContainer {
    children: FakeContainer[] = [];
    parent: FakeContainer | null = null;
    visible = true;
    alpha = 1;
    rotation = 0;
    tint = 0xffffff;
    label = '';
    blendMode = 'normal';
    mask: unknown = null;
    destroyed = false;
    position = { x: 0, y: 0, set: (x: number, y = x) => { this.position.x = x; this.position.y = y; } };
    scale = { x: 1, y: 1, set: (x: number, y = x) => { this.scale.x = x; this.scale.y = y; } };
    skew = { x: 0, y: 0 };
    anchor = { x: 0, y: 0, set: (x: number, y = x) => { this.anchor.x = x; this.anchor.y = y; } };
    addChild(...items: FakeContainer[]) {
        items.forEach(item => { item.parent?.removeChild(item); item.parent = this; this.children.push(item); });
        return items[0];
    }
    removeChild(item: FakeContainer) {
        const index = this.children.indexOf(item);
        if (index >= 0) this.children.splice(index, 1);
        item.parent = null;
        return item;
    }
    destroy(options?: boolean | { children?: boolean }) {
        this.destroyed = true;
        this.parent?.removeChild(this);
        if (options === true || (typeof options === 'object' && options.children)) [...this.children].forEach(child => child.destroy(options));
        this.children = [];
    }
}
class FakeSprite extends FakeContainer {
    constructor(public texture: unknown) { super(); }
}
class FakeGraphics extends FakeContainer {
    ops = 0;
    private chain() { this.ops += 1; return this; }
    clear() { this.ops = 0; return this; }
    rect() { return this.chain(); }
    roundRect() { return this.chain(); }
    circle() { return this.chain(); }
    poly(points: number[]) { points.forEach(value => { if (!Number.isFinite(value)) throw new Error('non-finite poly'); }); return this.chain(); }
    moveTo() { return this.chain(); }
    lineTo() { return this.chain(); }
    arc() { return this.chain(); }
    closePath() { return this.chain(); }
    fill() { return this; }
    stroke() { return this; }
}
const fakePixi = { Container: FakeContainer, Sprite: FakeSprite, Graphics: FakeGraphics, Texture: { EMPTY: {} } } as unknown as typeof import('pixi.js');

let destroyedAtlases = 0;
const fakeAtlas: BuildGlyphAtlas = (_pixi, options) => {
    const make = (char: string, px: number) => ({
        char, px, fill: { char, v: 'fill' }, fat: options.outline > 0 ? { char, v: 'fat' } : null,
        glow: options.glow ? { char, v: 'glow' } : null,
        halves: options.halves ? [{ char, v: 'a' }, { char, v: 'b' }] : null,
    }) as never;
    const entries = new Map<string, ReturnType<typeof make>>();
    options.chars.forEach((px, char) => entries.set(char, make(char, px)));
    return {
        entry: char => entries.get(char) ?? make(char, 10),
        scramble: (options.scramble?.chars ?? []).map(char => make(char, options.scramble!.px)),
        destroy: () => { destroyedAtlases += 1; },
    };
};

const palette: HanabiPalette = { ink: 0x101020, paper: 0xfff8f0, blocks: [0xff3366, 0x33ccff, 0xffcc00], sparks: [0xffaa00, 0xff66cc], accent: 0x66ffcc, glow: 0xffffee };
const theme = { fontStyle: 'sans' } as Theme;

const specOf = (overrides: Partial<TextSpec>): TextSpec => ({
    layout: 'center', heroSize: 0.12, emphasis: 0.6, tilt: 0, block: 'band', enter: 'pop', sing: 'none', exit: 'ascend',
    stagger: 0.06, outline: true, hardShadow: true, ...overrides,
});

const build = (spec: TextSpec, text = '夜空に咲いた Summer 花火') => {
    const line = makeLine(text, 10, 0.2);
    return {
        line,
        text: buildHanabiText({
            pixi: fakePixi, width: 1920, height: 1080, resolution: 1, theme, line, regionWidth: 1100, regionHeight: 520,
            spec, palette, seed: 'shot-1', enterAt: 9, exitAt: line.endTime + 0.5, exitDuration: 0.7, motion: 1, blockOpacity: 1,
            keywordColor: word => (word === '花火' ? 0xff0000 : null),
        }, { measure: estimateAdvance, buildAtlas: fakeAtlas }),
    };
};

describe('hanabi lyric text (fake pixi)', () => {
    it('paints the glyph atlas once, when prepared or on the first update, not while the scene is built', () => {
        let paints = 0;
        const lazyAtlas: BuildGlyphAtlas = (pixi, options) => {
            let painted = false;
            return { ...fakeAtlas(pixi, options), paint: () => (painted ? false : (painted = true, paints += 1, true)) };
        };
        const make = () => buildHanabiText({
            pixi: fakePixi, width: 1920, height: 1080, resolution: 1, theme, line: makeLine('夜空に咲いた花火', 10, 0.2), regionWidth: 1100, regionHeight: 520,
            spec: specOf({}), palette, seed: 'lazy', enterAt: 9, exitAt: 14, exitDuration: 0.7, motion: 1, blockOpacity: 1,
        }, { measure: estimateAdvance, buildAtlas: lazyAtlas });
        // 建好、算锚点（场景建的时候要用）都不画。
        const prepared = make();
        prepared.anchors(9.5);
        expect(paints).toBe(0);
        expect(prepared.prepare()).toBe(true);
        expect(prepared.prepare()).toBe(false);
        prepared.update(9.5);
        expect(paints).toBe(1);
        // 没提前备的，第一次 update 补画。
        const late = make();
        late.update(9.5);
        expect(paints).toBe(2);
        expect(late.prepare()).toBe(false);
        prepared.destroy();
        late.destroy();
    });

    it('runs every enter / exit / block / sing combination and settles on the layout', () => {
        const enters = ENTER_FX;
        enters.forEach((enter, k) => {
            const block = BLOCKS[k % BLOCKS.length]!;
            const exit: ExitFx = EXIT_FX[k % EXIT_FX.length]!;
            const sing: SingFx = SING_FX[k % SING_FX.length]!;
            const layout = LAYOUTS[k % LAYOUTS.length]!;
            const { line, text } = build(specOf({ enter, exit, block, layout, sing: 'none' }));
            const times = [8, 9, 9.3, 9.7, 10, 10.5, 12, line.endTime + 0.6, line.endTime + 1.3, 30];
            // 前进、后退各走一遍：同一时刻结果一样。
            const forward = times.map(time => { text.update(time); return JSON.stringify(text.anchors(time)); });
            const backward = [...times].reverse().map(time => { text.update(time); return JSON.stringify(text.anchors(time)); }).reverse();
            expect(backward, enter).toEqual(forward);

            const before = text.anchors(8.5);
            expect(before.every(anchor => anchor.alpha === 0), enter).toBe(true);
            const settled = text.anchors(10.05);
            const visible = settled.filter(anchor => !anchor.blank);
            expect(visible.length).toBeGreaterThan(0);
            visible.forEach(anchor => {
                expect(anchor.alpha, `${enter} ${anchor.char}`).toBeCloseTo(1, 6);
                expect(anchor.landedAt).toBeLessThanOrEqual(line.words[0]!.startTime + 1e-9);
            });
            const after = text.anchors(line.endTime + 1.25);
            expect(after.every(anchor => anchor.alpha === 0), `${enter}/${exit}`).toBe(true);
            // 强调换一种再建一次，确认也能跑。
            const other = build(specOf({ enter, exit, block, layout, sing }));
            for (let time = 8.8; time < line.endTime + 1.4; time += 0.1) other.text.update(time);
            other.text.destroy();
            text.destroy();
        });
    });

    it('rests exactly at the layout position once landed (no sing effect)', () => {
        const { text } = build(specOf({ enter: 'spiral', sing: 'none', block: 'tile', layout: 'stagger' }));
        const a = text.anchors(10.02);
        const b = text.anchors(10.5);
        a.forEach((anchor, index) => {
            if (anchor.blank) return;
            expect(anchor.x).toBeCloseTo(b[index]!.x, 6);
            expect(anchor.y).toBeCloseTo(b[index]!.y, 6);
        });
        const bounds = text.bounds;
        a.forEach(anchor => {
            if (anchor.blank) return;
            expect(anchor.x).toBeGreaterThanOrEqual(bounds.x);
            expect(anchor.x).toBeLessThanOrEqual(bounds.x + bounds.width);
        });
        text.destroy();
    });

    it('separates blocks and glyphs and releases everything on destroy', () => {
        const before = destroyedAtlases;
        const { text } = build(specOf({ block: 'double', enter: 'glitch', sing: 'glow', exit: 'dissolve' }));
        text.update(9.2);
        expect(text.view.children).toContain(text.blocks);
        expect(text.view.children).toContain(text.glyphs);
        const blocksRoot = text.blocks as unknown as FakeContainer;
        expect(blocksRoot.children.length).toBeGreaterThan(0);
        text.destroy();
        expect(destroyedAtlases).toBe(before + 1);
        expect((text.view as unknown as FakeContainer).destroyed).toBe(true);
        expect(blocksRoot.destroyed).toBe(true);
    });

    it('is deterministic across builds', () => {
        const a = build(specOf({ enter: 'scramble', layout: 'scatter', block: 'pill' })).text;
        const b = build(specOf({ enter: 'scramble', layout: 'scatter', block: 'pill' })).text;
        for (const time of [9.1, 9.4, 10.3]) expect(a.anchors(time)).toEqual(b.anchors(time));
    });
});

describe('hanabi glyph atlas limit (#929)', () => {
    it('只按用户选的超采样倍数放大 4096，再和 GPU 纹理上限、8192 取小；屏幕密度本身不放大', () => {
        try {
            // GPU 还没报上来时按 4096 算，和原来一样。
            expect(resolveGlyphAtlasLimit(1, undefined, 1)).toBe(4096);
            expect(resolveGlyphAtlasLimit(2, undefined, 1)).toBe(4096);
            setHanabiGlyphTextureLimit(16384);
            // 倍数 1：1 倍屏、2 倍屏都和原来一样是 4096。
            expect(resolveGlyphAtlasLimit(1, undefined, 1)).toBe(4096);
            expect(resolveGlyphAtlasLimit(2, undefined, 2)).toBe(4096);
            // 超采样：渲染倍率 ÷ 花火的像素密度。
            expect(resolveGlyphAtlasLimit(1.5, undefined, 1)).toBe(6144);
            expect(resolveGlyphAtlasLimit(2, undefined, 1)).toBe(8192);
            expect(resolveGlyphAtlasLimit(3, undefined, 2)).toBe(6144);
            expect(resolveGlyphAtlasLimit(3, undefined, 1)).toBe(8192);
            // 缩小分辨率时不往下压。
            expect(resolveGlyphAtlasLimit(0.5, undefined, 1)).toBe(4096);
            setHanabiGlyphTextureLimit(8192);
            expect(resolveGlyphAtlasLimit(1.5, undefined, 1)).toBe(6144);
            // 不像样的上报不认。
            setHanabiGlyphTextureLimit(Number.NaN);
            setHanabiGlyphTextureLimit(512);
            expect(resolveGlyphAtlasLimit(3, undefined, 1)).toBe(8192);
            // 显式给了 maxCanvasPx 就用它。
            expect(resolveGlyphAtlasLimit(2, 1024)).toBe(1024);
        } finally {
            setHanabiGlyphTextureLimit(4096);
        }
    });
});
