import { describe, expect, it } from 'vitest';
import type { TideAnchorSample } from '@/components/visualizer/backgrounds/tide/LyricAnchorSampler';
import {
    TIDE_CAMERA_LIMIT,
    glideTideCamera,
    resolveTideCameraTarget,
} from '@/components/visualizer/backgrounds/tide/tideCamera';

// test/unit/visualizer/tideCamera.test.ts
// 相机开关的所有算术都在这里：目标位置取锚点重心，强度换成屏幕偏移，再逐帧滑过去。

const anchor = (patch: Partial<TideAnchorSample> = {}): TideAnchorSample => ({
    key: 'dom:0',
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    strength: 1,
    ...patch,
});

describe('tide camera', () => {
    it('aims at the strength weighted centre of the anchors', () => {
        const camera = resolveTideCameraTarget([anchor({ x: 0.8 }), anchor({ x: 0.5, strength: 0.5 })], 0.45);

        expect(camera.x).toBeCloseTo((0.3 / 1.5) * 0.45 * 0.55, 6);
        expect(camera.y).toBe(0);
    });

    it('looks left when the lyrics move left and right when they move right', () => {
        expect(resolveTideCameraTarget([anchor({ x: 0.9 })], 0.45).x).toBeGreaterThan(0);
        expect(resolveTideCameraTarget([anchor({ x: 0.1 })], 0.45).x).toBeLessThan(0);
        // 字在上面时光看高一点（相机往上，画面里的水往下走）。
        expect(resolveTideCameraTarget([anchor({ y: 0.9 })], 0.45).y).toBeGreaterThan(0);
    });

    it('clamps the camera so the water never leaves the frame', () => {
        const camera = resolveTideCameraTarget([anchor({ x: 1, y: 0 })], 1);

        expect(camera.x).toBe(TIDE_CAMERA_LIMIT);
        expect(camera.y).toBe(-TIDE_CAMERA_LIMIT * 0.75);
    });

    it('returns to the centre with no anchors, no strength or a zero strength setting', () => {
        expect(resolveTideCameraTarget([], 1)).toEqual({ x: 0, y: 0 });
        expect(resolveTideCameraTarget([anchor({ x: 1 })], 0)).toEqual({ x: 0, y: 0 });
        expect(resolveTideCameraTarget([anchor({ x: 1, strength: 0 })], 1)).toEqual({ x: 0, y: 0 });
    });

    it('glides the camera instead of snapping', () => {
        const target = { x: TIDE_CAMERA_LIMIT, y: 0.1 };
        const first = glideTideCamera({ x: 0, y: 0 }, target, 1 / 60, 0.5);

        expect(first.x).toBeGreaterThan(0);
        // 相机比锚点慢得多：一帧只走一点点，镜头是跟拍不是瞬移。
        expect(first.x).toBeLessThan(target.x * 0.1);

        let camera = first;
        for (let frame = 0; frame < 240; frame += 1) {
            camera = glideTideCamera(camera, target, 1 / 60, 0.5);
        }

        expect(camera.x).toBeCloseTo(target.x, 2);
        expect(camera.x).toBeLessThan(target.x);
    });

    it('snaps to the target when smoothing is off', () => {
        const target = { x: 0.1, y: -0.05 };
        expect(glideTideCamera({ x: 0, y: 0 }, target, 1 / 60, 0)).toEqual(target);
    });
});
