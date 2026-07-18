import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { LyricData, SongResult } from '../../../types';
import { applyLyricDisplayFilter } from '../../../utils/lyrics/filtering';
import { ensureLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from '../../../utils/lyrics/chorusEffects';
import type { NeteaseChorusRange } from '../../../utils/lyrics/chorusEffects';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/createLyricsSetter.ts

const getStoredNeteaseLyrics = (song: SongResult | null): LyricData | null => {
    if (!song) return null;
    
    // Navidrome song
    if ((song as any).isNavidrome) {
        if ((song as any).matchedLyricsSource === 'netease' && (song as any).matchedLyrics) {
            return (song as any).matchedLyrics;
        }
        return null;
    }

    // Online song
    if (song.onlineLyricsState) {
        if (song.onlineLyricsState.matchedLyricsSource === 'netease' && song.onlineLyricsState.onlineOverrideLyrics) {
            return song.onlineLyricsState.onlineOverrideLyrics;
        }
    }

    return null;
};

// Creates the App-level lyric setter that applies filtering and render-hint normalization.
export const createLyricsSetter = (
    setLyricsState: Dispatch<SetStateAction<LyricData | null>>,
    lyricFilterPattern: string,
    currentSongFullRef?: MutableRefObject<SongResult | null>,
) => {
    let lastSongId: number | string | null = null;
    let cachedNeteaseChorusRanges: NeteaseChorusRange[] | null = null;

    return (nextLyrics: LyricData | null) => {
        const currentSong = currentSongFullRef?.current ?? null;
        const currentSongId = currentSong ? getPlaybackSongKey(currentSong) : null;

        if (currentSongId !== lastSongId) {
            lastSongId = currentSongId;
            cachedNeteaseChorusRanges = null;
        }

        let processed = applyLyricDisplayFilter(nextLyrics, lyricFilterPattern);
        if (processed) {
            const hasChorus = processed.lines.some(line => line.isChorus);
            if (hasChorus) {
                // Cache the chorus ranges from the incoming lyrics (e.g. NetEase lyrics)
                cachedNeteaseChorusRanges = processed.lines
                    .filter(line => line.isChorus)
                    .map(line => ({
                        startTime: line.startTime,
                        endTime: line.endTime
                    }));
            } else {
                // Try to load NetEase chorus ranges if they are not already cached
                if (!cachedNeteaseChorusRanges && currentSong) {
                    const storedLyrics = getStoredNeteaseLyrics(currentSong);
                    if (storedLyrics) {
                        cachedNeteaseChorusRanges = storedLyrics.lines
                            .filter(line => line.isChorus)
                            .map(line => ({
                                startTime: line.startTime,
                                endTime: line.endTime
                            }));
                    }
                }

                if (cachedNeteaseChorusRanges && cachedNeteaseChorusRanges.length > 0) {
                    processed = applyNeteaseChorusByTime(processed, cachedNeteaseChorusRanges);
                } else {
                    // Fall back to text-based frequency detection
                    const rebuildLrcText = processed.lines.map(line => `[00:00.00]${line.fullText}`).join('\n');
                    processed = applyDetectedChorusEffects(processed, rebuildLrcText);
                }
            }
            setLyricsState(ensureLyricDataRenderHints(processed));
        } else {
            setLyricsState(null);
        }
    };
};
