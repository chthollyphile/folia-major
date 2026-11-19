import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Line } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixi/pixiRuntimeHost';
import { useLyricRenderQuality } from '../renderQuality/useLyricRenderQuality';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import type { MetaphorRuntime, MetaphorSong } from './createMetaphorRuntime';
import type { MetaphorTuning } from './types';

// src/components/visualizer/metaphor/VisualizerMetaphor.tsx
// 隐喻的 React 外壳：挂共享 shell 与底部字幕层，把按需加载的 three.js 运行时建一次（useVisualizerPixiHost 托管，
// 它与渲染器无关），换歌、换主题、换设置、暂停、静态模式都就地推给运行时。WebGL 上下文丢了就换一个 epoch 重建；
// 播放页透明与否切换时也重建（画布带不带 alpha 只能在建上下文时定）。每帧的时间只在运行时的循环里读 currentTime，不进 React state。

const EMPTY_LINES: Line[] = [];

interface VisualizerMetaphorProps extends VisualizerSharedProps {
    metaphorTuning: MetaphorTuning;
}

const VisualizerMetaphor: React.FC<VisualizerMetaphorProps> = (props) => {
    const {
        metaphorTuning,
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
        isPreviewMode = false,
        seed = 'metaphor',
        songTitle,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
    } = props;
    // 播放页透明：纸不画，只留墨、强调色和网点。样式小图也把背景标成透明，那只是「不画共用背景」，小图照样画纸。
    const seeThrough = !isPreviewMode && (props.background?.transparent ?? false);
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const [contextEpoch, setContextEpoch] = useState(0);
    // 全屏着色器没有 MSAA，只跟分辨率倍数；预览的小图保持原来的像素密度
    const renderQuality = useLyricRenderQuality(metaphorTuning.render);
    const renderScale = isPreviewMode ? 1 : renderQuality.scale;

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ theme, paused, showText, staticMode, metaphorTuning, renderScale });
    latestRef.current = { theme, paused, showText, staticMode, metaphorTuning, renderScale };

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词编分镜（songHandover.ts）。
    const committedSong = useVisualizerSongCommit({ seed, lines, currentTime, readyGraceMs: 3000 });
    const committedLines = committedSong.isInstrumental ? EMPTY_LINES : committedSong.lines;

    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const song = useMemo<MetaphorSong>(() => ({
        seed: committedSong.seed ?? 'metaphor',
        lines: committedLines,
        title: songTitle ?? '',
    }), [committedLines, committedSong.seed, songTitle]);

    const runtimeRef = useVisualizerPixiHost<MetaphorRuntime, MetaphorSong>({
        hostRef,
        label: 'Metaphor',
        // 只有真正需要新 WebGL 上下文的输入；歌、主题、暂停、静态模式都就地推给运行时。
        rebuildKey: [currentTime, audioPower, seeThrough, contextEpoch],
        song,
        create: async (host, initialSong, signal) => {
            const { MetaphorRuntime: Runtime } = await import('./createMetaphorRuntime');
            const latest = latestRef.current;
            const runtime = await Runtime.create({
                host,
                song: initialSong,
                theme: latest.theme,
                tuning: latest.metaphorTuning,
                renderScale: latest.renderScale,
                currentTime,
                audioPower,
                paused: latest.paused,
                staticMode: latest.staticMode,
                showText: latest.showText,
                seeThrough,
                onContextLost: () => setContextEpoch(epoch => epoch + 1),
                signal,
            });
            const current = latestRef.current;
            runtime.setTheme(current.theme);
            runtime.setTuning(current.metaphorTuning);
            runtime.setRenderScale(current.renderScale);
            runtime.setShowText(current.showText);
            runtime.setPlayback(current.paused, current.staticMode);
            return runtime;
        },
        swap: (runtime, nextSong) => runtime.swapSong(nextSong),
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => { runtimeRef.current?.setTheme(theme); }, [theme, runtimeRef]);
    useEffect(() => { runtimeRef.current?.setTuning(metaphorTuning); }, [metaphorTuning, runtimeRef]);
    useEffect(() => { runtimeRef.current?.setRenderScale(renderScale); }, [renderScale, runtimeRef]);
    useEffect(() => { runtimeRef.current?.setShowText(showText); }, [showText, runtimeRef]);
    useEffect(() => { runtimeRef.current?.setPlayback(paused, staticMode); }, [paused, staticMode, runtimeRef]);

    // 暂停时循环停着，拖动进度要手动补一帧。
    useEffect(() => currentTime.on('change', () => {
        if (paused) runtimeRef.current?.requestFrame();
    }), [currentTime, paused, runtimeRef]);

    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);
    // 运行时建不起来时的退路：直接写当前这一句（还没唱到第一句时 currentLineIndex 是 -1）
    const fallbackText = currentLineIndex >= 0 && currentLineIndex < lines.length ? lines[currentLineIndex].fullText : '';

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
            renderBackground={false}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />
                {runtimeFailed && (
                    <div
                        className="absolute inset-0 flex items-center justify-center px-10 text-center"
                        style={{
                            color: theme.primaryColor,
                            fontFamily: resolveThemeFontStack(theme),
                            fontWeight: resolveThemeFontWeight(theme, 800),
                            fontSize: `clamp(2rem, ${5.4 * lyricsFontScale}vw, 5.6rem)`,
                        }}
                    >
                        {showText && !committedSong.isInstrumental ? (fallbackText || t('ui.waitingForMusic')) : null}
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

export default VisualizerMetaphor;
