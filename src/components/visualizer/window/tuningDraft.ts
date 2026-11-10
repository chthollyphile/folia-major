import type { StoredTuning } from '../tuningDefinition';
import { getVisualizerTuning } from '../tuningRegistry';

// src/components/visualizer/window/tuningDraft.ts
// The lyric style window's drafts, for every tuning it edits (a lyric style's, a background's),
// each under a key of its own. A change is shown at once and saved at once; while a slider is
// held it is only shown, and saved when the slider is let go. Nothing here names a style: a
// tuning is found through its declaration (tuning.ts), which says how a change is laid onto it
// and under which names the settings store holds it and its actions.

type Fields = Record<string, unknown>;

/** One tuning the window edits: what is saved, how a change is laid onto it, and the store's actions. */
export interface DraftTarget {
    key: string;
    saved: unknown;
    merge: (held: unknown, patch: object) => unknown;
    save: (patch: object) => void;
    reset: () => void;
}

/** `settings` is the settings store's fields: the tunings as they are saved and the actions that save them. */
export const draftTarget = (key: string, tuning: StoredTuning, settings: Fields): DraftTarget => ({
    key,
    saved: settings[tuning.settingsKey],
    merge: tuning.storage.merge as DraftTarget['merge'],
    save: settings[tuning.settingsSetterKey] as DraftTarget['save'],
    reset: settings[tuning.settingsResetterKey] as DraftTarget['reset'],
});

/** A lyric style's stored tuning; none for a style that declares no storage (a mod's style keeps its own settings). */
export const styleDraftTarget = (mode: string, settings: Fields): DraftTarget | null => {
    const tuning = getVisualizerTuning(mode);
    return tuning?.storage && tuning.settingsResetterKey
        ? draftTarget(`style:${mode}`, tuning as StoredTuning, settings)
        : null;
};

/** What the window shows for one tuning instead of what is saved. */
interface TuningDraft {
    /** The saved tuning the draft was made over: once another one is saved, the draft is over. */
    base: unknown;
    /** The changes made over `base`, added up. */
    patch: object;
    /** `patch` merged onto `base`, kept so that the same draft is always the same object. */
    value: unknown;
}

export type TuningDrafts = Readonly<Record<string, TuningDraft>>;

/** The tuning the window shows for `key`: its draft while what is saved is still what the draft was made over, else what is saved. */
export const shownTuning = <T,>(drafts: TuningDrafts, key: string, saved: T): T => {
    const draft = drafts[key];
    return draft && draft.base === saved ? draft.value as T : saved;
};

/**
 * The drafts after a change to `key`. Changes made over the same saved tuning add up (the many
 * values a held slider passes are one change to one field), and the draft shows them merged onto
 * what is saved by the tuning's own merge, so the draft is what a save of them will give.
 */
export const withChange = <T,>(
    drafts: TuningDrafts,
    key: string,
    saved: T,
    patch: Partial<T>,
    merge: (held: T, patch: Partial<T>) => T,
): TuningDrafts => {
    const before = drafts[key];
    const all = (before && before.base === saved ? { ...before.patch, ...patch } : patch) as Partial<T>;
    return { ...drafts, [key]: { base: saved, patch: all, value: merge(saved, all) } };
};

/** The drafts without the one of `key`: what is saved shows again. */
export const withoutDraft = (drafts: TuningDrafts, key: string): TuningDrafts => {
    if (!(key in drafts)) return drafts;
    const { [key]: _dropped, ...rest } = drafts;
    return rest;
};

/**
 * Decides when a change is saved. With no slider held, at once. While one is held, the save waits
 * for the release, and of each thing that is saved only the latest save is kept: a drag saves
 * once, the value it ended on, and to whatever it was dragged for, also when something else is
 * chosen or changed before the release. `what` names the thing saved (a setting, or the fields of
 * one tuning): a save waits beside the saves of other things and replaces an earlier one of its own.
 * A save that throws does not keep the ones after it from being saved.
 */
export const createSaveGate = () => {
    let held = false;
    const waiting = new Map<string, () => void>();
    return {
        isHeld: () => held,
        hold: () => {
            held = true;
        },
        save: (what: string, commit: () => void) => {
            if (held) {
                // Taken out first: a save that comes again goes to the end, behind what came since.
                waiting.delete(what);
                waiting.set(what, commit);
            } else {
                commit();
            }
        },
        /** What waits under a name that begins with `prefix` is not saved any more: that tuning was reset. */
        forget: (prefix: string) => {
            for (const what of [...waiting.keys()]) {
                if (what.startsWith(prefix)) waiting.delete(what);
            }
        },
        /**
         * The slider is let go: what waited is saved, each thing in the place of its latest save.
         * Every save is tried; the first one that threw is thrown again after the last.
         * A release with no hold before it does nothing.
         */
        release: () => {
            if (!held) return;
            held = false;
            const commits = [...waiting.values()];
            waiting.clear();
            const thrown: unknown[] = [];
            commits.forEach((commit) => {
                try {
                    commit();
                } catch (error) {
                    thrown.push(error);
                }
            });
            if (thrown.length > 0) throw thrown[0];
        },
    };
};

export type SaveGate = ReturnType<typeof createSaveGate>;
