import React, { createContext, useMemo, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, Theme } from '../../types';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from './definition';
import VisualizerBackgroundRenderer from './backgrounds/VisualizerBackgroundRenderer';
import VideoLayer from './videoLayer/VideoLayer';
import VisualizerBackgroundTransition from './styleTransition/VisualizerBackgroundTransition';
import type { LayerTransition } from './styleTransition/layerTransition';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { isMainAppSurface } from '../../utils/appSurface';
import { FoliumStageLayerSlot } from '../../mods/folium/registries/stageLayers';

// src/components/visualizer/VisualizerBackdrop.tsx
// What a lyric style is drawn over: the background, and the video layer above it. VisualizerRenderer
// draws them once around whichever style is on screen, so a style switch keeps them; a new copy
// would start again from its first frame (a WebGL context, an image that fades in, cover colours
// read again). Where no renderer is around a style (the style pictures, the mod export window), the
// style's VisualizerShell draws them itself, the same way. Mod stage layers are drawn here too, above
// and below the style, so a style switch keeps them mounted as well. Where the renderer plays the style
// switch's transition, a change of background plays it too (styleTransition/VisualizerBackgroundTransition).

/**
 * Set inside a VisualizerBackdrop: the shell of the style inside leaves the layers, the stage layers and
 * the opacity to it. The shell's own box lets the pointer through to the stage layers under the style,
 * so it reads the pointer on `pointerArea`, the backdrop's box (null until that is on the page, and
 * for a style that is leaving in a style switch).
 */
export interface VisualizerBackdropFrame {
    pointerArea: HTMLElement | null;
}

export const VisualizerBackdropContext = createContext<VisualizerBackdropFrame | null>(null);

export type VisualizerBackdropSharedProps = Pick<
    VisualizerSharedProps,
    | 'coverUrl'
    | 'isDaylight'
    | 'seed'
    | 'background'
    | 'staticMode'
    | 'backgroundStaticMode'
    | 'paused'
    | 'isPreviewMode'
>;

interface VisualizerBackdropLayersProps {
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    sharedProps?: VisualizerBackdropSharedProps;
    renderBackground: boolean;
    /** The transition a background change plays; left out or null, the new background shows at once. */
    transition?: LayerTransition | null;
    /** A background change made now waits to start, with the style switch it is made with. */
    waits?: boolean;
}

/** The layers under a style's lyrics, bottom first. */
export const VisualizerBackdropLayers: React.FC<VisualizerBackdropLayersProps> = ({
    theme,
    audioPower,
    audioBands,
    sharedProps,
    renderBackground,
    transition = null,
    waits = false,
}) => {
    const staticMode = sharedProps?.staticMode ?? false;
    const paused = sharedProps?.paused ?? false;

    return (
        <>
            <VisualizerBackgroundTransition
                inputs={{
                    config: sharedProps?.background,
                    theme,
                    isDaylight: sharedProps?.isDaylight ?? false,
                    coverUrl: getSizedCoverUrl(sharedProps?.coverUrl, 1024) || undefined,
                    audioPower,
                    audioBands,
                    seed: sharedProps?.seed,
                    staticMode: staticMode || (sharedProps?.backgroundStaticMode ?? false),
                    paused,
                    blendMs: transition ? (transition.enter.delay ?? 0) + transition.enter.duration : 0,
                    blendProgress: transition?.progress,
                }}
                drawn={renderBackground}
                transition={transition}
                waits={waits}
                render={inputs => <VisualizerBackgroundRenderer {...inputs} />}
            />

            {/* The built-in video layer follows the same rule as stage layers and stays out of the OBS
                sources, which cannot open the main window's local file handle. */}
            {!sharedProps?.isPreviewMode && !staticMode && isMainAppSurface && <VideoLayer paused={paused} />}
        </>
    );
};

interface VisualizerBackdropProps {
    /** The style on screen: it says which background it is drawn over. */
    entry: VisualizerRegistryEntry;
    props: VisualizerSharedProps;
    /** The transition a background change plays, the style switch's; left out or null to cut. */
    transition?: LayerTransition | null;
    /** The style switch waits for the new style's first frame: a background change made now waits with it. */
    waits?: boolean;
    children: React.ReactNode;
}

/**
 * The style on screen over its layers and between the stage layers, all at the visualizer's opacity.
 * The box is the one the style's shell had (full size, clipped), so the layers sit and paint where they
 * did inside it.
 */
const VisualizerBackdrop: React.FC<VisualizerBackdropProps> = ({ entry, props, transition, waits, children }) => {
    const [pointerArea, setPointerArea] = useState<HTMLDivElement | null>(null);
    const frame = useMemo<VisualizerBackdropFrame>(() => ({ pointerArea }), [pointerArea]);
    // Folium stage layers exist on the real player page only, never in previews.
    const showStageLayers = !props.isPreviewMode && !props.staticMode;
    const stageProps = { theme: props.theme, isDaylight: props.isDaylight ?? false, paused: props.paused ?? false };

    return (
        <div ref={setPointerArea} className="relative w-full h-full overflow-hidden" style={{ opacity: props.visualizerOpacity ?? 1 }}>
            <VisualizerBackdropLayers
                theme={props.theme}
                audioPower={props.audioPower}
                audioBands={props.audioBands}
                sharedProps={entry.background ? { ...props, background: entry.background(props) } : props}
                renderBackground={entry.background !== false}
                transition={transition}
                waits={waits}
            />
            {showStageLayers && <FoliumStageLayerSlot slot="player.stage.back" {...stageProps} />}
            <VisualizerBackdropContext.Provider value={frame}>
                {children}
            </VisualizerBackdropContext.Provider>
            {showStageLayers && (
                <FoliumStageLayerSlot slot="player.stage.front" {...stageProps} className="absolute inset-0 pointer-events-none z-20" />
            )}
        </div>
    );
};

export default VisualizerBackdrop;
