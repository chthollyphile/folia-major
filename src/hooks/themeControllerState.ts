import { DualTheme, Theme } from '../types';

export const getBaseThemeForMode = ({
    defaultTheme,
    daylightTheme,
    isDaylight,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}): Theme => {
    return isDaylight ? daylightTheme : defaultTheme;
};

export const resolveDaylightToggleTheme = ({
    aiTheme,
    bgMode,
    isLight,
    defaultTheme,
    daylightTheme,
    previousTheme,
}: {
    aiTheme: DualTheme | null;
    bgMode: 'default' | 'ai';
    isLight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    previousTheme: Theme;
}): Theme => {
    if (!aiTheme) {
        return isLight ? daylightTheme : defaultTheme;
    }

    const selectedTheme = isLight ? aiTheme.light : aiTheme.dark;
    if (bgMode === 'default') {
        const baseTheme = isLight ? daylightTheme : defaultTheme;
        return {
            ...selectedTheme,
            backgroundColor: baseTheme.backgroundColor,
            wordColors: previousTheme.wordColors,
            lyricsIcons: previousTheme.lyricsIcons
        };
    }

    return {
        ...selectedTheme,
        wordColors: previousTheme.wordColors,
        lyricsIcons: previousTheme.lyricsIcons
    };
};

export const resolveBgModeTheme = ({
    mode,
    aiTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    previousTheme,
}: {
    mode: 'default' | 'ai';
    aiTheme: DualTheme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    previousTheme: Theme;
}): Theme => {
    if (mode === 'default') {
        const baseTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
        if (!aiTheme) {
            return baseTheme;
        }

        const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
        return {
            ...selectedAiTheme,
            backgroundColor: baseTheme.backgroundColor,
            wordColors: previousTheme.wordColors,
            lyricsIcons: previousTheme.lyricsIcons
        };
    }

    if (!aiTheme) {
        return previousTheme;
    }

    const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
    return {
        ...selectedAiTheme,
        wordColors: previousTheme.wordColors,
        lyricsIcons: previousTheme.lyricsIcons
    };
};

export const buildThemeFallback = (baseTheme: Theme): Theme => {
    return {
        ...baseTheme,
        wordColors: [],
        lyricsIcons: []
    };
};
