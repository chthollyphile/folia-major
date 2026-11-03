import type { CollectionMorphCard, CollectionMorphFrame, CollectionMorphRect, CollectionMorphTitle } from './morphGeometry';

// src/library/suites/grid/transitions/morphFlight.ts
// The flight of a card, as keyframes: its picture, its frame and its title each go from where the
// card stands to where it lands.
//
// The carrier is laid out AT THE TARGET, so that it ends with no movement left in it and what is
// under it can take over without a seam. Every piece is moved by `transform` alone, which the
// compositor animates without the main thread (the page that opens is mounting on it):
//   - a box (the picture's, and the frame's): placed and scaled from the source rectangle to its own;
//   - the picture inside its box: scaled against the box, so that it is the picture as
//     `object-fit: cover` shows it in a box of that size, at every moment, though the two
//     rectangles differ in shape;
//   - a title: moved, and scaled by one factor both ways, so that its letters keep their shape.
// The picture's scale is the inverse of the box's times one factor, and the inverse of a line is
// not a line: all are given as samples of one curve, close enough together that the straight
// pieces between them cannot be told from it.
//
// The corners are one more animation, of `border-radius`. It cannot run on the compositor; it
// repaints its box alone, and a frame it misses shows corners a pixel or two off.

/** How long the card is in the air. */
export const FLIGHT_MS = 460;
/** How long the carrier takes to dissolve over the card it has landed on. */
export const HANDOVER_MS = 140;
/** Samples of the curve, the two ends included. */
const SAMPLES = 32;

// A spring let go at 0 that comes to rest at 1: the movement starts at once and settles, with no
// stop to be seen. Damped so that it passes its end by under one part in a hundred.
const RESPONSE = 0.36;
const DAMPING = 0.86;

/** How far the flight has come, 0 to 1, at `time` of 0 to 1. */
export const flightProgress = (time: number): number => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    const seconds = time * (FLIGHT_MS / 1000);
    const natural = (2 * Math.PI) / RESPONSE;
    const damped = natural * Math.sqrt(1 - DAMPING * DAMPING);
    const decay = Math.exp(-DAMPING * natural * seconds);
    return 1 - decay * (Math.cos(damped * seconds) + ((DAMPING * natural) / damped) * Math.sin(damped * seconds));
};

export interface MorphFlightEnd {
    rect: CollectionMorphRect;
    /** Corner radius in pixels as drawn; half the shorter side for a round picture. */
    radius: number;
}

const between = (from: number, to: number, progress: number) => from + (to - from) * progress;
const rounded = (value: number) => Number(value.toFixed(4));

/** The size at which a picture of these proportions covers a box. */
const coverSize = (box: { width: number; height: number }, proportions: number) => {
    const width = Math.max(box.width, box.height * proportions);
    return { width, height: width / proportions };
};

/** The curve at each sample: the time, and how far the flight has come. */
const curve = () => Array.from({ length: SAMPLES }, (_, sample) => {
    const offset = sample / (SAMPLES - 1);
    return { offset, progress: flightProgress(offset) };
});

/** The box at each sample: its size, and the scale that gives a box laid out at `target` that size. */
const samplesOf = (source: CollectionMorphRect, target: CollectionMorphRect) => (
    curve().map(({ offset, progress }) => {
        const width = between(source.width, target.width, progress);
        const height = between(source.height, target.height, progress);
        return {
            offset, progress, width, height,
            x: between(source.x, target.x, progress) - target.x,
            y: between(source.y, target.y, progress) - target.y,
            scaleX: width / target.width,
            scaleY: height / target.height,
        };
    })
);

/** The box's flight from `source` to `target`, where it is laid out: its transform, and its corners. */
export const flightBoxKeyframes = (source: MorphFlightEnd, target: MorphFlightEnd): { box: Keyframe[]; corners: Keyframe[] } => {
    const samples = samplesOf(source.rect, target.rect);
    return {
        box: samples.map(({ offset, x, y, scaleX, scaleY }) => (
            { offset, transform: `translate(${rounded(x)}px, ${rounded(y)}px) scale(${rounded(scaleX)}, ${rounded(scaleY)})` }
        )),
        // A radius under an uneven scale is drawn as an ellipse; each sample undoes its own.
        corners: samples.map(({ offset, progress, scaleX, scaleY }) => {
            const radius = Math.max(0, between(source.radius, target.radius, progress));
            return { offset, borderRadius: `${rounded(radius / scaleX)}px / ${rounded(radius / scaleY)}px` };
        }),
    };
};

/**
 * A picture inside that box. `proportions` is its width over its height (where it is not known,
 * the source's own, which shows the picture whole there). `picture` is where it is laid out in
 * the box: the whole picture, at the size that covers the target, centred.
 */
export const flightPictureKeyframes = (
    source: CollectionMorphRect,
    target: CollectionMorphRect,
    proportions: number,
): { picture: CollectionMorphRect; image: Keyframe[] } => {
    const shape = proportions > 0 && Number.isFinite(proportions) ? proportions : source.width / source.height;
    const home = coverSize(target, shape);
    return {
        picture: { x: (target.width - home.width) / 2, y: (target.height - home.height) / 2, width: home.width, height: home.height },
        image: samplesOf(source, target).map(({ offset, width, height, scaleX, scaleY }) => {
            // The picture as it covers a box of this size, against what the box's own scale makes of it.
            const cover = coverSize({ width, height }, shape).width / home.width;
            return { offset, transform: `scale(${rounded(cover / scaleX)}, ${rounded(cover / scaleY)})` };
        }),
    };
};

/** A change of opacity in one part of the flight, by its time: `from` until `start`, `to` from `end` on. */
export const flightFade = (from: number, to: number, start: number, end: number): Keyframe[] => [
    { opacity: from, offset: 0 },
    ...(start > 0 ? [{ opacity: from, offset: start }] : []),
    ...(end < 1 ? [{ opacity: to, offset: end }] : []),
    { opacity: to, offset: 1 },
];

/** A part of the flight, by its time. */
interface FlightPart {
    from: number;
    to: number;
}

/** An opacity that is 0 at both ends of the flight: it rises to `peak` over `rise`, stays, and falls over `fall`. */
const flightSwell = (peak: number, rise: FlightPart, fall: FlightPart): Keyframe[] => [
    { opacity: 0, offset: 0 },
    ...(rise.from > 0 ? [{ opacity: 0, offset: rise.from }] : []),
    { opacity: peak, offset: rise.to },
    { opacity: peak, offset: fall.from },
    ...(fall.to < 1 ? [{ opacity: 0, offset: fall.to }] : []),
    { opacity: 0, offset: 1 },
];

/** Where a title's first letter stands on the screen, and how large its letters are drawn. */
export interface MorphTitleAnchor {
    x: number;
    y: number;
    size: number;
}

export const titleAnchor = (title: Pick<CollectionMorphTitle, 'rect' | 'width' | 'fontSize'>): MorphTitleAnchor => ({
    x: title.rect.x,
    y: title.rect.y,
    size: title.fontSize * (title.width > 0 ? title.rect.width / title.width : 1),
});

/**
 * Where a title would stand at the other end of a flight, were it fixed to the picture: the place
 * a title flies to (or from) where that end has no title of its own.
 */
export const titleAnchorCarried = (anchor: MorphTitleAnchor, cover: CollectionMorphRect, coverThere: CollectionMorphRect): MorphTitleAnchor => {
    const ratio = cover.width > 0 ? coverThere.width / cover.width : 1;
    return {
        x: coverThere.x + (anchor.x - cover.x) * ratio,
        y: coverThere.y + (anchor.y - cover.y) * ratio,
        size: anchor.size * ratio,
    };
};

/** A title's flight between two anchors, for a line laid out at the window's corner with letters of `fontSize`. */
export const flightTitleKeyframes = (from: MorphTitleAnchor, to: MorphTitleAnchor, fontSize: number): Keyframe[] => (
    curve().map(({ offset, progress }) => ({
        offset,
        transform: `translate(${rounded(between(from.x, to.x, progress))}px, ${rounded(between(from.y, to.y, progress))}px) scale(${rounded(between(from.size, to.size, progress) / fontSize)})`,
    }))
);

// The parts of a flight, by its time, in which one thing turns into another: the picture and the
// title of the card that leaves into those of the place it lands on; a frame or a title that only
// one end has comes in the first part, or goes in the last.
const TURN = { from: 0.2, to: 0.7 };
const COMES = { from: 0, to: 0.4 };
const GOES = { from: 0.6, to: 1 };

export const flightTurn = { leaving: flightFade(1, 0, TURN.from, TURN.to), arriving: flightFade(0, 1, TURN.from, TURN.to) };

// The frame's edge: how strongly its outline is lit. Lit while the card is in the air and not at
// all at either end, where the carrier is to be the card as its page draws it. A frame that
// comes or goes on the way has its edge lit only while enough of the frame is there to carry it.
const EDGE_PEAK = 0.9;
const flightEdge = {
    stays: flightSwell(EDGE_PEAK, { from: 0, to: 0.16 }, { from: 0.6, to: 1 }),
    comes: flightSwell(EDGE_PEAK, { from: 0.1, to: 0.4 }, { from: 0.6, to: 1 }),
    goes: flightSwell(EDGE_PEAK, { from: 0, to: 0.16 }, { from: 0.45, to: 0.8 }),
};

export interface MorphFlightBox extends MorphFlightEnd {
    box: Keyframe[];
    corners: Keyframe[];
}

export interface MorphFlightTitle {
    title: CollectionMorphTitle;
    move: Keyframe[];
    fade: Keyframe[];
}

/** A card's flight, piece by piece. Each piece: where it is laid out, and what moves it. */
export interface MorphFlightPlan {
    cover: MorphFlightBox;
    /**
     * The frame, where either end has one; drawn as `look` says. `fade`: it comes or goes on the
     * way. `edge`: how strongly its outline is lit (in `look.edge`), 0 at both ends.
     */
    frame: (MorphFlightBox & {
        look: Pick<CollectionMorphFrame, 'background' | 'border' | 'shadow' | 'edge'>;
        fade: Keyframe[] | null;
        edge: Keyframe[];
    }) | null;
    /** The title of the card that leaves, and that of the place it lands on. */
    leavingTitle: MorphFlightTitle | null;
    arrivingTitle: MorphFlightTitle | null;
    /**
     * The layer an end draws over its picture, where either has one; drawn over the carrier's
     * picture as `look` says (a CSS `background`). `fade`: it goes or comes on the way.
     */
    shade: { look: string; fade: Keyframe[] | null } | null;
}

const boxFlight = (source: MorphFlightEnd, target: MorphFlightEnd): MorphFlightBox => ({
    rect: target.rect, radius: target.radius, ...flightBoxKeyframes(source, target),
});

/**
 * The flight of the card at `from` to the card at `to`. An end with no frame of its own has the
 * frame come out of, or go into, its picture; an end with no title has the title fixed to its
 * picture. A layer over the picture that only one end has (the poster wall's tile: its shade) is
 * whole at that end, where the carrier is to be as bright as the card under it, and is there for
 * the nearest part of the flight only, as a title is. A flight of a card to itself is that card
 * standing still.
 */
export const planFlight = (from: CollectionMorphCard, to: CollectionMorphCard): MorphFlightPlan => {
    const look = to.frame ?? from.frame;
    const shade = from.shade ?? to.shade;
    // What the frame does on the way: both ends draw one, or it comes to, or goes from, the picture.
    const frameWay = from.frame && to.frame ? 'stays' : from.frame ? 'goes' : 'comes';
    const fromAnchor = from.title ? titleAnchor(from.title) : null;
    const toAnchor = to.title ? titleAnchor(to.title) : null;
    const leavesFrom = fromAnchor ?? (toAnchor ? titleAnchorCarried(toAnchor, to.rect, from.rect) : null);
    const landsAt = toAnchor ?? (fromAnchor ? titleAnchorCarried(fromAnchor, from.rect, to.rect) : null);
    const titleFlight = (title: CollectionMorphTitle | null, fade: Keyframe[]): MorphFlightTitle | null => (
        title && leavesFrom && landsAt
            ? { title, move: flightTitleKeyframes(leavesFrom, landsAt, title.fontSize), fade }
            : null
    );
    return {
        cover: boxFlight(from, to),
        frame: look
            ? {
                ...boxFlight(from.frame ?? from, to.frame ?? to),
                look,
                fade: frameWay === 'stays'
                    ? null
                    : frameWay === 'goes' ? flightFade(1, 0, GOES.from, GOES.to) : flightFade(0, 1, COMES.from, COMES.to),
                edge: flightEdge[frameWay],
            }
            : null,
        leavingTitle: titleFlight(from.title, to.title ? flightTurn.leaving : flightFade(1, 0, COMES.from, COMES.to)),
        arrivingTitle: titleFlight(to.title, from.title ? flightTurn.arriving : flightFade(0, 1, GOES.from, GOES.to)),
        shade: shade
            ? {
                look: shade,
                fade: from.shade && to.shade
                    ? null
                    : from.shade ? flightFade(1, 0, COMES.from, COMES.to) : flightFade(0, 1, GOES.from, GOES.to),
            }
            : null,
    };
};
