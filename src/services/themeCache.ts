import { DualTheme, Theme } from '../types';
import { getFromCache } from './db';

export type CachedThemeState =
    | { kind: 'dual'; theme: DualTheme }
    | { kind: 'legacy'; theme: Theme }
    | { kind: 'none' };

export async function getCachedThemeState(songId: number): Promise<CachedThemeState> {
    const dualTheme = await getFromCache<DualTheme>(`dual_theme_${songId}`);
    if (dualTheme) {
        return { kind: 'dual', theme: dualTheme };
    }

    const legacyTheme = await getFromCache<Theme>(`theme_${songId}`);
    if (legacyTheme) {
        return { kind: 'legacy', theme: legacyTheme };
    }

    return { kind: 'none' };
}

export async function getLastDualTheme(): Promise<DualTheme | null> {
    return getFromCache<DualTheme>('last_dual_theme');
}
