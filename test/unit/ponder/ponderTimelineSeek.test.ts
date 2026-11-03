import { describe, expect, it } from 'vitest';
import { createTimeline } from 'animejs';
import { seekPonderTimeline } from '@/components/ponder/ponderTimelineSeek';

// test/unit/ponder/ponderTimelineSeek.test.ts
// A jump back in a lesson must show what playing from the start to that time shows. The chapter
// below is built from the tween shapes usePonderTimeline adds (captions, the focus frame and its
// name tags, the cursor, a key chip, a highlight, a result layer over its base), on plain objects:
// no DOM is needed to see which values the library writes. Every object starts at the from-value
// of its first tween, the way a node is hidden before its first tween.

const build = () => {
    const state = {
        c1: { opacity: 0, y: 6 }, c2: { opacity: 0, y: 6 }, c3: { opacity: 0, y: 6 }, c4: { opacity: 0, y: 6 },
        frame: { x: 10, opacity: 0, scale: 1.04 },
        tagA: { opacity: 0 }, tagB: { opacity: 0 }, tagC: { opacity: 0 },
        cursor: { x: 0 },
        chip: { opacity: 0, scale: 0.82 },
        highlight: { opacity: 0 },
        base: { opacity: 1 }, result: { opacity: 0 },
    };
    const timeline = createTimeline({ autoplay: false, defaults: { ease: 'linear' } });
    // Captions: each fades in with its own from-value and leaves with none, the last one stays.
    ([['c1', 0], ['c2', 2000], ['c3', 4000], ['c4', 6000]] as const).forEach(([id, atMs], index) => {
        timeline.add(state[id], { opacity: [0, 1], y: [6, 0], duration: 280 }, atMs);
        if (index < 3) timeline.add(state[id], { opacity: 0, y: -4, duration: 120 }, atMs + 1880);
    });
    // The focus frame: appears on A, travels to B, hides while caption 3 points at nothing, appears on C.
    timeline.add(state.frame, { x: [10, 10], opacity: [0, 1], scale: [1.04, 1], duration: 280 }, 0);
    timeline.add(state.tagA, { opacity: [0, 1], duration: 200 }, 0);
    timeline.add(state.frame, { x: [10, 50], duration: 420 }, 2000);
    timeline.add(state.tagA, { opacity: [1, 0], duration: 120 }, 2000);
    timeline.add(state.tagB, { opacity: [0, 1], duration: 200 }, 2000);
    timeline.add(state.frame, { opacity: [1, 0], duration: 200 }, 3800);
    timeline.add(state.tagB, { opacity: [1, 0], duration: 200 }, 3800);
    timeline.add(state.frame, { x: [90, 90], opacity: [0, 1], scale: [1.04, 1], duration: 280 }, 6000);
    timeline.add(state.tagC, { opacity: [0, 1], duration: 200 }, 6000);
    // The cursor: one move with a from-value, one without.
    timeline.add(state.cursor, { x: [0, 100], duration: 500 }, 1000);
    timeline.add(state.cursor, { x: 200, duration: 500 }, 5000);
    timeline.add(state.chip, { opacity: [0, 1], scale: [0.82, 1], duration: 200 }, 2500);
    timeline.add(state.chip, { opacity: 0, duration: 120 }, 2900);
    timeline.add(state.highlight, { opacity: [0, 0.5], duration: 600 }, 4200);
    timeline.add(state.highlight, { opacity: [0.5, 0.2], duration: 400 }, 6500);
    timeline.add(state.result, { opacity: [0, 1], duration: 300 }, 4500);
    timeline.add(state.base, { opacity: [1, 0], duration: 300 }, 4500);
    // A pause to the chapter's end at 8000.
    timeline.add({ duration: 100 }, 7900);
    return { timeline, state };
};

const snapshot = (state: ReturnType<typeof build>['state']) => JSON.parse(
    JSON.stringify(state, (_key, value) => (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value)),
);

/** What a play from the start shows at this time. */
const playedTo = (atMs: number) => {
    const { timeline, state } = build();
    timeline.seek(atMs, true);
    return snapshot(state);
};

describe('seekPonderTimeline', () => {
    it.each([
        ['frame on B, back into caption 1', 3000, 1000],
        ['frame hidden, back into caption 2', 5000, 3000],
        ['frame on C, back into caption 2', 7000, 3000],
        ['frame on C, back to the start of caption 2', 7000, 2000],
        ['chapter at its end, back into caption 1', 8000, 1000],
        ['chapter at its end, back into caption 3', 8000, 4600],
        ['back to the start', 7000, 0],
    ])('%s: a jump back shows what a play to that time shows', (_name, fromMs, toMs) => {
        const { timeline, state } = build();
        timeline.seek(fromMs, true);
        seekPonderTimeline(timeline, toMs);
        expect(snapshot(state)).toEqual(playedTo(toMs));
    });

    // The stop is a few ms before the next action, the frame that noticed it a few ms after.
    it.each([1990, 3790, 4490, 5990])('one frame past a stop at %i ms, pulled back: the next action has not begun', stopMs => {
        const { timeline, state } = build();
        timeline.seek(stopMs + 16, true);
        seekPonderTimeline(timeline, stopMs);
        expect(snapshot(state)).toEqual(playedTo(stopMs));
    });

    it('plays on correctly after a jump back', () => {
        const { timeline, state } = build();
        timeline.seek(7000, true);
        seekPonderTimeline(timeline, 1000);
        seekPonderTimeline(timeline, 5200);
        expect(snapshot(state)).toEqual(playedTo(5200));
    });
});
