import { describe, expect, it } from 'vitest';

// test/unit/electron/tileMemoryBudget.test.ts

const { raisedTileBudgetMb } = require('../../../electron/tileMemoryBudget.cjs') as {
    raisedTileBudgetMb: (screenPixels: number, totalMemBytes: number) => number;
};

const GB = 1024 ** 3;

describe('raisedTileBudgetMb', () => {
    it('gives twice Chromium\'s 874 MB on a 4K screen', () => {
        expect(raisedTileBudgetMb(3840 * 2160, 64 * GB)).toBe(1748);
    });

    it('keeps Chromium\'s 512 MB on a 1080p screen', () => {
        expect(raisedTileBudgetMb(1920 * 1080, 16 * GB)).toBe(512);
    });

    it('stays within a quarter of RAM', () => {
        expect(raisedTileBudgetMb(3840 * 2160, 4 * GB)).toBe(1024);
    });
});
