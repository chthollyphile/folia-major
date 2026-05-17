import type { Dispatch, SetStateAction } from 'react';
import type { LyricData } from '../../../types';
import { applyLyricDisplayFilter } from '../../../utils/lyrics/filtering';
import { ensureLyricDataRenderHints } from '../../../utils/lyrics/renderHints';

// src/components/app/playback/createLyricsSetter.ts

// Creates the App-level lyric setter that applies filtering and render-hint normalization.
export const createLyricsSetter = (
    setLyricsState: Dispatch<SetStateAction<LyricData | null>>,
    lyricFilterPattern: string,
) => {
    return (nextLyrics: LyricData | null) => {
        setLyricsState(ensureLyricDataRenderHints(applyLyricDisplayFilter(nextLyrics, lyricFilterPattern)));
    };
};
