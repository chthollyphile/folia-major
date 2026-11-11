import { describe, expect, it } from 'vitest';
import {
    buildPendoloDialProjection,
    buildPendoloHubViewProjection,
    buildPendoloLayerProjection,
    buildPendoloTiltProjection,
    invertPendoloProjectionMatrix,
    projectPendoloDialPoint,
    resolvePendoloSpaceCssTransform,
} from '@/components/visualizer/pendolo/pendoloDialProjection';
import { calculatePendoloWheelLayout } from '@/components/visualizer/pendolo/pendoloGeometry';
import { DEFAULT_PENDOLO_TUNING, type Line } from '@/types';

// test/unit/visualizer/pendoloDialProjection.test.ts
// 时计的表盘倾斜与左右镜像：投影矩阵与镜像后的弧线位置。

describe('pendolo hub view projection', () => {
    const hubX = 0;
    const hubY = 540;
    const view = (side: 1 | -1, back = 300) => buildPendoloHubViewProjection(400, back, 500, side, hubX, hubY, 1920, 1080);
    // 齐次结果，不做 w 的下限保护，背后的点也能看出符号
    const raw = (m: Float32Array, x: number, y: number, h = 0, lift: [number, number, number] = [0, 0, 0]) => {
        const w = m[6] * x + m[7] * y + m[8] + h * lift[2];
        return {
            x: (m[0] * x + m[1] * y + m[2] + h * lift[0]) / w,
            y: (m[3] * x + m[4] * y + m[5] + h * lift[1]) / w,
            w,
        };
    };

    it('lands the focal line on its fixed spot with w = 1', () => {
        const p = raw(view(1).matrix, 500, 0);
        expect(p.w).toBeCloseTo(1);
        expect(hubX + p.x).toBeCloseTo(960);
        expect(hubY + p.y).toBeCloseTo(1080 * 0.42);
    });

    it('looks along the pointer from behind the hub: farther along rises toward the horizon, behind the camera w < 0', () => {
        const projection = view(1);
        const near = raw(projection.matrix, 500, 0);
        const far = raw(projection.matrix, 2000, 0);
        expect(far.y).toBeLessThan(near.y);
        expect(far.x).toBeCloseTo(near.x);
        expect(raw(projection.matrix, -2000, 0).w).toBeLessThan(0);
        // 相机退到轮心后面：轮心在相机前方，画面里比焦点句低
        const hub = raw(projection.matrix, 0, 0);
        expect(hub.w).toBeGreaterThan(0);
        expect(hub.y).toBeGreaterThan(near.y);
        // 正上方（不后退）时焦点句仍落在同一点
        const overhead = raw(view(1, 0).matrix, 500, 0);
        expect(overhead.w).toBeCloseTo(1);
        expect(overhead.x).toBeCloseTo(near.x);
        // 右手边是表盘平面里的 +y（屏幕下方）
        expect(raw(projection.matrix, 500, 200).x).toBeGreaterThan(near.x);
    });

    it('raises higher layers on screen and brings them closer', () => {
        const projection = view(1);
        const ground = raw(projection.matrix, 700, 0);
        const raised = raw(projection.matrix, 700, 0, 100, projection.lift);
        expect(raised.y).toBeLessThan(ground.y);
        expect(raised.w).toBeLessThan(ground.w);
        expect(projection.invFocal).toBe(0);
        // 分层矩阵和直接加 h·lift 一样（不再按 1 - h/f 缩）
        const layer = buildPendoloLayerProjection(projection, 100);
        const viaLayer = raw(layer.matrix, 700, 0);
        expect(viaLayer.x).toBeCloseTo(raised.x);
        expect(viaLayer.y).toBeCloseTo(raised.y);
    });

    it('carries the height axis in the CSS matrix so stood-up lyrics share the camera', () => {
        const projection = view(1);
        const values = resolvePendoloSpaceCssTransform(projection)
            .slice('matrix3d('.length, -1).split(',').map(Number);
        // 第三列（z 的系数）就是抬高方向
        expect(values[8]).toBeCloseTo(projection.lift[0]);
        expect(values[9]).toBeCloseTo(projection.lift[1]);
        expect(values[11]).toBeCloseTo(projection.lift[2]);
        expect(values[15]).toBeCloseTo(projection.matrix[8]);
    });

    it('mirrors to look the other way when the pointer points left', () => {
        const right = raw(view(1).matrix, 500, 120);
        const left = raw(view(-1).matrix, -500, 120);
        expect(left.w).toBeCloseTo(right.w);
        expect(left.y).toBeCloseTo(right.y);
        // 朝左看时右手边是 -y
        expect(left.x - 960).toBeCloseTo(-(right.x - 960));
    });
});

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
        const inverse = { ...projection, matrix: invertPendoloProjectionMatrix(projection.matrix) };
        const screen = projectPendoloDialPoint(projection, 180, -90);
        const back = projectPendoloDialPoint(inverse, screen.x, screen.y);
        expect(back.x).toBeCloseTo(180, 3);
        expect(back.y).toBeCloseTo(-90, 3);
    });
});

describe('pendolo layer parallax', () => {
    it('leaves a raised layer exactly where the dial is while the dial lies flat', () => {
        const flat = buildPendoloTiltProjection(0, 0, 1920, 1080);
        const raised = buildPendoloLayerProjection(flat, 120);
        const p = projectPendoloDialPoint(raised, 300, -200);
        expect(p.x).toBeCloseTo(300, 6);
        expect(p.y).toBeCloseTo(-200, 6);
    });

    it('shifts a raised layer off the dial once it tilts, nearer layers more', () => {
        const tilt = buildPendoloTiltProjection(45, 0, 1920, 1080);
        const at = (height: number) => projectPendoloDialPoint(buildPendoloLayerProjection(tilt, height), 0, 0);
        expect(at(0).y).toBeCloseTo(0);
        // 水平轴、正倾斜（上方往里退）：法线朝观看者偏向上方，抬高的层往上（表盘远侧）错开
        expect(at(60).y).toBeLessThan(0);
        expect(at(120).y).toBeLessThan(at(60).y);
    });

    it('puts a raised layer nearer than the dial along the same screen ray', () => {
        // 遮挡靠深度测试：同一个屏幕像素上，越高的层 w 必须越小（越近），否则上层反被下层挡住
        const tilt = buildPendoloTiltProjection(53, -57, 1280, 720);
        const wAtPixel = (height: number, sx: number, sy: number) => {
            const m = buildPendoloLayerProjection(tilt, height).matrix;
            const inv = invertPendoloProjectionMatrix(m);
            const z = inv[6] * sx + inv[7] * sy + inv[8];
            const x = (inv[0] * sx + inv[1] * sy + inv[2]) / z;
            const y = (inv[3] * sx + inv[4] * sy + inv[5]) / z;
            return m[6] * x + m[7] * y + m[8];
        };
        for (const [sx, sy] of [[186, -185], [-150, 120], [0, 0]]) {
            expect(wAtPixel(40, sx, sy)).toBeLessThan(wAtPixel(0, sx, sy));
            expect(wAtPixel(90, sx, sy)).toBeLessThan(wAtPixel(40, sx, sy));
        }
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
            expect(item.x).toBeCloseTo(1000 - plain[index].x);
            expect(item.y).toBeCloseTo(plain[index].y);
            expect(item.angleDeg).toBeCloseTo(plain[index].angleDeg);
        });
    });
});
