import { describe, expect, it } from 'vitest';
import { blurTaps } from '@/components/visualizer/machi/engine/fx/bloomPass';

// test/unit/visualizer/machi/bloomBlur.test.ts
// 町景 bloom 的模糊取样：成对取样（双线性取在两点之间）和逐点取样加出来是同一个数，逐点取样和 UnrealBloomPass 的权重一样。

/** 一维信号在 x 处的线性插值（显卡双线性取样在一个方向上的样子）。 */
const lerpAt = (signal: number[], x: number) => {
    const i = Math.floor(x);
    const t = x - i;
    return signal[i]! * (1 - t) + signal[i + 1]! * t;
};

const blurAt = (signal: number[], center: number, taps: ReturnType<typeof blurTaps>) =>
    taps.offsets.reduce((sum, offset, i) => sum + (lerpAt(signal, center + offset) + lerpAt(signal, center - offset)) * taps.weights[i]!, signal[center]! * taps.center);

describe('machi bloom blur taps', () => {
    it('keeps the UnrealBloomPass gaussian when sampling one tap per texel', () => {
        const taps = blurTaps(6, false);
        const sigma = 2;
        expect(taps.offsets).toEqual([1, 2, 3, 4, 5]);
        expect(taps.center).toBeCloseTo(0.39894 / sigma);
        expect(taps.weights[2]).toBeCloseTo(0.39894 * Math.exp(-0.5 * 9 / (sigma * sigma)) / sigma);
    });

    it('pairs neighbouring taps into one sample without changing the result', () => {
        const signal = Array.from({ length: 64 }, (_, i) => Math.sin(i * 1.7) * 3 + (i % 5));
        [3, 5, 6, 10, 11, 22].forEach(kernel => {
            const plain = blurTaps(kernel, false);
            const paired = blurTaps(kernel, true);
            expect(paired.offsets.length).toBe(Math.ceil((kernel - 1) / 2));
            expect(blurAt(signal, 30, paired)).toBeCloseTo(blurAt(signal, 30, plain), 10);
        });
    });
});
