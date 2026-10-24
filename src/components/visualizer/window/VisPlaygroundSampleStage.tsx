import React, { useCallback, useMemo, useRef } from 'react';
import { MotionConfig } from 'framer-motion';
import { stageStyle, useBoxSize } from '../preview/LivePicture';
import { useWindowSize } from '../preview/LyricPreviewContext';
import { frameStage, stageAboveBox, stageBelowBox } from '../preview/previewScale';
import { HARMONY_TOP_PX, HarmonyTopContext } from '../VisualizerHarmonyOverlay';
import { PreviewBottomBarOffsetContext } from '../../floating-player/PlayerBottomBarLayoutContext';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    PLAYER_SUBTITLE_BOTTOM_PX,
    resolveUnscaledSubtitleBarOffset,
} from '../../../utils/playerBottomBarLayout';

// src/components/visualizer/window/VisPlaygroundSampleStage.tsx
// The stage of the big sample in the lyric style window, and of Theme Park's sample. Several
// styles lay themselves out from the size of the app's window (window.innerWidth, vw, vh), not of
// the box they are in, so the sample draws them as the small pictures do (LivePicture): on a stage
// as large as the window, scaled down to the sample's box. The box has the window's shape
// (SampleBox), so the style lays out as on the playing page of this screen, all of it shows and
// nothing is cut or zoomed. Only what is drawn is scaled: the sample's own buttons lie over it,
// outside this stage.

type SampleBoxProps = {
    /** Sizes the room the box is put in: it takes all of it that the window's shape allows. */
    room: string;
    className: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
};

/**
 * The sample's box: the shape of the app's window, as large as its room allows, centred there. The
 * room is a size container, so its size comes from its parent, never from the box in it.
 */
export const SampleBox: React.FC<SampleBoxProps> = ({ room, className, style, children }) => {
    const { width, height } = useWindowSize();
    return (
        <div className={`grid place-items-center [container-type:size] ${room}`}>
            <div className={className} style={{ ...style, aspectRatio: `${width} / ${height}`, width: `min(100cqw, 100cqh * ${width / height})` }}>
                {children}
            </div>
        </div>
    );
};

type VisPlaygroundSampleStageProps = {
    children: React.ReactNode;
    /**
     * Where the sample lays a bar of its own over the stage's bottom, unscaled (Theme Park's song
     * card): how far above the box's bottom the shared subtitle sits, in the box's pixels, instead of
     * shrinking with the stage and falling behind that bar. Without one it sits where the playing
     * page puts it, made smaller with the stage.
     */
    subtitleBottomPx?: number;
};

/**
 * How far inside the stage's edges the unscaled frame cuts it (previewScale.frameStage). One CSS
 * pixel is at least the half device pixel the frame's edge may be rounded outwards by.
 */
const FRAME_EDGE = 1;

const VisPlaygroundSampleStage: React.FC<VisPlaygroundSampleStageProps> = ({ children, subtitleBottomPx }) => {
    const windowSize = useWindowSize();
    const boxRef = useRef<HTMLDivElement>(null);
    const box = useBoxSize(boxRef);
    // The box has the window's shape to a pixel: filling it grows the stage by that pixel and the
    // frame's edges only, so no band of the box is left empty.
    const framed = useMemo(() => box && frameStage(windowSize, box, FRAME_EDGE, true), [windowSize, box]);
    const scale = framed?.place.scale ?? 1;
    // framer-motion reads the pointer in the page's pixels: on a stage drawn at `scale` a drag (Monet's
    // portrait) must move by the stage's pixels to stay under the pointer.
    const toStagePoint = useCallback((point: { x: number; y: number }) => ({ x: point.x / scale, y: point.y / scale }), [scale]);
    const subtitleBarOffset = framed && box
        ? resolveUnscaledSubtitleBarOffset(scale, stageBelowBox(framed, box), subtitleBottomPx ?? PLAYER_SUBTITLE_BOTTOM_PX * scale)
        : PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    // The harmony line at the top keeps its distance below the box's top as the subtitle keeps it above
    // the bottom, so the frame's edge never cuts it.
    const harmonyTop = framed
        ? (HARMONY_TOP_PX * scale + stageAboveBox(framed)) / scale
        : HARMONY_TOP_PX;

    return (
        <div ref={boxRef} className="absolute inset-0">
            {framed && (
                // The stage is cut by this unscaled frame, not by its own edges under the scale: see frameStage.
                <div className="absolute overflow-hidden" style={framed.frame}>
                    <div className="absolute origin-top-left" style={stageStyle(framed.stage, framed.place) ?? undefined}>
                        <PreviewBottomBarOffsetContext.Provider value={subtitleBarOffset}>
                            <HarmonyTopContext.Provider value={harmonyTop}>
                                <MotionConfig transformPagePoint={toStagePoint}>{children}</MotionConfig>
                            </HarmonyTopContext.Provider>
                        </PreviewBottomBarOffsetContext.Provider>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisPlaygroundSampleStage;
