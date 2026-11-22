import type { FoliumSourceAudioQuality, FoliumSourceSong } from '@folia/folium';
import { LX_QUALITIES } from './scripts.ts';
import type { LxPlatform, LxQuality } from './scripts.ts';

// sources/lxmusic/main/musicInfo.ts
// 交给洛雪脚本的东西怎么从宿主的歌和音质档换算出来：音质档的对应、脚本没有那一档时落到哪一档、musicInfo 的字段。

// 宿主的音质档 → 洛雪的音质档。
export const QUALITY_TO_LX: Record<FoliumSourceAudioQuality, LxQuality> = {
    standard: '128k', high: '320k', ultra: '320k', lossless: 'flac', hires: 'flac24bit',
};
export const LX_TO_QUALITY: Record<LxQuality, FoliumSourceAudioQuality> = {
    '128k': 'standard', '320k': 'high', flac: 'lossless', flac24bit: 'hires',
};

/** 脚本支持的档里离要的那档最近的：先往低找，再往高找。 */
export const pickLxQuality = (wanted: LxQuality, supported: readonly LxQuality[]): LxQuality | null => {
    const at = LX_QUALITIES.indexOf(wanted);
    for (let index = at; index >= 0; index -= 1) if (supported.includes(LX_QUALITIES[index])) return LX_QUALITIES[index];
    for (let index = at + 1; index < LX_QUALITIES.length; index += 1) if (supported.includes(LX_QUALITIES[index])) return LX_QUALITIES[index];
    return null;
};

const interval = (durationMs: number): string => {
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * 交给脚本的 musicInfo：洛雪自己的字段（name、singer、source、songmid、interval、albumName、img、hash、
 * strMediaMid…），外加各家脚本常读的别名（PR #1177 实测真实脚本后补的那一串）。
 */
export const buildMusicInfo = (platform: LxPlatform, nativeId: string, song: FoliumSourceSong): Record<string, unknown> => {
    const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 512) : '');
    const singer = (Array.isArray(song.artists) ? song.artists : []).map(artist => text(artist?.name)).filter(Boolean).join('、');
    const durationMs = Number.isFinite(song.durationMs) ? Number(song.durationMs) : 0;
    const data = song.data && typeof song.data === 'object' ? song.data : {};
    const albumName = text(song.album?.name);
    return {
        name: text(song.title),
        title: text(song.title),
        singer,
        artist: singer,
        source: platform,
        platform,
        songmid: nativeId,
        songId: platform === 'tx' && text(data.songId) ? text(data.songId) : nativeId,
        songid: nativeId,
        musicId: nativeId,
        musicid: nativeId,
        id: nativeId,
        mid: nativeId,
        rid: nativeId,
        copyrightId: nativeId,
        interval: interval(durationMs),
        duration: Math.round(durationMs / 1000),
        albumName,
        album: albumName,
        albumId: text(data.albumId),
        img: text(song.coverUrl ?? song.album?.coverUrl),
        ...(platform === 'kg' ? { hash: nativeId, ...(text(data.audioId) ? { audioId: text(data.audioId) } : {}) } : {}),
        ...(platform === 'tx' ? { strMediaMid: text(data.mediaMid), albumMid: text(data.albumMid) } : {}),
    };
};
