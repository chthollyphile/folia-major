// src/library/core/collection/albumDuration.ts
// 专辑总时长（集合描述的 albumDuration，单位秒）的写法：网格信息面板和 Bravais 专辑海报共用。
// 现在只有 Navidrome 写这个字段（Subsonic 的 album.duration 就是秒）；以前按「大于 10000 当毫秒」猜单位，
// 超过约 2 小时 47 分的专辑会显示成十几秒。

/** 专辑总时长：不足一小时写 m:ss，否则 h:mm:ss；没有或不是正数时为空串。 */
export const formatAlbumDuration = (durationSeconds?: number): string => {
    if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return '';
    const totalSeconds = Math.round(durationSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
