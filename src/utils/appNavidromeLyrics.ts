import { LyricParserFactory } from './lyrics/LyricParserFactory';
import type { LyricData } from '../types';
import type { NavidromeConfig, NavidromeSong, StructuredLyric } from '../types/navidrome';
import { navidromeApi } from '../services/navidromeService';
import { hasEnhancedStructuredLines, hasRenderableLyrics } from './appPlaybackHelpers';

// Navidrome lyric selection and hydration helpers kept outside App.tsx.
export const selectPreferredStructuredLyric = (items: StructuredLyric[] | null | undefined): StructuredLyric | null => {
    if (!items?.length) {
        return null;
    }

    const nonEmptyItems = items.filter(item => item.line?.some(line => (line.value || '').trim().length > 0));
    if (nonEmptyItems.length === 0) {
        return null;
    }

    return nonEmptyItems.find(hasEnhancedStructuredLines)
        || nonEmptyItems.find(item => item.synced)
        || nonEmptyItems[0];
};

export const resolvePreferredNavidromeLyrics = async (
    navidromeSong: Pick<NavidromeSong, 'cachedStructuredLyrics' | 'cachedPlainLyrics'>
): Promise<LyricData | null> => {
    const structuredLyrics = navidromeSong.cachedStructuredLyrics?.filter(line => (line.value || '').trim().length > 0);

    if (structuredLyrics && structuredLyrics.length > 0) {
        const parsedStructuredLyrics = await LyricParserFactory.parse({ type: 'navidrome', structuredLyrics });
        if (hasRenderableLyrics(parsedStructuredLyrics)) {
            return parsedStructuredLyrics;
        }
    }

    const plainLyrics = navidromeSong.cachedPlainLyrics?.trim();
    if (plainLyrics) {
        const parsedPlainLyrics = await LyricParserFactory.parse({ type: 'navidrome', plainLyrics });
        if (hasRenderableLyrics(parsedPlainLyrics)) {
            return parsedPlainLyrics;
        }
    }

    return null;
};

export const hydrateNavidromeLyricPayload = async (config: NavidromeConfig, navidromeSong: NavidromeSong): Promise<void> => {
    const navidromeId = navidromeSong.navidromeData?.id;
    if (!navidromeId) {
        return;
    }

    if (!navidromeSong.cachedStructuredLyrics?.length) {
        try {
            const structuredLyrics = await navidromeApi.getLyricsBySongId(config, navidromeId);
            const preferredStructuredLyrics = selectPreferredStructuredLyric(structuredLyrics);

            if (preferredStructuredLyrics?.line?.length) {
                navidromeSong.cachedStructuredLyrics = preferredStructuredLyrics.line;
            }
            if (!preferredStructuredLyrics?.line?.length && !navidromeSong.cachedPlainLyrics) {
                const artistName = navidromeSong.ar?.[0]?.name || navidromeSong.artists?.[0]?.name || '';
                const plainLyrics = await navidromeApi.getLyrics(config, artistName, navidromeSong.name);
                if (plainLyrics?.trim()) {
                    navidromeSong.cachedPlainLyrics = plainLyrics;
                }
            }
        } catch (e) {
            console.warn('[App] Failed to fetch Navidrome lyrics:', e);
        }
    }
};
