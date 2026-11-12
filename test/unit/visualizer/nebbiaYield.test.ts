import { describe, expect, it } from 'vitest';
import { yieldMoment, type LaidChar } from '@/components/visualizer/nebbia/nebbiaScene';

// test/unit/visualizer/nebbiaYield.test.ts
// 雾笺的让位：后面那句压上来时，这句不能写到一半就被盖掉（「你」1:37 的「思念很难捱」一句只唱一秒多，原来只写出「思念」）。

const char = (t: number, wt: number, wd: number, appearDur = 0) => ({ t, wt, wd, appearDur, glyph: {} }) as unknown as LaidChar;
// 「思念很难捱」：每字 0.2 秒，下一句 98.254 开唱
const line = { t: 97.139, chars: [0, 1, 2, 3, 4].map(k => char(97.139 + k * 0.2, 97.139 + k * 0.2, 0.2)) };

describe('nebbia yield', () => {
    it('waits until the whole line is written before yielding to the next one', () => {
        const at = yieldMoment(98.254, line);
        // 快速起雾、哈气都从让位前 0.6 秒起：那时最后一个字（97.94 起写 0.2 秒）已经写完
        expect(at - 0.6).toBeGreaterThanOrEqual(97.939 + 0.2);
    });

    it('keeps the next line\'s start when the line was long done', () => {
        expect(yieldMoment(120, line)).toBe(120);
    });

    it('counts faded-in characters once half shown, and ignores blank ones', () => {
        const faded = { t: 10, chars: [char(10, 10, 0, 2), { ...char(30, 30, 5), glyph: null }] };
        expect(yieldMoment(10.5, faded)).toBeCloseTo(10 + 0.5 + 0.9);
    });
});
