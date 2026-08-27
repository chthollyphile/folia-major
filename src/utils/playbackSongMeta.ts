import type { SongResult } from '../types';
import { resolveNavidromePlaybackCarrier } from './appPlaybackGuards';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';

// src/utils/playbackSongMeta.ts
// 播放发布侧共用的曲目展示字段，供当前曲目与队列邻居走同一套取值规则。

/** 艺术家：优先 provider 元数据，Navidrome 曲目回落到载体自身的 artists */
export const resolvePlaybackSongArtist = (song: SongResult | null | undefined): string | null => {
    if (!song) {
        return null;
    }

    const primaryArtists = getProviderSongMetadata(song).artists.map(artist => artist.name).filter(Boolean);
    if (primaryArtists.length > 0) {
        return primaryArtists.join(', ');
    }

    const navidromeSong = resolveNavidromePlaybackCarrier(song);
    return navidromeSong?.artists?.map(artist => artist.name).filter(Boolean).join(', ') || null;
};

/** 封面：只取曲目自身元数据，不含播放器当前的实时/缓存封面，邻居曲目同样适用 */
export const resolvePlaybackSongCoverUrl = (song: SongResult | null | undefined): string | null => (
    getProviderSongMetadata(song).coverUrl || null
);
