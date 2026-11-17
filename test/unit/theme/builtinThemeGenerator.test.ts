import { describe, expect, it } from 'vitest';
import { generateBuiltinDualTheme } from '@/utils/builtinTheme/generateBuiltinDualTheme';
import { analyzeCoverPalette } from '@/utils/builtinTheme/coverPaletteAnalysis';
import { BUILTIN_NAME_SUFFIX } from '@/utils/builtinTheme/themeNameTable';
import { sanitizeDualTheme } from '@/services/themeSanitizer';
import { getContrastRatio, getHueDistance, getOklabDistance, hexToHsl, hexToOklch } from '@/utils/themeColorMath';
import type { Theme } from '@/types';

// test/unit/theme/builtinThemeGenerator.test.ts

const createSequenceRandom = (seed: number) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
};

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

const expectReadableTheme = (theme: Theme) => {
    expect(getContrastRatio(theme.primaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(9);
    expect(getContrastRatio(theme.accentColor, theme.backgroundColor)).toBeGreaterThanOrEqual(3.2);
    expect(getContrastRatio(theme.secondaryColor, theme.backgroundColor)).toBeGreaterThanOrEqual(4.5);
};

describe('generateBuiltinDualTheme', () => {
    // Sweep many seeds and cover shapes: the contrast floors are solved iteratively, so a single
    // sample would not prove the solver never gives up short of the floor.
    const coverSamples: string[][] = [
        [],
        ['#f97316'],
        ['#22c55e', '#0ea5e9'],
        ['#7c3aed', '#f43f5e', '#facc15'],
        ['#2a2a2c', '#333336'],
        ['rgb(235, 120, 60)', 'rgb(40, 150, 220)'],
    ];

    it('keeps every generated theme readable and hex-shaped', () => {
        for (const coverColors of coverSamples) {
            for (let seed = 1; seed <= 25; seed += 1) {
                const dualTheme = generateBuiltinDualTheme({
                    coverColors,
                    random: createSequenceRandom(seed * 977 + 3),
                });

                for (const theme of [dualTheme.light, dualTheme.dark]) {
                    expect(theme.backgroundColor).toMatch(HEX_PATTERN);
                    expect(theme.primaryColor).toMatch(HEX_PATTERN);
                    expect(theme.accentColor).toMatch(HEX_PATTERN);
                    expect(theme.secondaryColor).toMatch(HEX_PATTERN);
                    expectReadableTheme(theme);
                }

                // Light stays light, dark stays dark.
                expect(hexToHsl(dualTheme.light.backgroundColor)!.l).toBeGreaterThan(0.85);
                expect(hexToHsl(dualTheme.dark.backgroundColor)!.l).toBeLessThan(0.2);
            }
        }
    });

    it('survives sanitizeDualTheme without any color being replaced', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#0ea5e9', '#f43f5e'],
            random: createSequenceRandom(42),
        });

        expect(sanitizeDualTheme(dualTheme)).toEqual(dualTheme);
    });

    it('names themes from the built-in table and marks them Built-in', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#7c3aed'],
            random: createSequenceRandom(5),
        });

        expect(dualTheme.light.name.endsWith(BUILTIN_NAME_SUFFIX)).toBe(true);
        expect(dualTheme.dark.name.endsWith(BUILTIN_NAME_SUFFIX)).toBe(true);
        expect(dualTheme.light.name.replace(BUILTIN_NAME_SUFFIX, '')).toHaveLength(4);
        expect(dualTheme.dark.name.replace(BUILTIN_NAME_SUFFIX, '')).toHaveLength(4);
        expect(dualTheme.light.name.slice(0, 2)).toBe(dualTheme.dark.name.slice(0, 2));
        expect(dualTheme.light.name).not.toBe(dualTheme.dark.name);
        expect(dualTheme.light.provider).toBe('Built-in');
    });

    it('fills a light and a dark atmosphere line from the description table', () => {
        const dualTheme = generateBuiltinDualTheme({
            coverColors: ['#22c55e'],
            random: createSequenceRandom(13),
        });

        for (const theme of [dualTheme.light, dualTheme.dark]) {
            expect(theme.description?.length).toBeGreaterThanOrEqual(15);
            expect(theme.description?.length).toBeLessThanOrEqual(30);
        }

        expect(dualTheme.light.description).not.toBe(dualTheme.dark.description);
    });

    it('leaves wordColors and lyricsIcons empty (no lyrics semantics available)', () => {
        const dualTheme = generateBuiltinDualTheme({ random: createSequenceRandom(3) });

        expect(dualTheme.light.wordColors).toEqual([]);
        expect(dualTheme.light.lyricsIcons).toEqual([]);
        expect(dualTheme.dark.wordColors).toEqual([]);
        expect(dualTheme.dark.lyricsIcons).toEqual([]);
    });

    it('varies background and name across random streams even without a cover', () => {
        const themes = [1, 2, 3, 4, 5, 6].map(seed => (
            generateBuiltinDualTheme({ random: createSequenceRandom(seed * 7919) })
        ));

        expect(new Set(themes.map(theme => theme.dark.backgroundColor)).size).toBeGreaterThan(1);
        expect(new Set(themes.map(theme => theme.dark.name)).size).toBeGreaterThan(1);
    });

    it('gives a muted cover a calmer accent than a vivid cover of the same hue', () => {
        const averageAccentChroma = (cover: string, mode: 'light' | 'dark') => {
            let total = 0;
            for (let seed = 1; seed <= 30; seed += 1) {
                const theme = generateBuiltinDualTheme({ coverColors: [cover], random: createSequenceRandom(seed * 389) })[mode];
                total += hexToOklch(theme.accentColor)!.C;
            }
            return total / 30;
        };

        for (const mode of ['light', 'dark'] as const) {
            expect(averageAccentChroma('#8f8a80', mode)).toBeLessThan(averageAccentChroma('#e0402a', mode) * 0.8);
        }
    });

    it('keeps the accent apart from the secondary text colour on grey and muted covers', () => {
        const covers = [[], ['#808080'], ['#2a2a2c', '#c8c8c6'], ['#8f8a80'], ['#6b7a8f'], ['#1d2b4a']];
        for (const coverColors of covers) {
            for (let seed = 1; seed <= 40; seed += 1) {
                const dualTheme = generateBuiltinDualTheme({ coverColors, random: createSequenceRandom(seed * 271) });
                for (const theme of [dualTheme.light, dualTheme.dark]) {
                    expect(getOklabDistance(theme.accentColor, theme.secondaryColor)).toBeGreaterThanOrEqual(0.05);
                    expectReadableTheme(theme);
                }
            }
        }
    });

    it('keeps light-theme accents out of the olive and khaki hues', () => {
        const covers = ['#ecec13', '#d6c21a', '#a4ec13', '#c8ec13', '#f2d600', '#7ca31f'];
        for (const cover of covers) {
            for (let seed = 1; seed <= 25; seed += 1) {
                const accent = hexToOklch(generateBuiltinDualTheme({
                    coverColors: [cover],
                    random: createSequenceRandom(seed * 613),
                }).light.accentColor)!;
                if (accent.C < 0.04) continue;
                expect(accent.h < 90 || accent.h > 135).toBe(true);
            }
        }
    });

    it('takes the accent hue from a second cover color when the cover is duotone', () => {
        const coverColors = ['#f43f5e', '#0ea5e9'];

        const duotoneRuns = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => (
            analyzeCoverPalette(coverColors, createSequenceRandom(seed * 131))
        )).filter(palette => palette.scheme === 'duotone');

        expect(duotoneRuns.length).toBeGreaterThan(0);

        const coverHues = coverColors.map(color => hexToHsl(color)!.h);
        for (const palette of duotoneRuns) {
            // The accent is the cover's own second hue (plus the small jitter), not a computed one.
            const nearestCoverHue = Math.min(...coverHues.map(hue => getHueDistance(palette.accentHue, hue)));
            expect(nearestCoverHue).toBeLessThanOrEqual(8);
            expect(getHueDistance(palette.accentHue, palette.baseHue)).toBeGreaterThan(20);
        }
    });
});
