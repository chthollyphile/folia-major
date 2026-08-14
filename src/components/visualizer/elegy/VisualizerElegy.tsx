import React, { useEffect, useRef, useState } from 'react';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { ElegyPixiRuntime } from './createElegyPixiRuntime';

// src/components/visualizer/elegy/VisualizerElegy.tsx
// Keeps React at line-level while Pixi and the glyph worker own continuous handwriting animation.
const VisualizerElegy: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        staticMode = false,
        paused = false,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
    } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<ElegyPixiRuntime | null>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const { activeLine, recentCompletedLine, upcomingLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const visibleActiveLine = showText ? activeLine : null;
    const latestActiveLineRef = useRef(visibleActiveLine);
    latestActiveLineRef.current = visibleActiveLine;
    const latestUpcomingLineRef = useRef(showText ? upcomingLine : null);
    latestUpcomingLineRef.current = showText ? upcomingLine : null;
    const fontFamily = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, 400);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let disposed = false;
        let createdRuntime: ElegyPixiRuntime | null = null;
        const abortController = new AbortController();
        setRuntimeFailed(false);

        void import('./createElegyPixiRuntime')
            .then(({ ElegyPixiRuntime }) => ElegyPixiRuntime.create({
                host,
                currentTime,
                theme,
                fontFamily,
                fontWeight,
                lyricsFontScale,
                staticMode,
                paused: pausedRef.current,
                initialLine: latestActiveLineRef.current,
                signal: abortController.signal,
            }))
            .then(runtime => {
                if (disposed) {
                    runtime.destroy();
                    return;
                }
                createdRuntime = runtime;
                runtimeRef.current = runtime;
                runtime.setPaused(pausedRef.current);
                runtime.setLine(latestActiveLineRef.current);
                runtime.prepareLine(latestUpcomingLineRef.current);
            })
            .catch(error => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.error('[Elegy] Pixi runtime initialization failed', error);
                if (!disposed) setRuntimeFailed(true);
            });

        return () => {
            disposed = true;
            abortController.abort();
            createdRuntime?.destroy();
            if (runtimeRef.current === createdRuntime) runtimeRef.current = null;
            host.replaceChildren();
        };
    }, [currentTime, fontFamily, fontWeight, lyricsFontScale, staticMode, theme]);

    useEffect(() => {
        runtimeRef.current?.setLine(visibleActiveLine);
        runtimeRef.current?.prepareLine(showText ? upcomingLine : null);
    }, [showText, upcomingLine, visibleActiveLine]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />
                {runtimeFailed && visibleActiveLine && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-[9vw] text-center"
                        style={{
                            color: theme.primaryColor,
                            fontFamily,
                            fontWeight,
                            fontSize: `clamp(3rem, ${6.5 * lyricsFontScale}vw, 6.75rem)`,
                        }}
                    >
                        {visibleActiveLine.fullText}
                    </div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={`clamp(${1.05 * lyricsFontScale}rem, ${2.2 * lyricsFontScale}vw, ${1.25 * lyricsFontScale}rem)`}
                upcomingFontSize={`clamp(${0.9 * lyricsFontScale}rem, ${1.8 * lyricsFontScale}vw, ${1.05 * lyricsFontScale}rem)`}
                subtitleFontScale={subtitleFontScale}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerElegy;
