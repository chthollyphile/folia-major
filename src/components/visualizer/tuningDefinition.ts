import type { VisualizerSharedProps } from './definition';
import type { VisualizerTuningBundle } from './tuningRegistry';

// src/components/visualizer/tuningDefinition.ts
// What a style's tuning.ts declares, and what it gets back.
//
// Kept apart from tuningRegistry.ts on purpose. The registry collects every tuning.ts as it loads,
// so a tuning.ts that imported the registry could not be loaded first. Nothing here loads another
// visualizer file, so a style's entry.tsx can import its own tuning.ts in any order.

/**
 * Where a tuning is kept between runs of the app, and how it comes back and changes. The settings
 * store and its persistence file hold one implementation that asks this; they name no style.
 */
export interface VisualizerTuningStorage<T> {
    /** The localStorage key the tuning is written under. A key never changes: a renamed key reads as "nothing stored". */
    key: string;
    /** Keys of earlier versions, read in this order where `key` holds nothing. They are never written. */
    olderKeys?: readonly string[];
    /**
     * A stored value, already parsed from JSON, as a tuning: older shapes, missing fields and
     * values out of range all end as a whole, valid tuning. It may throw on what is no object:
     * the defaults are used then.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    read: (stored: any) => T;
    /** A patch laid onto the tuning held now: the tuning that is then held and written. */
    merge: (held: T, patch: Partial<T>) => T;
    /** Runs before a change is merged: what a change has to say to the user, if anything. */
    onChange?: (patch: Partial<T>) => void;
    /** The message said after a reset to the defaults (an i18n key); none is said without it. */
    resetNotice?: string;
    /**
     * What a reset puts back, from the tuning held now: by default the whole of `defaults`. A style
     * whose panel shows only some of its fields (the rest come only by an import) resets just those.
     */
    reset?: (held: T, defaults: T) => T;
    /**
     * More store actions that belong to this tuning (a picture uploaded for it, an uploaded
     * picture cleared), under the names the store carries them by. The tuning.ts adds their
     * types to VisualizerTuningSettings itself.
     */
    actions?: (tuning: HeldTuning<T>) => object;
}

/** What a tuning's own store actions work with. */
export interface HeldTuning<T> {
    /** The tuning held now. */
    held: () => T;
    /** Writes a whole tuning under its key and holds it. */
    hold: (tuning: T) => void;
}

/**
 * One key of a style's tuning that mods may read and write (Folium 1.8 `folium.visualizer.getTuning` /
 * `setTuning`), as the style's own settings offer it: a number inside its slider's range (`step` only where the
 * value must land on whole steps, e.g. a count), a switch, or one of a few choices. The host checks a mod's
 * value against this before the tuning's own `merge`, so the range here is never wider than the one `merge`
 * clamps to (test/unit/visualizer/modTuningKeys.test.ts holds the two together). Declaring a key makes its
 * name and meaning public API, as `foliumTunables` does: renaming or dropping one breaks mods. Settings of
 * the picture's cost (resolution, render quality) are the user's and are not declared.
 */
export type VisualizerModTuningKey =
    | { type: 'number'; min: number; max: number; step?: number }
    | { type: 'boolean' }
    | { type: 'choice'; options: readonly string[] };

/** A numeric mod tuning key from `min` to `max`, landing on whole `step`s when one is given. */
export const modNumber = (min: number, max: number, step?: number): VisualizerModTuningKey => (
    step === undefined ? { type: 'number', min, max } : { type: 'number', min, max, step }
);
/** A mod tuning key that is a switch. */
export const MOD_SWITCH: VisualizerModTuningKey = { type: 'boolean' };
/** A mod tuning key that is one of `options`. */
export const modChoice = (options: readonly string[]): VisualizerModTuningKey => ({ type: 'choice', options });

export interface VisualizerTuningDefinition<T> {
    mode: string;
    /** The style's settings before the listener has changed anything. */
    defaults: T;
    /** The keys of this tuning mods may read and write; see VisualizerModTuningKey. A style without it offers none. */
    modKeys?: { readonly [K in keyof T]?: VisualizerModTuningKey };
    /**
     * A mod's checked patch as the style's panel would send it, from the tuning held now: for keys the panel
     * changes together (a slider that takes the other end along). Without it the patch goes to the setter as it is.
     */
    modPatch?: (held: T, patch: Partial<T>) => Partial<T>;
    /** The settings store field that holds this tuning, and the store actions that change and reset it. */
    settingsKey: string;
    settingsSetterKey: string;
    settingsResetterKey?: string;
    /** Where the tuning is stored. With it and `settingsResetterKey`, the store builds the field and both actions itself. */
    storage?: VisualizerTuningStorage<T>;
    /**
     * What the settings window's sample draws while a change is shown but not yet saved (a slider
     * is held): a style keeps the saved value here for a field that is too costly to follow a drag.
     * Without it the sample draws the draft as it is.
     */
    preview?: (draft: T, saved: T) => T;
    /*
     * Puts the tuning on the renderer's props under the name that renderer reads (pendoloTuning, ...).
     * A style whose entry takes its tuning with read() leaves this out, and needs no named prop.
     */
    apply?: (props: VisualizerSharedProps, tuning: T) => VisualizerSharedProps;
}

export interface VisualizerTuningAdapter<T = unknown> extends VisualizerTuningDefinition<T> {
    /*
     * This style's tuning out of the bundle. It is the stored object itself, never a copy
     * (renderers key their layout caches on it), or the defaults when the bundle has none.
     */
    read: (bundle?: VisualizerTuningBundle) => T;
}

/** What the settings store needs of a tuning to hold it, a lyric style's and a background's alike. */
export interface StoredTuning<T = unknown> {
    defaults: T;
    settingsKey: string;
    settingsSetterKey: string;
    settingsResetterKey: string;
    storage: VisualizerTuningStorage<T>;
}

/** A lyric style's tuning whose declaration says where it is stored. */
export type StoredTuningAdapter<T = unknown> = VisualizerTuningAdapter<T> & StoredTuning<T>;

/** What a background's tuning.ts declares: the background it belongs to, and how the store holds its tuning. */
export interface BackgroundTuningDefinition<T = unknown> extends StoredTuning<T> {
    mode: string;
}

/**
 * Stored settings of a background that are no single tuning object (a list with a chosen entry):
 * a settings.ts in the background's folder builds its own store fields and actions, reads and
 * writes its own keys, and adds its fields' types to VisualizerTuningSettings. `set` keeps
 * fields in the store, `get` reads the fields this slice built.
 */
export type BackgroundSettingsSlice<S extends object = object> = (set: (fields: Partial<S>) => void, get: () => S) => S;

/**
 * What the settings store holds for the styles and the backgrounds. Each tuning.ts adds its own
 * fields here with `declare module`, so the store's type lists no style either.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface VisualizerTuningSettings {}

/** The three store fields of one stored tuning: the tuning, the action that changes it, the action that resets it. */
export type StoredTuningFields<Field extends string, Setter extends string, Resetter extends string, T> =
    Record<Field, T> & Record<Setter, (patch: Partial<T>) => void> & Record<Resetter, () => void>;

/** A stored or patched value as a number between `min` and `max`: what is no finite number is the fallback. */
export const numberWithin = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

export const defineVisualizerTuning = <T>(definition: VisualizerTuningDefinition<T>): VisualizerTuningAdapter<T> => ({
    ...definition,
    read: bundle => ((bundle as Record<string, unknown> | undefined)?.[definition.mode] as T | undefined) ?? definition.defaults,
});

export const defineBackgroundTuning = <T>(definition: BackgroundTuningDefinition<T>) => definition;
