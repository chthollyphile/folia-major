import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Line, Theme } from '../../../types';
import { loadLucideIcons } from '../../../services/lucideIconResolver';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerPixiHost } from '../pixi/pixiRuntimeHost';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { closeMachiCameraBar, isMachiCameraBarOpen, subscribeMachiCameraBar } from './cameraBar';
import type { MachiRuntime, MachiSongContext } from './createMachiRuntime';
import MachiCameraBar from './MachiCameraBar';
import type { MachiSceneId, MachiTuning } from './types';

// src/components/visualizer/machi/VisualizerMachi.tsx
// 町景的 React 外壳：挂共享 shell 与底部字幕层，把按需加载的 three.js 运行时建一次（useVisualizerPixiHost 托管，
// 它与渲染器无关），换歌、换主题、换设置（场景、时间、天气）、暂停、静态模式都就地推给运行时。
// WebGL 上下文丢了就换一个 epoch 重建。
// 每帧的时间只在运行时的循环里读 currentTime，不进 React state。
// 播放页上（不是预览、宿主存得下改动）控制面板的摄影机按钮打开取景控制条（MachiCameraBar）：开着时底部字幕让开；
// 拖它的滑块时改动先记在这里的草稿上、只推给运行时，松手或收起时再一次存下。

const EMPTY_LINES: Line[] = [];

/** 主题没有图标时招牌上用的兜底图标。 */
export const MACHI_FALLBACK_ICONS = ['Store', 'Umbrella', 'CloudRain', 'Moon'];

/** 招牌同步画图标：建运行时与换歌 / 换主题前先把主题图标和兜底图标加载好。 */
const loadMachiIcons = (theme: Theme) => loadLucideIcons([...(theme.lyricsIcons ?? []), ...MACHI_FALLBACK_ICONS]);

interface VisualizerMachiProps extends VisualizerSharedProps {
    machiTuning: MachiTuning;
}

const VisualizerMachi: React.FC<VisualizerMachiProps> = (props) => {
    const {
        machiTuning,
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
        seed = 'machi',
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
        onVisualizerTuningChange,
    } = props;
    const { t } = useTranslation();
    const hostRef = useRef<HTMLDivElement>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    const [contextEpoch, setContextEpoch] = useState(0);
    // 取景控制条：只在播放页上（预览不接拖拽，也没有地方存改动；画面在主页后面当背景时也不出）。
    const onPlayerPage = useAppViewStore(state => state.view === 'player');
    const cameraBarAvailable = onPlayerPage && !isPreviewMode && Boolean(onVisualizerTuningChange);
    const cameraBarOpen = useSyncExternalStore(subscribeMachiCameraBar, isMachiCameraBarOpen, isMachiCameraBarOpen) && cameraBarAvailable;
    const [shownScene, setShownScene] = useState<MachiSceneId | null>(null);
    // 取景控制条拖动中的改动（还没存）：画面用存下的 tuning 叠上它。
    const barDraftRef = useRef<Partial<MachiTuning> | null>(null);
    const [barDraft, setBarDraft] = useState<Partial<MachiTuning> | null>(null);
    const shownTuning = useMemo(() => (barDraft ? { ...machiTuning, ...barDraft } : machiTuning), [machiTuning, barDraft]);

    // 运行时创建期间这些输入可能已经变了；create 完成后按最新值补一次。
    const latestRef = useRef({ theme, paused, showText, staticMode, machiTuning, shownTuning, onVisualizerTuningChange });
    latestRef.current = { theme, paused, showText, staticMode, machiTuning, shownTuning, onVisualizerTuningChange };

    const previewFromBar = useCallback((patch: Partial<MachiTuning>) => {
        barDraftRef.current = { ...barDraftRef.current, ...patch };
        setBarDraft(barDraftRef.current);
    }, []);
    // 把草稿（连同这一下的改动）存下；没有要存的就什么也不做。
    const commitFromBar = useCallback((patch?: Partial<MachiTuning>) => {
        const draft = { ...barDraftRef.current, ...patch };
        barDraftRef.current = null;
        setBarDraft(null);
        if (Object.keys(draft).length > 0) latestRef.current.onVisualizerTuningChange?.(draft);
    }, []);
    const flushBar = useCallback(() => commitFromBar(), [commitFromBar]);

    // 真正在画的歌：切歌时滞后于 props，免得对着还没到的歌词换牌面（songHandover.ts）。
    const committedSong = useVisualizerSongCommit({ seed, lines, currentTime, readyGraceMs: 3000 });
    const committedLines = committedSong.isInstrumental ? EMPTY_LINES : committedSong.lines;

    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const songContext = useMemo<MachiSongContext>(() => ({
        seed: committedSong.seed ?? 'machi',
        lines: committedLines,
        isInstrumental: committedSong.isInstrumental,
        title: songTitle ?? '',
        artist: songArtist ?? '',
        album: songAlbum ?? '',
    }), [committedLines, committedSong.isInstrumental, committedSong.seed, songAlbum, songArtist, songTitle]);

    const runtimeRef = useVisualizerPixiHost<MachiRuntime, MachiSongContext>({
        hostRef,
        label: 'Machi',
        // 只有真正需要新 WebGL 上下文的输入；歌、主题、暂停、静态模式都就地推给运行时。
        rebuildKey: [currentTime, audioPower, audioBands, isPreviewMode, contextEpoch],
        song: songContext,
        create: async (host, song, signal) => {
            const [{ MachiRuntime: Runtime }] = await Promise.all([
                import('./createMachiRuntime'),
                loadMachiIcons(latestRef.current.theme),
            ]);
            const latest = latestRef.current;
            const runtime = await Runtime.create({
                host,
                song,
                theme: latest.theme,
                tuning: latest.shownTuning,
                currentTime,
                audioPower,
                audioBands,
                paused: latest.paused,
                staticMode: latest.staticMode,
                showText: latest.showText,
                previewMode: isPreviewMode,
                // 自定义视角下拖动停稳了：新视角存进 tuning 里这个场景的那一份（宿主经 onVisualizerTuningChange 存）。
                onViewChange: (view, scene) => {
                    const latest = latestRef.current;
                    latest.onVisualizerTuningChange?.({ camera: 'custom', views: { ...latest.machiTuning.views, [scene]: view } } satisfies Partial<MachiTuning>);
                },
                onSceneShown: setShownScene,
                fallbackIcons: MACHI_FALLBACK_ICONS,
                onContextLost: () => setContextEpoch(epoch => epoch + 1),
                signal,
            });
            const current = latestRef.current;
            runtime.setTheme(current.theme);
            runtime.setTuning(current.shownTuning);
            runtime.setShowText(current.showText);
            runtime.setStaticMode(current.staticMode);
            runtime.setPaused(current.paused);
            return runtime;
        },
        swap: async (runtime, song) => {
            await loadMachiIcons(latestRef.current.theme);
            runtime.swapSong(song);
        },
        destroy: runtime => runtime.destroy(),
        onFailedChange: setRuntimeFailed,
    });

    useEffect(() => {
        let cancelled = false;
        void loadMachiIcons(theme).then(() => {
            if (!cancelled) runtimeRef.current?.setTheme(theme);
        });
        return () => { cancelled = true; };
    }, [theme, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setTuning(shownTuning);
    }, [shownTuning, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setShowText(showText);
    }, [showText, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setStaticMode(staticMode);
    }, [staticMode, runtimeRef]);

    useEffect(() => {
        runtimeRef.current?.setPaused(paused);
    }, [paused, runtimeRef]);

    // 离开播放页、播放页的町景画面拆掉（换了别的歌词样式）时收起取景控制条。
    useEffect(() => {
        if (!cameraBarAvailable) return undefined;
        return () => closeMachiCameraBar();
    }, [cameraBarAvailable]);

    // 取景控制条收起（不论从哪收起）时，还没存的拖动改动存下。
    useEffect(() => {
        if (!cameraBarOpen) commitFromBar();
    }, [cameraBarOpen, commitFromBar]);

    // 暂停时循环停着，拖动进度要手动补一帧。
    useEffect(() => currentTime.on('change', () => {
        if (paused || staticMode) runtimeRef.current?.renderOnce();
    }), [currentTime, paused, staticMode, runtimeRef]);

    const fallbackFontFamily = resolveThemeFontStack(theme);
    const fallbackFontWeight = resolveThemeFontWeight(theme, 700);
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
            renderBackground={false}
        >
            <div className="absolute inset-0 z-10 overflow-hidden">
                {/* 拖拽旋转、缩放要收到指针，所以这一层不是 pointer-events-none；预览里不接拖拽。 */}
                <div
                    ref={hostRef}
                    className={`absolute inset-0 z-10 ${isPreviewMode ? 'pointer-events-none' : ''}`}
                    aria-hidden="true"
                />
                {runtimeFailed && (
                    <div
                        className="pointer-events-none absolute inset-0 flex items-center justify-center px-10 text-center"
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

            {cameraBarOpen && shownScene && onVisualizerTuningChange && (
                <MachiCameraBar
                    tuning={shownTuning}
                    scene={shownScene}
                    theme={theme}
                    t={t}
                    isPlayerChromeHidden={isPlayerChromeHidden}
                    onPreview={previewFromBar}
                    onCommit={flushBar}
                    onTuningChange={commitFromBar}
                    onClose={closeMachiCameraBar}
                />
            )}

            <VisualizerSubtitleOverlay
                showText={showText && !cameraBarOpen}
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

export default VisualizerMachi;
