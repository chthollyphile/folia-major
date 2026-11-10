import type { PonderRect, PonderTimelinePlan } from '../../types/ponder';

// src/utils/ponder/ponderFocus.ts
// When each caption of a chapter is on screen, and what the focus frame does meanwhile. The
// caption has one fixed place under the picture; the frame is the one outline on the picture that
// marks what the caption is about, and it travels from one caption's anchor to the next.

/** One caption's time on screen. */
export type PonderCaptionWindow = {
    id: string;
    atMs: number;
    /** A caption leaves when its reading time is over, and at the latest when the next one starts. */
    endMs: number;
    /** The anchor the caption points to, if it points to one. */
    anchor?: string;
    /** The last caption of the chapter stays to the end: the offer of the next chapter stands beside it. */
    stays: boolean;
};

export const captionWindows = (plan: PonderTimelinePlan): PonderCaptionWindow[] => {
    const captions = plan.entries
        .filter(entry => entry.step.kind === 'caption')
        .sort((a, b) => a.atMs - b.atMs);
    return captions.map((entry, index) => {
        const next = captions[index + 1];
        return {
            id: entry.step.id,
            atMs: entry.atMs,
            endMs: Math.min(entry.atMs + entry.durationMs, next?.atMs ?? Infinity),
            anchor: entry.step.kind === 'caption' ? entry.step.pointTo?.anchor : undefined,
            stays: !next,
        };
    });
};

/** One stop of the focus frame. */
export type PonderFocusBeat = {
    anchor: string;
    atMs: number;
    /** The anchor the frame is on when this stop begins: it travels from there. Null: it appears here. */
    from: string | null;
    /** When the frame starts to hide. Null: the next stop takes over, or the chapter ends with it on. */
    hideAtMs: number | null;
};

/**
 * The frame's stops for a chapter. It travels when the next pointing caption follows at once,
 * hides when a caption ends with nothing to go to, and stays on with the last caption.
 * `hasAnchor` says whether an anchor has a rectangle on this stage; a caption whose anchor has
 * none shows no frame.
 */
export const focusBeats = (
    windows: PonderCaptionWindow[],
    hasAnchor: (anchor: string) => boolean,
    hideMs: number,
): PonderFocusBeat[] => {
    const pointed = windows.filter(window => window.anchor !== undefined && hasAnchor(window.anchor));
    return pointed.map((window, index) => {
        const previous = pointed[index - 1];
        const next = pointed[index + 1];
        const handsOver = Boolean(next) && next.atMs <= window.endMs;
        return {
            anchor: window.anchor as string,
            atMs: window.atMs,
            from: previous && previous.endMs >= window.atMs ? previous.anchor as string : null,
            hideAtMs: handsOver || window.stays ? null : Math.max(window.atMs, window.endMs - hideMs),
        };
    });
};

/** How far the frame stands off the thing it marks, px. */
const FRAME_PAD_PX = 5;

/** The corner of an anchor whose own radius was not measured or declared, px. */
const DEFAULT_RADIUS_PX = 8;

export type PonderFocusBox = { left: number; top: number; width: number; height: number; radius: number };

/** The frame around an anchor's rectangle: a little larger, with the anchor's corners grown by the same amount. */
export const focusFrameBox = (rect: PonderRect): PonderFocusBox => {
    // A percentage is a pill or a circle; a length is taken as it is.
    const declared = rect.radius === undefined ? NaN
        : rect.radius.includes('%') ? Infinity
        : Number.parseFloat(rect.radius);
    const radius = Math.min(Number.isNaN(declared) ? DEFAULT_RADIUS_PX : declared, Math.min(rect.width, rect.height) / 2);
    return {
        left: rect.left - FRAME_PAD_PX,
        top: rect.top - FRAME_PAD_PX,
        width: rect.width + FRAME_PAD_PX * 2,
        height: rect.height + FRAME_PAD_PX * 2,
        radius: radius + FRAME_PAD_PX,
    };
};
