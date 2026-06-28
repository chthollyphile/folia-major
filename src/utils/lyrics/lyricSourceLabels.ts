import type { AmllDbPlatform, LyricProviderSource } from '../../types';

// src/utils/lyrics/lyricSourceLabels.ts

export const getBaseLyricProviderLabel = (source: Exclude<LyricProviderSource, 'amll'>): string => {
    if (source === 'qq') return 'QQ 音乐';
    if (source === 'kugou') return '酷狗音乐';
    return '网易云音乐';
};

export const getAmllDbPlatformLabel = (platform?: AmllDbPlatform | null): string => {
    if (platform === 'qq') return 'QQ 音乐';
    return '网易云音乐';
};

export const getLyricProviderLabel = (
    source: LyricProviderSource | undefined,
    platform?: AmllDbPlatform | null,
): string => {
    if (source === 'amll') {
        return platform ? `AMLLDB · ${getAmllDbPlatformLabel(platform)}` : 'AMLLDB';
    }
    return getBaseLyricProviderLabel(source ?? 'netease');
};

export const getLyricProviderPreferenceLabel = (source: LyricProviderSource): string => (
    source === 'amll' ? 'AMLLDB' : getBaseLyricProviderLabel(source)
);
