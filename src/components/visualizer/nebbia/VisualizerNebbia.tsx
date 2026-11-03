import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Line } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { ARRIVING_MARK } from '../preview/frozenPicture';
import { useFirstFrameDrawn } from '../styleTransition/firstFrame';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { useLyricRenderQuality } from '../renderQuality/useLyricRenderQuality';
import { NebbiaRuntime } from './createNebbiaRuntime';
import { nebbiaSeesThrough } from './nebbiaBehind';
import { DEFAULT_NEBBIA_TUNING, type NebbiaTuning } from './types';

// src/components/visualizer/nebbia/VisualizerNebbia.tsx
// 雾笺的 React 外壳：挂共享 shell / 字幕层，运行时建一次，换歌、tuning、主题、暂停都就地推给它。
// 每帧的时间只在运行时的循环里读 currentTime，不进 React state。WebGL2 不可用或上下文丢了，就退回只显示当前这句。
// 窗外换成共用背景（或播放页透明）时画布要带透明通道，只能新建上下文；窗外在街景和水族箱之间换时着色器要按另一套编：都是运行时整个重建。
const EMPTY_LINES: Line[] = [];

type Props = VisualizerSharedProps & { nebbiaTuning?: NebbiaTuning };

const VisualizerNebbia: React.FC<Props> = (props) => {
    const {
        currentTime, currentLineIndex, lines, theme, audioPower, audioBands,
        showText = true, lyricsFontScale = 1, staticMode = false, paused = false, seed = 'nebbia', songTitle, songArtist,
        isPlayerChromeHidden = false, hideTranslationSubtitle = false, isPreviewMode = false,
        subtitleOverlayLayout, subtitleTheme, subtitleFontScale, subtitleOverlayOpacity, subtitleOverlayBackground, subtitleUpcomingLyricsBlur,
        isDaylight = false, nebbiaTuning = DEFAULT_NEBBIA_TUNING,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<NebbiaRuntime | null>(null);
    const [failed, setFailed] = useState(false);
    // WebGL 上下文丢了又回来时加一，重建运行时
    const [generation, setGeneration] = useState(0);
    // 着色器在后台编，第一帧之前画布是空的：拿这一刻做小图的（frozenPicture.ts）等它画出来
    const [drawn, setDrawn] = useState(false);
    const firstFrameDrawn = useFirstFrameDrawn();
    // 分辨率（#929）：全屏着色器没有 MSAA，只跟分辨率倍数；预览的小图保持原来的像素密度
    const renderQuality = useLyricRenderQuality(nebbiaTuning.render);
    const renderScale = isPreviewMode ? 1 : renderQuality.scale;
    const seeThrough = nebbiaSeesThrough(nebbiaTuning, props.background, props.isPreviewMode);
    // 透出后面时（播放页透明）不画水族箱，雨打窗、颠簸照旧，和街景透出时一样
    const scene = nebbiaTuning.behind === 'aquarium' && !seeThrough ? 'aquarium' : 'night';
    const glass = nebbiaTuning.glass;

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词排版（songHandover.ts）
    const committed = useVisualizerSongCommit({ seed, lines, currentTime, readyGraceMs: 3000 });
    const committedLines = committed.isInstrumental ? EMPTY_LINES : committed.lines;
    const song = useMemo(
        () => ({ lines: committedLines, seed: committed.seed ?? 'nebbia', title: songTitle, artist: songArtist }),
        [committedLines, committed.seed, songTitle, songArtist],
    );

    const latest = useRef({ theme, tuning: nebbiaTuning, renderScale, song, lyricsFontScale, showText, isDaylight, paused, staticMode, firstFrameDrawn });
    latest.current = { theme, tuning: nebbiaTuning, renderScale, song, lyricsFontScale, showText, isDaylight, paused, staticMode, firstFrameDrawn };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let runtime: NebbiaRuntime;
        try {
            const l = latest.current;
            runtime = new NebbiaRuntime({
                host,
                seeThrough,
                scene,
                glass,
                currentTime,
                vocal: audioBands.vocal,
                onFirstFrame: () => { setDrawn(true); latest.current.firstFrameDrawn(); },
                onFailed: () => { setFailed(true); setDrawn(true); latest.current.firstFrameDrawn(); },
                onRestored: () => setGeneration(value => value + 1),
            }, l.theme, l.tuning, l.renderScale);
            runtime.setFontScale(l.lyricsFontScale);
            runtime.setShowText(l.showText);
            runtime.setDaylight(l.isDaylight);
            runtime.setPlayback(l.paused, l.staticMode);
            runtime.setSong(l.song);
        } catch (error) {
            console.warn('[Nebbia] runtime failed to start', error);
            setFailed(true);
            setDrawn(true);
            latest.current.firstFrameDrawn();
            return undefined;
        }
        runtimeRef.current = runtime;
        setFailed(false);
        return () => {
            runtimeRef.current = null;
            runtime.destroy();
        };
    }, [audioBands.vocal, currentTime, generation, glass, scene, seeThrough]);

    useEffect(() => { runtimeRef.current?.setSong(song); }, [song]);
    useEffect(() => { runtimeRef.current?.setTuning(nebbiaTuning); }, [nebbiaTuning]);
    useEffect(() => { runtimeRef.current?.setRenderScale(renderScale); }, [renderScale]);
    useEffect(() => { runtimeRef.current?.setTheme(theme); }, [theme]);
    useEffect(() => { runtimeRef.current?.setFontScale(lyricsFontScale); }, [lyricsFontScale]);
    useEffect(() => { runtimeRef.current?.setShowText(showText); }, [showText]);
    useEffect(() => { runtimeRef.current?.setDaylight(isDaylight); }, [isDaylight]);
    useEffect(() => { runtimeRef.current?.setPlayback(paused, staticMode); }, [paused, staticMode]);
    // 暂停时循环停着，拖动进度要手动补一帧
    useEffect(() => currentTime.on('change', () => {
        if (paused) runtimeRef.current?.requestFrame();
    }), [currentTime, paused]);

    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime, currentLineIndex, lines, getLineEndTime: getLineRenderEndTime,
    });
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);

    return (
        <VisualizerShell theme={theme} audioPower={audioPower} audioBands={audioBands} sharedProps={props} renderBackground={seeThrough}>
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ background: seeThrough ? undefined : '#05070a' }}>
                <div ref={hostRef} className="absolute inset-0" aria-hidden="true" {...(drawn ? {} : { [ARRIVING_MARK]: '' })} />
                {failed && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-10 text-center"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: resolveThemeFontStack(theme),
                            fontWeight: resolveThemeFontWeight(theme, 600),
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText && !committed.isInstrumental ? (activeLine?.fullText || t('ui.waitingForMusic')) : null}
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

export default VisualizerNebbia;
