import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMotionSettingsStore } from '../../../stores/useMotionSettingsStore';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { createMotesRuntime, type MotesRuntimeSnapshot } from './motesRuntime';
import { DEFAULT_MOTES_TUNING, type MotesTuning } from './types';

// Motes' React shell keeps discrete lyrics and accessibility separate from its particle canvas.
export interface VisualizerMotesProps extends VisualizerSharedProps {
    tuning?: MotesTuning;
}

const VisualizerMotes: React.FC<VisualizerMotesProps> = (props) => {
    const { currentTime, theme, audioBands, audioPower,
        showText = true, lyricsFontScale = 1, tuning = DEFAULT_MOTES_TUNING } = props;
    // Respect the user's explicit opt-in to the system accessibility preference.
    const reducedMotion = useMotionSettingsStore(state => (
        state.followSystemReducedMotion && state.systemPrefersReducedMotion
    ));
    const { activeLine, recentCompletedLine, upcomingLine, nextLines } = useVisualizerRuntime(props);
    const fontFamily = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, 500);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<ReturnType<typeof createMotesRuntime>>(null);
    const [hasCanvas, setHasCanvas] = useState(true);
    const snapshot = useRef<MotesRuntimeSnapshot>(null!);

    useLayoutEffect(() => {
        snapshot.current = { ...props, tuning, fontFamily, fontWeight, reducedMotion,
            recentCompletedLine, upcomingLine };
        runtimeRef.current?.update();
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const runtime = createMotesRuntime(canvas, () => snapshot.current);
        runtimeRef.current = runtime;
        setHasCanvas(runtime !== null);
        return () => {
            runtime?.dispose();
            runtimeRef.current = null;
        };
    }, [currentTime]);

    return (
        <VisualizerShell theme={theme} audioPower={audioPower} audioBands={audioBands} sharedProps={props}>
            <div className="absolute inset-0 pointer-events-none">
                <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" data-motes-canvas="" />
                <p
                    className={hasCanvas ? 'sr-only' : 'absolute inset-x-4 top-[12%] bottom-[24%] flex items-center justify-center text-center text-3xl whitespace-pre-wrap'}
                    style={{ fontFamily, fontWeight, color: theme.primaryColor }}
                >
                    {showText ? activeLine?.fullText ?? '' : ''}
                </p>
            </div>
            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={props.subtitleTheme}
                {...resolveSubtitleFontSizes(lyricsFontScale)}
                subtitleFontScale={props.subtitleFontScale}
                subtitleOverlayOpacity={props.subtitleOverlayOpacity}
                subtitleOverlayBackground={props.subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={props.subtitleUpcomingLyricsBlur}
                isPlayerChromeHidden={props.isPlayerChromeHidden}
                hideTranslationSubtitle={props.hideTranslationSubtitle}
                showSubtitleTranslation={props.showSubtitleTranslation}
                subtitleContentMode={props.subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerMotes;
