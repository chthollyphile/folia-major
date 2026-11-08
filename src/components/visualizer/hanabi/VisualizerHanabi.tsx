// Copyright (c) 2026 chthollyphile
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Line, Theme } from '../../../types';
import { loadLucideIcons } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { resolveLyricAntialias } from '../../../utils/lyricRenderQuality';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixi/pixiRuntimeHost';
import { useLyricRenderQuality } from '../renderQuality/useLyricRenderQuality';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { HanabiPixiRuntime, HanabiSongContext } from './createHanabiPixiRuntime';
import type { HanabiCreditsMetadata } from './hanabiCreditsLayer';
import { compileHanabiProgram } from './hanabiProgram';
import { HANABI_FALLBACK_ICON } from './collage/collagePlan';
import type { HanabiTuning } from './types';

// src/components/visualizer/hanabi/VisualizerHanabi.tsx
// 花火的 React 外壳：挂共享 shell / 字幕层，把按需加载的 Pixi 运行时建一次，换歌、tuning、暂停都就地推给它。
// 每帧的时间只在运行时的 draw loop 里读 currentTime，不进 React state。
const EMPTY_HANABI_LINES: Line[] = [];

/** 场景同步建，拼贴里的图标贴纸只画已加载的图标：建运行时与换歌 / 换主题前先把主题图标和花加载好。 */
const loadHanabiIcons = (theme: Theme) => loadLucideIcons([...(theme.lyricsIcons ?? []), HANABI_FALLBACK_ICON]);

const VisualizerHanabi: React.FC<VisualizerSharedProps & { hanabiTuning: HanabiTuning }> = (props) => {
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
        seed = 'hanabi',
        songTitle,
        songArtist,
        songAlbum,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPreviewMode = false,
        hanabiTuning,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);

    // 分辨率与抗锯齿（#929）：全局挡位叠上本样式的覆盖。预览（样式架小图、主题乐园）保持原来的密度、不开 MSAA。
    // 抗锯齿原来写死关着，「自动」就是关。
    const renderQuality = useLyricRenderQuality(hanabiTuning.render);
    const renderScale = isPreviewMode ? 1 : renderQuality.scale;
    const antialias = isPreviewMode ? false : resolveLyricAntialias(renderQuality.antialias, false);

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ tuning: hanabiTuning, paused, showText, staticMode, renderScale });
    latestRef.current = { tuning: hanabiTuning, paused, showText, staticMode, renderScale };
    const metadataRef = useRef<HanabiCreditsMetadata>({ title: songTitle, artist: songArtist, album: songAlbum });
    metadataRef.current = { title: songTitle, artist: songArtist, album: songAlbum };

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词重建场景（songHandover.ts）。
    const committedSong = useVisualizerSongCommit({
        seed,
        lines,
        currentTime,
        readyGraceMs: 3000,
    });
    const committedSeed = committedSong.seed;
    const committedLines = committedSong.isInstrumental ? EMPTY_HANABI_LINES : committedSong.lines;

    // 纯音乐 / 歌词还没到：编译成只有间奏镜头的程序（烟花照常一路升空）。showText 关掉时仍按真实歌词编译，
    // 镜头节奏跟着歌走，只是不画字。
    const program = useMemo(
        () => compileHanabiProgram(committedLines, committedSeed),
        [committedLines, committedSeed],
    );
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const songContext = useMemo<HanabiSongContext>(
        () => ({ seed: committedSeed, program, theme }),
        [committedSeed, program, theme],
    );

    const runtimeRef = useVisualizerPixiHost<HanabiPixiRuntime, HanabiSongContext>({
        hostRef,
        label: 'Hanabi',
        // 只有真正需要新 WebGL 上下文的输入（抗锯齿只能建上下文时定）；歌、tuning、分辨率、暂停、静态模式都就地推给运行时。
        rebuildKey: [currentTime, antialias],
        song: songContext,
        create: async (host, song, signal) => {
            const [{ HanabiPixiRuntime }] = await Promise.all([
                import('./createHanabiPixiRuntime'),
                loadHanabiIcons(song.theme),
            ]);
            const latest = latestRef.current;
            const runtime = await HanabiPixiRuntime.create({
                host,
                song,
                tuning: latest.tuning,
                currentTime,
                staticMode: latest.staticMode,
                showText: latest.showText,
                paused: latest.paused,
                metadata: metadataRef.current,
                renderScale: latest.renderScale,
                antialias,
                signal,
            });
            const current = latestRef.current;
            runtime.setSongMetadata(metadataRef.current);
            runtime.setTuning(current.tuning);
            runtime.setRenderScale(current.renderScale);
            runtime.setShowText(current.showText);
            runtime.setStaticMode(current.staticMode);
            runtime.setPaused(current.paused);
            return runtime;
        },
        swap: async (runtime, song, signal) => {
            await loadHanabiIcons(song.theme);
            return runtime.swapSong(song, signal);
        },
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        runtimeRef.current?.setTuning(hanabiTuning);
    }, [hanabiTuning, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setRenderScale(renderScale);
    }, [renderScale, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setShowText(showText);
    }, [showText, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setStaticMode(staticMode);
    }, [staticMode, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setSongMetadata(metadataRef.current);
    }, [songAlbum, songArtist, songTitle, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused, runtimeRef]);

    // 暂停时 ticker 停着，拖动进度要手动补一帧。
    useEffect(() => currentTime.on('change', () => {
        if (paused) runtimeRef.current?.renderOnce();
    }), [currentTime, paused, runtimeRef]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 700);
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);
    const finalLine = lines.at(-1);
    // 片尾卡出来以后不再在字幕里重复最后一句。
    const creditsRecentCompletedLine = recentCompletedLine === finalLine ? null : recentCompletedLine;

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <div ref={hostRef} className="absolute inset-0 z-10" aria-hidden="true" />
                {runtimeFailed && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-10 text-center transition-opacity duration-300"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: fallbackFontFamily,
                            fontWeight: fallbackFontWeight,
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText && !committedSong.isInstrumental ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
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
                translationFontSize={subtitleFontSizes.translationFontSize}
                upcomingFontSize={subtitleFontSizes.upcomingFontSize}
                subtitleFontScale={subtitleFontScale}
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                subtitleOverlayLayout={subtitleOverlayLayout}
            />
        </VisualizerShell>
    );
};

export default VisualizerHanabi;
