import { describe, expect, it } from 'vitest';
import { nextShownLayers, startedLayers, type ShownLayer } from '@/components/visualizer/styleTransition/layerTransition';
import { shownBackgroundMode } from '@/components/visualizer/styleTransition/VisualizerBackgroundTransition';
import type { VisualizerBackgroundConfig } from '@/components/visualizer/backgrounds/definition';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '@/components/visualizer/backgrounds/registry';
import type { VisualizerMode } from '@/types';

// test/unit/visualizer/styleTransitionLayers.test.ts
// Which lyric styles (and, by the same rule, backgrounds) are mounted during and after a change. Each
// can hold a WebGL context, so a change never leaves more than two, quick changes end on the last one,
// and the cut leaves one. A change can wait to start (a style switch, for the new style's first frame):
// the one on screen stays the one leaving, and a new change while it waits replaces the waiting one.
// A background counts as changed only when another type, or none, is drawn.

const mode = (name: string) => name as VisualizerMode;
const first: readonly ShownLayer<VisualizerMode>[] = [{ key: 0, value: mode('classic'), leaving: false, comesIn: false, waits: false }];
const modes = (styles: readonly ShownLayer<VisualizerMode>[]) => styles.map(style => `${style.value}${style.leaving ? ' (leaving)' : ''}`);
// What the layer does when a leaving style's animation ends.
const left = (styles: readonly ShownLayer<VisualizerMode>[]) => styles.filter(style => !style.leaving);

describe('style transition layers', () => {
    it('keeps the same list while the style does not change', () => {
        expect(nextShownLayers(first, mode('classic'), true, false)).toBe(first);
        expect(nextShownLayers(first, mode('classic'), false, false)).toBe(first);
    });

    it('lets the style on screen leave under the new one, which comes in', () => {
        const switched = nextShownLayers(first, mode('diorama'), true, false);
        expect(modes(switched)).toEqual(['classic (leaving)', 'diorama']);
        expect(switched[0].key).toBe(0);
        expect(switched[1].comesIn).toBe(true);
        expect(modes(left(switched))).toEqual(['diorama']);
    });

    it('ends on the last style when switched again mid-way, never more than two mounted', () => {
        const toB = nextShownLayers(first, mode('diorama'), true, false);
        const toC = nextShownLayers(toB, mode('lumiere'), true, false);
        expect(modes(toC)).toEqual(['diorama (leaving)', 'lumiere']);
        expect(toC[0].key).toBe(toB[1].key);
        const backToA = nextShownLayers(toC, mode('classic'), true, false);
        expect(modes(backToA)).toEqual(['lumiere (leaving)', 'classic']);
        expect(new Set(backToA.map(style => style.key)).size).toBe(2);
        expect(modes(left(backToA))).toEqual(['classic']);
    });

    it('ends a change called back while the new one comes in: the one leaving stays, the new one leaves over it', () => {
        const toB = nextShownLayers(first, mode('diorama'), true, false);
        const back = nextShownLayers(toB, mode('classic'), true, true);
        expect(modes(back)).toEqual(['classic', 'diorama (leaving)']);
        expect(back.map(style => style.key)).toEqual([0, 1]);
        expect(back.map(style => style.waits)).toEqual([false, false]);
        expect(modes(left(back))).toEqual(['classic']);
        expect(nextShownLayers(back, mode('classic'), true, true)).toBe(back);
        const again = nextShownLayers(back, mode('diorama'), true, true);
        expect(modes(again)).toEqual(['classic (leaving)', 'diorama']);
        expect(again.map(style => style.key)).toEqual([0, 2]);
        expect(modes(nextShownLayers(back, mode('lumiere'), true, true))).toEqual(['classic (leaving)', 'lumiere']);
    });

    it('cuts to the new style without a transition, and ends one still playing when they are turned off', () => {
        const cut = nextShownLayers(first, mode('diorama'), false, false);
        expect(modes(cut)).toEqual(['diorama']);
        expect(cut[0].comesIn).toBe(false);
        const playing = nextShownLayers(first, mode('diorama'), true, false);
        expect(modes(nextShownLayers(playing, mode('diorama'), false, false))).toEqual(['diorama']);
    });
});

describe('a change that waits to start', () => {
    const waiting = (styles: readonly ShownLayer<VisualizerMode>[]) => styles.map(style => style.waits);

    it('waits whole: the style on screen does not leave yet, the new one does not come in yet', () => {
        const switched = nextShownLayers(first, mode('sonnet'), true, true);
        expect(modes(switched)).toEqual(['classic (leaving)', 'sonnet']);
        expect(waiting(switched)).toEqual([true, true]);
        expect(nextShownLayers(switched, mode('sonnet'), true, true)).toBe(switched);
    });

    it('starts when the new style says so, not when the one leaving does', () => {
        const switched = nextShownLayers(first, mode('sonnet'), true, true);
        expect(startedLayers(switched, switched[0].key)).toBe(switched);
        const playing = startedLayers(switched, switched[1].key);
        expect(waiting(playing)).toEqual([false, false]);
        expect(modes(playing)).toEqual(['classic (leaving)', 'sonnet']);
        expect(startedLayers(playing, playing[1].key)).toBe(playing);
    });

    it('starts when the switch it rides with no longer waits (a background change)', () => {
        const switched = nextShownLayers(first, mode('sonnet'), true, true);
        expect(waiting(nextShownLayers(switched, mode('sonnet'), true, false))).toEqual([false, false]);
    });

    it('is replaced by a switch made while it waits: the style on screen stays the one leaving', () => {
        const toB = nextShownLayers(first, mode('sonnet'), true, true);
        const toC = nextShownLayers(toB, mode('fume'), true, true);
        expect(modes(toC)).toEqual(['classic (leaving)', 'fume']);
        expect(toC[0].key).toBe(0);
        expect(toC[1].key).toBeGreaterThan(toB[1].key);
        expect(waiting(toC)).toEqual([true, true]);
    });

    it('ends when switched back to the style on screen while it waits', () => {
        const toB = nextShownLayers(first, mode('sonnet'), true, true);
        expect(nextShownLayers(toB, mode('classic'), true, true)).toEqual(first);
    });

    it('lets one called away while coming in leave once the next change starts', () => {
        const playing = startedLayers(nextShownLayers(first, mode('sonnet'), true, true), 1);
        const toC = nextShownLayers(playing, mode('fume'), true, true);
        expect(modes(toC)).toEqual(['sonnet (leaving)', 'fume']);
        expect(waiting(toC)).toEqual([true, true]);
    });

    it('cuts to the new style when transitions are turned off while it waits', () => {
        const switched = nextShownLayers(first, mode('sonnet'), true, true);
        const cut = nextShownLayers(switched, mode('sonnet'), false, false);
        expect(modes(cut)).toEqual(['sonnet']);
        expect(waiting(cut)).toEqual([false]);
    });
});

describe('which background a backdrop draws', () => {
    const common = (patch: Partial<VisualizerBackgroundConfig> = {}): VisualizerBackgroundConfig => ({
        mode: 'common',
        common: { opacity: 0.75, disableGeometricBackground: false },
        ...patch,
    });

    it('is the background type, the default one when none is set', () => {
        expect(shownBackgroundMode(common(), true)).toBe('common');
        expect(shownBackgroundMode(common({ mode: null }), true)).toBe(DEFAULT_VISUALIZER_BACKGROUND_MODE);
        expect(shownBackgroundMode(undefined, true)).toBe(DEFAULT_VISUALIZER_BACKGROUND_MODE);
    });

    it('does not change with a setting inside the type, so the background redraws in place', () => {
        expect(shownBackgroundMode(common({ common: { opacity: 0.3, disableGeometricBackground: true } }), true)).toBe('common');
    });

    it('is none over a style without a background and on a transparent player page', () => {
        expect(shownBackgroundMode(common(), false)).toBeNull();
        expect(shownBackgroundMode(common({ transparent: true }), true)).toBeNull();
    });
});
