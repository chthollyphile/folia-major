import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import type { Line } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { SonnetPixiRuntime, SonnetSongMetadata } from './createSonnetPixiRuntime';
import { compileSonnetProgram } from './sonnetProgram';

// src/components/visualizer/sonnet/VisualizerSonnet.tsx
// Mounts the lazily loaded Pixi director while React retains shell and subtitle responsibilities.
const EMPTY_SONNET_LINES: Line[] = [];

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
        songTitle,
        songArtist,
        songAlbum,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation = true,
        subtitleContentMode,
        sonnetTuning = DEFAULT_SONNET_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SonnetPixiRuntime | null>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const latestSongMetadataRef = useRef<SonnetSongMetadata>({
        title: songTitle,
        artist: songArtist,
        album: songAlbum,
    });
    latestSongMetadataRef.current = {
        title: songTitle,
        artist: songArtist,
        album: songAlbum,
    };
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const programLines = showText && lines.length > 0 ? lines : EMPTY_SONNET_LINES;
    const program = useMemo(
        () => compileSonnetProgram(programLines, seed),
        [programLines, seed],
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
        let createdRuntime: SonnetPixiRuntime | null = null;
        const abortController = new AbortController();
        setRuntimeFailed(false);
        void import('./createSonnetPixiRuntime')
            .then(({ SonnetPixiRuntime }) => {
                const metadata = latestSongMetadataRef.current;
                return SonnetPixiRuntime.create({
                    host,
                    program,
                    theme,
                    tuning: sonnetTuning,
                    currentTime,
                    lyricsFontScale,
                    staticMode,
                    paused: pausedRef.current,
                    songTitle: metadata.title,
                    songArtist: metadata.artist,
                    songAlbum: metadata.album,
                    signal: abortController.signal,
                });
            })
            .then(runtime => {
                if (disposed) {
                    runtime.destroy();
                    return;
                }
                createdRuntime = runtime;
                runtimeRef.current = runtime;
                runtime.setSongMetadata(latestSongMetadataRef.current);
                // The pause state may have changed while Pixi was importing or initializing.
                runtime.setPaused(pausedRef.current);
            })
            .catch(error => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.error('[Sonnet] Pixi runtime initialization failed', error);
                if (!disposed) setRuntimeFailed(true);
            });
        return () => {
            disposed = true;
            abortController.abort();
            if (createdRuntime) {
                createdRuntime.destroy();
                if (runtimeRef.current === createdRuntime) runtimeRef.current = null;
            } else if (runtimeRef.current) {
                runtimeRef.current.destroy();
                runtimeRef.current = null;
            }
            host.replaceChildren();
        };
    }, [
        currentTime,
        lyricsFontScale,
        program,
        sonnetTuning,
        staticMode,
        theme,
    ]);

    useEffect(() => {
        runtimeRef.current?.setSongMetadata(latestSongMetadataRef.current);
    }, [songAlbum, songArtist, songTitle]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused]);

    useEffect(() => currentTime.on('change', () => {
        if (paused) runtimeRef.current?.renderOnce();
    }), [currentTime, paused]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 600);
    const finalLine = lines.at(-1);
    const creditsRecentCompletedLine = recentCompletedLine === finalLine
        ? null
        : recentCompletedLine;

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
                recentCompletedLine={creditsRecentCompletedLine}
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
