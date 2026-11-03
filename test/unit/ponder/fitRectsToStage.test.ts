import { describe, expect, it } from 'vitest';
import { fitRectsToStage } from '@/utils/ponder/fitRectsToStage';
import type { PonderRect } from '@/types/ponder';

// test/unit/ponder/fitRectsToStage.test.ts
// 骨架要整体装进教程外框之间那条带子里。要紧的是「整体」二字 ——
// 相对位置和真实界面一致是骨架的全部价值，逐个避让或各自缩放都会把它毁掉。

const viewport = { width: 1440, height: 900 };
const chrome = { top: 84, bottom: 156 };
const fit = (rects: Record<string, PonderRect>) => fitRectsToStage({ rects, viewport, chrome });

/** 可用带：84+24 .. 900-156-24 = 108 .. 720 */
const AVAILABLE_TOP = 108;
const AVAILABLE_BOTTOM = 720;

describe('fitRectsToStage', () => {
    it('本来就装得下且位置合适时原样返回，不做无谓缩放', () => {
        const rects = { a: { left: 100, top: 108, width: 200, height: 300 } };
        expect(fit(rects)).toEqual(rects);
    });

    it('装得下但位置偏了：只做最小平移，不缩放也不居中', () => {
        const rects = { bar: { left: 100, top: 800, width: 400, height: 56 } };
        const out = fit(rects);

        expect(out.bar.height).toBe(56);
        expect(out.bar.width).toBe(400);
        expect(out.bar.left).toBe(100);
        // 刚好推到可用带的下沿，不多挪一像素 —— 位置与真实界面的对应尽量保住。
        expect(out.bar.top + out.bar.height).toBe(AVAILABLE_BOTTOM);
    });

    it('装不下时等比缩放，整幅图落进可用带', () => {
        const rects = {
            panel: { left: 400, top: 160, width: 600, height: 300 },
            bar: { left: 480, top: 800, width: 480, height: 56 },
        };
        const out = fit(rects);

        const top = Math.min(...Object.values(out).map(r => r.top));
        const bottom = Math.max(...Object.values(out).map(r => r.top + r.height));
        expect(top).toBeGreaterThanOrEqual(AVAILABLE_TOP - 0.5);
        expect(bottom).toBeLessThanOrEqual(AVAILABLE_BOTTOM + 0.5);
    });

    it('缩放是等比的：宽高比不变', () => {
        const rects = {
            panel: { left: 400, top: 160, width: 600, height: 300 },
            bar: { left: 480, top: 800, width: 480, height: 56 },
        };
        const out = fit(rects);

        expect(out.panel.width / out.panel.height).toBeCloseTo(600 / 300, 5);
        expect(out.bar.width / out.bar.height).toBeCloseTo(480 / 56, 5);
    });

    it('所有矩形用同一个缩放系数，相对关系不变', () => {
        const rects = {
            panel: { left: 400, top: 160, width: 600, height: 300 },
            bar: { left: 480, top: 800, width: 480, height: 56 },
        };
        const out = fit(rects);
        const s = out.panel.width / 600;

        expect(out.bar.width / 480).toBeCloseTo(s, 5);
        // 两者的垂直间距同比缩小。
        const before = rects.bar.top - (rects.panel.top + rects.panel.height);
        const after = out.bar.top - (out.panel.top + out.panel.height);
        expect(after).toBeCloseTo(before * s, 3);
    });

    it('横向以视口中线为缩放中心，左右关系保住', () => {
        const rects = {
            left: { left: 100, top: 200, width: 100, height: 600 },
            right: { left: 1240, top: 200, width: 100, height: 600 },
        };
        const out = fit(rects);
        const centerOf = (r: PonderRect) => r.left + r.width / 2;

        expect(centerOf(out.left)).toBeLessThan(viewport.width / 2);
        expect(centerOf(out.right)).toBeGreaterThan(viewport.width / 2);
    });

    it('极端高的内容也缩到装得下为止，缩多少没有下限', () => {
        const rects = { tall: { left: 0, top: 0, width: 400, height: 4000 } };
        const out = fit(rects);

        expect(out.tall.top).toBeGreaterThanOrEqual(AVAILABLE_TOP - 0.5);
        expect(out.tall.top + out.tall.height).toBeLessThanOrEqual(AVAILABLE_BOTTOM + 0.5);
        expect(out.tall.width / out.tall.height).toBeCloseTo(400 / 4000, 5);
    });

    it('空集不炸', () => {
        expect(fit({})).toEqual({});
    });

    it('圆角等其他字段原样保留', () => {
        const rects = { bar: { left: 100, top: 800, width: 400, height: 56, radius: '9999px' } };
        expect(fit(rects).bar.radius).toBe('9999px');
    });
});
