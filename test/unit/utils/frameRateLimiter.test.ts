import { describe, expect, it } from 'vitest';
import { createFrameRateLimitedRaf, parseVisualizerFrameRate, shouldProcessFrameAtRate } from '../../../src/utils/frameRateLimiter';

// test/unit/utils/frameRateLimiter.test.ts

describe('frameRateLimiter', () => {
    it('parses supported visualizer frame rates', () => {
        expect(parseVisualizerFrameRate(null)).toBe('auto');
        expect(parseVisualizerFrameRate('auto')).toBe('auto');
        expect(parseVisualizerFrameRate('30')).toBe(30);
        expect(parseVisualizerFrameRate('24')).toBe(24);
        expect(parseVisualizerFrameRate('15')).toBe(15);
        expect(parseVisualizerFrameRate('60')).toBe('auto');
    });

    it('skips frames until the target interval has elapsed', () => {
        expect(shouldProcessFrameAtRate(1000, 0, 30)).toBe(true);
        expect(shouldProcessFrameAtRate(1016, 1000, 30)).toBe(false);
        expect(shouldProcessFrameAtRate(1034, 1000, 30)).toBe(true);
    });

    it('always processes frames in auto mode', () => {
        expect(shouldProcessFrameAtRate(1001, 1000, 'auto')).toBe(true);
    });

    it('flushes all queued callbacks together on allowed frames', () => {
        const nativeCallbacks: FrameRequestCallback[] = [];
        const limiter = createFrameRateLimitedRaf(
            (callback) => {
                nativeCallbacks.push(callback);
                return nativeCallbacks.length;
            },
            () => undefined,
            30,
        );
        const processed: string[] = [];

        limiter.requestAnimationFrame(() => processed.push('a'));
        limiter.requestAnimationFrame(() => processed.push('b'));

        nativeCallbacks[0]?.(1000);
        expect(processed).toEqual(['a', 'b']);

        limiter.requestAnimationFrame(() => processed.push('c'));
        nativeCallbacks[1]?.(1016);
        expect(processed).toEqual(['a', 'b']);

        nativeCallbacks[2]?.(1034);
        expect(processed).toEqual(['a', 'b', 'c']);
    });
});
