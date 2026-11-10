import { KIT_MOTION } from '../../modal/settings/kit/motion';

// src/components/visualizer/preview/pictureRule.ts
// What a small picture of a lyric style or of a background does, from what the picture grid says
// about it. A picture that does not run is an image: the style is drawn once, what it drew is
// kept, and the style is taken away again (LivePicture). Only the picture the pointer rests on
// runs. The chosen picture never runs: the chosen style is already running in the large sample
// beside the pictures, or on the playing page behind them.
//
// Why images. Measured on a production build (RTX 4090, a 160 Hz display, so a frame is 6.3 ms),
// with 14 pictures beside the large sample: every picture running took 18.7 to 37.6 ms a frame;
// the chosen and the pointed one running doubled the frame time for three styles; and pictures
// held still by pausing the style still kept its loops, its renderer and its WebGL context, and
// took up to half of the main thread. Four pictures of styles drawn with elements alone, held on
// a stopped clock, took 9 to 18% of it.
//
// Making an image is not free either: drawing a style for the first time is one long task (0.1 to
// 0.6 s for the WebGL and canvas styles), and the large sample stands still for it. So an image
// is made when nothing else is going on, and as seldom as the truth of the picture allows.

/** nothing: off screen, not drawn. image: what the style drew, kept. live: the style itself, running. */
export type PictureWants = 'nothing' | 'image' | 'live';

/** How long the pointer rests on a picture before it runs, so that passing over the grid starts nothing. */
export const LIVE_REST_MS = 280;

export const pictureWants = (state: { visible: boolean; chosen: boolean; active: boolean }): PictureWants => {
    if (!state.visible) {
        return 'nothing';
    }
    return state.active && !state.chosen ? 'live' : 'image';
};

/** How long a picture without an image waits: a window that is arriving (the kit's `unfold`) has arrived by then. */
export const FIRST_IMAGE_REST_MS = Math.round(KIT_MOTION.unfold * 1000) + 150;
/** How long what a picture shows has to stay the same before its image is made again: a person who is adjusting pauses for less. */
export const NEW_IMAGE_REST_MS = 1200;

type ImageState = {
    /** Images may be made now (LyricPreview.making). */
    allowed: boolean;
    wants: PictureWants;
    chosen: boolean;
    /** An image of what the picture shows now exists (or it is known that none can be made). */
    made: boolean;
    /** The picture shows an image, if only one of earlier settings. */
    shows: boolean;
    /** How many tries to make this image ended with an empty stage. */
    tried: number;
};

/**
 * How long a picture waits before its image is made, in ms; null where none is to be made now.
 * The chosen picture keeps the image it shows while it is chosen: its settings are the ones a
 * person is adjusting, the large sample shows them, and every new image would stop that sample
 * for a moment. Its image is made again when another picture is chosen. A picture whose last try
 * came to nothing waits the longer time before the next.
 */
export const imageRest = ({ allowed, wants, chosen, made, shows, tried }: ImageState): number | null => {
    if (!allowed || wants === 'nothing' || made || (chosen && shows)) {
        return null;
    }
    return shows || tried > 0 ? NEW_IMAGE_REST_MS : FIRST_IMAGE_REST_MS;
};

/**
 * How a try to make an image ended. shown: the stage shows what the style drew. empty: the wait
 * was over and the stage showed nothing (the style's module was still loading, the page was busy
 * or hidden). failed: the style threw on the stage, or reading the stage threw.
 */
export type TryEnd = 'shown' | 'empty' | 'failed';

/** How many tries with an empty stage an image of the same settings gets. */
export const IMAGE_TRIES = 2;

/**
 * What becomes of a try, given how many tries came to nothing before it. keep: what the stage
 * shows is the image. again: nothing is kept, the turn is given back, and the picture asks again
 * later. glyph: no image is made of these settings, the glyph stands in; that is also where a
 * throw ends, at once.
 */
export const afterTry = (end: TryEnd, tried: number): 'keep' | 'again' | 'glyph' => {
    if (end === 'shown') {
        return 'keep';
    }
    return end === 'empty' && tried + 1 < IMAGE_TRIES ? 'again' : 'glyph';
};
