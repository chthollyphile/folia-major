import type { CSSProperties } from 'react';
import type { Theme, VisualizerMode } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';

// src/components/app/presentation/buildVisualizerTheme.ts

// Builds the visualizer-facing theme and deterministic geometry seed.
export const buildVisualizerTheme = ({
    appStyle,
    theme,
    lyricsFontStyle,
    lyricsCustomFontFamily,
    lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics,
    subtitleFontStyle,
    subtitleFontFamily,
    subtitleFontFallbackFamilies,
    currentSongId,
    visualizerMode,
}: {
    appStyle: CSSProperties;
    theme: Theme;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsCustomFontFamily: string | null;
    lyricsFontFallbackFamilies?: string[];
    subtitleFontInheritsLyrics?: boolean;
    subtitleFontStyle?: Theme['fontStyle'];
    subtitleFontFamily?: string | null;
    subtitleFontFallbackFamilies?: string[];
    currentSongId?: MediaId | null;
    visualizerMode: VisualizerMode;
}) => {
    const visualizerBackgroundColor = String(
        (appStyle as CSSProperties & { '--bg-color'?: string })['--bg-color'] ?? theme.backgroundColor,
    );
    const visualizerTheme: Theme = {
        ...theme,
        fontStyle: lyricsFontStyle,
        fontFamily: lyricsCustomFontFamily ?? undefined,
        fontFamilyStack: lyricsFontFallbackFamilies,
        backgroundColor: visualizerBackgroundColor,
    };
    const visualizerSubtitleTheme: Theme = (subtitleFontInheritsLyrics ?? true)
        ? visualizerTheme
        : {
            ...theme,
            fontStyle: subtitleFontStyle ?? 'sans',
            fontFamily: subtitleFontFamily ?? undefined,
            fontFamilyStack: subtitleFontFallbackFamilies,
            backgroundColor: visualizerBackgroundColor,
        };

    return {
        visualizerTheme,
        visualizerSubtitleTheme,
        visualizerGeometrySeed: currentSongId ?? `geometry-${visualizerMode}`,
    };
};
