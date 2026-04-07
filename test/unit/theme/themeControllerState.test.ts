import { describe, expect, it } from 'vitest';
import {
    buildThemeFallback,
    getBaseThemeForMode,
    resolveBgModeTheme,
    resolveDaylightToggleTheme
} from '@/hooks/themeControllerState';
import type { DualTheme, Theme } from '@/types';

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

    it('resolves daylight toggle without AI theme by switching to the selected preset', () => {
        const nextTheme = resolveDaylightToggleTheme({
            aiTheme: null,
            bgMode: 'default',
            isLight: true,
            defaultTheme,
            daylightTheme,
            previousTheme: defaultTheme
        });

        expect(nextTheme).toBe(daylightTheme);
    });

    it('preserves visual tokens while toggling daylight with AI theme in default background mode', () => {
        const previousTheme: Theme = {
            ...dualTheme.dark,
            wordColors: [{ word: 'keep-me', color: '#00ff00' }],
            lyricsIcons: ['keep-icon']
        };

        const nextTheme = resolveDaylightToggleTheme({
            aiTheme: dualTheme,
            bgMode: 'default',
            isLight: true,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme.name).toBe('AI Light');
        expect(nextTheme.backgroundColor).toBe(daylightTheme.backgroundColor);
        expect(nextTheme.wordColors).toEqual(previousTheme.wordColors);
        expect(nextTheme.lyricsIcons).toEqual(previousTheme.lyricsIcons);
    });

    it('switches bg mode back to default while retaining AI foreground tokens', () => {
        const previousTheme: Theme = {
            ...dualTheme.dark,
            wordColors: [{ word: 'persist', color: '#123456' }],
            lyricsIcons: ['persist-icon']
        };

        const nextTheme = resolveBgModeTheme({
            mode: 'default',
            aiTheme: dualTheme,
            isDaylight: false,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme.name).toBe('AI Dark');
        expect(nextTheme.backgroundColor).toBe(defaultTheme.backgroundColor);
        expect(nextTheme.wordColors).toEqual(previousTheme.wordColors);
        expect(nextTheme.lyricsIcons).toEqual(previousTheme.lyricsIcons);
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

    it('builds fallback themes with cleared visual token arrays', () => {
        expect(buildThemeFallback(defaultTheme)).toEqual({
            ...defaultTheme,
            wordColors: [],
            lyricsIcons: []
        });
    });
});
