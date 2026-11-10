import { describe, expect, it } from 'vitest';
import { fitRectsToStage } from '@/utils/ponder/fitRectsToStage';
import { ponderStageScreen } from '@/utils/ponder/ponderStageLayout';

// test/unit/ponder/ponderStageLayout.test.ts
// The arithmetic of the stage's screen: one size is drawn (1440 x 900); what the other window
// sizes get is only written here.

/** The stand-in of a whole page, fitted into the screen the way PonderStage does it (20 px inset). */
const standInOnScreen = (width: number, height: number, sideGutter: number) => {
    const viewport = { width, height };
    const screen = ponderStageScreen(viewport, sideGutter);
    const fitted = fitRectsToStage({
        rects: {
            page: { left: 0, top: 0, width, height },
            bar: { left: 0, top: height - 80, width, height: 80 },
        },
        viewport,
        chrome: {
            top: screen.top,
            bottom: height - screen.top - screen.height,
            left: screen.left,
            right: width - screen.left - screen.width,
        },
        gap: 20,
    });
    return { screen, page: fitted.page, bar: fitted.bar };
};

describe('ponderStageScreen', () => {
    it('is the drawn 864 x 540 screen on a 1440 x 900 window, centred under the title bar', () => {
        expect(ponderStageScreen({ width: 1440, height: 900 })).toEqual({ left: 288, top: 66, width: 864, height: 540 });
    });

    it('keeps its width on a lower window and loses height only', () => {
        expect(ponderStageScreen({ width: 1440, height: 700 })).toEqual({ left: 288, top: 66, width: 864, height: 340 });
    });

    it('keeps its shape on a taller window', () => {
        expect(ponderStageScreen({ width: 1920, height: 1080 })).toEqual({ left: 384, top: 66, width: 1152, height: 720 });
    });

    it('stays between the side gutters while the window is wide enough', () => {
        expect(ponderStageScreen({ width: 1440, height: 900 }, 248).width).toBe(864);
        expect(ponderStageScreen({ width: 1280, height: 900 }, 248)).toEqual({ left: 248, top: 66, width: 784, height: 540 });
    });

    it('never leaves a narrow window, gutter or not', () => {
        expect(ponderStageScreen({ width: 390, height: 844 })).toEqual({ left: 24, top: 66, width: 342, height: 484 });
        expect(ponderStageScreen({ width: 390, height: 844 }, 248).width).toBe(320);
    });
});

describe('the stand-in on the screen', () => {
    // Low, very wide, and narrow with the card of related lessons: the sizes where the picture
    // used to stick out under the transport and the text, and the two drawn sizes.
    const sizes: [number, number][] = [
        [1440, 900], [1440, 700], [1280, 640], [1280, 600], [1366, 680], [1024, 768],
        [800, 500], [520, 400], [3840, 1080], [900, 1600], [390, 844],
    ];
    const cases = sizes.flatMap(([width, height]) => [[width, height, 0], [width, height, 248]]);

    it.each(cases)('stays inside the screen on a %i x %i window (side gutter %i)', (width, height, sideGutter) => {
        const { screen, page, bar } = standInOnScreen(width, height, sideGutter);

        expect(page.left).toBeGreaterThanOrEqual(screen.left + 20 - 0.5);
        expect(page.top).toBeGreaterThanOrEqual(screen.top + 20 - 0.5);
        expect(page.left + page.width).toBeLessThanOrEqual(screen.left + screen.width - 20 + 0.5);
        expect(page.top + page.height).toBeLessThanOrEqual(screen.top + screen.height - 20 + 0.5);
        // Still one picture: the bar keeps its place at the page's bottom edge.
        expect(bar.top + bar.height).toBeCloseTo(page.top + page.height, 3);
        expect(bar.width).toBeCloseTo(page.width, 3);
    });
});
