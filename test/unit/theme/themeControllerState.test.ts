import { describe, expect, it } from 'vitest';
import {
    buildBuiltinDualTheme,
    getBaseThemeForMode,
    resolveBgModeTheme
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

    it('preserves visual tokens while using AI foreground in daylight default background mode', () => {
        const previousTheme: Theme = {
            ...dualTheme.dark,
            wordColors: [{ word: 'keep-me', color: '#00ff00' }],
            lyricsIcons: ['keep-icon']
        };

        const nextTheme = resolveBgModeTheme({
            aiTheme: dualTheme,
            mode: 'default',
            isDaylight: true,
            defaultTheme,
            daylightTheme,
            previousTheme
        });

        expect(nextTheme.name).toBe('AI Light');
        expect(nextTheme.backgroundColor).toBe(daylightTheme.backgroundColor);
        expect(nextTheme.wordColors).toEqual(previousTheme.wordColors);
        expect(nextTheme.lyricsIcons).toEqual(previousTheme.lyricsIcons);
    });

    it('keeps the previous theme when AI background mode is requested without AI theme', () => {
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

        expect(nextTheme).toBe(previousTheme);
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

    it('builds a built-in dual theme from warm cover colors', () => {
        const builtinTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(220, 110, 70)', '#f97316']
        });

        expect(builtinTheme.dark.name).toContain('Built-in');
        expect(builtinTheme.light.name).toContain('Built-in');
        expect(builtinTheme.dark.provider).toBe('Built-in');
        expect(builtinTheme.light.provider).toBe('Built-in');
        expect(builtinTheme.dark.backgroundColor).toMatch(/^#/);
        expect(builtinTheme.light.backgroundColor).toMatch(/^#/);
        expect(builtinTheme.dark.backgroundColor).not.toBe(builtinTheme.light.backgroundColor);
        expect(builtinTheme.dark.primaryColor).toBe('#f8fafc');
        expect(builtinTheme.light.primaryColor).toBe('#111827');
    });

    it('switches built-in palette families when the cover color hue changes', () => {
        const warmTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(235, 120, 60)']
        });
        const coolTheme = buildBuiltinDualTheme({
            coverColors: ['rgb(40, 150, 220)']
        });

        expect(warmTheme.dark.name).not.toBe(coolTheme.dark.name);
        expect(warmTheme.light.accentColor).not.toBe(coolTheme.light.accentColor);
    });
});
