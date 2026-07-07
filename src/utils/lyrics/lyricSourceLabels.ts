import i18n from '../../i18n/config';
import type { AmllDbPlatform, LyricProviderSource } from '../../types';

// src/utils/lyrics/lyricSourceLabels.ts

export const getBaseLyricProviderLabel = (source: Exclude<LyricProviderSource, 'amll'>): string => {
    if (source === 'qq') return i18n.t('lyricProvider.qq');
    if (source === 'kugou') return i18n.t('lyricProvider.kugou');
    return i18n.t('lyricProvider.netease');
};

export const getAmllDbPlatformLabel = (platform?: AmllDbPlatform | null): string => {
    if (platform === 'qq') return i18n.t('lyricProvider.qq');
    return i18n.t('lyricProvider.netease');
};

export const getLyricProviderLabel = (
    source: LyricProviderSource | undefined,
    platform?: AmllDbPlatform | null,
): string => {
    if (source === 'amll') {
        return platform ? `${i18n.t('lyricProvider.amll')} · ${getAmllDbPlatformLabel(platform)}` : i18n.t('lyricProvider.amll');
    }
    return getBaseLyricProviderLabel(source ?? 'netease');
};

export const getLyricProviderPreferenceLabel = (source: LyricProviderSource): string => (
    source === 'amll' ? i18n.t('lyricProvider.amll') : getBaseLyricProviderLabel(source)
);
