import { describe, expect, it } from 'vitest';
import { onAccentColor } from '../../../src/components/modal/settings/kit/kitTheme';
import { parseNumberText } from '../../../src/components/modal/settings/kit/numberText';
import { placePopover } from '../../../src/components/modal/settings/kit/popoverPlace';
import { landOnMark } from '../../../src/components/modal/settings/kit/Slider';
import { getContrastRatio } from '../../../src/utils/themeColorMath';

// test/unit/settings/settingsKit.test.ts
// The two rules of the settings kit that cannot be seen by using the window: which colour goes on
// the accent, and what number a typed text is. Both were wrong in ways that looked fine: white on a
// mid-light accent at 2.5:1, and "0,7" saved as typed and then used as 0.
// After them: where a layer that opens from a control is put, and where a dragged slider lands.

describe('the colour on the accent', () => {
    const DARK = '#17171a';
    const WHITE = '#ffffff';

    // Accents between the old fixed cut (luminance 0.4) and the point where dark starts to read
    // better (about 0.2) used to get white.
    it.each(['#ea580c', '#ff7f50', '#10b981', '#e879f9', '#a3a3a3'])('is dark on the mid-light accent %s', (accent) => {
        expect(onAccentColor(accent)).toBe(DARK);
    });

    it.each(['#2563eb', '#18181b', '#7c3aed'])('is white on the dark accent %s', (accent) => {
        expect(onAccentColor(accent)).toBe(WHITE);
    });

    it('is dark on the near-white accent of the default dark theme', () => {
        expect(onAccentColor('#f4f4f5')).toBe(DARK);
    });

    it('is never the worse of the two', () => {
        for (const accent of ['#ea580c', '#2563eb', '#10b981', '#808080', '#f4f4f5', '#18181b', '#facc15', '#be123c']) {
            const chosen = getContrastRatio(onAccentColor(accent), accent);
            expect(chosen).toBe(Math.max(getContrastRatio(DARK, accent), getContrastRatio(WHITE, accent)));
        }
    });
});

describe('a typed number', () => {
    it.each([
        ['0.7', 0.7],
        ['0,7', 0.7],
        ['1,5', 1.5],
        ['0，7', 0.7],
        ['0。7', 0.7],
        [' 0.7 ', 0.7],
        ['3', 3],
        ['.5', 0.5],
        ['1.', 1],
        ['-1', -1],
    ])('reads %j as %d', (text, value) => {
        expect(parseNumberText(text)).toBe(value);
    });

    // parseFloat reads the start of each of these as a number.
    it.each(['', '   ', 'abc', '0.7abc', '1e3', '1,234.5', '0.7.1', '.', 'Infinity'])('reads %j as no number', (text) => {
        expect(parseNumberText(text)).toBeNull();
    });
});

describe('where a popover goes', () => {
    // A window that is not at the corner of the screen: every distance is from its own edges.
    const WINDOW = { left: 100, top: 50, width: 400, height: 600 };
    const LAYER = { width: 200, height: 120 };
    const anchorAt = (left: number, top: number) => ({ left, top, width: 80, height: 32 });

    it('hangs under its anchor from the edge asked for', () => {
        expect(placePopover(anchorAt(140, 100), LAYER, WINDOW, { side: 'under', align: 'start' }))
            .toEqual({ side: 'under', left: 40, top: 88, maxHeight: 504 });
        expect(placePopover(anchorAt(340, 100), LAYER, WINDOW, { side: 'under', align: 'end' }))
            .toEqual({ side: 'under', right: 80, top: 88, maxHeight: 504 });
    });

    it('goes over the anchor where the window ends too soon under it, and under it where it was asked over and does not fit there', () => {
        expect(placePopover(anchorAt(140, 560), LAYER, WINDOW, { side: 'under', align: 'start' }))
            .toEqual({ side: 'over', left: 40, bottom: 96, maxHeight: 496 });
        expect(placePopover(anchorAt(140, 100), LAYER, WINDOW, { side: 'over', align: 'start' }))
            .toEqual({ side: 'under', left: 40, top: 88, maxHeight: 504 });
    });

    it('takes the side with more room in a window shorter than the layer, and is no taller than that room', () => {
        const short = { ...WINDOW, height: 300 };
        const tall = { width: 200, height: 400 };
        expect(placePopover(anchorAt(140, 180), tall, short, { side: 'over', align: 'start' }))
            .toMatchObject({ side: 'under', top: 168, maxHeight: 124 });
        expect(placePopover(anchorAt(140, 230), tall, short, { side: 'under', align: 'start' }))
            .toMatchObject({ side: 'over', bottom: 126, maxHeight: 166 });
        // Too tall for both sides, and the side asked for has more room: it stays there.
        expect(placePopover(anchorAt(140, 180), tall, short, { side: 'under', align: 'start' }))
            .toMatchObject({ side: 'under', top: 168, maxHeight: 124 });
    });

    it('counts from the scrolled edges of a window whose content is scrolled, with the same room', () => {
        const scrolled = { ...WINDOW, scrollLeft: 10, scrollTop: 40 };
        expect(placePopover(anchorAt(140, 100), LAYER, scrolled, { side: 'under', align: 'start' }))
            .toEqual({ side: 'under', left: 50, top: 128, maxHeight: 504 });
        expect(placePopover(anchorAt(340, 560), LAYER, scrolled, { side: 'under', align: 'end' }))
            .toEqual({ side: 'over', right: 70, bottom: 56, maxHeight: 496 });
        expect(placePopover(anchorAt(300, 100), LAYER, scrolled, { side: 'under', align: 'end', fill: true }))
            .toMatchObject({ left: 18, right: -2, top: 128 });
    });

    it('stays a gutter inside the window at both sides', () => {
        // The anchor is at the window's right edge: a layer from its start would pass that edge.
        expect(placePopover(anchorAt(400, 100), LAYER, WINDOW, { side: 'under', align: 'start' }).left).toBe(192);
        // The anchor is at the window's left edge: a layer from its end would pass that edge.
        expect(placePopover(anchorAt(104, 100), LAYER, WINDOW, { side: 'under', align: 'end' }).right).toBe(192);
        // A layer wider than the window starts at the gutter.
        expect(placePopover(anchorAt(140, 100), { width: 500, height: 120 }, WINDOW, { side: 'under', align: 'start' }).left).toBe(8);
    });

    it('is as wide as the window, less the gutters, when asked to fill', () => {
        expect(placePopover(anchorAt(300, 100), LAYER, WINDOW, { side: 'under', align: 'end', fill: true }))
            .toMatchObject({ left: 8, right: 8, top: 88 });
    });

    it('is centred on its anchor, and moved in at the edge of the screen', () => {
        const screen = { left: 0, top: 0, width: 1000, height: 700 };
        const label = { width: 120, height: 24 };
        expect(placePopover(anchorAt(500, 300), label, screen, { side: 'over', align: 'center' }))
            .toEqual({ side: 'over', left: 480, bottom: 406, maxHeight: 286 });
        expect(placePopover(anchorAt(912, 300), label, screen, { side: 'over', align: 'center' }).left).toBe(872);
        // No room over a part at the top of the screen.
        expect(placePopover(anchorAt(500, 10), label, screen, { side: 'over', align: 'center' })).toMatchObject({ side: 'under', top: 48 });
    });
});

describe('where a dragged slider lands', () => {
    // A font size in percent: the reach is what six pixels of the track are worth.
    const MARKS = [90, 100, 110, 125];
    const REACH = 4.9;

    it('lands on a mark that is within reach, on the nearer of two', () => {
        expect(landOnMark(113, MARKS, REACH)).toBe(110);
        expect(landOnMark(96, MARKS, REACH)).toBe(100);
        expect(landOnMark(110, MARKS, REACH)).toBe(110);
        expect(landOnMark(106, MARKS, 8)).toBe(110);
    });

    it('stays where it is out of reach of every mark, so a value between marks can be had', () => {
        expect(landOnMark(117, MARKS, REACH)).toBe(117);
        expect(landOnMark(95, MARKS, REACH)).toBe(95);
        expect(landOnMark(60, MARKS, REACH)).toBe(60);
    });

    it('takes a mark exactly at the end of the reach, and no mark where there is none', () => {
        expect(landOnMark(105, [100], 5)).toBe(100);
        expect(landOnMark(42, [], 100)).toBe(42);
    });
});
