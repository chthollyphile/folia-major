import React from 'react';
import type { Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import type { VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { useVisualizerSongCommit } from '../songHandover';
import { resolveSubtitleFontSizes } from '../subtitleFontSizes';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import TesseraBoard from './TesseraBoard';
import { tesseraBackgroundConfig, tesseraFill } from './tesseraBackdrop';
import type { TesseraTuning } from './types';

// src/components/visualizer/tessera/VisualizerTessera.tsx
// 方块字的 React 外壳：共享 shell、底部字幕层，中间是画布（TesseraBoard）。
// 歌词经 useVisualizerSongCommit 换歌（新歌的歌词到了才重排），每帧的时间只在画布里读。

const EMPTY_LINES: Line[] = [];

const VisualizerTessera: React.FC<VisualizerSharedProps & { tesseraTuning: TesseraTuning }> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        paused = false,
        seed = 'tessera',
        background,
        isPreviewMode = false,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        subtitleOverlayLayout,
        subtitleTheme,
        subtitleFontScale,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        tesseraTuning,
    } = props;

    const committedSong = useVisualizerSongCommit({ seed, lines, currentTime });
    const committedLines = committedSong.isInstrumental ? EMPTY_LINES : committedSong.lines;
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={{ ...props, background: tesseraBackgroundConfig(props) }}
        >
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                <TesseraBoard
                    lines={committedLines}
                    currentTime={currentTime}
                    theme={theme}
                    fill={tesseraFill(tesseraTuning.background, background, isPreviewMode)}
                    showText={showText}
                    paused={paused}
                />
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

export default VisualizerTessera;
