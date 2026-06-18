import { describe, expect, it } from 'vitest';
import {
    applyHexCardFrameStyles,
    computeHexCardFrame,
    type HexCardFrameStyleCache,
} from '../../../src/components/folia-grid/hexCardTransform';
import type { HexGridCoord } from '../../../src/components/folia-grid/hexViewport';

// Verifies GridView card-frame math and cached style application.
const makeCoord = (baseX: number, baseY = 0): HexGridCoord => ({
    index: 0,
    cube: { x: 0, y: 0, z: 0 },
    baseX,
    baseY,
});

const options = {
    clipRadius: 500,
    maxDistance: 500,
    lodStart: 340,
    lodEnd: 385,
};

const createFakeTarget = () => {
    const writes: string[] = [];
    const values: Record<string, string> = {};
    const style: Record<string, unknown> = {
        setProperty: (name: string, value: string) => {
            values[name] = value;
            writes.push(`${name}:${value}`);
        },
    };

    for (const key of ['display', 'transform', 'opacity', 'zIndex']) {
        Object.defineProperty(style, key, {
            get: () => values[key] ?? '',
            set: (value: string) => {
                values[key] = value;
                writes.push(`${key}:${value}`);
            },
        });
    }

    return {
        target: { style } as any,
        values,
        writes,
    };
};

describe('hexCardTransform', () => {
    it('computes centered card scale, opacity, layering, and controls', () => {
        const frame = computeHexCardFrame(makeCoord(0), 0, 0, options);

        expect(frame.visible).toBe(true);
        expect(frame.display).toBe('');
        expect(frame.distance).toBe(0);
        expect(frame.transform).toBe('translate3d(0px, 0px, 0) scale(1.1)');
        expect(frame.opacity).toBe('1');
        expect(frame.zIndex).toBe('50');
        expect(frame.queueOpacity).toBe('1');
        expect(frame.queuePointerEvents).toBe('auto');
        expect(frame.playOpacity).toBe('1');
        expect(frame.playScale).toBe('1');
        expect(frame.playPointerEvents).toBe('auto');
    });

    it('marks cards outside the clip radius as hidden', () => {
        const frame = computeHexCardFrame(makeCoord(700), 0, 0, options);

        expect(frame.visible).toBe(false);
        expect(frame.display).toBe('none');
        expect(frame.opacity).toBe('0');
        expect(frame.queueOpacity).toBe('0');
        expect(frame.queuePointerEvents).toBe('none');
        expect(frame.playPointerEvents).toBe('none');
    });

    it('hides cards outside the rectangular viewport even when inside the radial clip', () => {
        const frame = computeHexCardFrame(makeCoord(360), 0, 0, {
            ...options,
            viewportWidth: 400,
            viewportHeight: 400,
            cardWidth: 100,
            cardHeight: 100,
            visibilityBuffer: 0,
        });

        expect(frame.distance).toBe(360);
        expect(frame.visible).toBe(false);
        expect(frame.display).toBe('none');
    });

    it('fades queue controls across the LOD band', () => {
        const frame = computeHexCardFrame(makeCoord(362.5), 0, 0, options);

        expect(frame.visible).toBe(true);
        expect(frame.queueOpacity).toBe('0.5');
        expect(frame.queuePointerEvents).toBe('auto');
        expect(frame.playOpacity).toBe('0');
        expect(frame.playPointerEvents).toBe('none');
    });

    it('skips repeated DOM writes when the cached frame style is unchanged', () => {
        const frame = computeHexCardFrame(makeCoord(0), 0, 0, options);
        const cache: HexCardFrameStyleCache = {};
        const { target, writes } = createFakeTarget();

        expect(applyHexCardFrameStyles(target, frame, cache)).toBe(true);
        const firstWriteCount = writes.length;

        expect(applyHexCardFrameStyles(target, frame, cache)).toBe(false);
        expect(writes).toHaveLength(firstWriteCount);

        const movedFrame = computeHexCardFrame(makeCoord(0), 20, 0, options);
        expect(applyHexCardFrameStyles(target, movedFrame, cache)).toBe(true);
        expect(writes.length).toBeGreaterThan(firstWriteCount);
    });
});
