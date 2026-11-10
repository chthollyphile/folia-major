import type { SongResult } from '../../types';

// src/components/lxmusic/lxUi.ts
// 洛雪工作台用的小格式化工具：平台徽标、时长、播放量、日期。

export type LxPlatformBadge = { label: string; color: string };

const PLATFORM_META: Record<string, LxPlatformBadge> = {
    wy: { label: '网易云', color: '#dc2626' },
    kg: { label: '酷狗', color: '#2563eb' },
    kw: { label: '酷我', color: '#f59e0b' },
    tx: { label: 'QQ', color: '#16a34a' },
    mg: { label: '咪咕', color: '#7c3aed' },
    local: { label: '本地', color: '#64748b' },
};

export const platformBadge = (platform: string | undefined): LxPlatformBadge => (
    (platform && PLATFORM_META[platform]) || { label: platform ?? '未知', color: '#64748b' }
);

/** 从歌曲的 providerData（必要时从 id）里认出它属于哪个平台。 */
export const platformOfSong = (song: SongResult): string | undefined => {
    const ref = song.sourceRef;
    if (ref?.kind === 'online' && ref.providerData) {
        const platform = (ref.providerData as { platform?: string }).platform;
        if (platform) return platform;
    }
    const raw = String(song.id ?? '');
    const sep = raw.indexOf(':');
    return sep > 0 ? raw.slice(0, sep) : undefined;
};

export const formatDuration = (durationMs: number | undefined): string => {
    const total = Math.round((durationMs ?? 0) / 1000);
    if (!Number.isFinite(total) || total <= 0) return '--:--';
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const formatCount = (count: number | undefined): string => {
    const value = Number(count ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
    return String(Math.round(value));
};

/** 时间戳（毫秒或秒）→ YYYY-MM-DD；认不出来就给空串。 */
export const formatDate = (timestamp: number | undefined): string => {
    const value = Number(timestamp ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
};

export const errorText = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '未知错误';
};
