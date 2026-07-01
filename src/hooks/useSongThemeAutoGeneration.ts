import { useEffect, useRef } from 'react';
import type { GenerateAIThemeOptions, GenerateAIThemeResult } from './useThemeController';
import type { LyricData, SongResult } from '../types';
import { getCachedThemeState } from '../services/themeCache';
import {
    getSongThemeAutoGenerationKey,
    isSongThemeGenerationStillCurrent,
    shouldRequestSongThemeAutoGeneration,
} from '../utils/songThemeAutoGeneration';

// src/hooks/useSongThemeAutoGeneration.ts
// Coordinates delayed AI theme generation for the real current playback song.

type GenerateAITheme = (
    lyrics: LyricData | null,
    currentSong: SongResult | null,
    options?: GenerateAIThemeOptions,
) => Promise<GenerateAIThemeResult>;

type UseSongThemeAutoGenerationParams = {
    enabled: boolean;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    isLyricsLoading: boolean;
    generateAITheme: GenerateAITheme;
};

const AUTO_GENERATE_DELAY_MS = 650;

export function useSongThemeAutoGeneration({
    enabled,
    currentSong,
    lyrics,
    isLyricsLoading,
    generateAITheme,
}: UseSongThemeAutoGenerationParams) {
    const latestSongKeyRef = useRef<string | null>(null);
    const latestEnabledRef = useRef(enabled);
    const attemptedSongKeysRef = useRef(new Set<string>());
    const generateAIThemeRef = useRef(generateAITheme);

    useEffect(() => {
        generateAIThemeRef.current = generateAITheme;
    }, [generateAITheme]);

    useEffect(() => {
        latestEnabledRef.current = enabled;
    }, [enabled]);

    useEffect(() => {
        latestSongKeyRef.current = getSongThemeAutoGenerationKey(currentSong);
    }, [currentSong?.id]);

    useEffect(() => {
        if (!shouldRequestSongThemeAutoGeneration({
            enabled,
            currentSong,
            lyrics,
            isLyricsLoading,
            hasAttempted: currentSong ? attemptedSongKeysRef.current.has(String(currentSong.id)) : false,
            hasCachedTheme: false,
        })) {
            return;
        }

        const songKey = String(currentSong.id);
        let cancelled = false;
        const timeoutId = window.setTimeout(() => {
            void (async () => {
                if (cancelled || !isSongThemeGenerationStillCurrent({
                    latestSongKey: latestSongKeyRef.current,
                    targetSongKey: songKey,
                    enabled: latestEnabledRef.current,
                })) {
                    return;
                }

                const cachedTheme = await getCachedThemeState(currentSong.id);
                if (cancelled || !isSongThemeGenerationStillCurrent({
                    latestSongKey: latestSongKeyRef.current,
                    targetSongKey: songKey,
                    enabled: latestEnabledRef.current,
                })) {
                    return;
                }
                if (!shouldRequestSongThemeAutoGeneration({
                    enabled: latestEnabledRef.current,
                    currentSong,
                    lyrics,
                    isLyricsLoading: false,
                    hasAttempted: attemptedSongKeysRef.current.has(songKey),
                    hasCachedTheme: cachedTheme.kind !== 'none',
                })) {
                    attemptedSongKeysRef.current.add(songKey);
                    return;
                }

                attemptedSongKeysRef.current.add(songKey);
                await generateAIThemeRef.current(lyrics, currentSong, {
                    source: 'auto',
                    shouldApply: () => isSongThemeGenerationStillCurrent({
                        latestSongKey: latestSongKeyRef.current,
                        targetSongKey: songKey,
                        enabled: latestEnabledRef.current,
                    }),
                });
            })();
        }, AUTO_GENERATE_DELAY_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [currentSong, enabled, isLyricsLoading, lyrics]);
}
