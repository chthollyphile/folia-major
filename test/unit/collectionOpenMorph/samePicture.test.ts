import { describe, expect, it } from 'vitest';
import { cellsLookAlike } from '@/library/suites/grid/transitions/samePicture';

// test/unit/collectionOpenMorph/samePicture.test.ts
// The comparison of two pictures' cells. Reading a picture into cells takes a browser:
// test/component/samePicture.spec.ts.

describe('cellsLookAlike', () => {
    const cells = (...colours: number[]) => colours;

    it('takes cells that are the same, or nearly, for one picture', () => {
        expect(cellsLookAlike(cells(10, 120, 240, 0, 0, 0), cells(10, 120, 240, 0, 0, 0))).toBe(true);
        expect(cellsLookAlike(cells(10, 120, 240, 0, 0, 0), cells(19, 111, 249, 9, 9, 9))).toBe(true);
    });

    it('takes one cell that is far off in one channel for another picture', () => {
        expect(cellsLookAlike(cells(10, 120, 240, 0, 0, 0), cells(10, 120, 240, 0, 20, 0))).toBe(false);
        expect(cellsLookAlike(cells(10, 120, 240, 0, 0, 0), cells(10, 120, 240, 0, 19.9, 0))).toBe(true);
        expect(cellsLookAlike(cells(60, 60, 60), cells(40, 60, 60))).toBe(false);
    });

    it('takes pictures of different sizes, and no picture at all, for different', () => {
        expect(cellsLookAlike(cells(1, 2, 3), cells(1, 2, 3, 1, 2, 3))).toBe(false);
        expect(cellsLookAlike(cells(), cells())).toBe(false);
    });
});
