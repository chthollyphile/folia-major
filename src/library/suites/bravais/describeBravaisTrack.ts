import type { TFunction } from 'i18next';
import type { SongResult } from '../../../types';
import { getSongAlbumLabel, getSongArtistLabel, getSongCoverUrl, getSongDurationMs } from '../../../services/onlineMusic/songMetadata';
import { getTrackSourceLabel, getTrackSwappedFromLabel, getTrackUnplayableLabel, isTrackShownUnplayable, isTrackSourceUnavailable, TRACK_SWAPPED_MARK } from '../../../services/foliaPlaylist/trackSourceState';
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
        // 平台说下架的，或者来源此刻不在的（音源停用、卸载，Navidrome 没配置）。
        unavailable: isTrackShownUnplayable(track),
    };
};

/**
 * 混合来源的歌单（Folia 聚合歌单）里的一首：副标题后面接上来源的名字；来源不在时接的是原因（音源已停用之类）。
 */
export const describeBravaisSourcedTrack = (track: SongResult, t: TFunction): TrackDescription => {
    // 换过来源的行（转存时改由别的音源播放）：来源名后面一个小记号，悬停说明原来是哪个来源的歌。
    const swappedFrom = getTrackSwappedFromLabel(track, t);
    const source = swappedFrom ? `${getTrackSourceLabel(track, t)} ${TRACK_SWAPPED_MARK}` : getTrackSourceLabel(track, t);
    return {
        ...describeBravaisTrack(track),
        note: isTrackSourceUnavailable(track) ? `${source} · ${getTrackUnplayableLabel(track, t, '')}` : source,
        ...(swappedFrom ? { hint: swappedFrom } : {}),
    };
};
