import { describe, expect, it } from 'vitest';
import {
    buildThemeSourceModel,
    buildDefaultCustomDualTheme,
    buildBuiltinDualTheme,
    getBaseThemeForMode,
    resolveBgModeTheme
} from '@/hooks/themeControllerState';
import { FALLBACK_AI_DUAL_THEME } from '@/services/themeSanitizer';
import { getContrastRatio, getHueDistance, hexToHsl } from '@/utils/themeColorMath';
import type { DualTheme, Theme } from '@/types';

// Deterministic stand-in for Math.random so the generated theme is reproducible in assertions.
const createSequenceRandom = (seed: number) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
};

const defaultTheme: Theme = {
    name: 'Midnight',
    backgroundColor: '#000000',
    primaryColor: '#ffffff',
    accentColor: '#ff0000',
    secondaryColor: '#888888',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [{ word: 'night', color: '#111111' }],
    lyricsIcons: ['moon']
};

const daylightTheme: Theme = {
    ...defaultTheme,
    name: 'Daylight',
    backgroundColor: '#ffffff',
    primaryColor: '#111111',
    wordColors: [{ word: 'day', color: '#eeeeee' }],
    lyricsIcons: ['sun']
};

const dualTheme: DualTheme = {
    light: {
        ...daylightTheme,
        name: 'AI Light',
        backgroundColor: '#f5d76e',
        wordColors: [{ word: 'ai-light', color: '#f5d76e' }],
        lyricsIcons: ['spark']
    },
    dark: {
        ...defaultTheme,
        name: 'AI Dark',
        backgroundColor: '#101820',
        wordColors: [{ word: 'ai-dark', color: '#101820' }],
        lyricsIcons: ['star']
    }
};

describe('themeControllerState', () => {
    it('returns the correct base theme for current daylight mode', () => {
        expect(getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight: false })).toBe(defaultTheme);
        expect(getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight: true })).toBe(daylightTheme);
    });

    it('returns the selected preset when using default background mode without AI theme', () => {
        const nextTheme = resolveBgModeTheme({
            aiTheme: null,
            mode: 'default',
            isDaylight: true,
            defaultTheme,
            daylightTheme,
            previousTheme: defaultTheme
        });

        expect(nextTheme).toBe(daylightTheme);
    });

    it('builds an initial custom theme from the default light and dark themes', () => {
        const initialCustomTheme = buildDefaultCustomDualTheme({
            defaultTheme,
            daylightTheme
        });

        expect(initialCustomTheme.light).toMatchObject({
            name: daylightTheme.name,
            backgroundColor: daylightTheme.backgroundColor,
            primaryColor: daylightTheme.primaryColor,
            accentColor: daylightTheme.accentColor,
            secondaryColor: daylightTheme.secondaryColor,
            provider: 'Custom'
        });
        expect(initialCustomTheme.dark).toMatchObject({
            name: defaultTheme.name,
            backgroundColor: defaultTheme.backgroundColor,
            primaryColor: defaultTheme.primaryColor,
            accentColor: defaultTheme.accentColor,
            secondaryColor: defaultTheme.secondaryColor,
            provider: 'Custom'
        });
        expect(initialCustomTheme.light.wordColors).toEqual([]);
        expect(initialCustomTheme.dark.wordColors).toEqual([]);
        expect(initialCustomTheme.light.lyricsIcons).toEqual([]);
        expect(initialCustomTheme.dark.lyricsIcons).toEqual([]);
    });

    it('uses the default AI dual theme when no generated AI theme exists', () => {
        const model = buildThemeSourceModel({
            bgMode: 'ai',
            aiTheme: null,
            legacyTheme: null,
            customTheme: null,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            currentSongHasLocalAiTheme: false,
        });

        expect(model.activeSource).toBe('ai');
        expect(model.current.label).toBe(FALLBACK_AI_DUAL_THEME.dark.name);
        expect(model.options.ai.available).toBe(true);
        expect(model.options.ai.editable).toBe(true);
        expect(model.canOpenQuickEditor).toBe(true);
    });

    it('treats built-in fallback dual themes as editable AI themes', () => {
        const fallbackTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(40, 150, 220)'],
        });
        const model = buildThemeSourceModel({
            bgMode: 'ai',
            aiTheme: fallbackTheme,
            legacyTheme: null,
            customTheme: null,
            isDaylight: true,
            defaultTheme,
            daylightTheme,
            currentSongHasLocalAiTheme: false,
        });

        expect(model.activeSource).toBe('ai');
        expect(model.current.label).toBe(fallbackTheme.light.name);
        expect(model.options.ai.available).toBe(true);
        expect(model.options.ai.editable).toBe(true);
        expect(model.editableSource).toBe('ai');
    });

    it('shows legacy AI themes as available but not quick editable', () => {
        const legacyTheme: Theme = {
            ...defaultTheme,
            name: 'Legacy AI Theme',
        };
        const model = buildThemeSourceModel({
            bgMode: 'ai',
            aiTheme: null,
            legacyTheme,
            customTheme: null,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            currentSongHasLocalAiTheme: false,
        });

        expect(model.activeSource).toBe('ai');
        expect(model.current.label).toBe('Legacy AI Theme');
        expect(model.options.ai.available).toBe(true);
        expect(model.options.ai.editable).toBe(false);
        expect(model.editableSource).toBeNull();
    });

    it('marks the active custom source as quick editable', () => {
        const customTheme = buildDefaultCustomDualTheme({
            defaultTheme,
            daylightTheme,
        });
        const model = buildThemeSourceModel({
            bgMode: 'custom',
            aiTheme: dualTheme,
            legacyTheme: null,
            customTheme,
            isDaylight: true,
            defaultTheme,
            daylightTheme,
            currentSongHasLocalAiTheme: false,
        });

        expect(model.activeSource).toBe('custom');
        expect(model.current.label).toBe(customTheme.light.name);
        expect(model.options.custom.available).toBe(true);
        expect(model.options.custom.editable).toBe(true);
        expect(model.editableSource).toBe('custom');
    });

    it('returns the daylight preset untouched in default mode while an AI theme is loaded', () => {
        const previousTheme: Theme = {
            ...dualTheme.light,
            wordColors: [{ word: 'drop-me', color: '#00ff00' }],
            lyricsIcons: ['drop-icon']
        };

        const nextTheme = resolveBgModeTheme({
            aiTheme: dualTheme,
            mode: 'default',
            isDaylight: true,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme).toBe(daylightTheme);
    });

    it('applies the default AI theme when AI background mode is requested without generated AI theme', () => {
        const previousTheme: Theme = {
            ...defaultTheme,
            name: 'Legacy Theme',
            wordColors: [{ word: 'legacy', color: '#999999' }],
            lyricsIcons: ['legacy-icon']
        };

        const nextTheme = resolveBgModeTheme({
            mode: 'ai',
            aiTheme: null,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme.name).toBe(FALLBACK_AI_DUAL_THEME.dark.name);
        expect(nextTheme.backgroundColor).toBe(FALLBACK_AI_DUAL_THEME.dark.backgroundColor);
        expect(nextTheme.wordColors).toEqual(previousTheme.wordColors);
        expect(nextTheme.lyricsIcons).toEqual(previousTheme.lyricsIcons);
    });

    // #947: switching back to the default source after generating an AI theme must restore the preset.
    it('switches back to the midnight preset in default mode while an AI theme is loaded', () => {
        const previousTheme: Theme = {
            ...dualTheme.dark,
            wordColors: [{ word: 'drop-me', color: '#123456' }],
            lyricsIcons: ['drop-icon']
        };

        const nextTheme = resolveBgModeTheme({
            mode: 'default',
            aiTheme: dualTheme,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme).toBe(defaultTheme);
    });

    it('applies AI background mode while keeping existing visual tokens', () => {
        const previousTheme: Theme = {
            ...defaultTheme,
            wordColors: [{ word: 'persist', color: '#654321' }],
            lyricsIcons: ['persist-icon']
        };

        const nextTheme = resolveBgModeTheme({
            mode: 'ai',
            aiTheme: dualTheme,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme.name).toBe('AI Dark');
        expect(nextTheme.backgroundColor).toBe(dualTheme.dark.backgroundColor);
        expect(nextTheme.wordColors).toEqual(previousTheme.wordColors);
        expect(nextTheme.lyricsIcons).toEqual(previousTheme.lyricsIcons);
    });

    it('builds a built-in dual theme from warm cover colors', () => {
        const builtinTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(220, 110, 70)', '#f97316'],
            random: createSequenceRandom(7),
        });

        expect(builtinTheme.dark.name).toContain('Built-in');
        expect(builtinTheme.light.name).toContain('Built-in');
        expect(builtinTheme.dark.name).not.toBe(builtinTheme.light.name);
        // Light and dark are the same theme seen day and night: same Chinese prefix, different suffix.
        expect(builtinTheme.dark.name.slice(0, 2)).toBe(builtinTheme.light.name.slice(0, 2));
        expect(builtinTheme.dark.provider).toBe('Built-in');
        expect(builtinTheme.light.provider).toBe('Built-in');
        expect(builtinTheme.dark.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(builtinTheme.light.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
        expect(builtinTheme.dark.backgroundColor).not.toBe(builtinTheme.light.backgroundColor);

        for (const theme of [builtinTheme.light, builtinTheme.dark]) {
            expect(getContrastRatio(theme.primaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(9);
            expect(getContrastRatio(theme.accentColor, theme.backgroundColor)).toBeGreaterThanOrEqual(3.2);
            expect(getContrastRatio(theme.secondaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(4.5);
            expect(theme.description?.length).toBeGreaterThanOrEqual(15);
            expect(theme.description?.length).toBeLessThanOrEqual(30);
        }
    });

    it('follows the cover hue instead of snapping onto a fixed palette family', () => {
        const warmTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(235, 120, 60)'],
            random: createSequenceRandom(11),
        });
        const coolTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(40, 150, 220)'],
            random: createSequenceRandom(11),
        });

        // rgb(235, 120, 60) sits near 21deg, rgb(40, 150, 220) near 203deg.
        expect(getHueDistance(hexToHsl(warmTheme.dark.backgroundColor)!.h, 21)).toBeLessThan(30);
        expect(getHueDistance(hexToHsl(coolTheme.dark.backgroundColor)!.h, 203)).toBeLessThan(30);
        expect(warmTheme.dark.name).not.toBe(coolTheme.dark.name);
        expect(warmTheme.light.accentColor).not.toBe(coolTheme.light.accentColor);
    });
});
