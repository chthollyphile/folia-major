import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisualizerBackgroundActions, VisualizerBackgroundConfig } from '../backgrounds/definition';
import {
    backgroundTuningActions,
    backgroundTuningConfig,
    getBackgroundTunings,
    getVisualizerTuning,
    type VisualizerTuningBundle,
} from '../tuningRegistry';
import { useVisualizerTunings } from '../useVisualizerTunings';
import { createSaveGate, draftTarget, shownTuning, styleDraftTarget, withChange, withoutDraft, type DraftTarget, type SaveGate, type TuningDrafts } from './tuningDraft';

// src/components/visualizer/window/useTuningDrafts.ts
// The lyric style window's one draft for every tuning it edits: the lyric styles' and the
// backgrounds', found through their declarations (tuning.ts) and held under a key each. The
// window and its column ask it for a style's tuning, change and reset by the style's id; nothing
// here, and nothing that calls it, names a style or a background.

type Fields = Record<string, unknown>;

export interface StyleDraft {
    /** The style's tuning as the window shows it; undefined for a style without a stored tuning. */
    tuning: unknown;
    change: (patch: object) => void;
    /** Puts the style's tuning back to its defaults; undefined where there is nothing to reset. */
    reset?: () => void;
}

/**
 * `settings` is the settings store's fields (selectVisualizerSettingsSnapshot): the tunings as
 * they are saved and the actions that save them.
 */
export const useTuningDrafts = (settings: Fields) => {
    const [drafts, setDrafts] = useState<TuningDrafts>({});
    const gateRef = useRef<SaveGate | null>(null);
    gateRef.current ??= createSaveGate();
    const gate = gateRef.current;
    // The window closes while a slider is held: what waited was shown, so it is saved.
    useEffect(() => () => gate.release(), [gate]);
    const savedTunings = useVisualizerTunings() as VisualizerTuningBundle;

    // A change is saved under its tuning and its fields: while a slider is held, a change to
    // another field waits beside the slider's. Once saved, the draft has done its work and goes:
    // what is saved shows, and a tuning that later gets back the object the draft was made over
    // (a reset from elsewhere puts the defaults back) does not show the old draft again. It goes
    // too when the save throws: the window then shows what is stored, not a value that is not.
    const change = (target: DraftTarget, patch: object) => {
        setDrafts(before => withChange(before, target.key, target.saved, patch, target.merge));
        gate.save(`${target.key}/${Object.keys(patch).join('+')}`, () => {
            try {
                target.save(patch);
            } finally {
                setDrafts(before => withoutDraft(before, target.key));
            }
        });
    };
    // A reset also drops what waits for that tuning: let go after it, a held slider saves nothing
    // over the defaults.
    const reset = (target: DraftTarget) => {
        setDrafts(before => withoutDraft(before, target.key));
        gate.forget(`${target.key}/`);
        target.reset();
    };

    // What the sample draws: the saved tunings, with a draft where one is live. With none live it
    // is the saved bundle itself, and a tuning that has no draft is always the saved object:
    // renderers key their layout on which object they are given.
    const sampleTunings = useMemo(() => {
        let bundle: Fields | null = null;
        for (const [mode, saved] of Object.entries(savedTunings)) {
            const shown = shownTuning(drafts, `style:${mode}`, saved);
            if (shown !== saved) {
                bundle ??= { ...savedTunings };
                bundle[mode] = getVisualizerTuning(mode)?.preview?.(shown, saved) ?? shown;
            }
        }
        return (bundle ?? savedTunings) as VisualizerTuningBundle;
    }, [drafts, savedTunings]);

    const styleDraft = (mode: string): StyleDraft => {
        const target = styleDraftTarget(mode, settings);
        return target
            ? {
                tuning: shownTuning(drafts, target.key, target.saved),
                change: patch => change(target, patch),
                reset: () => reset(target),
            }
            : { tuning: undefined, change: () => {} };
    };

    // The backgrounds' tunings and their actions, in the shape the background config and actions
    // carry them, with the drafts in the tunings' place.
    const shownFields: Fields = {};
    const draftActions: Fields = {};
    getBackgroundTunings().forEach((tuning) => {
        const target = draftTarget(`background:${tuning.mode}`, tuning, settings);
        shownFields[tuning.settingsKey] = shownTuning(drafts, target.key, target.saved);
        draftActions[tuning.settingsSetterKey] = (patch: object) => change(target, patch);
        draftActions[tuning.settingsResetterKey] = () => reset(target);
    });

    return {
        /** Decides when a change is saved; the window's other sliders (opacity, font size) save through it too. */
        gate,
        /** A slider is held: changes are only shown until it is let go. Stable, as the slider rows need it. */
        onSliderPointerDown: useCallback(() => gate.hold(), [gate]),
        /** The slider is let go: what waited is saved. */
        onSliderCommit: useCallback(() => gate.release(), [gate]),
        /** The saved tunings of the lyric styles: what the small pictures draw with. */
        savedTunings,
        sampleTunings,
        styleDraft,
        backgroundConfig: backgroundTuningConfig(shownFields) as Partial<VisualizerBackgroundConfig>,
        backgroundActions: backgroundTuningActions(draftActions) as Partial<VisualizerBackgroundActions>,
    };
};
