import i18n from '../../i18n/config';
import type { AmllDbPlatform, LyricProviderSource, SongResult } from '../../types';
import { getLyricSource, getPlatformLyricSource, isLyricProviderSource } from './lyricSources';

// src/utils/lyrics/lyricSourceLabels.ts

// A lyric choice stored before sources had names is NetEase's. A stored name that no source has
// is shown the same way.
const UNNAMED_CHOICE_SOURCE: LyricProviderSource = 'netease';

const getSourceName = (source: LyricProviderSource | undefined): string => (
    i18n.t(getLyricSource(isLyricProviderSource(source) ? source : UNNAMED_CHOICE_SOURCE).labelKey)
);

export const getAmllDbPlatformLabel = (platform?: AmllDbPlatform | null): string => (
    getSourceName(platform === 'qq' ? 'qq' : 'netease')
);

export const getLyricProviderLabel = (
    source: LyricProviderSource | undefined,
    platform?: AmllDbPlatform | null,
): string => {
    if (source === 'amll' && platform) {
        return `${getSourceName(source)} · ${getAmllDbPlatformLabel(platform)}`;
    }
    return getSourceName(source);
};

export const getLyricProviderPreferenceLabel = (source: LyricProviderSource): string => getSourceName(source);

export const getSongNativeLyricProviderSource = (
    song?: Pick<SongResult, 'sourceRef'> | null,
): LyricProviderSource | undefined => (
    getPlatformLyricSource(song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined)?.id
);

// 在线歌曲「在线」歌词的来源名：存了匹配就是匹配到的来源；没有匹配时就是歌曲所在平台自己的歌词，
// 平台不在歌词来源列表里（波点、YouTube Music）则用调用方给的平台名。
export const getOnlineLyricSourceLabel = (
    song: Pick<SongResult, 'sourceRef'> | null | undefined,
    matched: { matchedLyricsSource?: LyricProviderSource; matchedLyricsProviderPlatform?: AmllDbPlatform | null } | null | undefined,
    providerLabel: string,
): string => {
    const source = matched?.matchedLyricsSource ?? getSongNativeLyricProviderSource(song);
    return source ? getLyricProviderLabel(source, matched?.matchedLyricsProviderPlatform) : providerLabel;
};
