import { describe, expect, it } from 'vitest';
import { resolveBravaisCameraTweenSeconds, shouldJumpBravaisCamera } from '@/library/suites/bravais/bravaisCameraTween';
import {
    BRAVAIS_CAMERA_JUMP_SCREENS,
    BRAVAIS_CAMERA_MAX_SPEED,
    BRAVAIS_CAMERA_MAX_TWEEN_S,
    BRAVAIS_CAMERA_TWEEN_S,
} from '@/library/suites/bravais/bravaisConstants';

// test/unit/library/bravais/bravaisCameraTween.test.ts
// 相机补间的时长与「直接到位」的界：近距离还是固定的 0.42s；一屏以内按速度上限拉长；超过一屏多直接到位。

const VIEW = { width: 1440, height: 1100, scale: 0.76 };
/** 一屏（视口对角线）在世界上有多长。 */
const SCREEN = Math.hypot(VIEW.width, VIEW.height) / VIEW.scale;

describe('resolveBravaisCameraTweenSeconds', () => {
    it('keeps the base duration while the distance fits it', () => {
        expect(resolveBravaisCameraTweenSeconds(0)).toBe(BRAVAIS_CAMERA_TWEEN_S);
        expect(resolveBravaisCameraTweenSeconds(100)).toBe(BRAVAIS_CAMERA_TWEEN_S);
        expect(resolveBravaisCameraTweenSeconds(BRAVAIS_CAMERA_TWEEN_S * BRAVAIS_CAMERA_MAX_SPEED)).toBe(BRAVAIS_CAMERA_TWEEN_S);
    });

    it('stretches with the distance once the base duration would go faster than the cap', () => {
        expect(resolveBravaisCameraTweenSeconds(BRAVAIS_CAMERA_MAX_SPEED)).toBeCloseTo(1, 5);
        expect(resolveBravaisCameraTweenSeconds(BRAVAIS_CAMERA_MAX_SPEED * 0.75)).toBeCloseTo(0.75, 5);
    });

    it('never goes past the longest tween', () => {
        expect(resolveBravaisCameraTweenSeconds(BRAVAIS_CAMERA_MAX_SPEED * 10)).toBe(BRAVAIS_CAMERA_MAX_TWEEN_S);
        expect(resolveBravaisCameraTweenSeconds(Number.POSITIVE_INFINITY)).toBe(BRAVAIS_CAMERA_MAX_TWEEN_S);
    });

    it('keeps an explicit base for a jump or an unknown distance', () => {
        expect(resolveBravaisCameraTweenSeconds(5000, 0.6)).toBe(BRAVAIS_CAMERA_MAX_TWEEN_S);
        expect(resolveBravaisCameraTweenSeconds(5000, 0)).toBe(0);
        expect(resolveBravaisCameraTweenSeconds(Number.NaN)).toBe(BRAVAIS_CAMERA_TWEEN_S);
        expect(resolveBravaisCameraTweenSeconds(-20)).toBe(BRAVAIS_CAMERA_TWEEN_S);
    });
});

describe('shouldJumpBravaisCamera', () => {
    it('tweens inside the reach and jumps past it', () => {
        expect(shouldJumpBravaisCamera(SCREEN * BRAVAIS_CAMERA_JUMP_SCREENS, VIEW)).toBe(false);
        expect(shouldJumpBravaisCamera(SCREEN * BRAVAIS_CAMERA_JUMP_SCREENS + 1, VIEW)).toBe(true);
        expect(shouldJumpBravaisCamera(SCREEN * 10, VIEW)).toBe(true);
    });

    it('tweens whatever it can while the view is not measured or the distance is unusable', () => {
        expect(shouldJumpBravaisCamera(SCREEN * 10, null)).toBe(false);
        expect(shouldJumpBravaisCamera(SCREEN * 10, { ...VIEW, scale: 0 })).toBe(false);
        expect(shouldJumpBravaisCamera(0, VIEW)).toBe(false);
        expect(shouldJumpBravaisCamera(Number.NaN, VIEW)).toBe(false);
    });
});
