import { describe, expect, it } from 'vitest';
import { compilePonderScene } from '@/utils/ponder/compilePonderTimeline';
import { captionWindows, focusBeats, focusFrameBox } from '@/utils/ponder/ponderFocus';
import type { PonderStep } from '@/types/ponder';

// test/unit/ponder/ponderFocus.test.ts
// When a caption is on screen, and whether the focus frame travels, appears or hides. Nobody can
// tell these apart by looking at one still; a wrong rule shows as a frame left on a part nothing
// is said about, or as two captions in the one place.

const plan = (steps: PonderStep[]) => compilePonderScene({ id: 'focus', titleKey: 'x', anchors: {}, steps });

const caption = (id: string, durationMs: number, anchor?: string): PonderStep => ({
    kind: 'caption', id, textKey: 'x', durationMs, ...(anchor ? { pointTo: { anchor } } : {}),
});

describe('captionWindows', () => {
    it('a caption leaves when the next one starts, and the last one stays', () => {
        const windows = captionWindows(plan([caption('a', 5000, 'bar'), caption('b', 3000), { kind: 'pause', id: 'p', dwellMs: 9000 }]));

        expect(windows).toEqual([
            { id: 'a', atMs: 0, endMs: 5000, anchor: 'bar', stays: false },
            { id: 'b', atMs: 5000, endMs: 8000, anchor: undefined, stays: true },
        ]);
    });

    it('a caption that runs beside an action is cut where the next caption starts', () => {
        const windows = captionWindows(plan([
            { kind: 'highlight', id: 'h', anchor: 'bar', durationMs: 400 },
            { ...caption('a', 6000, 'bar'), withPrevious: true },
            caption('b', 2000, 'queue'),
        ]));

        expect(windows.map(window => [window.atMs, window.endMs])).toEqual([[0, 400], [400, 2400]]);
    });
});

describe('focusBeats', () => {
    const everyAnchor = () => true;

    it('travels to the next anchor when its caption follows at once', () => {
        const beats = focusBeats(captionWindows(plan([caption('a', 1000, 'bar'), caption('b', 1000, 'queue')])), everyAnchor, 200);

        expect(beats).toEqual([
            { anchor: 'bar', atMs: 0, from: null, hideAtMs: null },
            { anchor: 'queue', atMs: 1000, from: 'bar', hideAtMs: null },
        ]);
    });

    it('hides when a caption ends with nothing to go to, and appears again later', () => {
        const beats = focusBeats(captionWindows(plan([
            caption('a', 1000, 'bar'),
            { kind: 'pause', id: 'p', dwellMs: 500 },
            caption('b', 1000, 'queue'),
        ])), everyAnchor, 200);

        expect(beats).toEqual([
            { anchor: 'bar', atMs: 0, from: null, hideAtMs: 800 },
            { anchor: 'queue', atMs: 1500, from: null, hideAtMs: null },
        ]);
    });

    it('hides under a caption that points to nothing, and skips an anchor that has no rectangle', () => {
        const windows = captionWindows(plan([caption('a', 1000, 'bar'), caption('b', 1000), caption('c', 1000, 'gone'), caption('d', 1000, 'queue')]));
        const beats = focusBeats(windows, anchor => anchor !== 'gone', 200);

        expect(beats).toEqual([
            { anchor: 'bar', atMs: 0, from: null, hideAtMs: 800 },
            { anchor: 'queue', atMs: 3000, from: null, hideAtMs: null },
        ]);
    });
});

describe('focusFrameBox', () => {
    it('stands five pixels off the anchor and grows its corner by as much', () => {
        expect(focusFrameBox({ left: 100, top: 50, width: 200, height: 80, radius: '12px' }))
            .toEqual({ left: 95, top: 45, width: 210, height: 90, radius: 17 });
    });

    it('a pill and a circle stay round; an anchor without a radius gets the default corner', () => {
        expect(focusFrameBox({ left: 0, top: 0, width: 300, height: 40, radius: '9999px' }).radius).toBe(25);
        expect(focusFrameBox({ left: 0, top: 0, width: 36, height: 36, radius: '50%' }).radius).toBe(23);
        expect(focusFrameBox({ left: 0, top: 0, width: 300, height: 40 }).radius).toBe(13);
    });
});
