import type { LyricData } from '../../types';
import type { ChorusRange, OnlineProviderId, ProviderLyricsResult } from '../../types/onlineMusic';
import { applyDetectedChorusEffects, applyChorusRangesByTime } from './chorusEffects';

// src/utils/lyrics/chorusResolver.ts

/**
 * The host's last chorus rule: repeated lines of the parsed lyrics, read as text one line each. The resolver below
 * falls back to it where the provider hands no raw text; a Folium 2.0 source's lyrics go through it where their
 * raw text is not one the detector reads (src/mods/folium/lyricsSource.ts).
 */
export const applyLineTextChorus = (lyrics: LyricData): LyricData => (
    applyDetectedChorusEffects(lyrics, lyrics.lines.map(line => `[00:00.00]${line.fullText}`).join('\n'))
);

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

    const hasMarks = lyrics.lines.some(line => line.isChorus);
    // The lyrics' own marks, kept as they came. Marks that came without an origin (a Folia document, which may be
    // one exported from guessed marks) are not vouched for: they count as guessed, as in the lyric setter. Every
    // chorus line leaves here with an origin, so cached lyrics without one can only be ones saved before origins
    // were kept (cachedLyrics.ts).
    const keepExisting = (): ResolvedProviderLyricsChorus => {
        console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} using existing chorus markers`);
        const unrecorded = lyrics.lines.some(line => line.isChorus && line.chorusOrigin === undefined);
        return {
            result: unrecorded
                ? {
                    ...providerResult,
                    lyrics: {
                        ...lyrics,
                        lines: lyrics.lines.map(line => (
                            line.isChorus && line.chorusOrigin === undefined ? { ...line, chorusOrigin: 'text' as const } : line
                        )),
                    },
                }
                : providerResult,
            mode: 'existing',
        };
    };

    // A chorus the lyric data itself marks (a TTML songPart) stands. One guessed from repeated lines (a lyric the
    // line rule marked on its way in, say) gives way to ranges a source gives: an automatic match lends the
    // playing song's ranges to the lyric it picked, and the guess would otherwise keep the source's chorus off it.
    const vouched = lyrics.lines.some(line => line.isChorus && line.chorusOrigin === 'source');
    const nativeAvailable = (providerResult.chorusRanges?.length ?? 0) > 0 || Boolean(options.fetchChorusRanges);
    if (hasMarks && (vouched || !nativeAvailable)) return keepExisting();

    let chorusRanges = providerResult.chorusRanges ?? [];
    if (chorusRanges.length === 0 && options.fetchChorusRanges) {
        try {
            chorusRanges = await options.fetchChorusRanges();
        } catch (error) {
            console.warn(`[ChorusResolver] provider=${options.providerId} song=${options.songId} native chorus request failed; falling back to text detection`, error);
        }
    }

    if (chorusRanges.length > 0) {
        // Guessed marks go first, so a line the source's ranges do not reach is not left marked; so do ranges the
        // lyrics kept from before, which would read as these ones having marked something.
        const unmarked = hasMarks
            ? (() => {
                const { sourceChorusRanges: _kept, ...rest } = lyrics;
                return {
                    ...rest,
                    lines: lyrics.lines.map(line => {
                        if (!line.isChorus) return line;
                        const { isChorus: _isChorus, chorusEffect: _chorusEffect, chorusOrigin: _chorusOrigin, ...lineRest } = line;
                        return lineRest;
                    }),
                };
            })()
            : lyrics;
        const applied = applyChorusRangesByTime(unmarked, chorusRanges);
        // Ranges that reach none of these lines (another timing) leave the guess where it was.
        if (hasMarks && !applied.sourceChorusRanges) {
            console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} ${chorusRanges.length} native chorus range(s) reach no line; keeping the guessed markers`);
            return keepExisting();
        }
        console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} applied ${chorusRanges.length} native chorus range(s)${hasMarks ? ' over guessed markers' : ''}`);
        return {
            result: {
                ...providerResult,
                lyrics: applied,
                chorusRanges,
            },
            mode: 'native',
        };
    }

    if (hasMarks) return keepExisting();

    const sourceText = providerResult.mainText?.trim() || providerResult.wordByWordText?.trim();
    console.log(`[ChorusResolver] provider=${options.providerId} song=${options.songId} native chorus unavailable or empty; applied text fallback`);
    return {
        result: {
            ...providerResult,
            lyrics: sourceText ? applyDetectedChorusEffects(lyrics, sourceText) : applyLineTextChorus(lyrics),
            chorusRanges: [],
        },
        mode: 'text',
    };
};
