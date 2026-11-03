import { describe, expect, it } from 'vitest';
import { NebbiaSpot } from '@/components/visualizer/nebbia/nebbiaSpot';
import type { LaidChar, LaidLine } from '@/components/visualizer/nebbia/nebbiaScene';

// test/unit/visualizer/nebbiaSpot.test.ts
// 雾笺的聚光灯跟着正在写的字走：手指书写按书写时刻 wt 挑字，慢慢显现按演唱时刻 t；写到唱完以后也还亮着。

/** 一个字：唱在 t，从 wt 起写 wd 秒；appearDur > 0 是慢慢显现。 */
const ch = (x: number, t: number, wt: number, wd: number, appearDur = 0) => (
    { x, y: 300, s: 100, t, wt, wd, appearDur, glyph: {} } as unknown as LaidChar
);
/** 一句：唱 0–1 秒，三个字唱得很快，写得慢（一直写到 6 秒）。 */
const written = (): LaidLine => ({
    t: 0, end: 1, next: 6,
    chars: [ch(100, 0, 0, 2), ch(200, 0.3, 2, 2), ch(300, 0.6, 4, 2)],
} as unknown as LaidLine);

/** dt = 0 时直接对齐到目标，取当下的目标点。 */
const aim = (laid: LaidLine[], T: number) => {
    const spot = new NebbiaSpot();
    spot.update(laid, T, 0);
    return { x: spot.x, i: spot.i };
};

describe('nebbia spot follows the character being written', () => {
    it('picks the character by its writing time, not its sung time', () => {
        const laid = [written()];
        // 唱已经到第三个字，笔还在第一个字上
        expect(aim(laid, 0.7).x).toBeLessThan(150);
        // 第二个字刚开写
        expect(aim(laid, 2).x).toBeCloseTo(200);
        expect(aim(laid, 4.5).x).toBeCloseTo(300);
    });

    it('stays lit while the line is still being written after it is sung', () => {
        const laid = [written()];
        expect(aim(laid, 5).i).toBe(1);
        expect(aim(laid, 6.5).i).toBe(1);
        expect(aim(laid, 7).i).toBe(0);
    });

    it('follows the sung time for a line that fades in', () => {
        // 书写时刻故意排得很晚：慢慢显现的字不看它
        const line = { t: 0, end: 1, next: 2, chars: [ch(100, 0, 5, 0.5, 0.4), ch(200, 0.5, 5, 0.5, 0.4)] } as unknown as LaidLine;
        expect(aim([line], 0.5).x).toBeCloseTo(200);
        expect(aim([line], 1.7).i).toBe(1);
        expect(aim([line], 2).i).toBe(0);
    });

    it('stays on the later line while an earlier one is still being written', () => {
        // 上一句写到 6 秒，下一句 3 秒起开写，两句的字开写时刻交错
        const later = { t: 2.5, end: 4, next: 9, chars: [ch(700, 2.5, 3, 2), ch(800, 3, 5.5, 2)] } as unknown as LaidLine;
        const laid = [written(), later];
        for (const T of [3.2, 4.2, 5, 5.6]) expect(aim(laid, T).x).toBeGreaterThan(650);
    });
});
