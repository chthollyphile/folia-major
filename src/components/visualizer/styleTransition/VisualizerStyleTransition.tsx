import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { VisualizerMode } from '../../../types';
import { VisualizerBackdropContext } from '../VisualizerBackdrop';
import { holdTurns } from '../preview/pictureTurns';
import { FirstFrameContext, type FirstFrameReport } from './firstFrame';
import { useLayerAnimation, useShownLayers, type LayerTransition, type ShownLayer } from './layerTransition';

// src/components/visualizer/styleTransition/VisualizerStyleTransition.tsx
// The lyric style layer of VisualizerRenderer, inside its backdrop: the style on screen and, while a
// switch plays, the one leaving. The backdrop around it keeps its stage layers and video layer; its
// background changes with the same transition only where the new style is drawn over another one
// (VisualizerBackgroundTransition). The leaving style keeps running (a living picture fades better
// than a frozen one, and it is a few hundred milliseconds).
//
// A switch waits for the new style's first frame (firstFrame.ts): the new style is mounted at once
// but unseen, the one on screen stays as it is, and the transition starts once the new one has drawn.
// A start that compiles shaders or lays out a whole song is one long task, and in the middle of the
// transition it stopped it halfway, over a new style that had drawn nothing yet. While a switch waits
// or plays, no small picture starts (pictureTurns): its own start would land in the transition.

/**
 * How long a switch waits for the new style's first frame before its transition starts anyway, so a
 * style that never says it has drawn still switches. Only the time before the start's long task
 * counts: a timer cannot fire inside a task, and one that runs out during it fires after it.
 * Measured on a production build limited to four slow cores, from the player panel: that task began
 * at most 0.4 s after the new style was mounted (the shaders of 商籁, 凝彩, 绘光 and 镜台, the layout
 * of 浮名), and the switches waited 0.3 to 1.3 s, 浮名's first layout of a song 2.9 s (it is laid out
 * in slices since, which the timer runs between: the article was in 1.3 to 1.6 s after the click for
 * a 32-line song, so a longer song can outlast the limit and show its hourglass). This leaves
 * room for a slower machine; a limit that runs out before the start is busy only brings back how it was.
 */
export const FIRST_FRAME_LIMIT_MS = 1500;

/** The styles of a renderer while it switches: VisualizerRenderer keeps them, its background follows. */
export interface StyleSwitch {
    styles: readonly ShownLayer<VisualizerMode>[];
    onLeft: (key: number) => void;
    onStart: (key: number) => void;
    /** The switch waits for the new style's first frame: a background change made with it waits too. */
    waits: boolean;
}

/**
 * Draws a style in a frame of the host's own, inside the style's layer, so the switch's blur and fade
 * cover the frame too: the sample of the lyric style window and of Theme Park zooms Monet more than
 * the rest, and a switch between them then shows each style leaving and coming in at its own size.
 * Null (most hosts): the style is drawn as it is.
 */
export const StyleFrameContext = createContext<((mode: VisualizerMode, content: React.ReactNode) => React.ReactNode) | null>(null);

/** The styles to draw for `mode`, with the transition a switch plays, or null to cut. */
export const useStyleSwitch = (mode: VisualizerMode, transition: LayerTransition | null): StyleSwitch => {
    const animate = transition !== null;
    const [styles, onLeft, onStart] = useShownLayers(mode, animate, animate);
    const newest = styles[styles.length - 1];
    const waitingKey = newest.waits ? newest.key : null;
    useEffect(() => {
        if (waitingKey === null) return undefined;
        const limit = window.setTimeout(() => onStart(waitingKey), FIRST_FRAME_LIMIT_MS);
        return () => window.clearTimeout(limit);
    }, [waitingKey, onStart]);
    return { styles, onLeft, onStart, waits: newest.waits };
};

interface StyleLayerProps {
    style: ShownLayer<VisualizerMode>;
    transition: LayerTransition | null;
    onLeft: (key: number) => void;
    onStart: (key: number) => void;
    children: React.ReactNode;
}

/*
 * One style, in a box the size of the backdrop. The box takes no pointer itself, so stage layers under
 * the style still get it (the style's shell gives the style back the pointer); a leaving style is inert,
 * and its shell no longer reads the pointer on the backdrop's box, so only the style on screen shows the
 * back button and the player panel guide. At rest the box has no opacity, filter or transform, so it
 * groups nothing: the style's layers stack with the stage layers as they did without it.
 */
const StyleLayer: React.FC<StyleLayerProps> = ({ style, transition, onLeft, onStart, children }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayerAnimation(ref, style, transition, onLeft, holdTurns);
    const { key, leaving } = style;
    const backdrop = useContext(VisualizerBackdropContext);
    const frame = useMemo(() => (backdrop && leaving ? { ...backdrop, pointerArea: null } : backdrop), [backdrop, leaving]);
    // Only the new style of a switch that waits starts it, so a report that changes nothing (a style
    // that reports again on a new song, the style leaving) sets no state: React keeps such an update
    // queued, and the renders after it started again from the styles before the switch.
    const startsSwitch = style.waits && !leaving;
    const startsRef = useRef(startsSwitch);
    useLayoutEffect(() => {
        startsRef.current = startsSwitch;
        // Gone, it starts nothing: a style's report can come after its layer was replaced.
        return () => {
            startsRef.current = false;
        };
    }, [startsSwitch]);
    const claimed = useRef(false);
    const firstFrame = useMemo<FirstFrameReport>(() => ({
        claim: () => {
            claimed.current = true;
        },
        drawn: () => {
            if (startsRef.current) onStart(key);
        },
    }), [onStart, key]);
    // After the style's own layout effects, before the page is painted: a style that does not say when
    // it has drawn is ready now.
    useLayoutEffect(() => {
        if (!claimed.current && startsRef.current) onStart(key);
    }, [onStart, key]);

    return (
        <div ref={ref} className="absolute inset-0" style={{ pointerEvents: 'none' }} inert={leaving} data-visualizer-style={style.value}>
            <VisualizerBackdropContext.Provider value={frame}>
                <FirstFrameContext.Provider value={firstFrame}>{children}</FirstFrameContext.Provider>
            </VisualizerBackdropContext.Provider>
        </div>
    );
};

interface VisualizerStyleTransitionProps {
    /** The styles to show (useStyleSwitch). */
    styleSwitch: StyleSwitch;
    /** The transition a switch plays, or null to cut. */
    transition: LayerTransition | null;
    renderStyle: (mode: VisualizerMode) => React.ReactNode;
}

const VisualizerStyleTransition: React.FC<VisualizerStyleTransitionProps> = ({ styleSwitch, transition, renderStyle }) => {
    const { styles, onLeft, onStart } = styleSwitch;
    const frameStyle = useContext(StyleFrameContext);

    // Oldest first: the new style is drawn over the leaving one, and neither box moves in the page.
    return (
        <>
            {styles.map(style => (
                <StyleLayer key={style.key} style={style} transition={transition} onLeft={onLeft} onStart={onStart}>
                    {frameStyle ? frameStyle(style.value, renderStyle(style.value)) : renderStyle(style.value)}
                </StyleLayer>
            ))}
        </>
    );
};

export default VisualizerStyleTransition;
