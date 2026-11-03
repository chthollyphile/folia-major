// src/library/suites/grid/transitions/samePicture.ts
// Whether two pictures look the same, told from the pictures and not from their addresses.
//
// One picture is served at more than one address. A playlist's cover and its first track's are
// two files to a provider even where they are one picture, and most addresses say nothing of
// what they show (`sameArtwork` in standInHandover.ts knows the few that do).
//
// Each picture is read again, with CORS: the pictures on the page cannot be read (drawn into a
// canvas they taint it). It is cut to its middle square, which is what a square cover shows of
// it, and that square is cut into CELLS x CELLS cells, each brought down to its average colour.
// Two pictures look the same where no cell of one is far from the same cell of the other. A
// picture that cannot be read this way (its host does not allow it, or it does not load) looks
// like no other.

/** A picture is compared as this many cells a side. */
const CELLS = 8;
/**
 * The picture is drawn at this many pixels a side, and its cells are averaged from that. Drawn
 * straight at a few pixels a side it is not averaged: a browser draws a picture smaller by
 * reading a few of its pixels, and a large file and a small one of the same artwork then came
 * out as far apart as two artworks.
 */
const DRAWN = 128;
/**
 * Two pictures look the same where no cell differs by this much in any colour channel, of 255.
 * Measured once on the 16 pictures that test/component/samePicture.spec.ts puts to it (the spec
 * holds what is said of each pair, not the distances): the files of one artwork, from 60 to 544
 * pixels a side and JPEG quality 0.5 to 0.92, were at most 9.5 apart; two artworks at least 36.
 */
const ALIKE_UNDER = 20;

/** Whether two pictures, as the average colours of their cells (red, green, blue for each), are nearly one. */
export const cellsLookAlike = (first: ArrayLike<number>, second: ArrayLike<number>): boolean => {
    if (first.length === 0 || first.length !== second.length) {
        return false;
    }
    for (let at = 0; at < first.length; at += 1) {
        if (Math.abs(first[at] - second[at]) >= ALIKE_UNDER) {
            return false;
        }
    }
    return true;
};

/** The average colour of each cell of a picture's middle square, or null where the picture cannot be read. */
const cellsOf = async (url: string): Promise<Float32Array | null> => {
    const picture = new Image();
    picture.crossOrigin = 'anonymous';
    picture.src = url;
    try {
        await picture.decode();
        const canvas = document.createElement('canvas');
        canvas.width = DRAWN;
        canvas.height = DRAWN;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            return null;
        }
        const side = Math.min(picture.naturalWidth, picture.naturalHeight);
        context.drawImage(picture, (picture.naturalWidth - side) / 2, (picture.naturalHeight - side) / 2, side, side, 0, 0, DRAWN, DRAWN);
        const drawn = context.getImageData(0, 0, DRAWN, DRAWN).data;
        const cell = DRAWN / CELLS;
        const cells = new Float32Array(CELLS * CELLS * 3);
        for (let y = 0; y < DRAWN; y += 1) {
            for (let x = 0; x < DRAWN; x += 1) {
                const from = (y * DRAWN + x) * 4;
                const to = (Math.floor(y / cell) * CELLS + Math.floor(x / cell)) * 3;
                cells[to] += drawn[from];
                cells[to + 1] += drawn[from + 1];
                cells[to + 2] += drawn[from + 2];
            }
        }
        return cells.map(sum => sum / (cell * cell));
    } catch {
        return null;
    }
};

/** Whether the pictures at two addresses look the same. False where either cannot be read. */
export const picturesLookAlike = async (first: string, second: string): Promise<boolean> => {
    const [one, other] = await Promise.all([cellsOf(first), cellsOf(second)]);
    return one !== null && other !== null && cellsLookAlike(one, other);
};
