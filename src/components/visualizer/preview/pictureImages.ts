import type { Theme } from '../../../types';

// src/components/visualizer/preview/pictureImages.ts
// The images of the small pictures, kept for as long as the page lives. An image is filed under a
// text that names everything it shows (the style, the theme, the settings, the size of the stage):
// the same text, the same image; a new text, a new image. So a picker that is opened again has its
// pictures at once.

/** null: the style drew nothing that can be kept. */
type Image = HTMLElement | null;

/** More than every style and background in two themes; the oldest go first. */
const KEPT = 64;

const images = new Map<string, Image>();
const listeners = new Set<() => void>();

export const subscribeImages = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** The image filed under `key`; undefined while none was made. */
export const imageOf = (key: string): Image | undefined => images.get(key);

export const keepImage = (key: string, image: Image) => {
    images.delete(key);
    images.set(key, image);
    if (images.size > KEPT) {
        images.delete(images.keys().next().value as string);
    }
    listeners.forEach(listener => listener());
};

/**
 * A theme as a picture is drawn in and filed under: its colours, its font and its motion. Not its
 * name, description or provider: with AI themes those are new with every song, and in a picture
 * they are a few letters at most.
 */
export const themeForPictures = (theme: Theme): Theme => ({ ...theme, name: '', description: undefined, provider: undefined });

const marks = new WeakMap<object, number>();
let marked = 0;

/** A number for an object: the same object, the same number. Nothing stands for 0. */
const markOf = (value: object | null | undefined): number => {
    if (!value) {
        return 0;
    }
    if (!marks.has(value)) {
        marked += 1;
        marks.set(value, marked);
    }
    return marks.get(value)!;
};

/**
 * A text for what a picture shows. Plain settings are written out, so equal settings give the same
 * text. An uploaded picture is told apart by which object it is: writing its data out would be
 * megabytes.
 */
export const pictureKey = (settings: unknown, ...uploads: Array<object | null | undefined>): string => (
    `${JSON.stringify(settings)}#${uploads.map(markOf).join('.')}`
);

/** Everything a lyric style's picture shows, apart from uploaded pictures. */
export interface StylePictureShows {
    mode: string;
    stage: unknown;
    theme: Theme;
    isDaylight: boolean;
    /** The sample song. */
    sample: string;
    fontScale: number | undefined;
    /** The style's own saved tuning; a style without one has none. */
    tuning: unknown;
    /** A mod style's own stored settings; null for a style that is no mod's. */
    modSettings: unknown;
    /** The multipliers mods put on this style. */
    modTunings: unknown;
}

/** The text a lyric style's picture is filed under: every setting that changes what the style draws is in it, a mod's too. */
export const stylePictureKey = (shows: StylePictureShows, ...uploads: Array<object | null | undefined>): string => pictureKey(
    ['style', shows.mode, shows.stage, shows.theme, shows.isDaylight, shows.sample, shows.fontScale, shows.tuning, shows.modSettings, shows.modTunings],
    ...uploads,
);
