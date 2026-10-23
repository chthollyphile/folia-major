import type { Dispatch, SetStateAction, MutableRefObject } from 'react';
import type { LyricData, SongResult } from '../../../types';
import { applyLyricDisplayFilter } from '../../../utils/lyrics/filtering';
import { isPureMusicLyricLines } from '../../../utils/lyrics/pureMusic';
import { applyLyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import type { LyricStaffPolicyOptions } from '../../../utils/lyrics/staffCreditsPolicy';
import { ensureLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { applyLyricWordSegmentation } from '../../../utils/lyrics/lyricSegmentationRecord';
import { applyAutoWordSegmentation } from '../../../utils/lyrics/icuFolia';
import { getLyricSegmentationRecord } from '../../../stores/useLyricSegmentationStore';
import { applyDetectedChorusEffects, applyChorusRangesByTime } from '../../../utils/lyrics/chorusEffects';
import type { ChorusRange } from '../../../utils/lyrics/chorusEffects';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { applyLyricsTransform, lyricsForNoLyrics, untransformedLyrics } from '../../../services/hostExtensionHooks';
import { setLyricsState as setPlaybackLyrics, usePlaybackStore } from '../../../stores/usePlaybackStore';

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
    let cachedNeteaseChorusRanges: ChorusRange[] | null = null;

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

        // 通用过滤是用户的显式指令，先跑；staff 策略只处理它没删掉的署名块。
        // 歌词行整体就是“纯音乐，请欣赏”这类提示语时按无歌词处理（与 provider 判为纯音乐时一致），
        // 让 visualizer 走纯音乐路径，而不是把提示语当歌词渲染。provider 没覆盖到的来源（本地、QQ 等）靠这里兜底。
        let processed = nextLyrics && isPureMusicLyricLines(nextLyrics.lines)
            ? null
            : applyLyricStaffPolicy(applyLyricDisplayFilter(nextLyrics, lyricFilterPattern), staffOptions);
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
                    processed = applyChorusRangesByTime(processed, cachedNeteaseChorusRanges);
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
            // icu-folia's default split, for every line the saved one does not cover. A no-op until
            // its engines have loaded; useIcuFoliaSegmentation bakes it on afterwards in that case.
            processed = applyAutoWordSegmentation(processed);
            // Extension layers (Folium `lyrics.transform`) see the finished lyrics once per load.
            setLyricsState(applyLyricsTransform(ensureLyricDataRenderHints(processed)));
        } else {
            setLyricsState(null);
        }
    };
};

/**
 * Called where a lyric load ends, after its check that the song is still the one asked for: when the
 * load left the song without lyrics (none found, an instrumental, a failed fetch), an extension
 * transform may supply some (lyricsForNoLyrics). Not in the setter above: setting null is also how
 * the app clears lyrics (song start, platform switch, stage reset), and a clear must stay a clear.
 */
export const supplyLyricsAfterEmptyLoad = () => {
    if (usePlaybackStore.getState().lyrics !== null) return;
    const supplied = lyricsForNoLyrics();
    if (supplied) setPlaybackLyrics(supplied);
};
