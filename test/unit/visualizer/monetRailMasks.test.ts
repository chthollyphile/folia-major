import { describe, expect, it } from 'vitest';
import { getEdgeFadeMask } from '@/components/visualizer/monet/monetRailMasks';

// test/unit/visualizer/monetRailMasks.test.ts
// 莫奈超宽行的边缘渐隐落在行尾一侧：LTR 在右缘，RTL 在左缘。
describe('getEdgeFadeMask', () => {
    it('fades the right edge of an overflowing LTR line', () => {
        expect(getEdgeFadeMask(true, 24)).toMatch(/^linear-gradient\(90deg,/);
    });
    it('fades the left edge of an overflowing RTL line, where it overflows', () => {
        expect(getEdgeFadeMask(true, 24, true)).toMatch(/^linear-gradient\(270deg,/);
    });
    it('draws no mask when the line fits', () => {
        expect(getEdgeFadeMask(false, 24, true)).toBeUndefined();
    });
});
