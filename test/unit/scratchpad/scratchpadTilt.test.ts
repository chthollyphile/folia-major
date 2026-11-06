import { describe, expect, it } from 'vitest';
import { clientToLocal, localToClient, rotatePoint, type TiltBox } from '@/components/app/scratchpad/scratchpadTilt';
import {
    FILM_SPACING,
    NOTE_SPACING,
    PHOTO_SPACING,
    OVERVIEW_ROW_BLOCK,
    OVERVIEW_ROW_MIN_STEP,
    cardRect,
    cardSize,
    columnsFor,
    overviewBottomInset,
    overviewRowTops,
    slotPosition,
    tiltDrop,
} from '@/components/app/scratchpad/canvasLayout';
import { mulberry32, scatterBandDecos, scatterSlimDecos } from '@/components/app/scratchpad/scratchpadLook';

// test/unit/scratchpad/scratchpadTilt.test.ts
// 展开整页那张倾斜的纸：屏幕坐标与元素自己坐标的换算、三种卡片的格子大小、信息条装饰按种子撒。

/** 一个 w × h 的元素，左上角（没转时）在 origin，整个绕 pivot 转了 deg 度：它的外接框与自身宽高。 */
const tiltedBox = (origin: { x: number; y: number }, w: number, h: number, pivot: { x: number; y: number }, deg: number): TiltBox => {
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => {
        const turned = rotatePoint({ x: origin.x + x - pivot.x, y: origin.y + y - pivot.y }, deg);
        return { x: turned.x + pivot.x, y: turned.y + pivot.y };
    });
    const xs = corners.map(point => point.x);
    const ys = corners.map(point => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
        offsetWidth: w,
        offsetHeight: h,
        getBoundingClientRect: () => ({
            left, top, right: Math.max(...xs), bottom: Math.max(...ys),
            width: Math.max(...xs) - left, height: Math.max(...ys) - top, x: left, y: top, toJSON: () => null,
        }),
    };
};

describe('tilted sheet coordinates', () => {
    const box = tiltedBox({ x: 200, y: 300 }, 1200, 600, { x: 720, y: 450 }, 6);

    it('maps the element corners back to its own corners', () => {
        const topLeftOnScreen = localToClient(box, { x: 0, y: 0 }, 6);
        const local = clientToLocal(box, topLeftOnScreen, 6);
        expect(local.x).toBeCloseTo(0, 6);
        expect(local.y).toBeCloseTo(0, 6);
        const far = clientToLocal(box, localToClient(box, { x: 1200, y: 600 }, 6), 6);
        expect(far.x).toBeCloseTo(1200, 6);
        expect(far.y).toBeCloseTo(600, 6);
    });

    it('turns the way the sheet turns: further right is further down on screen', () => {
        const left = localToClient(box, { x: 0, y: 100 }, 6);
        const right = localToClient(box, { x: 1000, y: 100 }, 6);
        expect(right.y - left.y).toBeCloseTo(1000 * Math.sin((6 * Math.PI) / 180), 6);
    });

    it('is a plain offset when the sheet does not turn', () => {
        const flat = tiltedBox({ x: 40, y: 50 }, 300, 200, { x: 0, y: 0 }, 0);
        expect(clientToLocal(flat, { x: 100, y: 80 }, 0)).toEqual({ x: 60, y: 30 });
        expect(localToClient(flat, { x: 60, y: 30 }, 0)).toEqual({ x: 100, y: 80 });
    });
});

describe('full-page card sizes', () => {
    it('lays notebook cards out on their own size', () => {
        expect(cardSize(NOTE_SPACING)).toEqual({ width: 128, height: 152 });
        expect(slotPosition(11, 10, NOTE_SPACING)).toEqual({ x: 144, y: 196 });
        expect(columnsFor(144 * 10 - 16, NOTE_SPACING)).toBe(10);
    });

    it('keeps rows far enough apart that a long sideways marquee on the tilted sheet stays in its row', () => {
        // Dragging 400px sideways on a sheet turned 6° drifts about 42px across rows.
        const drift = tiltDrop(400, 6);
        expect(drift).toBeCloseTo(41.8, 1);
        for (const spacing of [NOTE_SPACING, PHOTO_SPACING, FILM_SPACING]) {
            expect(spacing.y).toBeGreaterThan(drift);
        }
    });

    it('butts film frames together with no gap', () => {
        const first = cardRect({ x: 0, y: 0 }, 0, 10, FILM_SPACING);
        const second = cardRect({ x: 0, y: 0 }, 1, 10, FILM_SPACING);
        expect(second.left).toBe(first.right);
    });
});

describe('band decorations', () => {
    it('draws the same numbers as the design generator', () => {
        // mulberry32(11): the first values of the reference implementation.
        const random = mulberry32(11);
        const first = random();
        const second = random();
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(1);
        expect(second).not.toBe(first);
        expect(mulberry32(11)()).toBe(first);
    });

    it('places the same shapes every time, inside their zones, without overlapping', () => {
        const decos = scatterBandDecos('history', 1760);
        expect(scatterBandDecos('history', 1760)).toEqual(decos);
        expect(decos.length).toBeGreaterThan(8);
        for (const deco of decos) {
            expect(deco.x).toBeGreaterThanOrEqual(742);
            expect(deco.x + deco.size).toBeLessThanOrEqual(1760 - 220);
        }
        for (let a = 0; a < decos.length; a += 1) {
            for (let b = a + 1; b < decos.length; b += 1) {
                const one = decos[a];
                const other = decos[b];
                const overlap = one.x < other.x + other.size && one.x + one.size > other.x && one.y < other.y + other.size && one.y + one.size > other.y;
                expect(overlap).toBe(false);
            }
        }
        expect(scatterSlimDecos('queue').every(deco => deco.x > 500)).toBe(true);
    });
});

describe('three-row overview layout', () => {
    it('keeps the design positions on a tall window', () => {
        const tops = overviewRowTops(900);
        expect(tops[0]).toBeCloseTo(116.1, 1);
        // The minimum step (a row is as tall as the tallest card) wins over the design ratio here.
        expect(tops[1]).toBeCloseTo(116.1 + OVERVIEW_ROW_MIN_STEP, 1);
        expect(tops[2]).toBeCloseTo(116.1 + 2 * OVERVIEW_ROW_MIN_STEP, 1);
    });

    it('never lets a row run into the next one', () => {
        for (const height of [560, 640, 700, 768, 824, 900, 1080]) {
            const tops = overviewRowTops(height);
            for (let index = 1; index < tops.length; index += 1) {
                expect(tops[index] - tops[index - 1]).toBeGreaterThanOrEqual(OVERVIEW_ROW_BLOCK - 1e-9);
            }
        }
    });

    it('keeps the third row inside a short window, moving up before squeezing', () => {
        const tops = overviewRowTops(760);
        expect(tops[2] + OVERVIEW_ROW_BLOCK).toBeLessThanOrEqual(760 - 8 + 1e-9);
        expect(tops[1] - tops[0]).toBeGreaterThanOrEqual(OVERVIEW_ROW_BLOCK);
        expect(tops[0]).toBeGreaterThanOrEqual(36);
        // Tall enough to keep the full spacing once moved up: no squeezing.
        const roomy = overviewRowTops(820);
        expect(roomy[1] - roomy[0]).toBeCloseTo(OVERVIEW_ROW_MIN_STEP, 6);
        expect(roomy[2] + OVERVIEW_ROW_BLOCK).toBeLessThanOrEqual(820 - 8 + 1e-9);
    });
});

describe('tilted safe area', () => {
    it('measures how far the right end of a tilted row sinks', () => {
        expect(tiltDrop(0, 6)).toBe(0);
        expect(tiltDrop(-500, 6)).toBeLessThan(0);
        expect(overviewBottomInset(1760, 0)).toBe(0);
        expect(overviewBottomInset(1760, 6)).toBe(Math.ceil(680 * Math.sin((6 * Math.PI) / 180)));
    });

    it('keeps the overview clear of the sunk right end when the window has room for it', () => {
        const inset = overviewBottomInset(1760, 6);
        const tops = overviewRowTops(860, inset);
        expect(tops[2] + OVERVIEW_ROW_BLOCK).toBeLessThanOrEqual(860 - 8 - inset + 1e-9);
        // Without the inset the last row would have stayed lower.
        expect(overviewRowTops(860)[2]).toBeGreaterThan(tops[2]);
    });
});
