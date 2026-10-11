// Copyright (c) 2026 chthollyphile
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LUMIERE_TUNING } from '../../../types';
import type { Line } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixiRuntimeHost';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { LumierePixiRuntime, LumiereSongContext, LumiereSongMetadata } from './createLumierePixiRuntime';
import { compileLumiereProgram } from './lumiereProgram';
import { resolveLumiereCompileOptions } from './lumiereRuntimeTuning';

// src/components/visualizer/lumiere/VisualizerLumiere.tsx
// 绘光的 React 外壳：挂共享 shell / 字幕层，把按需加载的 Pixi 运行时建一次，换歌、tuning、暂停都就地推给它。
// 每帧的时间只在运行时的 draw loop 里读 currentTime，不进 React state。
const EMPTY_LUMIERE_LINES: Line[] = [];

const VisualizerLumiere: React.FC<VisualizerSharedProps> = (props) => {
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
        seed = 'lumiere',
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
        lumiereTuning = DEFAULT_LUMIERE_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ tuning: lumiereTuning, paused, showText, staticMode, audioPower, audioBands });
    latestRef.current = { tuning: lumiereTuning, paused, showText, staticMode, audioPower, audioBands };
    const metadataRef = useRef<LumiereSongMetadata>({ title: songTitle, artist: songArtist, album: songAlbum });
    metadataRef.current = { title: songTitle, artist: songArtist, album: songAlbum };

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词重建场景（songHandover.ts）。
    const committedSong = useVisualizerSongCommit({
        seed,
        lines,
        currentTime,
        readyGraceMs: 3000,
    });
    const committedSeed = committedSong.seed;
    const committedLines = committedSong.isInstrumental ? EMPTY_LUMIERE_LINES : committedSong.lines;

    // 纯音乐 / 歌词还没到：编译成只有间奏镜头的程序（folia 不给 visualizer 传歌曲时长，用编译器的缺省时长），
    // 光照照常，不造 ♪ 虚拟行。showText 关掉时仍按真实歌词编译，镜头节奏跟着歌走，只是不画字。
    // 轨迹过渡改变编译结果：切换时重新编译，新程序走同曲替换（swapSong → commitSong 清场景缓存），不重建 WebGL。
    const seamlessTransitions = lumiereTuning.seamlessTransitions;
    const program = useMemo(
        () => compileLumiereProgram(committedLines, committedSeed, {}, resolveLumiereCompileOptions({ seamlessTransitions })),
        [committedLines, committedSeed, seamlessTransitions],
    );
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const songContext = useMemo<LumiereSongContext>(
        () => ({ seed: committedSeed, program, theme }),
        [committedSeed, program, theme],
    );

    const runtimeRef = useVisualizerPixiHost<LumierePixiRuntime, LumiereSongContext>({
        hostRef,
        label: 'Lumiere',
        // 只有真正需要新 WebGL 上下文的输入；歌、tuning、暂停、静态模式都就地推给运行时。
        rebuildKey: [currentTime],
        song: songContext,
        create: async (host, song, signal) => {
            const { LumierePixiRuntime } = await import('./createLumierePixiRuntime');
            const latest = latestRef.current;
            const runtime = await LumierePixiRuntime.create({
                host,
                song,
                tuning: latest.tuning,
                currentTime,
                audioPower: latest.audioPower,
                audioBands: latest.audioBands,
                staticMode: latest.staticMode,
                showText: latest.showText,
                paused: latest.paused,
                metadata: metadataRef.current,
                signal,
            });
            const current = latestRef.current;
            runtime.setSongMetadata(metadataRef.current);
            runtime.setTuning(current.tuning);
            runtime.setShowText(current.showText);
            runtime.setStaticMode(current.staticMode);
            runtime.setAudioSources(current.audioPower, current.audioBands);
            runtime.setPaused(current.paused);
            return runtime;
        },
        swap: (runtime, song, signal) => runtime.swapSong(song, signal),
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        runtimeRef.current?.setTuning(lumiereTuning);
    }, [lumiereTuning, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setShowText(showText);
    }, [showText, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setStaticMode(staticMode);
    }, [staticMode, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setAudioSources(audioPower, audioBands);
    }, [audioPower, audioBands, runtimeRef]);

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
    const fallbackFontWeight = resolveThemeFontWeight(theme, 500);
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
                currentTime={currentTime}
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
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerLumiere;
