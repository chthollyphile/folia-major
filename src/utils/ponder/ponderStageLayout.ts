// src/utils/ponder/ponderStageLayout.ts
// Where the teaching stage puts its picture: the framed screen the stand-ins are drawn on. The
// title bar is above it; the transport, the chapter line, the caption and the key legend are below.

/** The title bar, and the small gap under it. */
const TOP_BAND_PX = 66;

/** The transport row, the chapter line, five lines of caption and the key legend. */
const BOTTOM_BAND_PX = 294;

/** Free space kept at each side of the screen. */
const SIDE_PX = 24;

/** The screen is as wide as this where the window allows, and wider only to keep its shape. */
const SCREEN_WIDTH_PX = 864;

/** Width over height of the screen on a tall window. */
const SCREEN_ASPECT = 1.6;

/** The screen never gets lower or narrower than this, whatever the window. */
const SCREEN_MIN_HEIGHT_PX = 160;
const SCREEN_MIN_WIDTH_PX = 320;

export type PonderStageScreen = { left: number; top: number; width: number; height: number };

/**
 * The screen for a window of this size, centred. `sideGutter` is the width something beside the
 * screen takes at each side (the card of related lessons); the screen stays between the gutters
 * while the window is wide enough for that.
 */
export const ponderStageScreen = (
    viewport: { width: number; height: number },
    sideGutter = 0,
): PonderStageScreen => {
    const height = Math.max(SCREEN_MIN_HEIGHT_PX, viewport.height - TOP_BAND_PX - BOTTOM_BAND_PX);
    const wanted = Math.max(SCREEN_WIDTH_PX, height * SCREEN_ASPECT);
    const widest = viewport.width - 2 * SIDE_PX;
    const room = Math.max(viewport.width - 2 * Math.max(SIDE_PX, sideGutter), Math.min(widest, SCREEN_MIN_WIDTH_PX));
    const width = Math.min(wanted, room);
    return { left: (viewport.width - width) / 2, top: TOP_BAND_PX, width, height };
};
