import { describe, expect, it } from 'vitest';
import { GREETING_SHORT_VARIANTS, GREETING_VARIANTS, historyGreetingSlot, msUntilNextGreetingSlot, pickGreetingVariant } from '../../../src/components/app/scratchpad/historyGreeting';

// test/unit/scratchpad/historyGreeting.test.ts
// 速记簿「播放历史」页顶上那句问候：按本地时钟分段，以及到下一段还有多久。

describe('history greeting', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 10, 4, hour, minute);

    it('picks one fixed slot per part of the day', () => {
        expect(historyGreetingSlot(at(0))).toBe('lateNight');
        expect(historyGreetingSlot(at(4, 59))).toBe('lateNight');
        expect(historyGreetingSlot(at(5))).toBe('dawn');
        expect(historyGreetingSlot(at(9))).toBe('morning');
        expect(historyGreetingSlot(at(12))).toBe('noon');
        expect(historyGreetingSlot(at(15))).toBe('afternoon');
        expect(historyGreetingSlot(at(19))).toBe('evening');
        expect(historyGreetingSlot(at(23, 30))).toBe('night');
    });

    it('picks one of the variants, never past the last', () => {
        expect(pickGreetingVariant(() => 0)).toBe('v1');
        expect(pickGreetingVariant(() => 0.5)).toBe('v4');
        expect(pickGreetingVariant(() => 0.999999)).toBe(`v${GREETING_VARIANTS}`);
        expect(pickGreetingVariant(() => 1)).toBe(`v${GREETING_VARIANTS}`);
        expect(pickGreetingVariant(() => 0.999999, GREETING_SHORT_VARIANTS)).toBe(`v${GREETING_SHORT_VARIANTS}`);
    });

    it('counts down to the start of the next slot', () => {
        expect(msUntilNextGreetingSlot(at(13, 30))).toBe(30 * 60 * 1000);
        expect(msUntilNextGreetingSlot(at(23))).toBe(60 * 60 * 1000);
    });
});
