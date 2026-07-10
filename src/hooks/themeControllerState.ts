import { DualTheme, Theme } from '../types';
import { applyStoredAnimationIntensityToDualTheme } from '../services/themePreferences';
import { FALLBACK_AI_DUAL_THEME } from '../services/themeSanitizer';

export type ThemeSourceKind = 'default' | 'ai' | 'custom';
export type EditableThemeSourceKind = 'ai' | 'custom';

export type ThemeSourceOption = {
    source: ThemeSourceKind;
    available: boolean;
    editable: boolean;
    theme: Theme | null;
    label: string;
    swatchColor: string;
};

export type ThemeSourceModel = {
    activeSource: ThemeSourceKind;
    current: ThemeSourceOption;
    options: Record<ThemeSourceKind, ThemeSourceOption>;
    editableSource: EditableThemeSourceKind | null;
    canOpenQuickEditor: boolean;
    hasLocalAiTheme: boolean;
};

interface RgbColor {
    r: number;
    g: number;
    b: number;
}

interface BuiltinPalette {
    name: string;
    hue: number;
    darkBackground: string;
    lightBackground: string;
    accent: string;
    secondary: string;
}

const BUILTIN_THEME_PALETTES: BuiltinPalette[] = [
    {
        name: 'Sunset Bloom',
        hue: 8,
        darkBackground: '#170d0e',
        lightBackground: '#fff4ef',
        accent: '#ff7a59',
        secondary: '#ffc4ae'
    },
    {
        name: 'Golden Hour',
        hue: 42,
        darkBackground: '#171108',
        lightBackground: '#fff8e7',
        accent: '#eab308',
        secondary: '#fcd34d'
    },
    {
        name: 'Forest Echo',
        hue: 145,
        darkBackground: '#09140f',
        lightBackground: '#eefbf3',
        accent: '#22c55e',
        secondary: '#86efac'
    },
    {
        name: 'Ocean Mist',
        hue: 190,
        darkBackground: '#08141a',
        lightBackground: '#ebfbff',
        accent: '#06b6d4',
        secondary: '#67e8f9'
    },
    {
        name: 'Twilight Signal',
        hue: 228,
        darkBackground: '#0c1020',
        lightBackground: '#eef2ff',
        accent: '#6366f1',
        secondary: '#a5b4fc'
    },
    {
        name: 'Rose Vinyl',
        hue: 338,
        darkBackground: '#180d13',
        lightBackground: '#fff1f5',
        accent: '#f43f5e',
        secondary: '#fda4af'
    }
];

const FALLBACK_THEME_COLOR = '#4f7cff';

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const parseColor = (value: string): RgbColor | null => {
    const normalized = value.trim();

    const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (hexMatch) {
        const hex = hexMatch[1];
        const expanded = hex.length === 3
            ? hex.split('').map(char => `${char}${char}`).join('')
            : hex;

        return {
            r: parseInt(expanded.slice(0, 2), 16),
            g: parseInt(expanded.slice(2, 4), 16),
            b: parseInt(expanded.slice(4, 6), 16)
        };
    }

    const rgbMatch = normalized.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (!rgbMatch) {
        return null;
    }

    return {
        r: clampChannel(Number(rgbMatch[1])),
        g: clampChannel(Number(rgbMatch[2])),
        b: clampChannel(Number(rgbMatch[3]))
    };
};

const toHex = ({ r, g, b }: RgbColor) => {
    return `#${[r, g, b].map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
};

const mixColors = (from: string, to: string, amount: number) => {
    const start = parseColor(from);
    const end = parseColor(to);

    if (!start || !end) {
        return toHex(parseColor(to) || parseColor(from) || parseColor(FALLBACK_THEME_COLOR)!);
    }

    const ratio = Math.max(0, Math.min(1, amount));
    return toHex({
        r: start.r + (end.r - start.r) * ratio,
        g: start.g + (end.g - start.g) * ratio,
        b: start.b + (end.b - start.b) * ratio
    });
};

const getRelativeLuminance = (color: string) => {
    const parsed = parseColor(color);
    if (!parsed) return 0;

    const transform = (channel: number) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };

    const r = transform(parsed.r);
    const g = transform(parsed.g);
    const b = transform(parsed.b);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const getContrastRatio = (foreground: string, background: string) => {
    const luminanceA = getRelativeLuminance(foreground);
    const luminanceB = getRelativeLuminance(background);
    const [lighter, darker] = luminanceA > luminanceB
        ? [luminanceA, luminanceB]
        : [luminanceB, luminanceA];

    return (lighter + 0.05) / (darker + 0.05);
};

const ensureContrast = (
    foreground: string,
    background: string,
    minimumRatio: number,
    fallback: string
) => {
    return getContrastRatio(foreground, background) >= minimumRatio ? foreground : fallback;
};

const getHue = (color: string) => {
    const parsed = parseColor(color);
    if (!parsed) return 220;

    const r = parsed.r / 255;
    const g = parsed.g / 255;
    const b = parsed.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (delta === 0) return 220;

    let hue = 0;
    if (max === r) {
        hue = ((g - b) / delta) % 6;
    } else if (max === g) {
        hue = (b - r) / delta + 2;
    } else {
        hue = (r - g) / delta + 4;
    }

    return Math.round((hue * 60 + 360) % 360);
};

const getSaturation = (color: string) => {
    const parsed = parseColor(color);
    if (!parsed) return 0;

    const max = Math.max(parsed.r, parsed.g, parsed.b);
    const min = Math.min(parsed.r, parsed.g, parsed.b);
    if (max === 0) return 0;

    return (max - min) / max;
};

const pickDominantCoverColor = (coverColors: string[]) => {
    const viableColor = coverColors.find(color => parseColor(color) && getSaturation(color) > 0.12);
    return viableColor || coverColors.find(color => parseColor(color)) || FALLBACK_THEME_COLOR;
};

const getHueDistance = (a: number, b: number) => {
    const distance = Math.abs(a - b);
    return Math.min(distance, 360 - distance);
};

const pickPaletteForColor = (color: string) => {
    const hue = getHue(color);
    return BUILTIN_THEME_PALETTES.reduce((best, candidate) => {
        const candidateDistance = getHueDistance(hue, candidate.hue);
        const bestDistance = getHueDistance(hue, best.hue);
        return candidateDistance < bestDistance ? candidate : best;
    }, BUILTIN_THEME_PALETTES[0]);
};

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

const getSelectedDualTheme = (dualTheme: DualTheme, isDaylight: boolean) => (
    isDaylight ? dualTheme.light : dualTheme.dark
);

const buildThemeSourceOption = (
    source: ThemeSourceKind,
    theme: Theme | null,
    available: boolean,
    editable: boolean,
): ThemeSourceOption => ({
    source,
    available,
    editable,
    theme,
    label: theme?.name ?? '',
    swatchColor: theme?.backgroundColor ?? 'transparent',
});

export const buildThemeSourceModel = ({
    bgMode,
    aiTheme,
    legacyTheme,
    customTheme,
    isDaylight,
    defaultTheme,
    daylightTheme,
    currentSongHasLocalAiTheme,
}: {
    bgMode: ThemeSourceKind;
    aiTheme: DualTheme | null;
    legacyTheme: Theme | null;
    customTheme: DualTheme | null;
    isDaylight: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    currentSongHasLocalAiTheme: boolean;
}): ThemeSourceModel => {
    const defaultSourceTheme = getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
    const aiSourceTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : legacyTheme ?? getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);
    const customSourceTheme = customTheme
        ? getSelectedDualTheme(customTheme, isDaylight)
        : null;

    const options: Record<ThemeSourceKind, ThemeSourceOption> = {
        default: buildThemeSourceOption('default', defaultSourceTheme, true, false),
        ai: buildThemeSourceOption('ai', aiSourceTheme, true, Boolean(aiTheme || !legacyTheme)),
        custom: buildThemeSourceOption('custom', customSourceTheme, Boolean(customTheme), Boolean(customTheme)),
    };

    const activeSource = options[bgMode]?.available ? bgMode : 'default';
    const editableSource = options[activeSource].editable && activeSource !== 'default'
        ? activeSource
        : null;

    return {
        activeSource,
        current: options[activeSource],
        options,
        editableSource,
        canOpenQuickEditor: options.ai.editable || options.custom.editable,
        hasLocalAiTheme: currentSongHasLocalAiTheme,
    };
};

export const buildDefaultCustomDualTheme = ({
    defaultTheme,
    daylightTheme,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
}): DualTheme => applyStoredAnimationIntensityToDualTheme({
    light: {
        ...daylightTheme,
        wordColors: [],
        lyricsIcons: [],
        provider: 'Custom',
    },
    dark: {
        ...defaultTheme,
        wordColors: [],
        lyricsIcons: [],
        provider: 'Custom',
    },
});

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

    const selectedAiTheme = aiTheme
        ? getSelectedDualTheme(aiTheme, isDaylight)
        : getSelectedDualTheme(FALLBACK_AI_DUAL_THEME, isDaylight);
    return {
        ...selectedAiTheme,
        wordColors: previousTheme.wordColors,
        lyricsIcons: previousTheme.lyricsIcons
    };
};

export const buildBuiltinDualTheme = ({
    coverColors = []
}: {
    coverColors?: string[];
} = {}): DualTheme => {
    const dominantColor = pickDominantCoverColor(coverColors);
    const palette = pickPaletteForColor(dominantColor);

    const darkBackground = mixColors(palette.darkBackground, dominantColor, 0.2);
    const lightBackground = mixColors(palette.lightBackground, dominantColor, 0.1);
    const darkAccentBase = mixColors(palette.accent, dominantColor, 0.45);
    const lightAccentBase = mixColors(palette.accent, dominantColor, 0.35);
    const darkSecondaryBase = mixColors(palette.secondary, dominantColor, 0.25);
    const lightSecondaryBase = mixColors(palette.secondary, dominantColor, 0.15);

    return applyStoredAnimationIntensityToDualTheme({
        light: {
            name: `${palette.name} Built-in`,
            backgroundColor: lightBackground,
            primaryColor: ensureContrast('#111827', lightBackground, 10, '#0f172a'),
            accentColor: ensureContrast(mixColors(lightAccentBase, '#111827', 0.18), lightBackground, 3, '#1d4ed8'),
            secondaryColor: ensureContrast(mixColors(lightSecondaryBase, '#1f2937', 0.35), lightBackground, 4.5, '#475569'),
            fontStyle: 'sans',
            animationIntensity: 'normal',
            wordColors: [],
            lyricsIcons: [],
            provider: 'Built-in'
        },
        dark: {
            name: `${palette.name} Built-in`,
            backgroundColor: darkBackground,
            primaryColor: ensureContrast('#f8fafc', darkBackground, 12, '#ffffff'),
            accentColor: ensureContrast(mixColors(darkAccentBase, '#ffffff', 0.08), darkBackground, 3, '#7dd3fc'),
            secondaryColor: ensureContrast(mixColors(darkSecondaryBase, '#f8fafc', 0.22), darkBackground, 4.5, '#cbd5e1'),
            fontStyle: 'sans',
            animationIntensity: 'normal',
            wordColors: [],
            lyricsIcons: [],
            provider: 'Built-in'
        }
    });
};
