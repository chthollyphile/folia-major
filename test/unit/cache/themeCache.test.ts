import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedThemeState, getLastDualTheme, getLastLegacyTheme } from '@/services/themeCache';
import { getFromCache } from '@/services/db';
import { FALLBACK_AI_DUAL_THEME, normalizeThemeHexColor, sanitizeDualTheme, sanitizeTheme } from '@/services/themeSanitizer';
import type { DualTheme, Theme } from '@/types';

vi.mock('@/services/db', () => ({
    getFromCache: vi.fn()
}));

describe('themeCache', () => {
    const getFromCacheMock = vi.mocked(getFromCache);

    const legacyTheme: Theme = {
        name: 'Legacy Theme',
        backgroundColor: '#111111',
        primaryColor: '#ffffff',
        accentColor: '#ff6600',
        secondaryColor: '#999999',
        fontStyle: 'sans',
        animationIntensity: 'normal'
    };

    const dualTheme: DualTheme = {
        light: {
            ...legacyTheme,
            name: 'Light Theme',
            backgroundColor: '#ffffff',
            primaryColor: '#111111'
        },
        dark: {
            ...legacyTheme,
            name: 'Dark Theme'
        }
    };

    beforeEach(() => {
        getFromCacheMock.mockReset();
    });

    it('prefers cached dual themes over legacy theme entries', async () => {
        getFromCacheMock.mockResolvedValueOnce(dualTheme);

        await expect(getCachedThemeState(42)).resolves.toEqual({
            kind: 'dual',
            theme: sanitizeDualTheme(dualTheme)
        });
        expect(getFromCacheMock).toHaveBeenCalledWith('dual_theme_42');
        expect(getFromCacheMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to legacy cached themes when dual themes are missing', async () => {
        getFromCacheMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(legacyTheme);

        await expect(getCachedThemeState(7)).resolves.toEqual({
            kind: 'legacy',
            theme: sanitizeTheme(legacyTheme, FALLBACK_AI_DUAL_THEME.dark)
        });
        expect(getFromCacheMock).toHaveBeenNthCalledWith(1, 'dual_theme_7');
        expect(getFromCacheMock).toHaveBeenNthCalledWith(2, 'theme_7');
    });

    it('returns none when no cached theme exists', async () => {
        getFromCacheMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

        await expect(getCachedThemeState(9)).resolves.toEqual({ kind: 'none' });
    });

    it('reads the last dual theme from cache', async () => {
        getFromCacheMock.mockResolvedValueOnce(dualTheme);

        await expect(getLastDualTheme()).resolves.toEqual(sanitizeDualTheme(dualTheme));
        expect(getFromCacheMock).toHaveBeenCalledWith('last_dual_theme');
    });

    it('sanitizes malformed cached AI colors before returning them', async () => {
        getFromCacheMock.mockResolvedValueOnce({
            light: {
                ...dualTheme.light,
                accentColor: '#e9b11',
                wordColors: [
                    { word: 'rain', color: '#12' },
                    { word: '', color: '#ffffff' },
                    { word: 'sky', color: '#abc' }
                ],
                lyricsIcons: ['Moon', null, '']
            },
            dark: {
                ...dualTheme.dark,
                backgroundColor: 'blue',
                primaryColor: '#DEF'
            }
        });

        const cached = await getLastDualTheme();

        expect(cached?.light.accentColor).toBe(FALLBACK_AI_DUAL_THEME.light.accentColor);
        expect(cached?.light.wordColors).toEqual([
            { word: 'rain', color: FALLBACK_AI_DUAL_THEME.light.accentColor },
            { word: 'sky', color: '#aabbcc' }
        ]);
        expect(cached?.light.lyricsIcons).toEqual(['Moon']);
        expect(cached?.dark.backgroundColor).toBe(FALLBACK_AI_DUAL_THEME.dark.backgroundColor);
        expect(cached?.dark.primaryColor).toBe('#ddeeff');
    });

    it('normalizes invalid colors without trusting malformed fallback values', () => {
        expect(normalizeThemeHexColor('#ABC', '#000000')).toBe('#aabbcc');
        expect(normalizeThemeHexColor('#e9b11', '#12345')).toBe('#ffffff');
        expect(normalizeThemeHexColor('#e9b11', '#12345', '#111827')).toBe('#111827');
    });

    it('sanitizes malformed cached legacy AI themes', async () => {
        getFromCacheMock.mockResolvedValueOnce({
            ...legacyTheme,
            secondaryColor: '#12345',
            wordColors: [{ word: 'glow', color: 'orange' }]
        });

        const cached = await getLastLegacyTheme();

        expect(cached?.secondaryColor).toBe(FALLBACK_AI_DUAL_THEME.dark.secondaryColor);
        expect(cached?.wordColors).toEqual([{ word: 'glow', color: legacyTheme.accentColor }]);
    });
});
