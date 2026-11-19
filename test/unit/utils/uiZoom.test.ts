import { describe, expect, it } from 'vitest';
import { readUiZoomStep, resolveUiZoomFactor, stepUiZoom } from '@/utils/uiZoom';

// test/unit/utils/uiZoom.test.ts
// 界面缩放（#1264）的挡位：读存着的值、开关合成倍数、一挡一挡走时 100% 就是关掉开关。

describe('uiZoom', () => {
    it('reads only the fixed steps', () => {
        expect(readUiZoomStep('80')).toBe(80);
        expect(readUiZoomStep(125)).toBe(125);
        expect(readUiZoomStep('100')).toBeNull();
        expect(readUiZoomStep('85')).toBeNull();
        expect(readUiZoomStep('')).toBeNull();
    });

    it('is 100% while the switch is off', () => {
        expect(resolveUiZoomFactor(false, 67)).toBe(1);
        expect(resolveUiZoomFactor(true, 67)).toBe(0.67);
    });

    it('steps through 100% by turning the switch off and keeps the step', () => {
        expect(stepUiZoom(true, 90, 1)).toEqual({ enabled: false, step: 90 });
        expect(stepUiZoom(false, 90, 1)).toEqual({ enabled: true, step: 110 });
        expect(stepUiZoom(false, 125, -1)).toEqual({ enabled: true, step: 90 });
        expect(stepUiZoom(true, 110, -1)).toEqual({ enabled: false, step: 110 });
        expect(stepUiZoom(true, 50, 1)).toEqual({ enabled: true, step: 67 });
    });

    it('stops at either end', () => {
        expect(stepUiZoom(true, 150, 1)).toBeNull();
        expect(stepUiZoom(true, 50, -1)).toBeNull();
    });
});
