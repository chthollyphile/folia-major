import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { VisualizerBackgroundMode } from '../../../types';
import type { VisualizerBackgroundConfig, VisualizerBackgroundRenderProps } from '../backgrounds/definition';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE, getVisualizerBackgroundRegistryEntry } from '../backgrounds/registry';
import { FirstFrameContext, LayerUnseenContext, type FirstFrameReport } from './firstFrame';
import { useLayerAnimation, useShownLayers, type LayerTransition, type ShownLayer } from './layerTransition';

// src/components/visualizer/styleTransition/VisualizerBackgroundTransition.tsx
// The background layer of a backdrop: the background on screen and, while a change plays, the one
// leaving, with the style switch's transition. A change is another background type, a background
// coming or going (a style drawn over none, the player page made transparent), or a new song where the
// background draws the song (its entry's `song`: the cover, the seed). A setting inside one type is not
// a change: that background redraws in place, as it did. The new background is mounted unseen and the
// change starts once it is ready (firstFrame.ts: its cover decoded, its picture made), or after
// BACKGROUND_READY_LIMIT_MS. A style switch that changes the background starts both transitions in the
// same frame, so they play as one: while the switch waits for the new style's first frame, the
// background change waits with it. A background leaving for another one stays as it is under the new
// one until that has come in (underNext): a background covers the whole backdrop, and two fading at once
// would let the page behind them through.

/** How long a background change waits for the new background to say it is ready before it starts anyway. */
export const BACKGROUND_READY_LIMIT_MS = 1000;

/** Which background a backdrop draws: its type, or null for none. */
export const shownBackgroundMode = (config: VisualizerBackgroundConfig | undefined, drawn: boolean): VisualizerBackgroundMode | null => (
    drawn && !config?.transparent ? config?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE : null
);

/** `config` drawn as the background `mode`: as it is where it draws that one already. */
const drawnAs = (config: VisualizerBackgroundConfig | undefined, mode: VisualizerBackgroundMode): VisualizerBackgroundConfig | undefined => (
    shownBackgroundMode(config, true) === mode ? config : { ...config, mode, transparent: false }
);

/**
 * The background a backdrop draws as one value, its type and what it draws of the song, or null for
 * none: a background whose value changes is changed as a whole. Song inputs of a type without `song`
 * are not part of it, nor any where the host does not `animate`: there a new copy would come in before
 * it has loaded, and the copy on screen changes in place as it did, with its own fades.
 */
export const shownBackground = (inputs: VisualizerBackgroundRenderProps, drawn: boolean, animate: boolean): string | null => {
    const mode = shownBackgroundMode(inputs.config, drawn);
    if (mode === null) return null;
    const song = animate ? getVisualizerBackgroundRegistryEntry(mode).song?.({ ...inputs, config: drawnAs(inputs.config, mode) }) ?? [] : [];
    return JSON.stringify([mode, ...song]);
};

const modeOf = (background: string): VisualizerBackgroundMode => (JSON.parse(background) as [VisualizerBackgroundMode])[0];

/**
 * How a background leaves when another one comes in over it: at its full look until the new one has
 * come in, then gone. With both fading, the page behind showed through halfway (at the softFocus timings
 * about 15% darker, and darker still at the blurred edges): on a cover, a dark flash at every change.
 */
const underNext = (transition: LayerTransition): LayerTransition => ({
    ...transition,
    leave: {
        to: { opacity: 1, filter: 'none', transform: 'none' },
        duration: (transition.enter.delay ?? 0) + transition.enter.duration,
        easing: 'linear',
    },
});

type RenderBackground = (inputs: VisualizerBackgroundRenderProps) => React.ReactNode;

interface BackgroundLayerProps {
    background: ShownLayer<string | null>;
    /** What the backdrop draws its background with now. */
    inputs: VisualizerBackgroundRenderProps;
    /** The background `inputs` make (shownBackground), a render ahead of the layers. */
    now: string | null;
    transition: LayerTransition | null;
    /** The style switch waits for the new style's first frame. */
    styleWaits: boolean;
    onLeft: (key: number) => void;
    onStart: (key: number) => void;
    render: RenderBackground;
}

/*
 * One background, in a box the size of the backdrop; none has no box and so has left at once. At rest
 * the box has no opacity, filter or transform and no z-index, so it groups nothing: the background's
 * layers stack under the video layer, the stage layers and the style as they did without it.
 */
const BackgroundLayer: React.FC<BackgroundLayerProps> = ({ background, inputs, now, transition, styleWaits, onLeft, onStart, render }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayerAnimation(ref, background, transition, onLeft);
    const { key, value, leaving } = background;
    // Followed while they are this background's own and it is on screen; kept once it leaves (the
    // inputs given then are the next background's: another type, the next song). Kept too while a
    // style switch waits: what the new style changes in place (Fume hiding the shapes) comes with its
    // transition, not before it. Kept in a ref the commit writes, so following them sets no state. What
    // it draws of the song, its config and the theme are kept: the theme is the song's too (a blend's
    // next song brings its own while this one still shows). Pausing and the sound reach it still.
    const keeps = leaving || styleWaits || value !== now;
    const drawnRef = useRef(inputs);
    const kept = drawnRef.current;
    const drawn = keeps ? { ...inputs, config: kept.config, coverUrl: kept.coverUrl, seed: kept.seed, theme: kept.theme } : inputs;
    useLayoutEffect(() => {
        drawnRef.current = drawn;
    });

    // Only the new background of a change that waits starts it, once it is ready and no style switch
    // waits, so a report that changes nothing sets no state (VisualizerStyleTransition says why).
    const startsChange = background.waits && !leaving;
    const startsRef = useRef(false);
    const styleWaitsRef = useRef(styleWaits);
    const readyRef = useRef(false);
    const claimed = useRef(false);
    const start = useCallback(() => {
        if (startsRef.current && readyRef.current && !styleWaitsRef.current) onStart(key);
    }, [onStart, key]);
    const report = useMemo<FirstFrameReport>(() => ({
        claim: () => {
            claimed.current = true;
        },
        drawn: () => {
            readyRef.current = true;
            start();
        },
    }), [start]);
    // After the background's own layout effects: one that does not say when it is ready is ready now.
    useLayoutEffect(() => {
        if (!claimed.current) readyRef.current = true;
    }, []);
    useLayoutEffect(() => {
        startsRef.current = startsChange;
        styleWaitsRef.current = styleWaits;
        start();
        // Gone, it starts nothing: a background's report can come after its layer was replaced.
        return () => {
            startsRef.current = false;
        };
    }, [startsChange, styleWaits, start]);
    useEffect(() => {
        if (!startsChange) return undefined;
        const limit = window.setTimeout(() => report.drawn(), BACKGROUND_READY_LIMIT_MS);
        return () => window.clearTimeout(limit);
    }, [startsChange, report]);

    if (value === null) return null;
    const mode = modeOf(value);
    return (
        <div ref={ref} className="absolute inset-0" inert={leaving} data-visualizer-background={mode}>
            <FirstFrameContext.Provider value={report}>
                <LayerUnseenContext.Provider value={background.waits && !leaving}>
                    {render({ ...drawn, config: drawnAs(drawn.config, mode) })}
                </LayerUnseenContext.Provider>
            </FirstFrameContext.Provider>
        </div>
    );
};

interface VisualizerBackgroundTransitionProps {
    /** What the background is drawn with. */
    inputs: VisualizerBackgroundRenderProps;
    /** False where the style on screen is drawn over no background. */
    drawn: boolean;
    /** The transition a change plays, or null to cut. */
    transition: LayerTransition | null;
    /** The style switch waits for its new style's first frame: a change made with it starts with it. */
    waits: boolean;
    render: RenderBackground;
}

const VisualizerBackgroundTransition: React.FC<VisualizerBackgroundTransitionProps> = ({ inputs, drawn, transition, waits, render }) => {
    // Which background is shown follows a render behind, as the style does (VisualizerRenderer defers
    // it): a style switch and a background change made at once (an appearance import, a mod's saved
    // choices coming back) then reach this layer in the same render and are one change, not a new
    // background cut off by the next one. Until then each background draws what it drew.
    const animate = transition !== null;
    const now = shownBackground(inputs, drawn, animate);
    const shown = useDeferredValue(now);
    const [backgrounds, onLeft, onStart] = useShownLayers(shown, animate, animate);
    const under = useMemo(() => (transition ? underNext(transition) : null), [transition]);
    // A background going to none fades out as the style switch's own; one with another coming over it
    // stays under it. One drawn over the background on screen (a change called back) fades out over it.
    const onScreen = backgrounds.findIndex(background => !background.leaving);
    const nextDrawn = onScreen >= 0 && backgrounds[onScreen].value !== null;

    // Oldest first: the new background is drawn over the leaving one.
    return (
        <>
            {backgrounds.map((background, index) => (
                <BackgroundLayer
                    key={background.key}
                    background={background}
                    inputs={inputs}
                    now={now}
                    transition={background.leaving && nextDrawn && index < onScreen ? under : transition}
                    styleWaits={waits}
                    onLeft={onLeft}
                    onStart={onStart}
                    render={render}
                />
            ))}
        </>
    );
};

export default VisualizerBackgroundTransition;
