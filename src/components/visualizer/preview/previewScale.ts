// src/components/visualizer/preview/previewScale.ts
// The arithmetic of a small live picture. Several lyric styles lay themselves out from the size of
// the app's window, not of the box they are in, and the Pixi styles never make a canvas smaller
// than 320 by 240. So a picture draws the style on a stage as large as the window, where it lays
// out as on the playing page, and scales that stage down until it covers the picture's box. The
// big sample of the lyric style window and of Theme Park does the same in a box of the window's
// shape, which the stage fills whole (frameStage).

export type Size = { width: number; height: number };

/** Where the scaled stage sits in the box, from the box's top left corner. */
export type StagePlace = { scale: number; left: number; top: number };

/** Scales a stage by the ratio `pick` chooses of the two and centres it in the box. Null while either has no size. */
const placeStage = (stage: Size, box: Size, pick: (across: number, down: number) => number): StagePlace | null => {
    if (!(stage.width > 0 && stage.height > 0 && box.width > 0 && box.height > 0)) {
        return null;
    }
    const scale = pick(box.width / stage.width, box.height / stage.height);
    return {
        scale,
        left: (box.width - stage.width * scale) / 2,
        top: (box.height - stage.height * scale) / 2,
    };
};

/**
 * Places a stage in a box so that it covers the box: scaled by the larger of the two ratios and
 * centred, so what sticks out is cut evenly at both sides. Null while either has no size.
 */
export const coverStage = (stage: Size, box: Size): StagePlace | null => placeStage(stage, box, Math.max);

/**
 * Places a stage in a box so that all of it shows: scaled by the smaller of the two ratios and
 * centred, so the box is left empty evenly at two sides. Null while either has no size.
 */
export const fitStage = (stage: Size, box: Size): StagePlace | null => placeStage(stage, box, Math.min);

/** A rectangle in a box, from the box's top left corner. */
export type BoxRect = { left: number; top: number; width: number; height: number };

/**
 * Fits a stage into a box (fitStage) and gives the unscaled frame that cuts what of it shows.
 * Under the scale the stage's edges fall between device pixels, and there a layer the compositor
 * draws apart (a style's canvas) is cut at the whole pixel past the edge, while what is painted
 * over it (the dim over a background) fades out inside that pixel: the last column shows the
 * canvas undimmed, a bright line along the edge. The frame lies `edge` inside the stage's edges
 * where the box is left empty, and `edge` past the box's where the stage fills it, so the box cuts
 * it there; an unscaled frame is cut at the same whole pixel for every layer. The stage's place is
 * from the frame's top left corner. With `fill` the stage is first grown along the box's spare side
 * until it fills the box, as if the window were taller (or wider), so it fills both sides and the
 * frame lies `edge` past the box all round; `zoom` then scales it up by that much more, the window's
 * own side growing past the box and cut evenly at both ends while the spare side shrinks back no
 * further than the window. `stage` is the stage to draw. Null while either has no size.
 */
export const frameStage = (
    stage: Size,
    box: Size,
    edge: number,
    fill = false,
    zoom = 1,
): { frame: BoxRect; place: StagePlace; stage: Size } | null => {
    if (!(box.width > 0 && box.height > 0)) {
        return null;
    }
    // Fitted into the box grown by two edges at each side: along the side it fills, the stage
    // reaches two edges past the box, and the frame one edge inside the stage, one past the box.
    const grown = { width: box.width + 4 * edge, height: box.height + 4 * edge };
    const fitted = fitStage(stage, grown);
    if (!fitted) {
        return null;
    }
    if (!fill) {
        return {
            frame: {
                left: fitted.left - edge,
                top: fitted.top - edge,
                width: stage.width * fitted.scale - 2 * edge,
                height: stage.height * fitted.scale - 2 * edge,
            },
            place: { scale: fitted.scale, left: -edge, top: -edge },
            stage,
        };
    }
    const scale = fitted.scale * zoom;
    // Grown against the grown box, not the box, so it reaches two edges past the box at all four sides.
    const drawn = {
        width: Math.max(stage.width, grown.width / scale),
        height: Math.max(stage.height, grown.height / scale),
    };
    return {
        frame: { left: -edge, top: -edge, width: box.width + 2 * edge, height: box.height + 2 * edge },
        place: {
            scale,
            left: (grown.width - drawn.width * scale) / 2 - edge,
            top: (grown.height - drawn.height * scale) / 2 - edge,
        },
        stage: drawn,
    };
};

/**
 * Where a stage placed at `inner` sits on another stage placed at `outer` in the same box, in the
 * outer stage's pixels, so drawn inside it the inner stage lands where `inner` puts it in the box.
 */
export const placeOnStage = (outer: StagePlace, inner: StagePlace): StagePlace => ({
    scale: inner.scale / outer.scale,
    left: (inner.left - outer.left) / outer.scale,
    top: (inner.top - outer.top) / outer.scale,
});

/** How far a framed stage's top edge lies above the box's top, in the box's pixels. */
export const stageAboveBox = (framed: { frame: BoxRect; place: StagePlace }): number => (
    -(framed.frame.top + framed.place.top)
);

/** How far a framed stage's bottom edge lies below the box's bottom, in the box's pixels. */
export const stageBelowBox = (framed: { frame: BoxRect; place: StagePlace; stage: Size }, box: Size): number => (
    framed.frame.top + framed.place.top + framed.stage.height * framed.place.scale - box.height
);
