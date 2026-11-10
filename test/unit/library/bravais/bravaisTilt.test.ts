import { describe, expect, it } from 'vitest';
import { BRAVAIS_TILT_DEG } from '@/library/suites/bravais/bravaisConstants';
import { rotateAround, seamTiltInsets } from '@/library/suites/bravais/bravaisFrame';
import { resolveBravaisTiltDeg, resolveBravaisTiltPage, type BravaisTiltInput } from '@/library/suites/bravais/bravaisTilt';

// test/unit/library/bravais/bravaisTilt.test.ts
// 整层的倾斜角：哪一套缝的内容算哪一种页面（首页 / 集合页 / 海报，各取 BRAVAIS_TILT_DEG 里的角度），什么时候不倾斜
// （面板、表单、搜索框、折叠、横向的缝、合上的缝、降低动态效果），以及倾斜的信息条里内容上下缩进多少。

const input = (patch: Partial<BravaisTiltInput> = {}): BravaisTiltInput => ({
    variant: 'poster',
    openWidth: 600,
    targetAxis: 'x',
    renderedAxis: 'x',
    reducedMotion: false,
    ...patch,
});

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
            expect(resolveBravaisTiltDeg(input({ variant }))).toBe(0);
        }
    });
});

describe('resolveBravaisTiltDeg', () => {
    it('takes each page kind from the one table', () => {
        expect(resolveBravaisTiltDeg(input({ variant: 'poster' }))).toBe(BRAVAIS_TILT_DEG.poster);
        expect(resolveBravaisTiltDeg(input({ variant: 'home' }))).toBe(BRAVAIS_TILT_DEG.home);
        expect(resolveBravaisTiltDeg(input({ variant: 'home-spine' }))).toBe(BRAVAIS_TILT_DEG.home);
        expect(resolveBravaisTiltDeg(input({ variant: 'full' }))).toBe(BRAVAIS_TILT_DEG.collection);
        expect(resolveBravaisTiltDeg(input({ variant: 'spine' }))).toBe(BRAVAIS_TILT_DEG.collection);
    });

    it('tilts the artist and album poster and leaves the home and collection pages as they ship', () => {
        expect(BRAVAIS_TILT_DEG.poster).toBe(-10);
        expect(BRAVAIS_TILT_DEG.home).toBe(0);
        expect(BRAVAIS_TILT_DEG.collection).toBe(0);
    });

    it('straightens while the seam is shut, with reduced motion, and for a seam that runs across', () => {
        expect(resolveBravaisTiltDeg(input({ openWidth: 0 }))).toBe(0);
        expect(resolveBravaisTiltDeg(input({ reducedMotion: true }))).toBe(0);
        expect(resolveBravaisTiltDeg(input({ variant: 'full', targetAxis: 'y', renderedAxis: 'y' }))).toBe(0);
        expect(resolveBravaisTiltDeg(input({ variant: 'none', targetAxis: null }))).toBe(0);
    });

    it('waits for a row strip to close before turning for the upright seam that replaces it', () => {
        expect(resolveBravaisTiltDeg(input({ renderedAxis: 'y' }))).toBe(0);
        expect(resolveBravaisTiltDeg(input({ renderedAxis: null }))).toBe(BRAVAIS_TILT_DEG.poster);
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
