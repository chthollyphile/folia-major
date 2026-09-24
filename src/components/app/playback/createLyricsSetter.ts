import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { LyricData, SongResult } from '../../../types';
import { applyLyricDisplayFilter } from '../../../utils/lyrics/filtering';
import { applyLyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { LyricStaffPolicyOptions } from '../../../utils/lyrics/staffCreditsPolicy';
import { ensureLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { applyLyricWordSegmentation } from '../../../utils/lyrics/lyricSegmentationRecord';
import { getLyricSegmentationRecord } from '../../../stores/useLyricSegmentationStore';
import { applyDetectedChorusEffects, applyNeteaseChorusByTime } from '../../../utils/lyrics/chorusEffects';
import type { NeteaseChorusRange } from '../../../utils/lyrics/chorusEffects';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { applyLyricsTransform, untransformedLyrics } from '../../../services/hostExtensionHooks';

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
// The staff-credit policy stays here rather than in the parser: it is a display decision that
// depends on the finished timeline, and the parse/cache layer must not bake it in.
export const createLyricsSetter = (
    setLyricsState: Dispatch<SetStateAction<LyricData | null>>,
    lyricFilterPattern: string,
    currentSongFullRef?: MutableRefObject<SongResult | null>,
    staffOptions?: LyricStaffPolicyOptions,
) => {
    let lastSongId: number | string | null = null;
    let cachedNeteaseChorusRanges: NeteaseChorusRange[] | null = null;

    return (incomingLyrics: LyricData | null) => {
        // Lyrics already on screen (e.g. re-applied after an automix cancel) re-enter from
        // their pre-transform source, so the extension transform below never stacks.
        const nextLyrics = untransformedLyrics(incomingLyrics);
        const currentSong = currentSongFullRef?.current ?? null;
        const currentSongId = currentSong ? getPlaybackSongKey(currentSong) : null;

        if (currentSongId !== lastSongId) {
            lastSongId = currentSongId;
            cachedNeteaseChorusRanges = null;
        }

        // 通用过滤是用户的显式指令，先跑；staff 策略只处理它没删掉的开头块。
        let processed = applyLyricStaffPolicy(applyLyricDisplayFilter(nextLyrics, lyricFilterPattern), staffOptions);
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
            // Word segmentation is baked onto the lines here because visualizers receive lines
            // with no song identity and so cannot look up a per-song override themselves. Last in
            // the chain, so it sees the lines that actually survived filtering.
            processed = applyLyricWordSegmentation(processed, getLyricSegmentationRecord());
            // Extension layers (Folium `lyrics.transform`) see the finished lyrics once per load.
            setLyricsState(applyLyricsTransform(ensureLyricDataRenderHints(processed)));
        } else {
            setLyricsState(null);
        }
    };
};
