import { afterEach, describe, expect, it } from 'vitest';
import { setLyricHoldReason, useBackgroundLyricHoldStore } from '@/components/app/backgroundThrottling/backgroundLyricHoldStore';

// test/unit/app/lyricHoldReasons.test.ts
// The lyric animation is held for either of two reasons - 后台节流 with the window out of sight, or the
// performance check measuring from its own window - and neither lets go of the other's hold.

afterEach(() => {
    setLyricHoldReason('background', false);
    setLyricHoldReason('perfCheck', false);
});

describe('lyric hold reasons', () => {
    it('holds while either reason is on', () => {
        expect(useBackgroundLyricHoldStore.getState().held).toBe(false);
        setLyricHoldReason('perfCheck', true);
        expect(useBackgroundLyricHoldStore.getState().held).toBe(true);
        setLyricHoldReason('perfCheck', false);
        expect(useBackgroundLyricHoldStore.getState().held).toBe(false);
    });

    it('does not let the background switch release the check\'s hold, or the other way round', () => {
        setLyricHoldReason('perfCheck', true);
        setLyricHoldReason('background', true);
        setLyricHoldReason('background', false);
        expect(useBackgroundLyricHoldStore.getState().held).toBe(true);
        setLyricHoldReason('background', true);
        setLyricHoldReason('perfCheck', false);
        expect(useBackgroundLyricHoldStore.getState().held).toBe(true);
        setLyricHoldReason('background', false);
        expect(useBackgroundLyricHoldStore.getState().held).toBe(false);
    });
});
