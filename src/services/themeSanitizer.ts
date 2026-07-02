import type { DualTheme, Theme } from '../types';

// src/services/themeSanitizer.ts
// ESM sanitizer used by browser, API handlers, and workers.

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const FALLBACK_LIGHT_THEME: Theme = {
    name: 'AI Light',
    backgroundColor: '#ffffff',
    primaryColor: '#111827',
    accentColor: '#2563eb',
    secondaryColor: '#475569',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: [],
    provider: 'AI',
};

const FALLBACK_DARK_THEME: Theme = {
    name: 'AI Dark',
    backgroundColor: '#0f172a',
    primaryColor: '#f8fafc',
    accentColor: '#7dd3fc',
    secondaryColor: '#cbd5e1',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: [],
    provider: 'AI',
};

export const FALLBACK_AI_DUAL_THEME: DualTheme = {
    light: FALLBACK_LIGHT_THEME,
    dark: FALLBACK_DARK_THEME,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const normalizeHexColorCandidate = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
        return null;
    }

    const hex = trimmed.slice(1).toLowerCase();
    if (hex.length === 3) {
        return `#${hex.split('').map(char => `${char}${char}`).join('')}`;
    }

    return `#${hex}`;
};

export const normalizeThemeHexColor = (
    value: unknown,
    fallback: string,
    hardFallback = '#ffffff',
): string => (
    normalizeHexColorCandidate(value)
    ?? normalizeHexColorCandidate(fallback)
    ?? hardFallback
);

const normalizeFontStyle = (value: unknown, fallback: Theme['fontStyle']): Theme['fontStyle'] => (
    value === 'serif' || value === 'mono' || value === 'sans' ? value : fallback
);

const normalizeAnimationIntensity = (
    value: unknown,
    fallback: Theme['animationIntensity'],
): Theme['animationIntensity'] => (
    value === 'calm' || value === 'chaotic' || value === 'normal' ? value : fallback
);

const normalizeWordColors = (
    value: unknown,
    fallbackColor: string,
): NonNullable<Theme['wordColors']> => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap(entry => {
        if (!isRecord(entry)) {
            return [];
        }

        const word = typeof entry.word === 'string' ? entry.word.trim() : '';
        if (!word) {
            return [];
        }

        const color = normalizeThemeHexColor(entry.color, fallbackColor);

        return [{ word, color }];
    });
};

const normalizeLyricsIcons = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((icon): icon is string => typeof icon === 'string')
        .map(icon => icon.trim())
        .filter(Boolean)
        .slice(0, 12);
};

export const sanitizeTheme = (
    value: unknown,
    fallbackTheme: Theme,
): Theme => {
    const source = isRecord(value) ? value : {};
    const accentColor = normalizeThemeHexColor(source.accentColor, fallbackTheme.accentColor);

    return {
        ...fallbackTheme,
        name: typeof source.name === 'string' && source.name.trim()
            ? source.name.trim()
            : fallbackTheme.name,
        description: typeof source.description === 'string'
            ? source.description.trim()
            : fallbackTheme.description,
        backgroundColor: normalizeThemeHexColor(source.backgroundColor, fallbackTheme.backgroundColor),
        primaryColor: normalizeThemeHexColor(source.primaryColor, fallbackTheme.primaryColor),
        accentColor,
        secondaryColor: normalizeThemeHexColor(source.secondaryColor, fallbackTheme.secondaryColor),
        fontStyle: normalizeFontStyle(source.fontStyle, fallbackTheme.fontStyle),
        animationIntensity: normalizeAnimationIntensity(source.animationIntensity, fallbackTheme.animationIntensity),
        wordColors: normalizeWordColors(source.wordColors, accentColor),
        lyricsIcons: normalizeLyricsIcons(source.lyricsIcons),
        provider: typeof source.provider === 'string' && source.provider.trim()
            ? source.provider.trim()
            : fallbackTheme.provider,
    };
};

export const sanitizeDualTheme = (
    value: unknown,
    fallbackTheme: DualTheme = FALLBACK_AI_DUAL_THEME,
): DualTheme => {
    const source = isRecord(value) ? value : {};
    return {
        light: sanitizeTheme(source.light, fallbackTheme.light),
        dark: sanitizeTheme(source.dark, fallbackTheme.dark),
    };
};
