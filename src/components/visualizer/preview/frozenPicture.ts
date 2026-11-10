import type { TryEnd } from './pictureRule';

// src/components/visualizer/preview/frozenPicture.ts
// Turns a style that is drawn on a stage into an image, so that the style can be taken away: the
// stage's elements are copied as they stand, and every canvas among them is copied onto a plain
// 2D canvas. The copy has no script behind it, no loop and no WebGL context. It works the same
// for a style drawn with elements, one drawn on a canvas, and one that mixes the two.
//
// A WebGL canvas can be read only in the frame it was drawn in, after the draw: read at any other
// moment it comes back empty. So the stage is looked at once a frame, after the frame's own
// callbacks have run, and a canvas that reads empty is read again in the next frame.

/** The widest a copied canvas is, in px: twice the widest picture on screen. */
const IMAGE_CANVAS_WIDTH = 384;
/** A style stands still when none of its elements changed for this long. */
const QUIET_MS = 160;
/** The least time between a style's first drawing and its image: words that arrive are let in. */
const SETTLE_MIN_MS = 350;
/** A style that never stands still is taken as it is after this long. */
const SETTLE_MAX_MS = 1000;
/**
 * A canvas that stays empty holds a stage that shows a word or a picture back for this long: a
 * canvas a style draws on only now and then is empty for good, one that WebGL has not drawn on
 * yet is not. A stage that shows only painted boxes beside it is held back until the wait is over.
 */
const EMPTY_CANVAS_MS = 1000;
/** The longest a stage is watched. One that shows something by then is taken as it stands; one that shows nothing ends as 'empty'. */
const GIVE_UP_MS = 4000;
/** Set on what stands in for a style while its module loads. */
export const WAIT_MARK = 'data-picture-wait';
/**
 * Set by what is drawn on a stage for as long as a part of it is still to come: a background whose
 * cover is loading or fading in. The stage is held back meanwhile, and taken as it stands when the
 * wait is over.
 */
export const ARRIVING_MARK = 'data-picture-arriving';

const PROBE = { width: 64, height: 40 };
let probe: CanvasRenderingContext2D | null = null;

/** Whether nothing is drawn on a canvas: every pixel the same. Read on a small copy. */
const isBlank = (canvas: HTMLCanvasElement): boolean => {
    if (!probe) {
        const scratch = document.createElement('canvas');
        scratch.width = PROBE.width;
        scratch.height = PROBE.height;
        probe = scratch.getContext('2d', { willReadFrequently: true });
        if (probe) {
            // Averages the pixels it skips, so thin strokes are not stepped over.
            probe.imageSmoothingQuality = 'high';
        }
    }
    if (!probe) {
        return false;
    }
    try {
        probe.clearRect(0, 0, PROBE.width, PROBE.height);
        probe.drawImage(canvas, 0, 0, PROBE.width, PROBE.height);
        const pixels = new Uint32Array(probe.getImageData(0, 0, PROBE.width, PROBE.height).data.buffer);
        return pixels.every(pixel => pixel === pixels[0]);
    } catch {
        // A canvas with a picture from another origin on it cannot be read, and the small copy it
        // was drawn onto cannot be read again either: the next read gets a new one. Such a canvas
        // has something drawn on it.
        probe = null;
        return false;
    }
};

/** The canvases of a stage that have a size, each with whether it reads empty at this moment. */
const readCanvases = (stage: HTMLElement) => (
    [...stage.querySelectorAll('canvas')]
        .filter(canvas => canvas.width > 0 && canvas.height > 0)
        .map(canvas => ({ canvas, blank: isBlank(canvas) }))
);

/** How many of a stage's elements are asked what they paint: a background is a handful of boxes. */
const PAINT_PROBED = 60;

/**
 * Whether a box of the stage paints a picture or a gradient as its CSS background: a background
 * drawn with plain boxes (the cover blurred, a wash of gradients) shows itself this way only.
 * A box of no size, and one with no opacity, paints nothing.
 */
const paintsBoxes = (stage: HTMLElement): boolean => (
    [...stage.querySelectorAll<HTMLElement>('*')].slice(0, PAINT_PROBED).some((element) => {
        const style = getComputedStyle(element);
        return Boolean(style.backgroundImage) && style.backgroundImage !== 'none'
            && style.opacity !== '0' && element.offsetWidth > 0 && element.offsetHeight > 0;
    })
);

/**
 * What a stage shows at this moment. `shows`: its module is there and it has a word, a picture, a
 * canvas with something drawn, or a box that paints a picture. `whole`: none of its canvases is
 * empty. `waits`: what it shows is not yet the whole picture. Either what is drawn says so
 * (ARRIVING_MARK), or painted boxes are all it shows and a canvas of it is still empty: that
 * canvas may be about to draw.
 */
const readStage = (stage: HTMLElement): { shows: boolean; whole: boolean; waits: boolean } => {
    if (!stage.firstElementChild || stage.querySelector(`[${WAIT_MARK}]`)) {
        return { shows: false, whole: false, waits: false };
    }
    const canvases = readCanvases(stage);
    const whole = canvases.every(entry => !entry.blank);
    const drew = canvases.some(entry => !entry.blank)
        || Boolean(stage.textContent?.trim())
        || stage.querySelector('svg, img') !== null;
    const boxes = !drew && paintsBoxes(stage);
    const arriving = stage.querySelector(`[${ARRIVING_MARK}]`) !== null;
    return { shows: drew || boxes, whole, waits: arriving || (boxes && !whole) };
};

/** Whether an animation of the stage is on its way to an end: one that repeats for ever is not. */
const isArriving = (stage: HTMLElement): boolean => stage.getAnimations({ subtree: true }).some(animation => (
    animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))
));

/**
 * Watches a stage until its style has drawn ('drawn') or has drawn and stands still ('still'),
 * then calls `done('shown')` in a frame, after the style's own drawing: a canvas can be copied
 * there. When the wait is over it calls `done` as well: 'shown' where the stage shows something,
 * 'empty' where it shows nothing. Reading the stage threw: `done('failed')`. It calls `done` once.
 * The function returned stops watching.
 */
export const watchStage = (stage: HTMLElement, until: 'drawn' | 'still', done: (end: TryEnd) => void): (() => void) => {
    const started = performance.now();
    let changedAt = started;
    let shownAt = 0;
    let timer = 0;
    let frame = 0;
    const observer = new MutationObserver(() => {
        changedAt = performance.now();
    });
    if (until === 'still') {
        observer.observe(stage, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    const stop = () => {
        observer.disconnect();
        window.clearTimeout(timer);
        window.cancelAnimationFrame(frame);
    };
    // A frame asked for from a timer runs after the callbacks that loops asked for inside the frame before.
    const wait = () => {
        timer = window.setTimeout(() => {
            frame = window.requestAnimationFrame(look);
        });
    };
    /** How the watch ends in this frame; null where it goes on. */
    const read = (): TryEnd | null => {
        const now = performance.now();
        const { shows, whole, waits } = readStage(stage);
        // A stage that waits does not start the clock: it is taken when the wait is over.
        const ready = shows && !waits;
        if (ready && !shownAt) {
            shownAt = now;
        }
        const drawn = ready && (whole || now - shownAt >= EMPTY_CANVAS_MS);
        const still = () => now - shownAt >= SETTLE_MIN_MS
            && ((now - changedAt >= QUIET_MS && !isArriving(stage)) || now - shownAt >= SETTLE_MAX_MS);
        if (drawn && (until === 'drawn' || still())) {
            return 'shown';
        }
        if (now - started >= GIVE_UP_MS) {
            return shows ? 'shown' : 'empty';
        }
        return null;
    };
    const look = () => {
        let end: TryEnd | null;
        try {
            end = read();
        } catch (error) {
            console.warn('[LivePicture] A stage could not be read:', error);
            end = 'failed';
        }
        if (end) {
            stop();
            done(end);
            return;
        }
        wait();
    };
    wait();
    return stop;
};

/** Draws `from` onto `to`, a canvas of the copy, no wider than an image needs. */
const copyCanvas = (from: HTMLCanvasElement, to: HTMLCanvasElement, width = Math.min(from.width, IMAGE_CANVAS_WIDTH)) => {
    to.width = Math.max(1, width);
    to.height = Math.max(1, Math.round((from.height * width) / Math.max(1, from.width)));
    const context = to.getContext('2d');
    if (context) {
        context.imageSmoothingQuality = 'high';
        context.drawImage(from, 0, 0, to.width, to.height);
    }
};

const cssName = (property: string) => property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/**
 * Copies what is on the stage at this moment: its elements, each canvas as a flat picture, and an
 * element that an animation is moving as it looks now, with the animation taken off. Null where
 * the stage shows nothing: an empty picture. Call it from `watchStage`'s `done`.
 */
export const freezeStage = (stage: HTMLElement): HTMLElement | null => {
    if (!readStage(stage).shows) {
        return null;
    }
    const image = stage.cloneNode(true) as HTMLElement;
    const twins = image.querySelectorAll('canvas');
    stage.querySelectorAll('canvas').forEach((canvas, index) => {
        const twin = twins[index];
        // A canvas is laid out by its own size where no style gives it one: the copy is smaller, so it is told.
        twin.style.width = `${canvas.offsetWidth}px`;
        twin.style.height = `${canvas.offsetHeight}px`;
        if (canvas.width > 0 && canvas.height > 0) {
            copyCanvas(canvas, twin);
        }
    });

    const elements = [...stage.querySelectorAll('*')];
    const copies = image.querySelectorAll<HTMLElement | SVGElement>('*');
    // Nothing in an image will change: a layer of its own for an element costs the page every frame.
    copies.forEach((copy) => {
        copy.style.willChange = 'auto';
    });
    for (const animation of stage.getAnimations({ subtree: true })) {
        const effect = animation.effect as KeyframeEffect | null;
        const copy = effect?.target && !effect.pseudoElement ? copies[elements.indexOf(effect.target)] : undefined;
        if (!effect?.target || !copy) {
            continue;
        }
        const now = getComputedStyle(effect.target);
        for (const keyframe of effect.getKeyframes()) {
            for (const property of Object.keys(keyframe)) {
                if (property !== 'offset' && property !== 'computedOffset' && property !== 'easing' && property !== 'composite') {
                    copy.style.setProperty(cssName(property), now.getPropertyValue(cssName(property)));
                }
            }
        }
        copy.style.animation = 'none';
    }
    return image;
};

/**
 * Notes every canvas that comes onto a stage. The function returned is called once the style has
 * been taken away: it gives back the WebGL context of each canvas that still holds one. A style
 * that only takes its canvas out (the Paper shaders of nomand and latent do, and so does sora) keeps
 * that context until the browser collects the canvas, which may be much later (measured: still
 * there after 18 s), and the page has 16.
 */
export const followCanvases = (stage: HTMLElement): (() => void) => {
    const canvases = new Set<HTMLCanvasElement>(stage.querySelectorAll('canvas'));
    const note = (records: MutationRecord[]) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                if (node instanceof HTMLCanvasElement) {
                    canvases.add(node);
                } else if (node instanceof Element) {
                    node.querySelectorAll('canvas').forEach(canvas => canvases.add(canvas));
                }
            });
        }
    };
    const observer = new MutationObserver(note);
    observer.observe(stage, { subtree: true, childList: true });
    return () => {
        note(observer.takeRecords());
        observer.disconnect();
        for (const canvas of canvases) {
            try {
                // A canvas drawn on in 2D, or never drawn on, has no WebGL context: asking for a 2D
                // one answers that without making a WebGL context.
                if (canvas.getContext('2d')) {
                    continue;
                }
                const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
                if (gl && !gl.isContextLost()) {
                    gl.getExtension('WEBGL_lose_context')?.loseContext();
                }
            } catch {
                // A canvas handed to a worker gives no context here: nothing to give back.
            }
        }
    };
};

/** One more copy of an image, to put on screen: an element is in one place only, and an image may show in several. */
export const copyImage = (image: HTMLElement): HTMLElement => {
    const copy = image.cloneNode(true) as HTMLElement;
    const twins = copy.querySelectorAll('canvas');
    image.querySelectorAll('canvas').forEach((canvas, index) => {
        if (canvas.width > 0 && canvas.height > 0) {
            copyCanvas(canvas, twins[index], canvas.width);
        }
    });
    return copy;
};
