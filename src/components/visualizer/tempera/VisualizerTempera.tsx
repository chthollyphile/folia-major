import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_TEMPERA_TUNING } from '../../../types';
import type { Line } from '../../../types';
import { extractRepresentativeColors } from '../../../utils/colorExtractor';
import { loadTemperaLayerImageBlobs } from '../../../services/temperaLayerImages';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixiRuntimeHost';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type {
    TemperaPixiRuntime,
    TemperaSongContext,
    TemperaSongMetadata,
} from './createTemperaPixiRuntime';
import { compileTemperaProgram } from './temperaProgram';

// src/components/visualizer/tempera/VisualizerTempera.tsx
// Mounts the lazily loaded Pixi director while React retains shell and subtitle responsibilities.
const EMPTY_TEMPERA_LINES: Line[] = [];

const VisualizerTempera: React.FC<VisualizerSharedProps> = (props) => {
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
        seed = 'tempera',
        coverUrl,
        temperaLayerImageAssets,
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
        temperaTuning = DEFAULT_TEMPERA_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const temperaTuningRef = useRef(temperaTuning);
    temperaTuningRef.current = temperaTuning;
    const latestSongMetadataRef = useRef<TemperaSongMetadata>({
        title: songTitle,
        artist: songArtist,
        album: songAlbum,
    });
    latestSongMetadataRef.current = {
        title: songTitle,
        artist: songArtist,
        album: songAlbum,
    };
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const [imageBlobs, setImageBlobs] = useState<Map<string, Blob>>(() => new Map());
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
        if (!isInstrumental) return EMPTY_TEMPERA_LINES;
        const generated: Line[] = [];
        for (let i = 0; i < 60; i++) {
            generated.push({
                id: `virtual-block-${i}`,
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
        : EMPTY_TEMPERA_LINES;
    const wholeLineLyrics = temperaTuning.wholeLineLyrics;
    const program = useMemo(
        () => compileTemperaProgram(programLines, committedSeed, { wholeLineLyrics }),
        [programLines, committedSeed, wholeLineLyrics],
    );
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    // Cover-art colours feed the gradient colour mode only; the other modes derive everything
    // from the theme, so there is no reason to decode the artwork for them.
    const needsCoverColors = temperaTuning.colorMode === 'gradient';
    useEffect(() => {
        if (!needsCoverColors || !coverUrl) {
            setCoverColors([]);
            return undefined;
        }
        let active = true;
        void extractRepresentativeColors(coverUrl, 5).then(colors => {
            if (active) setCoverColors(colors);
        }).catch(() => {
            if (active) setCoverColors([]);
        });
        return () => {
            active = false;
        };
    }, [coverUrl, needsCoverColors]);

    // The placed images live in IndexedDB; only their ids and placement ride in the tuning.
    // Blobs are handed to the renderer as-is, which decodes them itself - see the note there
    // on why an object URL would not survive Pixi's asset loader.
    const layerImages = temperaTuning.layerImages;
    const layerImagesRef = useRef(layerImages);
    layerImagesRef.current = layerImages;
    const injectedAssetsRef = useRef(temperaLayerImageAssets);
    injectedAssetsRef.current = temperaLayerImageAssets;
    // Keyed on the id set, not the array: dragging a slider hands down a new array every
    // pointer move, and re-reading storage for each of those would be pure waste.
    const layerImageIds = layerImages.map(image => image.id).join('|');
    const injectedAssetIds = (temperaLayerImageAssets ?? []).map(asset => asset.id).join('|');
    useEffect(() => {
        const placements = layerImagesRef.current;
        const injected = injectedAssetsRef.current;
        if (placements.length === 0) {
            setImageBlobs(new Map());
            return undefined;
        }
        let active = true;
        // The OBS overlay ships the pool inline because that page has no access to the app's
        // IndexedDB; when it does, storage is not consulted at all.
        const load = injected && injected.length > 0
            ? Promise.all(injected.map(async asset => [
                asset.id,
                await fetch(asset.url).then(response => response.blob()),
            ] as const)).then(entries => new Map(entries))
            : loadTemperaLayerImageBlobs(placements);
        void load.then(blobs => {
            if (active) setImageBlobs(blobs);
        }).catch(() => {
            if (active) setImageBlobs(new Map());
        });
        return () => {
            active = false;
        };
    }, [layerImageIds, injectedAssetIds]);

    // Song-scoped inputs, kept as one object so a track change is a single identity change.
    const songContext = useMemo<TemperaSongContext>(
        () => ({ seed: committedSeed, program, theme, coverColors }),
        [committedSeed, coverColors, program, theme],
    );

    const runtimeRef = useVisualizerPixiHost<TemperaPixiRuntime, TemperaSongContext>({
        hostRef,
        label: 'Tempera',
        // Only inputs that genuinely need a new WebGL context and texture pool. The song is
        // handed to the live runtime instead - see TemperaPixiRuntime.swapSong.
        rebuildKey: [currentTime, imageBlobs, lyricsFontScale, staticMode],
        song: songContext,
        create: async (host, song, signal) => {
            const { TemperaPixiRuntime } = await import('./createTemperaPixiRuntime');
            const metadata = latestSongMetadataRef.current;
            const runtime = await TemperaPixiRuntime.create({
                host,
                songSeed: song.seed,
                program: song.program,
                theme: song.theme,
                tuning: temperaTuningRef.current,
                currentTime,
                lyricsFontScale,
                staticMode,
                coverColors: song.coverColors,
                imageBlobs,
                paused: pausedRef.current,
                songTitle: metadata.title,
                songArtist: metadata.artist,
                songAlbum: metadata.album,
                signal,
            });
            runtime.setSongMetadata(latestSongMetadataRef.current);
            // The tuning may have moved on while Pixi was importing or initializing.
            runtime.setTuning(temperaTuningRef.current);
            // The pause state may have changed while Pixi was importing or initializing.
            runtime.setPaused(pausedRef.current);
            return runtime;
        },
        swap: (runtime, song, signal) => runtime.swapSong(song, signal),
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    // Tuning is pushed into the live renderer rather than rebuilding it. A rebuild per pointer
    // move re-initialises WebGL, re-decodes every placed image and re-measures every line.
    useEffect(() => {
        runtimeRef.current?.setTuning(temperaTuning);
    }, [temperaTuning, runtimeRef]);

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
                        {showText && !isInstrumental ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
                    </div>
                )}
            </div>

            <VisualizerSubtitleOverlay
                currentTime={currentTime}
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

export default VisualizerTempera;
