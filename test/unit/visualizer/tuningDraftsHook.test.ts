// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useTuningDrafts } from '@/components/visualizer/window/useTuningDrafts';
import { DEFAULT_CLASSIC_TUNING, type ClassicTuning } from '@/types';

// test/unit/visualizer/tuningDraftsHook.test.ts
// The lyric style window's drafts as the window uses them: what a style's controls are shown,
// and what reaches the store's save action, around a held slider. Where this goes wrong the
// window shows a value that was never saved, or a change made while a slider is held is lost.

// The saved tunings of the sample are the settings store's; these cases need none.
vi.mock('@/components/visualizer/useVisualizerTunings', () => ({ useVisualizerTunings: () => ({}) }));

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let drafts: ReturnType<typeof useTuningDrafts>;

const Probe: React.FC<{ settings: Record<string, unknown> }> = ({ settings }) => {
    drafts = useTuningDrafts(settings);
    return null;
};

/** The window over a store whose classic tuning is `saved`; `save` and `reset` are the store's actions. */
const draw = async (saved: ClassicTuning, save: (patch: object) => void, reset: () => void = () => {}) => {
    root ??= createRoot(document.createElement('div'));
    await act(async () => {
        root!.render(React.createElement(Probe, {
            settings: { classicTuning: saved, handleSetClassicTuning: save, handleResetClassicTuning: reset },
        }));
    });
};
const classic = () => drafts.styleDraft('classic');

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
});

describe('the drafts of the lyric style window', () => {
    it('show what is saved once a change was saved', async () => {
        const save = vi.fn();
        await draw(DEFAULT_CLASSIC_TUNING, save);
        await act(async () => classic().change({ wordSpacing: 1.3 }));
        expect(save).toHaveBeenCalledWith({ wordSpacing: 1.3 });
        // The store did not take the change (or took it and was put back to these defaults from
        // elsewhere): the window shows what the store holds, not the draft that was saved.
        await draw(DEFAULT_CLASSIC_TUNING, save);
        expect(classic().tuning).toBe(DEFAULT_CLASSIC_TUNING);
    });

    it('show a held slider\'s value and save it once, on the release', async () => {
        const save = vi.fn();
        await draw(DEFAULT_CLASSIC_TUNING, save);
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.1 }));
        await act(async () => classic().change({ wordSpacing: 1.2 }));
        expect(classic().tuning).toEqual({ ...DEFAULT_CLASSIC_TUNING, wordSpacing: 1.2 });
        expect(save).not.toHaveBeenCalled();
        await act(async () => drafts.onSliderCommit());
        expect(save.mock.calls).toEqual([[{ wordSpacing: 1.2 }]]);
    });

    it('save another control changed while a slider is held as well as the slider', async () => {
        const save = vi.fn();
        await draw(DEFAULT_CLASSIC_TUNING, save);
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.2 }));
        await act(async () => classic().change({ enableWordRotation: false }));
        expect(classic().tuning).toEqual({ ...DEFAULT_CLASSIC_TUNING, wordSpacing: 1.2, enableWordRotation: false });
        await act(async () => drafts.onSliderCommit());
        expect(save.mock.calls).toEqual([[{ wordSpacing: 1.2 }], [{ enableWordRotation: false }]]);
    });

    it('do not undo a reset pressed while a slider is held when the slider is let go', async () => {
        const save = vi.fn();
        const reset = vi.fn();
        await draw(DEFAULT_CLASSIC_TUNING, save, reset);
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.2 }));
        await act(async () => classic().change({ enableWordRotation: false }));
        await act(async () => classic().reset?.());
        expect(classic().tuning).toBe(DEFAULT_CLASSIC_TUNING);
        await act(async () => drafts.onSliderCommit());
        expect(reset).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        // What the held slider is moved to after the reset is the person's newest word: it is saved.
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.4 }));
        await act(async () => drafts.onSliderCommit());
        expect(save.mock.calls).toEqual([[{ wordSpacing: 1.4 }]]);
    });

    it('show what is stored again when a save throws', async () => {
        const save = vi.fn(() => {
            throw new Error('storage is full');
        });
        await draw(DEFAULT_CLASSIC_TUNING, save);
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.2 }));
        expect(classic().tuning).toEqual({ ...DEFAULT_CLASSIC_TUNING, wordSpacing: 1.2 });
        let thrown: unknown;
        await act(async () => {
            try {
                drafts.onSliderCommit();
            } catch (error) {
                thrown = error;
            }
        });
        expect(String(thrown)).toContain('storage is full');
        expect(classic().tuning).toBe(DEFAULT_CLASSIC_TUNING);
    });

    it('save what waited when the window closes while a slider is held', async () => {
        const save = vi.fn();
        await draw(DEFAULT_CLASSIC_TUNING, save);
        await act(async () => drafts.onSliderPointerDown());
        await act(async () => classic().change({ wordSpacing: 1.2 }));
        await act(async () => classic().change({ enableWordRotation: false }));
        await act(async () => root?.unmount());
        root = null;
        expect(save.mock.calls).toEqual([[{ wordSpacing: 1.2 }], [{ enableWordRotation: false }]]);
    });
});
