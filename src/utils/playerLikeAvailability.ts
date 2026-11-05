import { getPlaybackSourceRef } from './appPlaybackGuards';
import { omni } from '../services/onlineMusic/omni';
import type { SongResult } from '../types';

// src/utils/playerLikeAvailability.ts
// 「喜爱」这个动作能不能用，只有这一份判断。
//
// 侧边面板的喜爱按钮和进度条胶囊上的喜爱槽位必须给出同一个答案，
// 否则会出现一边置灰、另一边能点出面板不允许的状态。
// 返回 i18n key 而不是文案，这样它不依赖任何组件的 t()。

export type LikeAvailability = {
    disabled: boolean;
    /** 置灰原因；可用时为 null。 */
    reason: { key: string; params?: Record<string, string>; } | null;
};

export const resolveLikeAvailability = (
    currentSong: SongResult | null,
    /** 播放控制整体不可用（混音过渡中、无音源等）。 */
    playbackControlsDisabled: boolean,
    /** 当前由外部 Stage 播放，喜爱状态不归本机管。 */
    isStage: boolean,
): LikeAvailability => {
    if (!currentSong) {
        return { disabled: true, reason: null };
    }

    if (playbackControlsDisabled || isStage) {
        return { disabled: true, reason: { key: 'status.stageLikeUnavailable' } };
    }

    const sourceRef = getPlaybackSourceRef(currentSong);
    if (sourceRef.kind === 'online' && !omni.canLikeSong(currentSong)) {
        return {
            disabled: true,
            reason: {
                key: 'status.providerLikeUnavailable',
                params: { provider: omni.getProviderLabel(sourceRef.providerId) },
            },
        };
    }

    return { disabled: false, reason: null };
};

/**
 * 私人 FM 的「不喜欢」能不能用：只有 provider 真有 dislikeSong 才行。没有时（波点）垃圾桶置灰，
 * 不再假装记下了「不喜欢」、实际只切到下一首。
 */
export const canDislikeCurrentSong = (currentSong: SongResult | null): boolean => (
    Boolean(currentSong)
    && getPlaybackSourceRef(currentSong as SongResult).kind === 'online'
    && omni.canDislikeSong(currentSong as SongResult)
);
