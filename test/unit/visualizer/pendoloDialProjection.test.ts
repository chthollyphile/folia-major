import { describe, expect, it } from 'vitest';
import {
    buildPendoloDialProjection,
    buildPendoloTiltProjection,
    invertPendoloProjectionMatrix,
    projectPendoloDialPoint,
} from '@/components/visualizer/pendolo/pendoloDialProjection';
import { calculatePendoloWheelLayout } from '@/components/visualizer/pendolo/pendoloGeometry';
import { DEFAULT_PENDOLO_TUNING, type Line } from '@/types';

// test/unit/visualizer/pendoloDialProjection.test.ts
// 时计的表盘倾斜与左右镜像：投影矩阵与镜像后的弧线位置。

describe('pendolo dial projection', () => {
    it('is the identity with no tilt, so the default frame is drawn as before', () => {
        const flat = buildPendoloTiltProjection(0, 30, 1920, 1080);
        expect(flat.flat).toBe(true);
        expect(Array.from(flat.matrix)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        expect(projectPendoloDialPoint(flat, 120, -40)).toEqual({ x: 120, y: -40, depthScale: 1 });
    });

    it('mirrors the dial plane left to right before tilting', () => {
        const mirrored = buildPendoloDialProjection(buildPendoloTiltProjection(0, 0, 1920, 1080), true);
        const p = projectPendoloDialPoint(mirrored, 100, 50);
        expect(p.x).toBeCloseTo(-100);
        expect(p.y).toBeCloseTo(50);
    });

    it('sends the side above a horizontal axis into the screen for a positive tilt', () => {
        const tilt = buildPendoloTiltProjection(40, 0, 1920, 1080);
        const top = projectPendoloDialPoint(tilt, 0, -300);
        const bottom = projectPendoloDialPoint(tilt, 0, 300);
        expect(top.depthScale).toBeLessThan(1);
        expect(bottom.depthScale).toBeGreaterThan(1);
        // 远侧缩得比近侧多，所以顶边离轮心更近
        expect(Math.abs(top.y)).toBeLessThan(Math.abs(bottom.y));
        // 轴上的点不动
        const onAxis = projectPendoloDialPoint(tilt, 250, 0);
        expect(onAxis.x).toBeCloseTo(250);
        expect(onAxis.y).toBeCloseTo(0);
    });

    it('inverts back to the dial plane', () => {
        const projection = buildPendoloDialProjection(buildPendoloTiltProjection(-35, 25, 1600, 900), true);
        const inverse = { matrix: invertPendoloProjectionMatrix(projection.matrix), flat: false };
        const screen = projectPendoloDialPoint(projection, 180, -90);
        const back = projectPendoloDialPoint(inverse, screen.x, screen.y);
        expect(back.x).toBeCloseTo(180, 3);
        expect(back.y).toBeCloseTo(-90, 3);
    });
});

describe('pendolo mirrored layout', () => {
    const lines = Array.from({ length: 5 }, (_, index): Line => ({
        id: `l${index}`,
        startTime: index * 4,
        endTime: index * 4 + 3,
        fullText: `line ${index}`,
        words: [],
    }));

    it('puts the wheel against the right edge and opens the arc to the left, symmetric with the original', () => {
        const tuning = { ...DEFAULT_PENDOLO_TUNING, wheelCenterX: 0.1 };
        const plain = calculatePendoloWheelLayout(lines, 2, 0, 1000, 800, tuning);
        const mirrored = calculatePendoloWheelLayout(lines, 2, 0, 1000, 800, { ...tuning, mirrorLayout: true });
        expect(mirrored).toHaveLength(plain.length);
        mirrored.forEach((item, index) => {
            expect(item.x).toBeCloseTo(1000 - plain[index]!.x);
            expect(item.y).toBeCloseTo(plain[index]!.y);
            expect(item.angleDeg).toBeCloseTo(plain[index]!.angleDeg);
        });
    });
});
