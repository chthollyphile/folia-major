// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/visualizer/tideAnchorSampler.test.ts
// The tide background has no lyrics of its own: it asks the foreground lyric layer where the
// glyphs sit and turns each cluster of neighbours into one force vector. jsdom has no layout, so
// the tests stub Range#getClientRects with a deterministic ten-pixel grid to stand in for the
// browser's text metrics.

import {
    buildTideLineWordRanges,
    collectTideGlyphs,
    measureTideGlyphRange,
    normalizeAnchorText,
    readTideMarkAnchors,
} from '@/components/visualizer/backgrounds/tide/tideGlyphDom';
import { LyricAnchorSampler } from '@/components/visualizer/backgrounds/tide/LyricAnchorSampler';
import type { Line } from '@/types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BOUNDS = { left: 0, top: 0, width: 1000, height: 1000 };

let glyphLeft = 100;
let glyphTop = 200;

// jsdom implements Range but not its layout-facing getClientRects, so the stub replaces it
// outright instead of spying on an existing method.
const stubGlyphRects = (options: { empty?: boolean } = {}) => {
    (Range.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = function (this: Range) {
        if (options.empty) {
            return { length: 0, item: () => null } as unknown as DOMRectList;
        }

        const text = this.toString();
        // 节点显式声明了 data-glyph-base 时，按「节点基准 + Range 起点偏移」定位：
        // 同一个词重复出现时才能靠各自的字形位置区分开。没有该属性就沿用按首字符推的旧逻辑。
        const explicitBase = (this.startContainer?.parentElement as HTMLElement | null)?.dataset?.glyphBase;
        const baseIndex = explicitBase !== undefined
            ? Number(explicitBase) + (this.startOffset ?? 0)
            : Math.max(0, ALPHABET.indexOf(text[0] ?? 'A'));
        const rects = Array.from(text, (_, index) => {
            const left = glyphLeft + (baseIndex + index) * 10;
            return {
                left,
                top: glyphTop,
                right: left + 10,
                bottom: glyphTop + 20,
                width: 10,
                height: 20,
                x: left,
                y: glyphTop,
            } as DOMRect;
        });

        return {
            length: rects.length,
            item: (index: number) => rects[index] ?? null,
        } as unknown as DOMRectList;
    };
};

const buildStage = (parts: string[]): HTMLElement => {
    document.body.innerHTML = '';
    const stage = document.createElement('div');
    parts.forEach((part) => {
        const span = document.createElement('span');
        span.textContent = part;
        stage.appendChild(span);
    });
    document.body.appendChild(stage);
    return stage;
};

/** 波环式标记（播放头/交界向量）：零尺寸，位置由桩给出，强度与外推方向写在 data 里。 */
const buildMarkStage = (
    marks: Array<{ attr: 'playhead' | 'jet'; left: number; top: number; strength?: number; out?: string; push?: number }>,
): HTMLElement => {
    document.body.innerHTML = '';
    const stage = document.createElement('div');
    marks.forEach(({ attr, left, top, strength = 0.8, out, push }) => {
        const mark = document.createElement('div');
        if (attr === 'playhead') {
            mark.dataset.tidePlayhead = 'true';
        } else {
            mark.dataset.tideJet = 'true';
        }
        mark.dataset.tideStrength = String(strength);
        if (out) {
            mark.dataset.tideOut = out;
        }
        if (push !== undefined) {
            mark.dataset.tidePush = String(push);
        }
        // jsdom 不做布局，位置由 getBoundingClientRect 桩直接给出（零尺寸 = left/top 即锚点）。
        mark.getBoundingClientRect = () => ({ left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
        stage.appendChild(mark);
    });
    document.body.appendChild(stage);
    return stage;
};

const makeLine = (words: Array<[string, number, number]>, id = 'line-1'): Line => ({
    id,
    fullText: words.map(([text]) => text).join(''),
    startTime: words[0][1],
    endTime: words[words.length - 1][2],
    words: words.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    document.body.innerHTML = '';
    glyphLeft = 100;
    glyphTop = 200;
});

describe('tideGlyphDom', () => {
    it('normalizes whitespace out of a word before it is matched against the DOM', () => {
        expect(normalizeAnchorText(' A  B\n C ')).toBe('ABC');
    });

    it('collects visible glyphs in reading order and skips canvas, svg and opt-out subtrees', () => {
        const stage = buildStage(['AB', ' CD ']);

        const optOut = document.createElement('div');
        optOut.dataset.tideSkipAnchor = 'true';
        optOut.textContent = 'ZZ';
        stage.appendChild(optOut);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        svgText.textContent = 'QQ';
        svg.appendChild(svgText);
        stage.appendChild(svg);

        const { text, glyphs } = collectTideGlyphs(stage);
        expect(text).toBe('ABCD');
        expect(glyphs).toHaveLength(4);
        expect(glyphs.map(glyph => glyph.offset)).toEqual([0, 1, 1, 2]);
    });

    it('maps each word to its own glyph range so a repeated word keeps its own occurrence', () => {
        const line = makeLine([['AB', 1, 1.4], ['CD', 1.4, 2], ['AB', 2.2, 2.8]]);
        expect(buildTideLineWordRanges('ABCDAB', line)).toEqual([
            { start: 0, length: 2 },
            { start: 2, length: 2 },
            { start: 4, length: 2 },
        ]);
        // 行文本不在舞台上、或分词和字形长度对不上时不给映射，让调用方退回其他锚点。
        expect(buildTideLineWordRanges('ABCD', line)).toEqual([]);
    });

    it('measures a glyph range from the union of its client rects', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCDEFGH']);
        const { glyphs } = collectTideGlyphs(stage);

        expect(measureTideGlyphRange(glyphs, 2, 3)).toEqual({ left: 120, top: 200, width: 30, height: 20 });
        expect(measureTideGlyphRange(glyphs, 0, 2)?.left).toBe(100);
        expect(measureTideGlyphRange([], 0, 3)).toBeNull();
    });

    it('returns nothing when the browser reports no visible text rects', () => {
        stubGlyphRects({ empty: true });
        const stage = buildStage(['ABCD']);
        const { glyphs } = collectTideGlyphs(stage);
        expect(measureTideGlyphRange(glyphs, 0, 2)).toBeNull();
    });
});

describe('LyricAnchorSampler', () => {
    it('emits nothing without an active line, a playhead mark or timing lyrics', () => {
        const sampler = new LyricAnchorSampler();
        expect(sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1 })).toEqual([]);
    });

    it('reads the playhead and jet marks when the visualizer renders no lyric DOM (wave ring)', () => {
        const stage = buildMarkStage([
            { attr: 'playhead', left: 400, top: 250, strength: 0.8 },
            { attr: 'jet', left: 700, top: 600, strength: 0.4, out: '0,1' },
        ]);
        const sampler = new LyricAnchorSampler();

        // 没有在唱的行（或纯音乐）：标记锚点顶上来，按 DOM 顺序播放头在前。
        const silent = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1 });
        expect(silent).toHaveLength(2);
        expect(silent[0]).toMatchObject({ key: 'playhead', x: 0.4, y: 0.75, strength: 0.8, vx: 0, vy: 0 });
        // 交界向量的 key 带序号 —— 下游按 key 配对，重复 key 会把多个标记折叠成一个。
        // 屏幕上「向下」的方向（0,1）在流体坐标里仍是向下，所以 pushY 取反成 -1。
        expect(silent[1]).toMatchObject({ key: 'jet:0', x: 0.7, y: 0.4, strength: 0.4, pushX: 0, pushY: -1 });

        // 有在唱的行但前台没有文字 DOM（canvas 模式）：标记锚点替换时序兜底。
        const line = makeLine([['A', 1, 1.5]]);
        const singing = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(singing.map(sample => sample.key)).toEqual(['playhead', 'jet:0']);
        expect(singing[0].x).toBeCloseTo(0.4, 5);
    });

    it('gives every jet mark a distinct key so none are collapsed downstream', () => {
        const stage = buildMarkStage([
            { attr: 'playhead', left: 400, top: 250 },
            { attr: 'jet', left: 100, top: 100 },
            { attr: 'jet', left: 500, top: 300 },
            { attr: 'jet', left: 800, top: 700 },
        ]);
        const sampler = new LyricAnchorSampler();
        const samples = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1 });
        const keys = samples.map(sample => sample.key);
        expect(keys).toEqual(['playhead', 'jet:0', 'jet:1', 'jet:2']);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('caps mark anchors at maxAnchors, keeping DOM order (playhead first)', () => {
        const stage = buildMarkStage([
            { attr: 'playhead', left: 400, top: 250 },
            { attr: 'jet', left: 700, top: 600 },
        ]);
        const sampler = new LyricAnchorSampler();
        const samples = sampler.sample({ stage, maxAnchors: 1, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1 });
        expect(samples.map(sample => sample.key)).toEqual(['playhead']);
    });

    it('keeps DOM lyric anchors in charge when text glyphs exist', () => {
        stubGlyphRects();
        // 同一个 stage 里既有文字又有标记：文字锚点优先，标记不插队。
        const stage = buildStage(['ABCD']);
        const mark = document.createElement('div');
        mark.dataset.tidePlayhead = 'true';
        stage.appendChild(mark);

        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const samples = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });

        expect(samples.map(sample => sample.key)).toEqual(['dom:0', 'dom:1']);
    });

    it('ignores marks that sit far outside the stage', () => {
        const stage = buildMarkStage([{ attr: 'playhead', left: 5000, top: -5000 }]);
        expect(readTideMarkAnchors(stage, BOUNDS)).toEqual([]);

        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5]]);
        // 退回时序兜底（标记越界视为没有标记）。
        const samples = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(samples.map(sample => sample.key)).toEqual(['timing:0']);
    });

    it('falls back to a neutral strength when a mark reports garbage', () => {
        const stage = buildMarkStage([{ attr: 'jet', left: 300, top: 300, strength: Number.NaN }]);
        const anchors = readTideMarkAnchors(stage, BOUNDS);
        expect(anchors).toHaveLength(1);
        expect(anchors[0].strength).toBe(0.5);
        // 没有 data-tide-out 就是纯固定点：不额外推水。
        expect(anchors[0].outX).toBe(0);
        expect(anchors[0].outY).toBe(0);
    });

    it('normalizes a garbage outward direction to zero so a bad mark cannot shove the fluid', () => {
        const stage = buildMarkStage([
            { attr: 'jet', left: 300, top: 300, out: 'nonsense' },
            { attr: 'jet', left: 400, top: 300, out: '0,0' },
            { attr: 'jet', left: 500, top: 300, out: '3,4' },
        ]);
        const anchors = readTideMarkAnchors(stage, BOUNDS);
        expect(anchors[0].outX).toBe(0);
        expect(anchors[0].outY).toBe(0);
        expect(anchors[1].outX).toBe(0);
        expect(anchors[1].outY).toBe(0);
        // (3,4) 是斜边 5 的直角三角形：归一化后就是 (0.6, 0.8)。
        expect(anchors[2].outX).toBeCloseTo(0.6, 6);
        expect(anchors[2].outY).toBeCloseTo(0.8, 6);
    });

    it('scales the self-reported direction by the self-reported momentum (data-tide-push)', () => {
        // 方向固定、大小随音乐：动量 0.25 就是四分之一股推力。
        const stage = buildMarkStage([{ attr: 'jet', left: 400, top: 400, out: '1,0', push: 0.25 }]);
        const [anchor] = readTideMarkAnchors(stage, BOUNDS);
        expect(anchor.outX).toBeCloseTo(1, 6);
        expect(anchor.push).toBeCloseTo(0.25, 6);

        const [sample] = new LyricAnchorSampler()
            .sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [], lineIndex: 0, timeSec: 1 });
        expect(sample.pushX).toBeCloseTo(0.25, 6);
        expect(sample.pushY).toBeCloseTo(0, 6);
        // 缺省动量是满推力；坏值归零，不会换来一股满推力。
        expect(readTideMarkAnchors(buildMarkStage([{ attr: 'jet', left: 300, top: 300, out: '1,0' }]), BOUNDS)[0].push).toBe(1);
        expect(readTideMarkAnchors(buildMarkStage([{ attr: 'jet', left: 300, top: 300, out: '1,0', push: Number.NaN }]), BOUNDS)[0].push).toBe(0);
    });

    it('ignores words that are far outside their timing window', () => {
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5]]);
        const samples = sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 0.2 });
        expect(samples).toEqual([]);
    });

    it('falls back to timing anchors when the visualizer renders no DOM text', () => {
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const samples = sampler.sample({ stage: null, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });

        expect(samples.map(sample => sample.key)).toEqual(['timing:0', 'timing:1']);
        expect(samples[0].strength).toBeCloseTo(0.55, 5);
        expect(samples[1].strength).toBeCloseTo((1 - 0.3 / 0.45) * 0.55, 5);
        samples.forEach((sample) => {
            expect(sample.x).toBeGreaterThanOrEqual(0.04);
            expect(sample.x).toBeLessThanOrEqual(0.96);
            expect(sample.y).toBeGreaterThanOrEqual(0.08);
            expect(sample.y).toBeLessThanOrEqual(0.92);
        });
    });

    it('measures anchors on the real lyric DOM and inverts the y axis', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCD']);
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5], ['B', 1.5, 2]]);
        const samples = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });

        expect(samples.map(sample => sample.key)).toEqual(['dom:0', 'dom:1']);
        expect(samples[0].x).toBeCloseTo(0.105, 5);
        expect(samples[0].y).toBeCloseTo(0.79, 5);
        expect(samples[0].strength).toBeCloseTo(1, 5);
        expect(samples[1].x).toBeCloseTo(0.115, 5);
    });

    it('anchors a repeated word to its own DOM range instead of the first match', () => {
        stubGlyphRects();
        // 同一行里同一个词出现两次，且都渲染在同一个文本节点里。
        document.body.innerHTML = '';
        const stage = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = 'ABAB';
        span.dataset.glyphBase = '0';
        stage.appendChild(span);
        document.body.appendChild(stage);

        const line = makeLine([['AB', 1, 1.4], ['AB', 2.2, 2.8]]);
        // 第一个「AB」早已唱完（超出 0.5s 的尾部窗口），此刻只有第二个词活跃。
        const samples = new LyricAnchorSampler()
            .sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 2.4 });

        expect(samples.map(sample => sample.key)).toEqual(['dom:1']);
        // 第二个「AB」横跨字形 2..3（left 120..140），中心 x = 0.13。
        // 旧的「从串首重新搜索」只命中第一个（100..120），x 会错成 0.11。
        expect(samples[0].x).toBeCloseTo(0.13, 5);
        expect(samples[0].x).not.toBeCloseTo(0.11, 3);
    });

    it('follows the glyphs but never reports a velocity of its own', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCD']);
        const sampler = new LyricAnchorSampler();
        const line = makeLine([['A', 1, 1.5]]);

        glyphTop = 900;
        const low = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        glyphTop = 100;
        const high = sampler.sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });

        // y 已翻转：字往上走，锚点跟着升高。
        expect(high[0].y).toBeGreaterThan(low[0].y);
        // 速度不从「两次采样的位移差」里估（那是快速采样抽搐的源头），交给下游滤波。
        expect(high[0].vx).toBe(0);
        expect(high[0].vy).toBe(0);
    });

    it('anchors every word that is singing instead of striding over them', () => {
        stubGlyphRects();
        const stage = buildStage(['AB', 'CD', 'EF', 'GH']);
        const line = makeLine([['AB', 1, 1.5], ['CD', 1.1, 1.5], ['EF', 1.5, 2], ['GH', 1.55, 2]]);

        const all = new LyricAnchorSampler().sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(all.map(sample => sample.key)).toEqual(['dom:0', 'dom:1', 'dom:2', 'dom:3']);

        // 超上限时留下正在唱的两个（envelope 1.0），不是按均匀步长跳过去的那两个。
        const capped = new LyricAnchorSampler().sample({ stage, maxAnchors: 2, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(capped.map(sample => sample.key)).toEqual(['dom:0', 'dom:1']);
    });

    it('caps how many glyph vectors one sample may return', () => {
        stubGlyphRects();
        const stage = buildStage(['ABCDEFGH']);
        const line = makeLine([['A', 1, 1.5], ['B', 1, 1.5], ['C', 1, 1.5], ['D', 1, 1.5], ['E', 1, 1.5], ['F', 1, 1.5]]);

        const capped = new LyricAnchorSampler().sample({ stage, maxAnchors: 2, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(capped.length).toBeLessThanOrEqual(2);

        const all = new LyricAnchorSampler().sample({ stage, maxAnchors: 6, bounds: BOUNDS, lines: [line], lineIndex: 0, timeSec: 1.2 });
        expect(all.length).toBeGreaterThan(capped.length);
    });
});
