import { describe, expect, it, vi } from 'vitest';
import { getBackgroundTunings, getVisualizerTuning } from '@/components/visualizer/tuningRegistry';
import {
    createSaveGate,
    draftTarget,
    shownTuning,
    styleDraftTarget,
    withChange,
    withoutDraft,
    type TuningDrafts,
} from '@/components/visualizer/window/tuningDraft';
import { DEFAULT_CLASSIC_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, type PartitaTuning } from '@/types';

// test/unit/visualizer/tuningDraft.test.ts
// The one draft of the lyric style window. None of this shows as an error when it is wrong: a
// slider would save to the wrong style, save twice, or the sample would go on showing a value that
// was never saved.

const NO_DRAFTS: TuningDrafts = {};
const partitaMerge = getVisualizerTuning('partita')!.storage!.merge as (held: PartitaTuning, patch: Partial<PartitaTuning>) => PartitaTuning;

describe('what the window shows for a tuning', () => {
    it('is what is saved while nothing was changed', () => {
        expect(shownTuning(NO_DRAFTS, 'style:partita', DEFAULT_PARTITA_TUNING)).toBe(DEFAULT_PARTITA_TUNING);
    });

    it('is the change laid onto what is saved by the tuning\'s own merge', () => {
        const saved: PartitaTuning = { ...DEFAULT_PARTITA_TUNING, staggerMin: 40, staggerMax: 150 };
        // A lower end sent alone, above the upper one: the declared merge puts the smaller one
        // first. This is not what a drag past the other end gives: Partita's sliders send both
        // ends, the other one taken along (PartitaSettingsPanel), so both follow the pointer.
        const drafts = withChange(NO_DRAFTS, 'style:partita', saved, { staggerMin: 170 }, partitaMerge);
        expect(shownTuning(drafts, 'style:partita', saved)).toEqual({ ...saved, staggerMin: 150, staggerMax: 170 });
        // What is shown is what a save of the change gives.
        expect(shownTuning(drafts, 'style:partita', saved)).toEqual(partitaMerge(saved, { staggerMin: 170 }));
    });

    it('adds up the changes made over the same saved tuning, and stays the same object between changes', () => {
        const saved: PartitaTuning = { ...DEFAULT_PARTITA_TUNING, staggerMin: 40, staggerMax: 150 };
        let drafts = withChange(NO_DRAFTS, 'style:partita', saved, { staggerMin: 60 }, partitaMerge);
        drafts = withChange(drafts, 'style:partita', saved, { staggerMin: 80 }, partitaMerge);
        drafts = withChange(drafts, 'style:partita', saved, { showGuideLines: !saved.showGuideLines }, partitaMerge);
        const shown = shownTuning(drafts, 'style:partita', saved);
        expect(shown).toEqual({ ...saved, staggerMin: 80, showGuideLines: !saved.showGuideLines });
        expect(shownTuning(drafts, 'style:partita', saved)).toBe(shown);
    });

    it('is what is saved again once another tuning is saved, and a new change starts from that one', () => {
        const saved: PartitaTuning = { ...DEFAULT_PARTITA_TUNING, staggerMin: 40, staggerMax: 150 };
        const drafts = withChange(NO_DRAFTS, 'style:partita', saved, { staggerMin: 60 }, partitaMerge);
        const savedNow: PartitaTuning = { ...saved, staggerMin: 55 };
        expect(shownTuning(drafts, 'style:partita', savedNow)).toBe(savedNow);
        const next = withChange(drafts, 'style:partita', savedNow, { staggerMax: 100 }, partitaMerge);
        expect(shownTuning(next, 'style:partita', savedNow)).toEqual({ ...savedNow, staggerMax: 100 });
    });

    it('keeps the drafts of two tunings apart, and drops one without the other', () => {
        const merge = (held: { value: number }, patch: Partial<{ value: number }>) => ({ ...held, ...patch });
        const one = { value: 1 };
        const two = { value: 2 };
        let drafts = withChange(NO_DRAFTS, 'style:one', one, { value: 10 }, merge);
        drafts = withChange(drafts, 'background:one', two, { value: 20 }, merge);
        expect(shownTuning(drafts, 'style:one', one)).toEqual({ value: 10 });
        expect(shownTuning(drafts, 'background:one', two)).toEqual({ value: 20 });
        drafts = withoutDraft(drafts, 'style:one');
        expect(shownTuning(drafts, 'style:one', one)).toBe(one);
        expect(shownTuning(drafts, 'background:one', two)).toEqual({ value: 20 });
        expect(withoutDraft(drafts, 'style:none')).toBe(drafts);
    });
});

describe('when a change is saved', () => {
    it('at once while no slider is held', () => {
        const gate = createSaveGate();
        const save = vi.fn();
        gate.save('opacity', save);
        expect(save).toHaveBeenCalledTimes(1);
        // A release with no hold before it saves nothing more.
        gate.release();
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('once, on the release, with the value the slider ended on', () => {
        const gate = createSaveGate();
        const saved: number[] = [];
        gate.hold();
        expect(gate.isHeld()).toBe(true);
        [0.2, 0.4, 0.6].forEach(value => gate.save('opacity', () => saved.push(value)));
        expect(saved).toEqual([]);
        gate.release();
        expect(saved).toEqual([0.6]);
        expect(gate.isHeld()).toBe(false);
        // The release is told a second time (the pointer event, then the slider leaving the page).
        gate.release();
        expect(saved).toEqual([0.6]);
        // The next slider is pressed and let go without moving: the last drag's value is not saved again.
        gate.hold();
        gate.release();
        expect(saved).toEqual([0.6]);
    });

    it('to the style the slider was dragged for, also when another style is chosen before the release', () => {
        const gate = createSaveGate();
        const classicSave = vi.fn();
        const partitaSave = vi.fn();
        const settings = {
            classicTuning: DEFAULT_CLASSIC_TUNING, handleSetClassicTuning: classicSave, handleResetClassicTuning: vi.fn(),
            partitaTuning: DEFAULT_PARTITA_TUNING, handleSetPartitaTuning: partitaSave, handleResetPartitaTuning: vi.fn(),
        };
        const classic = styleDraftTarget('classic', settings)!;
        gate.hold();
        gate.save(`${classic.key}/wordSpacing`, () => classic.save({ wordSpacing: 1.2 }));
        // The shelf now shows partita, and one of its controls is changed before the held slider is let go.
        const partita = styleDraftTarget('partita', settings)!;
        expect(partita.key).not.toBe(classic.key);
        gate.save(`${partita.key}/showGuideLines`, () => partita.save({ showGuideLines: false }));
        expect(classicSave).not.toHaveBeenCalled();
        gate.release();
        expect(classicSave).toHaveBeenCalledTimes(1);
        expect(classicSave).toHaveBeenCalledWith({ wordSpacing: 1.2 });
        expect(partitaSave).toHaveBeenCalledTimes(1);
        expect(partitaSave).toHaveBeenCalledWith({ showGuideLines: false });
    });

    it('everything changed while a slider is held, each with its last value, in the order of its latest change', () => {
        const gate = createSaveGate();
        const saved: string[] = [];
        gate.hold();
        gate.save('style:classic/wordSpacing', () => saved.push('spacing 1.1'));
        gate.save('style:classic/enableWordRotation', () => saved.push('rotation off'));
        gate.save('fontScale', () => saved.push('font 1.3'));
        gate.save('style:classic/wordSpacing', () => saved.push('spacing 1.2'));
        gate.release();
        expect(saved).toEqual(['rotation off', 'font 1.3', 'spacing 1.2']);
    });

    it('a field changed alone after a change that set it with another: the value it ended on is the one stored', () => {
        const gate = createSaveGate();
        const stored: Record<string, unknown> = {};
        const save = (patch: object) => () => Object.assign(stored, patch);
        gate.hold();
        gate.save('style:classic/wordSpacing', save({ wordSpacing: 1.1 }));
        gate.save('style:classic/wordSpacing+enableWordRotation', save({ wordSpacing: 1.5, enableWordRotation: false }));
        gate.save('style:classic/wordSpacing', save({ wordSpacing: 1.2 }));
        gate.release();
        expect(stored).toEqual({ wordSpacing: 1.2, enableWordRotation: false });
    });

    it('a save that throws does not keep the others from being saved, and is thrown again after them', () => {
        const gate = createSaveGate();
        const saved: string[] = [];
        gate.hold();
        gate.save('style:classic/wordSpacing', () => {
            throw new Error('storage is full');
        });
        gate.save('fontScale', () => saved.push('font 1.3'));
        expect(() => gate.release()).toThrow('storage is full');
        expect(saved).toEqual(['font 1.3']);
        // Nothing of that release is left to be saved a second time.
        gate.hold();
        gate.release();
        expect(saved).toEqual(['font 1.3']);
    });

    it('nothing of a tuning that was reset while the slider was held, and the rest as before', () => {
        const gate = createSaveGate();
        const saved: string[] = [];
        gate.hold();
        gate.save('style:classic/wordSpacing', () => saved.push('classic spacing'));
        gate.save('style:classical/wordSpacing', () => saved.push('another style'));
        gate.save('fontScale', () => saved.push('font 1.3'));
        gate.forget('style:classic/');
        gate.release();
        expect(saved).toEqual(['another style', 'font 1.3']);
    });

    it('nothing where a held slider never moved', () => {
        const gate = createSaveGate();
        const earlier = vi.fn();
        gate.save('opacity', earlier);
        gate.hold();
        gate.release();
        // The press and the release saved nothing: what was saved before is not saved again.
        expect(earlier).toHaveBeenCalledTimes(1);
        expect(gate.isHeld()).toBe(false);
    });
});

describe('which tuning a style or a background brings to the window', () => {
    it('a style with a stored tuning: its saved tuning, its declared merge and the store\'s two actions', () => {
        const set = vi.fn();
        const reset = vi.fn();
        const target = styleDraftTarget('partita', { partitaTuning: DEFAULT_PARTITA_TUNING, handleSetPartitaTuning: set, handleResetPartitaTuning: reset })!;
        expect(target.key).toBe('style:partita');
        expect(target.saved).toBe(DEFAULT_PARTITA_TUNING);
        expect(target.merge).toBe(getVisualizerTuning('partita')!.storage!.merge);
        target.save({ staggerMin: 10 });
        target.reset();
        expect(set).toHaveBeenCalledWith({ staggerMin: 10 });
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it('none for a mod\'s style and for a style without settings: the window shows no tuning and saves nothing', () => {
        expect(styleDraftTarget('mod:someone:style', {})).toBeNull();
        expect(styleDraftTarget('still', {})).toBeNull();
    });

    it('a background: under a key of its own, apart from the style of the same name', () => {
        const nomand = getBackgroundTunings().find(tuning => tuning.mode === 'nomand')!;
        const monet = getBackgroundTunings().find(tuning => tuning.mode === 'monet')!;
        const set = vi.fn();
        const target = draftTarget(`background:${nomand.mode}`, nomand, {
            nomandBackgroundTuning: DEFAULT_NOMAND_BACKGROUND_TUNING, handleSetNomandBackgroundTuning: set, handleResetNomandBackgroundTuning: vi.fn(),
        });
        expect(target.saved).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING);
        target.save({ size: 5 });
        expect(set).toHaveBeenCalledWith({ size: 5 });
        // 莫奈 is a lyric style and a background: two tunings, two store fields.
        expect(monet.settingsKey).not.toBe(getVisualizerTuning('monet')!.settingsKey);
    });
});
