import type { ChorusRange, OnlineProviderId, ProviderLyricsResult } from '../../types/onlineMusic';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from './chorusEffects';

// src/utils/lyrics/chorusResolver.ts

export interface ResolveProviderLyricsChorusOptions {
    providerId: OnlineProviderId;
    songId: number | string;
    fetchChorusRanges?: () => Promise<ChorusRange[]>;
}

export interface ResolvedProviderLyricsChorus {
    result: ProviderLyricsResult;
    mode: 'none' | 'existing' | 'native' | 'text';
}

// Resolves chorus metadata only after the active provider has assembled its complete lyric result.
export const resolveProviderLyricsChorus = async (
    providerResult: ProviderLyricsResult,
    options: ResolveProviderLyricsChorusOptions,
): Promise<ResolvedProviderLyricsChorus> => {
    const lyrics = providerResult.lyrics;
    if (!lyrics) {
        return { result: providerResult, mode: 'none' };
    }

    if (lyrics.lines.some(line => line.isChorus)) {
        console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} using existing chorus markers`);
        return { result: providerResult, mode: 'existing' };
    }

    let chorusRanges = providerResult.chorusRanges ?? [];
    if (chorusRanges.length === 0 && options.fetchChorusRanges) {
        try {
            chorusRanges = await options.fetchChorusRanges();
        } catch (error) {
            console.warn(`[ChorusResolver] provider=${options.providerId} song=${options.songId} native chorus request failed; falling back to text detection`, error);
        }
    }

    if (chorusRanges.length > 0) {
        console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} applied ${chorusRanges.length} native chorus range(s)`);
        return {
            result: {
                ...providerResult,
                lyrics: applyNeteaseChorusByTime(lyrics, chorusRanges),
                chorusRanges,
            },
            mode: 'native',
        };
    }

    const sourceText = providerResult.mainText?.trim()
        || providerResult.wordByWordText?.trim()
        || lyrics.lines.map(line => `[00:00.00]${line.fullText}`).join('\n');
    console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} native chorus unavailable or empty; applied text fallback`);
    return {
        result: {
            ...providerResult,
            lyrics: applyDetectedChorusEffects(lyrics, sourceText),
            chorusRanges: [],
        },
        mode: 'text',
    };
};
