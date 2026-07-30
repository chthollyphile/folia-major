import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { SonnetPixiRuntime } from './createSonnetPixiRuntime';
import { compileSonnetProgram } from './sonnetProgram';

// src/components/visualizer/sonnet/VisualizerSonnet.tsx
// Mounts the lazily loaded Pixi director while React retains shell and subtitle responsibilities.
const VisualizerSonnet: React.FC<VisualizerSharedProps> = (props) => {
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
        seed = 'sonnet',
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
        sonnetTuning = DEFAULT_SONNET_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SonnetPixiRuntime | null>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const program = useMemo(
        () => compileSonnetProgram(showText ? lines : [], seed),
        [lines, seed, showText],
    );
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let disposed = false;
        const abortController = new AbortController();
        setRuntimeFailed(false);
        void import('./createSonnetPixiRuntime')
            .then(({ SonnetPixiRuntime }) => SonnetPixiRuntime.create({
                host,
                program,
                theme,
                tuning: sonnetTuning,
                currentTime,
                audioPower,
                audioBands,
                lyricsFontScale,
                staticMode,
                paused,
                signal: abortController.signal,
            }))
            .then(runtime => {
                if (disposed) {
                    runtime.destroy();
                    return;
                }
                runtimeRef.current = runtime;
            })
            .catch(error => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.error('[Sonnet] Pixi runtime initialization failed', error);
                if (!disposed) setRuntimeFailed(true);
            });
        return () => {
            disposed = true;
            abortController.abort();
            runtimeRef.current?.destroy();
            runtimeRef.current = null;
            host.replaceChildren();
        };
    }, [
        audioBands,
        audioPower,
        currentTime,
        lyricsFontScale,
        program,
        sonnetTuning,
        staticMode,
        theme,
    ]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused]);

    useEffect(() => currentTime.on('change', () => {
        if (paused) runtimeRef.current?.renderOnce();
    }), [currentTime, paused]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 600);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <div ref={hostRef} className="absolute inset-0 z-10" aria-hidden="true" />
                {(runtimeFailed || program.paragraphs.length === 0) && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-10 text-center transition-opacity duration-300"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: fallbackFontFamily,
                            fontWeight: fallbackFontWeight,
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
                    </div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={`clamp(${1.05 * lyricsFontScale}rem, ${2.2 * lyricsFontScale}vw, ${1.25 * lyricsFontScale}rem)`}
                upcomingFontSize={`clamp(${0.9 * lyricsFontScale}rem, ${1.8 * lyricsFontScale}vw, ${1.05 * lyricsFontScale}rem)`}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerSonnet;
