import React, { Suspense, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copyImage, followCanvases, freezeStage, WAIT_MARK, watchStage } from './frozenPicture';
import { useLyricPreview } from './LyricPreviewContext';
import { imageOf, keepImage, subscribeImages } from './pictureImages';
import { afterTry, imageRest, LIVE_REST_MS, pictureWants, type TryEnd } from './pictureRule';
import { claimRun, takeTurn, useIsRunning, whenFree } from './pictureTurns';
import { coverStage, type Size, type StagePlace } from './previewScale';

// src/components/visualizer/preview/LivePicture.tsx
// One small picture of something that moves: a lyric style, a background. It fills the frame it is
// put in with the previewed theme's background colour.
//
// What moves is drawn on a stage as large as the app's window, where it lays out as on the playing
// page, and the stage is scaled down to cover the frame. It is drawn there twice only. Once to
// make the image: when the picture's turn comes it is drawn out of sight on a stopped clock, what
// it drew is kept (frozenPicture) and it is taken away. And while the pointer rests on the picture:
// then it runs over its image, and takes the image's place once it has drawn. At every other
// moment the picture is its image. When an image is made is decided in pictureRule. Until it has
// an image, and where none can be made, the picture shows its glyph.

type LivePictureProps = {
    /** Everything the picture shows, as one text (pictureKey): the image is kept while it stays the same. */
    imageKey: string;
    /** As the picture grid reports them (PictureState). */
    visible: boolean;
    chosen: boolean;
    active: boolean;
    /** Stands in where no image can be made. */
    glyph: React.ReactNode;
    /** Draws the real thing on the stage: running with the clock, or held at the still moment. */
    children: (running: boolean) => React.ReactNode;
};

/** Runs `run` when the page has a moment, half a second later at most. The function returned takes it back. */
const whenIdle = (run: () => void): (() => void) => {
    if (typeof window.requestIdleCallback !== 'function') {
        const timer = window.setTimeout(run, 50);
        return () => window.clearTimeout(timer);
    }
    const idle = window.requestIdleCallback(run, { timeout: 500 });
    return () => window.cancelIdleCallback(idle);
};

type PictureFrameProps = {
    glyph?: React.ReactNode;
    /** The colour behind the picture, where it is not the previewed theme's: an image of an earlier theme keeps that theme's. */
    surface?: string;
    children?: React.ReactNode;
};

/** The frame of a picture: the theme's background colour, and a glyph in the middle if one is given. */
export const PictureFrame = React.forwardRef<HTMLDivElement, PictureFrameProps>(({ glyph, surface, children }, ref) => {
    const { theme } = useLyricPreview();
    return (
        <div
            ref={ref}
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ backgroundColor: surface ?? theme.backgroundColor, color: theme.primaryColor }}
        >
            {children}
            {glyph && <div className="absolute inset-0 grid place-items-center opacity-50">{glyph}</div>}
        </div>
    );
});

PictureFrame.displayName = 'PictureFrame';

/** A stage of the given size, scaled and moved to its place in a box (previewScale); null while it has none. */
export const stageStyle = (stage: Size, place: StagePlace | null): React.CSSProperties | null => place && {
    left: place.left,
    top: place.top,
    width: stage.width,
    height: stage.height,
    transform: `scale(${place.scale})`,
    // The stage has its size from here, whatever is drawn on it.
    contain: 'strict',
};

/** The inner size of the element `ref` holds, followed as it changes; null until it is first measured. */
export const useBoxSize = (ref: React.RefObject<HTMLElement | null>): Size | null => {
    const [box, setBox] = useState<Size | null>(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) {
            return undefined;
        }
        const measure = () => setBox(before => (
            before && before.width === node.clientWidth && before.height === node.clientHeight
                ? before
                : { width: node.clientWidth, height: node.clientHeight }
        ));
        measure();
        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [ref]);
    return box;
};

type StageBoundaryProps = {
    /** The style threw while it was drawn, or its module did not load. */
    onThrow: () => void;
    children: React.ReactNode;
};

/**
 * Around what a style draws on a picture's stage. A style that throws there, or whose module does
 * not load, takes down what is inside this boundary only: not the picker, and not the playing page.
 */
export class PictureStageBoundary extends React.Component<StageBoundaryProps, { threw: boolean }> {
    state = { threw: false };

    static getDerivedStateFromError() {
        return { threw: true };
    }

    componentDidCatch(error: unknown) {
        console.warn('[LivePicture] A style threw on the stage of a picture:', error);
        this.props.onThrow();
    }

    render() {
        return this.state.threw ? null : this.props.children;
    }
}

/** An image on the stage: a copy of its elements, put there by hand. React draws nothing inside. */
const ImageOnStage: React.FC<{ image: HTMLElement; style: React.CSSProperties }> = ({ image, style }) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        ref.current?.replaceChildren(...copyImage(image).childNodes);
    }, [image]);
    return <div ref={ref} inert data-picture="image" className="absolute origin-top-left" style={style} />;
};

export const LivePicture: React.FC<LivePictureProps> = ({ imageKey, visible, chosen, active, glyph, children }) => {
    const { stage, theme, making: mayMake } = useLyricPreview();
    const id = useId();
    const boxRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const box = useBoxSize(boxRef);
    const [making, setMaking] = useState(false);
    const [liveDrawn, setLiveDrawn] = useState(false);
    const image = useSyncExternalStore(subscribeImages, () => imageOf(imageKey));
    const live = useIsRunning(id);
    const wants = pictureWants({ visible, chosen, active });
    // While an image for new settings is made, the one before it stays, as it was made: on the
    // background colour of its theme (words drawn for a dark theme stay readable when the theme
    // turns light) and on a stage of its size (it is still whole after the window changed size).
    const [shown, setShown] = useState({ image: image ?? null, surface: theme.backgroundColor, stage });
    if (image !== undefined && (image !== shown.image || theme.backgroundColor !== shown.surface || stage !== shown.stage)) {
        setShown({ image, surface: theme.backgroundColor, stage });
    }
    const shownImage = shown.image;

    const onStage = box ? stageStyle(stage, coverStage(stage, box)) : null;
    const imageOnStage = box ? stageStyle(shown.stage, coverStage(shown.stage, box)) : null;
    const hasPlace = onStage !== null;
    // Without a place there is no stage to draw on: a picture that asked for its turn then would keep it.
    // How many tries to make the image of these settings came to nothing.
    const [emptyTries, setEmptyTries] = useState({ key: imageKey, count: 0 });
    const tried = emptyTries.key === imageKey ? emptyTries.count : 0;
    const rest = hasPlace ? imageRest({ allowed: mayMake, wants, chosen, made: image !== undefined, shows: shownImage !== null, tried }) : null;

    // A try has ended (pictureRule.afterTry). Whatever is kept, the turn goes back: an image that
    // exists, also the knowledge that none can be made, ends the wait for one.
    const endTry = (end: TryEnd, node: HTMLElement | null) => {
        const next = afterTry(end, tried);
        if (next === 'again') {
            setEmptyTries({ key: imageKey, count: tried + 1 });
            return;
        }
        let kept: HTMLElement | null = null;
        if (next === 'keep' && node) {
            try {
                kept = freezeStage(node);
            } catch (error) {
                console.warn('[LivePicture] A stage could not be copied:', error);
            }
        }
        keepImage(imageKey, kept);
    };

    // On screen without an image of what it shows now: once that has rested (a slider that is
    // dragged changes it many times a second), wait for the turn, then for a moment the page is
    // idle in, and then for the page to be done switching its lyric style.
    useEffect(() => {
        if (rest === null) {
            return undefined;
        }
        let stopIdle: (() => void) | undefined;
        let stopWaiting: (() => void) | undefined;
        let giveBack: (() => void) | undefined;
        const timer = window.setTimeout(() => {
            giveBack = takeTurn(() => {
                stopIdle = whenIdle(() => {
                    stopWaiting = whenFree(() => setMaking(true));
                });
            });
        }, rest);
        return () => {
            window.clearTimeout(timer);
            stopIdle?.();
            stopWaiting?.();
            giveBack?.();
            setMaking(false);
        };
    }, [rest, imageKey, tried]);

    // Its turn: once the style has drawn and stands still, what it drew is kept.
    useEffect(() => {
        const node = stageRef.current;
        if (!making || !node) {
            return undefined;
        }
        return watchStage(node, 'still', end => endTry(end, node));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [making, hasPlace, imageKey]);

    // The pointer rests on it: it becomes the one picture that runs, once the page is done switching
    // its lyric style.
    const mayRun = wants === 'live' && Boolean(image);
    useEffect(() => {
        if (!mayRun) {
            return undefined;
        }
        let stop: (() => void) | undefined;
        let stopWaiting: (() => void) | undefined;
        const timer = window.setTimeout(() => {
            stopWaiting = whenFree(() => {
                stop = claimRun(id);
            });
        }, LIVE_REST_MS);
        return () => {
            window.clearTimeout(timer);
            stopWaiting?.();
            stop?.();
        };
    }, [mayRun, id]);

    // Running: the image stays until the style has drawn.
    useEffect(() => {
        const node = stageRef.current;
        if (!live || !node) {
            return undefined;
        }
        // A style that shows nothing stays behind its image.
        const stop = watchStage(node, 'drawn', end => setLiveDrawn(end === 'shown'));
        return () => {
            stop();
            setLiveDrawn(false);
        };
    }, [live, hasPlace]);

    // A stage that is taken down gives back the WebGL contexts its style left behind. This runs
    // after the style's own clean-up, which React runs first for what it takes away.
    const staged = making || live;
    useEffect(() => {
        const node = stageRef.current;
        return staged && node ? followCanvases(node) : undefined;
    }, [staged, hasPlace]);

    const showsLive = live && liveDrawn;

    return (
        // The glyph stands in for as long as the picture has no image to show.
        <PictureFrame ref={boxRef} surface={showsLive || !shownImage ? undefined : shown.surface} glyph={!shownImage && !showsLive ? glyph : undefined}>
            {shownImage && imageOnStage && !showsLive && <ImageOnStage image={shownImage} style={imageOnStage} />}
            {(making || live) && onStage && (
                <div ref={stageRef} inert data-picture={live ? 'running' : 'making'} className="absolute origin-top-left" style={{ ...onStage, opacity: showsLive ? 1 : 0 }}>
                    {/* A style's module loads when it is first drawn: until then the stage says that it waits. */}
                    <PictureStageBoundary key={live ? 'running' : 'making'} onThrow={() => (live ? undefined : endTry('failed', null))}>
                        <Suspense fallback={<i {...{ [WAIT_MARK]: '' }} />}>{children(live)}</Suspense>
                    </PictureStageBoundary>
                </div>
            )}
        </PictureFrame>
    );
};

export default LivePicture;
