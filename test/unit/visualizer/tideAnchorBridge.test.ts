// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/visualizer/tideAnchorBridge.test.ts
// canvas 类可视化（商籁 / 绘光）把歌词画在 Pixi 画布内，DOM 里没有字形，tide 的字形采集
// 又明确跳过 canvas —— 它们只能靠这条桥把自己的逐字位置报出来。这里钉住三件事：
// 桥本身的发布/读取契约、按舞台实例隔离（主舞台与样式预览互不覆盖、卸载自动失效）、
// 以及取样侧把「画布逻辑像素」折算成舞台归一化坐标的算法。

import {
    beginTideAnchors,
    clearTideAnchors,
    GLYPH_ANCHOR_LEAD,
    GLYPH_ANCHOR_TAIL,
    publishTideAnchorFrom,
    pushTideAnchor,
    readTideAnchors,
    releaseTideAnchorCanvas,
    resolveGlyphAnchorStrength,
} from '@/components/visualizer/backgrounds/tide/tideAnchorBridge';
import { LyricAnchorSampler } from '@/components/visualizer/backgrounds/tide/LyricAnchorSampler';
import type { Line } from '@/types';

const BOUNDS = { left: 0, top: 0, width: 1000, height: 1000 };

/**
 * 一个真实挂在 DOM 上的舞台 + 里面的画布。rect 由桩给出（jsdom 不做布局），
 * 但画布是真节点 —— readTideAnchors 靠 stage.contains(canvas) 认领，桩对象过不了这一关。
 */
const buildStageWithCanvas = (
    rect: { left: number; top: number; width: number; height: number } = { left: 100, top: 50, width: 500, height: 250 },
): { stage: HTMLElement; canvas: HTMLCanvasElement } => {
    const stage = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
    }) as DOMRect;
    stage.appendChild(canvas);
    document.body.appendChild(stage);
    return { stage, canvas };
};

const buildStage = (text: string): HTMLElement => {
    const stage = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = text;
    stage.appendChild(span);
    document.body.appendChild(stage);
    return stage;
};

const sample = (overrides: Partial<{ stage: HTMLElement | null; maxAnchors: number; lines: Line[]; lineIndex: number }> = {}) => (
    new LyricAnchorSampler().sample({
        stage: overrides.stage ?? null,
        maxAnchors: overrides.maxAnchors ?? 6,
        bounds: BOUNDS,
        lines: overrides.lines ?? [],
        lineIndex: overrides.lineIndex ?? 0,
        timeSec: 0,
    })
);

afterEach(() => {
    clearTideAnchors();
    document.body.innerHTML = '';
});

describe('tideAnchorBridge', () => {
    it('reads nothing until a frame was begun for a canvas and something is published', () => {
        const first = buildStageWithCanvas();

        // 没有 begin 过（没有登记任何画布）：推了也没人接。
        pushTideAnchor(10, 20, 1);
        expect(readTideAnchors(first.stage)).toBeNull();

        // begin 但一个字都没发布：也不算可用帧。
        const second = buildStageWithCanvas();
        beginTideAnchors(second.canvas);
        expect(readTideAnchors(second.stage)).toBeNull();

        pushTideAnchor(10, 20, 1);
        expect(readTideAnchors(second.stage)?.count).toBe(1);
    });

    it('reports nothing for a canvas that has left the document', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        pushTideAnchor(10, 20, 1);

        // 预览关闭：画布脱离文档，读取时整帧被剪除。
        canvas.remove();
        expect(readTideAnchors(stage)).toBeNull();
    });

    it('drops the previous frame when a new one begins', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        pushTideAnchor(1, 2, 0.5);
        pushTideAnchor(3, 4, 0.6);
        expect(readTideAnchors(stage)?.count).toBe(2);

        beginTideAnchors(canvas);
        expect(readTideAnchors(stage)).toBeNull();
    });

    it('caps how many anchors one frame may carry', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        for (let index = 0; index < 600; index += 1) {
            pushTideAnchor(index, index, 1);
        }
        expect(readTideAnchors(stage)?.count).toBeLessThanOrEqual(512);
    });

    it('publishes from a glyph container but never throws on a stub or a dark glyph', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);

        // 桩对象 / 已销毁节点：没有 getGlobalPosition，直接跳过，不能把渲染层搞崩。
        publishTideAnchorFrom(null, 1);
        publishTideAnchorFrom({}, 1);
        // 未唱 / 未亮起：强度≈0，没有搅水的意义。
        publishTideAnchorFrom({ getGlobalPosition: () => ({ x: 30, y: 40 }) }, 0.01);
        expect(readTideAnchors(stage)).toBeNull();

        publishTideAnchorFrom({ getGlobalPosition: () => ({ x: 30, y: 40 }) }, 0.5);
        expect(readTideAnchors(stage)?.count).toBe(1);
        expect(readTideAnchors(stage)?.anchors[0]).toEqual({ x: 30, y: 40, strength: 0.5 });
    });

    it('silently drops pushes that happen without a begun frame', () => {
        // 运行时销毁后 ticker 里若还残留一次发布（异步竞态），不允许写进任何帧。
        const { stage } = buildStageWithCanvas();
        pushTideAnchor(1, 2, 1);
        expect(readTideAnchors(stage)).toBeNull();
    });
});

describe('tideAnchorBridge stage isolation', () => {
    it('keeps the main stage and the style preview in separate frames', () => {
        const main = buildStageWithCanvas();
        const preview = buildStageWithCanvas();

        // 主舞台先发布一帧……
        beginTideAnchors(main.canvas);
        pushTideAnchor(1, 2, 1);
        // ……样式预览随后发布它自己的一帧：两个实例的 renderFrame 各自 begin，
        // 以前是模块级单槽，预览会把主舞台的锚点整帧覆盖掉。
        beginTideAnchors(preview.canvas);
        pushTideAnchor(9, 9, 0.5);

        const mainFrame = readTideAnchors(main.stage);
        const previewFrame = readTideAnchors(preview.stage);
        expect(mainFrame?.canvas).toBe(main.canvas);
        expect(mainFrame?.anchors[0]).toEqual({ x: 1, y: 2, strength: 1 });
        expect(previewFrame?.canvas).toBe(preview.canvas);
        expect(previewFrame?.anchors[0]).toEqual({ x: 9, y: 9, strength: 0.5 });
    });

    it('does not let a closed preview take the main stage down with it', () => {
        const main = buildStageWithCanvas();
        const preview = buildStageWithCanvas();

        beginTideAnchors(main.canvas);
        pushTideAnchor(1, 2, 1);
        beginTideAnchors(preview.canvas);
        pushTideAnchor(9, 9, 0.5);

        // 预览关闭（画布脱离文档 + 运行时销毁交还帧）：主舞台的帧必须原样可读。
        releaseTideAnchorCanvas(preview.canvas);
        const mainFrame = readTideAnchors(main.stage);
        expect(mainFrame?.canvas).toBe(main.canvas);
        expect(mainFrame?.count).toBe(1);
        expect(readTideAnchors(preview.stage)).toBeNull();
    });

    it('ignores a canvas that lives inside another stage subtree', () => {
        const main = buildStageWithCanvas();
        const elsewhere = buildStageWithCanvas();

        beginTideAnchors(elsewhere.canvas);
        pushTideAnchor(9, 9, 1);

        // 别的舞台里发布的锚点不属于这个舞台：不串台。
        expect(readTideAnchors(main.stage)).toBeNull();
    });

    it('lets the sampler read only the canvas inside its own stage', () => {
        const main = buildStageWithCanvas();
        const preview = buildStageWithCanvas();

        // 主舞台的字在 (250, 125)（画布逻辑像素），预览的字在 (9, 9)。
        beginTideAnchors(main.canvas);
        pushTideAnchor(250, 125, 1);
        beginTideAnchors(preview.canvas);
        pushTideAnchor(9, 9, 0.9);

        const mainSamples = sample({ stage: main.stage });
        const previewSamples = sample({ stage: preview.stage });
        expect(mainSamples).toHaveLength(1);
        expect(mainSamples[0].x).toBeCloseTo(0.35, 6);
        expect(mainSamples[0].y).toBeCloseTo(0.825, 6);
        expect(previewSamples).toHaveLength(1);
        expect(previewSamples[0].x).toBeCloseTo((100 + 9) / 1000, 6);
    });
});

describe('glyph anchor strength', () => {
    it('stays lit for the whole glyph span and falls away outside it', () => {
        // 字自己的时段内恒为 1：一个长音期间锚点必须一直在线上。
        expect(resolveGlyphAnchorStrength(1, 1, 3)).toBe(1);
        expect(resolveGlyphAnchorStrength(2, 1, 3)).toBe(1);
        expect(resolveGlyphAnchorStrength(3, 1, 3)).toBe(1);
        // 时段外按前导/拖尾单调淡出。
        expect(resolveGlyphAnchorStrength(1 - GLYPH_ANCHOR_LEAD, 1, 3)).toBeCloseTo(0, 6);
        expect(resolveGlyphAnchorStrength(3 + GLYPH_ANCHOR_TAIL, 1, 3)).toBeCloseTo(0, 6);
        expect(resolveGlyphAnchorStrength(0.95, 1, 3)).toBeGreaterThan(0);
        expect(resolveGlyphAnchorStrength(0.95, 1, 3)).toBeLessThan(1);
        // 前导段是渐强：越接近字自己的时段越强（进到时段内就是 1）。
        expect(resolveGlyphAnchorStrength(0.98, 1, 3)).toBeGreaterThan(resolveGlyphAnchorStrength(0.95, 1, 3));
    });

    it('drops a glyph that is long past, instead of parking at alpha 1 like the sprite does', () => {
        // 这正是「水钉在行首不跟着唱」的根因：alpha 唱完仍是 1，时间包络会掉出去。
        expect(resolveGlyphAnchorStrength(6, 1, 3)).toBeLessThan(0.02);
        expect(resolveGlyphAnchorStrength(0, 1, 3)).toBe(0);
    });

    it('lets the sampler keep the glyph being sung rather than the first few in publishing order', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        // 行首两个字早就唱完了（强度掉到 0），正在唱的是最后一个。以前强度取 alpha 时，
        // 前两个字 alpha 仍是 1，会被一直选中 -> 水钉在行首。
        pushTideAnchor(0, 0, resolveGlyphAnchorStrength(5, 0, 1));
        pushTideAnchor(10, 0, resolveGlyphAnchorStrength(5, 1, 2));
        pushTideAnchor(250, 125, resolveGlyphAnchorStrength(5, 4.5, 6));

        const samples = sample({ stage });
        expect(samples).toHaveLength(1);
        expect(samples[0].key).toBe('bridge:2');
    });
});

describe('LyricAnchorSampler bridged anchors', () => {
    it('maps canvas pixels into stage coordinates through the canvas own rect', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        // 画布左上 → 屏幕 (100, 50) → 舞台 x 0.1；y 要翻成「屏幕向上」→ 0.95
        pushTideAnchor(0, 0, 0.9);
        // 画布中心 → 屏幕 (350, 175) → 舞台 x 0.35；y → 1 - 0.175 = 0.825
        pushTideAnchor(250, 125, 0.8);

        const samples = sample({ stage });
        expect(samples).toHaveLength(2);
        expect(samples[0].x).toBeCloseTo(0.1, 6);
        expect(samples[0].y).toBeCloseTo(0.95, 6);
        expect(samples[1].x).toBeCloseTo(0.35, 6);
        expect(samples[1].y).toBeCloseTo(0.825, 6);
        // 位置照报，速度留给下游滤波。
        expect(samples[0].vx).toBe(0);
        expect(samples[0].vy).toBe(0);
        expect(samples[0].key).toBe('bridge:0');
    });

    it('lands on the exact same spot as the existing DOM mark path for the same screen point', () => {
        // 同一个屏幕点 (350, 175)：一边是画布像素 (250, 125)（画布 rect 在 100, 50），
        // 一边是视口坐标下零尺寸的标记。两条路径必须给出同一个归一化坐标 ——
        // 这条断言把 bridge 的 y 约定钉死在一个已经被视觉验证过的参照上。
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        pushTideAnchor(250, 125, 1);
        const bridged = sample({ stage });

        clearTideAnchors();
        const markStage = document.createElement('div');
        const mark = document.createElement('div');
        mark.dataset.tidePlayhead = 'true';
        mark.getBoundingClientRect = () => ({ left: 350, top: 175, right: 350, bottom: 175, width: 0, height: 0, x: 350, y: 175 }) as DOMRect;
        markStage.appendChild(mark);
        document.body.appendChild(markStage);
        const marks = sample({ stage: markStage });

        expect(bridged).toHaveLength(1);
        expect(marks).toHaveLength(1);
        expect(bridged[0].x).toBeCloseTo(marks[0].x, 9);
        expect(bridged[0].y).toBeCloseTo(marks[0].y, 9);
    });

    it('takes priority over DOM glyphs, which canvas modes do not have anyway', () => {
        const { stage, canvas } = buildStageWithCanvas();
        const span = document.createElement('span');
        span.textContent = 'ABCD';
        stage.appendChild(span);
        beginTideAnchors(canvas);
        pushTideAnchor(100, 50, 0.9);

        const samples = sample({ stage });
        expect(samples).toHaveLength(1);
        expect(samples[0].key).toBe('bridge:0');
    });

    it('keeps the strongest few, in a stable order, so keys do not churn every frame', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        pushTideAnchor(0, 0, 0.4);
        pushTideAnchor(10, 0, 0.9);
        pushTideAnchor(20, 0, 0.7);
        pushTideAnchor(30, 0, 0.9);

        const samples = sample({ stage, maxAnchors: 2 });
        expect(samples).toHaveLength(2);
        expect(samples.map(entry => entry.key)).toEqual(['bridge:1', 'bridge:3']);
    });

    it('falls back to the ordinary path when a frame exists but nothing is lit', () => {
        const { stage, canvas } = buildStageWithCanvas();
        beginTideAnchors(canvas);
        pushTideAnchor(100, 50, 0.01);

        // 没有可用锚点时必须原样走后面那条路（这里是无词、无标记 → 空）。
        expect(sample({ stage })).toEqual([]);
    });
});
