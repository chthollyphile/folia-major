import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import type { Line } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixiRuntimeHost';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { useFoliumTunings } from '@/mods/folium/registries/tunings';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type {
    SonnetPixiRuntime,
    SonnetSongContext,
    SonnetSongMetadata,
} from './createSonnetPixiRuntime';
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
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        background,
        sonnetTuning = DEFAULT_SONNET_TUNING,
    } = props;
    const transparentBackground = background?.transparent ?? false;
    const { t } = useTranslation();
    // Mod-driven per-frame multipliers (K3Panel etc.). Read once per render; the
    // runtime hot-swaps them via setModulation so the Pixi context is never rebuilt.
    // Keys are the Folium tunables declared in ./entry.tsx.
    const modulation = useFoliumTunings('sonnet');
    const hostRef = useRef<HTMLDivElement>(null);
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

    // The song actually on screen. It lags the props across a switch so the scene is never
    // rebuilt against lyrics that have not arrived yet - see songHandover.ts.
    const committedSong = useVisualizerSongCommit({
        seed,
        lines,
        currentTime,
        readyGraceMs: 3000,
    });
    const committedSeed = committedSong.seed;
    const committedLines = committedSong.lines;
    const isInstrumental = committedSong.isInstrumental;

    const virtualLines = useMemo(() => {
        if (!isInstrumental) return EMPTY_SONNET_LINES;
        const generated: Line[] = [];
        for (let i = 0; i < 60; i++) {
            generated.push({
                id: `virtual-staff-${i}`,
                startTime: i * 8,
                endTime: i * 8 + 6,
                fullText: '♪',
                words: [],
                isChorus: false,
            });
        }
        return generated;
    }, [isInstrumental]);

    const programLines = showText
        ? (committedLines.length > 0 ? committedLines : virtualLines)
        : EMPTY_SONNET_LINES;
    const program = useMemo(
        () => compileSonnetProgram(programLines, committedSeed),
        [programLines, committedSeed],
    );
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    // Song-scoped inputs, kept as one object so a track change is a single identity change.
    const songContext = useMemo<SonnetSongContext>(
        () => ({ seed: committedSeed, program, theme }),
        [committedSeed, program, theme],
    );

    const runtimeRef = useVisualizerPixiHost<SonnetPixiRuntime, SonnetSongContext>({
        hostRef,
        label: 'Sonnet',
        // Only inputs that genuinely need a new WebGL context. The song is handed to the live
        // runtime instead - see SonnetPixiRuntime.swapSong.
        rebuildKey: [currentTime, lyricsFontScale, sonnetTuning, staticMode, transparentBackground],
        song: songContext,
        create: async (host, song, signal) => {
            const { SonnetPixiRuntime } = await import('./createSonnetPixiRuntime');
            const metadata = latestSongMetadataRef.current;
            const runtime = await SonnetPixiRuntime.create({
                host,
                songSeed: song.seed,
                program: song.program,
                theme: song.theme,
                tuning: sonnetTuning,
                currentTime,
                audioPower,
                audioBands,
                lyricsFontScale,
                staticMode,
                transparentBackground,
                paused: pausedRef.current,
                songTitle: metadata.title,
                songArtist: metadata.artist,
                songAlbum: metadata.album,
                signal,
                modulation,
            });
            runtime.setSongMetadata(latestSongMetadataRef.current);
            // The pause state may have changed while Pixi was importing or initializing.
            runtime.setPaused(pausedRef.current);
            return runtime;
        },
        swap: (runtime, song, signal) => runtime.swapSong(song, signal),
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        runtimeRef.current?.setSongMetadata(latestSongMetadataRef.current);
    }, [songAlbum, songArtist, songTitle]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused]);

    useEffect(() => {
        runtimeRef.current?.setModulation(modulation);
    }, [modulation]);

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
                        {showText && !isInstrumental ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
                    </div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={creditsRecentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize={`clamp(${1.05 * lyricsFontScale}rem, ${2.2 * lyricsFontScale}vw, ${1.25 * lyricsFontScale}rem)`}
                upcomingFontSize={`clamp(${0.9 * lyricsFontScale}rem, ${1.8 * lyricsFontScale}vw, ${1.05 * lyricsFontScale}rem)`}
                subtitleFontScale={subtitleFontScale}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerSonnet;
