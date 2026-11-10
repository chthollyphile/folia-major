import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPonderHold } from '@/components/ponder/hold/usePonderHold';

// test/unit/ponder/ponderHold.test.ts
// The timing rule of "hold to enter the tutorial", shared by the G entry and the Ctrl+G entry:
// a full hold opens once, a hold let go early opens nothing, and the key's auto-repeat does not
// start the count again.

describe('createPonderHold', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reports once when the key is held for the whole time, and not a millisecond earlier', () => {
        const onFull = vi.fn();
        const hold = createPonderHold(400, onFull);
        expect(hold.press()).toBe(true);
        vi.advanceTimersByTime(399);
        expect(onFull).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onFull).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2000);
        expect(onFull).toHaveBeenCalledTimes(1);
    });

    it('reports nothing when the key is let go before the time is up', () => {
        const onFull = vi.fn();
        const hold = createPonderHold(400, onFull);
        hold.press();
        vi.advanceTimersByTime(399);
        expect(hold.release()).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(onFull).not.toHaveBeenCalled();
    });

    it('does not start the count again when pressed while already held', () => {
        const onFull = vi.fn();
        const hold = createPonderHold(400, onFull);
        hold.press();
        vi.advanceTimersByTime(300);
        expect(hold.press()).toBe(false);
        vi.advanceTimersByTime(100);
        expect(onFull).toHaveBeenCalledTimes(1);
    });

    it('can be held again after a full hold and after a hold that was let go', () => {
        const onFull = vi.fn();
        const hold = createPonderHold(400, onFull);
        hold.press();
        vi.advanceTimersByTime(400);
        expect(hold.press()).toBe(true);
        hold.release();
        expect(hold.press()).toBe(true);
        vi.advanceTimersByTime(400);
        expect(onFull).toHaveBeenCalledTimes(2);
    });

    it('says so when there was nothing to let go', () => {
        const hold = createPonderHold(400, vi.fn());
        expect(hold.release()).toBe(false);
    });
});
