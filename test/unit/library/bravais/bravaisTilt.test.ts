import { describe, expect, it } from 'vitest';
import { BRAVAIS_TILT_DEG } from '@/library/suites/bravais/bravaisConstants';
import { reanchorLift, rotateAround, seamPlanEdge, seamTiltInsets, tiltEdgeRoom, type BravaisFrameInput } from '@/library/suites/bravais/bravaisFrame';
import { tiltedScreenBox } from '@/library/suites/bravais/bravaisTiltReveal';
import { resolveBravaisTiltDeg, resolveBravaisTiltPage, type BravaisTiltInput } from '@/library/suites/bravais/bravaisTilt';

// test/unit/library/bravais/bravaisTilt.test.ts
// 整层的倾斜角：哪一套缝的内容算哪一种页面（首页 / 集合页 / 海报，各取 BRAVAIS_TILT_DEG 里的角度），什么时候不倾斜
// （面板、表单、搜索框、折叠、横向的缝、合上的缝、有限拼贴、降低动态效果），以及倾斜的信息条里内容上下缩进多少。

const input = (patch: Partial<BravaisTiltInput> = {}): BravaisTiltInput => ({
    variant: 'poster',
    openWidth: 600,
    targetAxis: 'x',
    renderedAxis: 'x',
    finite: false,
    reducedMotion: false,
    ...patch,
});

// 每一格角度都不一样、都不是 0：出厂的表里首页与集合页是 0，拿它测分不清「取了这一格」和「没倾斜」。
const TABLE = { home: -4, collection: -6, poster: -10 };
const tilt = (patch: Partial<BravaisTiltInput> = {}) => resolveBravaisTiltDeg(input(patch), TABLE);

describe('resolveBravaisTiltPage', () => {
    it('groups the seam contents by page kind', () => {
        expect(resolveBravaisTiltPage('poster')).toBe('poster');
        expect(resolveBravaisTiltPage('home')).toBe('home');
        expect(resolveBravaisTiltPage('home-spine')).toBe('home');
        expect(resolveBravaisTiltPage('full')).toBe('collection');
        expect(resolveBravaisTiltPage('spine')).toBe('collection');
    });

    it('keeps panels, forms, the home search and the folded seam upright', () => {
        for (const variant of ['panel', 'form', 'search', 'none'] as const) {
            expect(resolveBravaisTiltPage(variant)).toBeNull();
            expect(tilt({ variant })).toBe(0);
        }
    });
});

describe('resolveBravaisTiltDeg', () => {
    it('takes each page kind from its own entry of the table', () => {
        expect(tilt({ variant: 'poster' })).toBe(-10);
        expect(tilt({ variant: 'home' })).toBe(-4);
        expect(tilt({ variant: 'home-spine' })).toBe(-4);
        expect(tilt({ variant: 'full' })).toBe(-6);
        expect(tilt({ variant: 'spine' })).toBe(-6);
    });

    it('reads the shipped table by default: the home stays upright, playlists lean a little, the poster the most', () => {
        expect(BRAVAIS_TILT_DEG).toEqual({ home: 0, collection: -4, poster: -10 });
        expect(resolveBravaisTiltDeg(input({ variant: 'poster' }))).toBe(-10);
        expect(resolveBravaisTiltDeg(input({ variant: 'home' }))).toBe(0);
        expect(resolveBravaisTiltDeg(input({ variant: 'full' }))).toBe(-4);
        expect(resolveBravaisTiltDeg(input({ variant: 'spine' }))).toBe(-4);
    });

    // 下面每一条只动一个条件，其余都是「会倾斜」的样子（集合页的信息条，表里 −6）。
    it('straightens while the seam is shut', () => {
        expect(tilt({ variant: 'full', openWidth: 0 })).toBe(0);
    });

    it('straightens with reduced motion', () => {
        expect(tilt({ variant: 'full', reducedMotion: true })).toBe(0);
    });

    it('straightens on a finite wall (a filter is on)', () => {
        expect(tilt({ variant: 'full', finite: true })).toBe(0);
        expect(tilt({ variant: 'home', finite: true })).toBe(0);
    });

    it('does not tilt a seam that is going to run across, even before the upright one has left', () => {
        expect(tilt({ variant: 'full', targetAxis: 'y', renderedAxis: 'x' })).toBe(0);
        expect(tilt({ variant: 'full', targetAxis: null, renderedAxis: 'x' })).toBe(0);
    });

    it('waits for a row strip to close before turning for the upright seam that replaces it', () => {
        expect(tilt({ variant: 'full', targetAxis: 'x', renderedAxis: 'y' })).toBe(0);
        expect(tilt({ variant: 'full', targetAxis: 'x', renderedAxis: null })).toBe(-6);
        expect(tilt({ variant: 'full', targetAxis: 'x', renderedAxis: 'x' })).toBe(-6);
    });
});

describe('rotateAround', () => {
    it('turns like CSS rotate: positive is clockwise on a y-down screen', () => {
        const turned = rotateAround(110, 50, { pivotX: 100, pivotY: 50 }, 90);
        expect(turned.x).toBeCloseTo(100);
        expect(turned.y).toBeCloseTo(60);
    });

    it('leaves the pivot and an untilted point alone', () => {
        expect(rotateAround(100, 50, { pivotX: 100, pivotY: 50 }, -10)).toEqual({ x: 100, y: 50 });
        expect(rotateAround(7, 9, { pivotX: 100, pivotY: 50 }, 0)).toEqual({ x: 7, y: 9 });
    });
});

describe('seamTiltInsets', () => {
    // 内容那一列（右缘是转轴所在的缝右缘，宽 width，上下各缩进 insets）转过去之后四个角的屏幕 y。
    const cornerYs = (width: number, height: number, deg: number) => {
        const { top, bottom } = seamTiltInsets({ width, height, deg });
        const pivot = { pivotX: width, pivotY: height / 2 };
        return [[0, top], [width, top], [0, height - bottom], [width, height - bottom]].map(([x, y]) => rotateAround(x, y, pivot, deg).y);
    };

    it('does nothing without a tilt', () => {
        expect(seamTiltInsets({ width: 300, height: 900, deg: 0 })).toEqual({ top: 0, bottom: 0 });
    });

    it('keeps all four corners of the content between the top and bottom edges', () => {
        for (const deg of [-10, -4, 3, 10]) {
            for (const [width, height] of [[300, 900], [120, 700], [64, 1300]]) {
                for (const y of cornerYs(width, height, deg)) {
                    expect(y).toBeGreaterThanOrEqual(-0.01);
                    expect(y).toBeLessThanOrEqual(height + 0.01);
                }
            }
        }
    });

    it('insets the side whose corner the turn pushes out, and no more than that', () => {
        // 逆时针（负）：左下角往下掉；顺时针：左上角往上翘。
        const counter = seamTiltInsets({ width: 300, height: 900, deg: -10 });
        expect(counter.top).toBe(0);
        expect(counter.bottom).toBeGreaterThan(40);
        expect(counter.bottom).toBeLessThan(50);
        const clockwise = seamTiltInsets({ width: 300, height: 900, deg: 10 });
        expect(clockwise.bottom).toBe(0);
        expect(clockwise.top).toBeCloseTo(counter.bottom);
    });

    it('grows from nothing with the angle, so the content does not jump when the turn starts', () => {
        expect(seamTiltInsets({ width: 300, height: 900, deg: -0.05 }).bottom).toBeLessThan(0.5);
    });
});

describe('reanchorLift', () => {
    const view = { width: 1440, height: 900, scale: 0.76 };
    const frameAt = (patch: Partial<BravaisFrameInput> = {}): BravaisFrameInput => ({
        center: { x: 0, y: 0 },
        view,
        anchorX: 3000,
        openWidth: 0,
        contentWidth: 300,
        hidden: false,
        tiltDeg: -4,
        ...patch,
    });
    /** 一个世界点此刻画在屏幕上的哪里（两半墙的让位、倾斜与垫的那一截都算上）。 */
    const drawn = (frame: BravaisFrameInput, x: number, y: number) => {
        const box = tiltedScreenBox({ x, y, width: 0, height: 0 }, frame);
        return { x: box.left, y: box.top };
    };
    // 缝被拖到右边 3000 世界单位外（收起了），在视口里另一条块边界上重新裂开。
    const next = 0;
    const pivotShift = (3000 - next) * view.scale;

    it('is nothing without a tilt, without a seam, or when the anchor does not move', () => {
        expect(reanchorLift(frameAt({ tiltDeg: 0 }), next)).toBe(0);
        expect(reanchorLift(frameAt({ anchorX: null }), next)).toBe(0);
        expect(reanchorLift(frameAt(), null)).toBe(0);
        expect(reanchorLift(frameAt(), 3000)).toBeCloseTo(0);
    });

    it('keeps the wall where it was when the anchor jumps under a tilt', () => {
        for (const tiltDeg of [-4, -10, 6]) {
            const before = frameAt({ tiltDeg });
            const lift = reanchorLift(before, next);
            // 墙上的一点（两条锚点都在它右边，落在同一半面）。
            const [x, y] = [-600, 250];
            const from = drawn(before, x, y);
            const jumped = drawn({ ...before, anchorX: next }, x, y);
            const held = drawn({ ...before, anchorX: next, liftY: lift }, x, y);
            // 不垫：顺着纸的竖向跳了约 支点挪的距离 × |sin|。
            expect(Math.hypot(jumped.x - from.x, jumped.y - from.y)).toBeGreaterThan(pivotShift * Math.abs(Math.sin(tiltDeg * Math.PI / 180)) * 0.95);
            // 垫上：只剩垂直于纸竖向的那一点（支点挪的距离 × (1 − cos)）。
            const left = Math.hypot(held.x - from.x, held.y - from.y);
            expect(left).toBeLessThanOrEqual(pivotShift * (1 - Math.cos(tiltDeg * Math.PI / 180)) + 0.01);
        }
    });

    it('measures the pivot as it is drawn at that moment, opening included', () => {
        // 新缝立刻张着 300（开口没有归零）：支点还多挪了半个开口。
        const closed = reanchorLift(frameAt(), next);
        const open = reanchorLift(frameAt({ openWidth: 300 }), next);
        expect(open - closed).toBeCloseTo(150 * Math.sin(-4 * Math.PI / 180));
    });
});

describe('tiltEdgeRoom', () => {
    it('is the sideways reach of a tilted seam end: half the viewport height times |sin|', () => {
        expect(tiltEdgeRoom(900, 0)).toBe(0);
        expect(tiltEdgeRoom(900, -4)).toBeCloseTo(450 * Math.sin(4 * Math.PI / 180));
        expect(tiltEdgeRoom(900, 4)).toBeCloseTo(tiltEdgeRoom(900, -4));
    });

    it('covers how far the ends of a tilted strip lean out past its own left and right edges', () => {
        // 缝的右缘半高是转轴。逆时针（负）：上端往左、下端往右；往外探出缝自己左右缘的距离不超过它。
        const [width, height, deg] = [300, 900, -4];
        const pivot = { pivotX: width, pivotY: height / 2 };
        const room = tiltEdgeRoom(height, deg);
        const xs = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => rotateAround(x, y, pivot, deg).x);
        expect(0 - Math.min(...xs)).toBeGreaterThan(room * 0.9);
        expect(0 - Math.min(...xs)).toBeLessThanOrEqual(room + 0.01);
        expect(Math.max(...xs) - width).toBeGreaterThan(room * 0.9);
        expect(Math.max(...xs) - width).toBeLessThanOrEqual(room + 0.01);
    });

    it('is added to the planning margin only when the viewport has room for it on both sides', () => {
        const room = tiltEdgeRoom(900, -4);
        expect(seamPlanEdge({ view: { width: 1440, height: 900 }, openWidth: 300, tiltDeg: -4, edge: 14 })).toBeCloseTo(14 + room);
        expect(seamPlanEdge({ view: { width: 1440, height: 900 }, openWidth: 300, tiltDeg: 0, edge: 14 })).toBe(14);
        // 正好放得下 / 差一点放不下。
        const fits = 300 + 2 * (14 + room);
        expect(seamPlanEdge({ view: { width: fits, height: 900 }, openWidth: 300, tiltDeg: -4, edge: 14 })).toBeCloseTo(14 + room);
        expect(seamPlanEdge({ view: { width: fits - 1, height: 900 }, openWidth: 300, tiltDeg: -4, edge: 14 })).toBe(14);
    });
});
