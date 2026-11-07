import type { SongResult } from '../../../types';
import { getSongAlbumLabel, getSongArtistLabel, getSongCoverUrl, getSongDurationMs } from '../../../services/onlineMusic/songMetadata';
import { isSongUnavailable } from '../../../services/onlineMusic/songAvailability';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import type { TrackDescription } from './bravaisProjection';

// src/library/suites/bravais/describeBravaisTrack.ts
// 一首歌在磁贴上要的展示字段，取自与 Lattice（latticeModel）相同的元数据 helper。歌手名按 track.artists 的顺序给出：
// 聚焦卡上的第 i 个歌手链接与 core 的 resolveTrackArtistLinks(track)[i] 对得上；曲目没有 artists 时退回元数据的歌手名。

export const describeBravaisTrack = (track: SongResult): TrackDescription => {
    const names = (track.artists ?? []).map(artist => artist.name || '');
    const label = getSongArtistLabel(track);
    return {
        artists: names.some(Boolean) ? names : (label ? [label] : []),
        album: getSongAlbumLabel(track) || track.album?.name || '',
        coverUrl: getSongCoverUrl(track) || track.album?.coverUrl,
        durationMs: getSongDurationMs(track) || track.durationMs || 0,
        playbackKey: getPlaybackSongKey(track),
        unavailable: isSongUnavailable(track),
    };
};
