import { describe, expect, it } from 'vitest';
import { createFrameRateLimitedRaf, installGlobalVisualizerFrameRateLimiter, parseVisualizerFrameRate, setGlobalVisualizerFrameRate, shouldProcessFrameAtRate } from '../../../src/utils/frameRateLimiter';

// test/unit/utils/frameRateLimiter.test.ts

describe('frameRateLimiter', () => {
    it('parses supported visualizer frame rates', () => {
        expect(parseVisualizerFrameRate(null)).toBe('off');
        expect(parseVisualizerFrameRate('off')).toBe('off');
        expect(parseVisualizerFrameRate('auto')).toBe('off');
        expect(parseVisualizerFrameRate('120')).toBe(120);
        expect(parseVisualizerFrameRate('90')).toBe(90);
        expect(parseVisualizerFrameRate('60')).toBe(60);
        expect(parseVisualizerFrameRate('30')).toBe('off');
        expect(parseVisualizerFrameRate('15')).toBe('off');
        expect(parseVisualizerFrameRate('24')).toBe('off');
    });

    it('skips frames until the target interval has elapsed', () => {
        expect(shouldProcessFrameAtRate(1000, 0, 60)).toBe(true);
        expect(shouldProcessFrameAtRate(1016, 1000, 60)).toBe(false);
        expect(shouldProcessFrameAtRate(1017, 1000, 60)).toBe(true);
    });

    it('always processes frames when disabled', () => {
        expect(shouldProcessFrameAtRate(1001, 1000, 'off')).toBe(true);
    });

    it('flushes all queued callbacks together on allowed frames', () => {
        const nativeCallbacks: FrameRequestCallback[] = [];
        const limiter = createFrameRateLimitedRaf(
            (callback) => {
                nativeCallbacks.push(callback);
                return nativeCallbacks.length;
            },
            () => undefined,
            60,
        );
        const processed: string[] = [];

        limiter.requestAnimationFrame(() => processed.push('a'));
        limiter.requestAnimationFrame(() => processed.push('b'));

        nativeCallbacks[0]?.(1000);
        expect(processed).toEqual(['a', 'b']);

        limiter.requestAnimationFrame(() => processed.push('c'));
        nativeCallbacks[1]?.(1016);
        expect(processed).toEqual(['a', 'b']);

        nativeCallbacks[2]?.(1017);
        expect(processed).toEqual(['a', 'b', 'c']);
    });

    it('restores native requestAnimationFrame when disabled globally', () => {
        const previousWindow = (globalThis as { window?: Window; }).window;
        const originalRequestAnimationFrame = () => 1;
        const originalCancelAnimationFrame = () => undefined;
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                requestAnimationFrame: originalRequestAnimationFrame,
                cancelAnimationFrame: originalCancelAnimationFrame,
                localStorage: { getItem: () => null },
            },
        });

        try {
            installGlobalVisualizerFrameRateLimiter(60);
            expect(globalThis.window.requestAnimationFrame).not.toBe(originalRequestAnimationFrame);

            setGlobalVisualizerFrameRate('off');
            expect(globalThis.window.requestAnimationFrame).toBe(originalRequestAnimationFrame);
            expect(globalThis.window.cancelAnimationFrame).toBe(originalCancelAnimationFrame);
        } finally {
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: previousWindow,
            });
        }
    });
});
