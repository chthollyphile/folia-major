// src/utils/mpris.ts
// MPRIS 快照的纯换算。

import type { MprisPlayerSnapshot, MprisTrack } from '../types/mpris';

const LRC_TIMESTAMP = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;

/** 总线名 + trackid；没有 trackid 用标题/歌手/专辑。 */
export const mprisTrackKey = (player: MprisPlayerSnapshot): string => (
    `${player.busName}|${player.trackId ?? `${player.title}|${player.artists.join(',')}|${player.album}`}`
);

/** 从采样时刻往后外推，不超过时长。 */
export const mprisPositionSec = (player: MprisPlayerSnapshot, nowMs: number): number => {
    const elapsed = player.status === 'playing' ? Math.max(0, nowMs - player.sampledAtMs) / 1000 * player.rate : 0;
    const position = player.positionSec + elapsed;
    return player.durationSec > 0 ? Math.min(player.durationSec, Math.max(0, position)) : Math.max(0, position);
};

/** xesam:asText 有没有时间轴。 */
export const hasTimedLyricText = (text: string): boolean => LRC_TIMESTAMP.test(text);

/**
 * 找歌词用的输入指纹。歌手、时长、自带歌词要算进去：播放器常常分两步报元数据，
 * 只按曲目标识缓存会把先到的空歌手钉死。
 */
export const mprisLyricSignature = (player: MprisPlayerSnapshot): string => {
    const embedded = player.lyricText.trim();
    const embeddedKind = embedded === '' ? 'none' : hasTimedLyricText(embedded) ? 'timed' : 'plain';
    return [
        mprisTrackKey(player),
        player.title,
        player.artists.join(','),
        player.album,
        Math.round(player.durationSec),
        embeddedKind,
    ].join('|');
};

export const mprisTrackFromPlayer = (player: MprisPlayerSnapshot, key = mprisTrackKey(player)): MprisTrack => ({
    key,
    busName: player.busName,
    identity: player.identity,
    title: player.title || player.identity,
    artists: player.artists,
    artist: player.artists.join(', '),
    album: player.album,
    artUrl: player.artUrl,
    durationSec: player.durationSec,
});
