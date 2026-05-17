import type { CSSProperties } from 'react';
import type { Theme, VisualizerMode } from '../../../types';

// src/components/app/presentation/buildVisualizerTheme.ts

// Builds the visualizer-facing theme and deterministic geometry seed.
export const buildVisualizerTheme = ({
    appStyle,
    theme,
    lyricsFontStyle,
    lyricsCustomFontFamily,
    currentSongId,
    visualizerMode,
}: {
    appStyle: CSSProperties;
    theme: Theme;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsCustomFontFamily: string | null;
    currentSongId?: number | null;
    visualizerMode: VisualizerMode;
}) => {
    const visualizerBackgroundColor = String(appStyle['--bg-color']);
    return {
        visualizerTheme: {
            ...theme,
            fontStyle: lyricsFontStyle,
            fontFamily: lyricsCustomFontFamily ?? undefined,
            backgroundColor: visualizerBackgroundColor,
        },
        visualizerGeometrySeed: currentSongId ?? `geometry-${visualizerMode}`,
    };
};
