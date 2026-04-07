import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedThemeState, getLastDualTheme } from '@/services/themeCache';
import { getFromCache } from '@/services/db';
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
            theme: dualTheme
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
            theme: legacyTheme
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

        await expect(getLastDualTheme()).resolves.toBe(dualTheme);
        expect(getFromCacheMock).toHaveBeenCalledWith('last_dual_theme');
    });
});
