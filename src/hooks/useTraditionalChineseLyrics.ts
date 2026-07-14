import { useEffect, useState } from 'react';
import type { LyricData } from '../types';
import { convertLyricDataToTraditional } from '../utils/lyrics/traditionalChinese';

// src/hooks/useTraditionalChineseLyrics.ts
// Keeps the original lyric data available while the optional OpenCC conversion loads asynchronously.

type ConvertedLyrics = {
    source: LyricData;
    value: LyricData;
};

export const useTraditionalChineseLyrics = (
    sourceLyrics: LyricData | null,
    enabled: boolean,
): LyricData | null => {
    const [convertedLyrics, setConvertedLyrics] = useState<ConvertedLyrics | null>(null);

    useEffect(() => {
        let active = true;

        if (!enabled || !sourceLyrics) {
            setConvertedLyrics(null);
            return () => {
                active = false;
            };
        }

        void convertLyricDataToTraditional(sourceLyrics)
            .then(value => {
                if (active && value) {
                    setConvertedLyrics({ source: sourceLyrics, value });
                }
            })
            .catch(error => {
                console.error('[useTraditionalChineseLyrics] Failed to convert lyrics:', error);
            });

        return () => {
            active = false;
        };
    }, [enabled, sourceLyrics]);

    if (!enabled || convertedLyrics?.source !== sourceLyrics) {
        return sourceLyrics;
    }

    return convertedLyrics.value;
};
