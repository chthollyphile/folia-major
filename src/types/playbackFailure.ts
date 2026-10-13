import type { ReplayGainInfo } from '../types';
import type { SkipPromptMessageKey } from './appPlayback';
import type { OnlineProviderId, ProviderErrorCode, ProviderPlaybackAttempt } from './onlineMusic';

// src/types/playbackFailure.ts
// 一次播放请求失败的跨层契约；与歌曲的静态可用性（ProviderSongAvailability）分开表达。

export type PlaybackFailureReason =
    | 'not-signed-in' | 'session-expired'
    | 'membership-required' | 'purchase-required' | 'entitlement-required'
    | 'preview-only' | 'region-restricted'
    | 'taken-down'
    | 'network' | 'timeout' | 'service-unavailable' | 'rate-limited'
    | 'invalid-response' | 'unknown';

export type PlaybackFailureStage =
    | 'static' | 'replacement' | 'cooldown' | 'resolve-url'
    | 'refresh' | 'restore' | 'media-element' | 'prefetch';

export interface PlaybackFailure {
    reason: PlaybackFailureReason;
    stage: PlaybackFailureStage;
    providerId?: OnlineProviderId;
    providerCode?: ProviderErrorCode;   // 诊断
    providerStage?: string;             // 诊断（details.stage）
    upstreamCode?: number | string;     // 诊断
    httpStatus?: number;
    retryAfterMs?: number;
    transient?: boolean;
    hint?: 'sign-in-may-help';
    mediaErrorCode?: number;
    attempts?: readonly ProviderPlaybackAttempt[];
    message?: string;
    cause?: unknown;
}

export type PlaybackFailureContext = 'play' | 'restore' | 'mid-playback';
export type PlaybackFailureAction = 'retry' | 'skip';

export type PlaybackFailureMessageKey =
    | 'status.songLoginRequired' | 'status.loginExpired'
    | 'status.songMembershipRequired' | 'status.songPurchaseRequired' | 'status.songEntitlementRequired'
    | 'status.songPreviewOnly' | 'status.songRegionRestricted' | 'status.songUnavailable'
    | 'status.songNetworkFailed' | 'status.songRequestTimedOut'
    | 'status.songServiceUnavailable' | 'status.songServiceNotConfigured'
    | 'status.songRateLimited' | 'status.songRateLimitedNoWait'
    | 'status.songTemporarilyUnavailable' | 'status.songTemporarilyUnavailableSignInHint';

export interface PlaybackFailurePolicy {
    messageKey: PlaybackFailureMessageKey;
    messageParams?: { seconds: number };
    countdownKey?: SkipPromptMessageKey;     // 仅 autoSkip==='countdown'
    stopPlayback: boolean;                   // 暂停旧音频、shouldAutoPlay=false；play 置 IDLE，mid-playback 置 PAUSED
    autoSkip: 'countdown' | 'none';
    actions: readonly PlaybackFailureAction[]; // 'skip' 只在有下一首可播歌曲时渲染
    autoRetryDelaysMs: readonly number[];    // [] = 不自动重试
    cooldown: 'retry-after' | null;
    offerReplacement: boolean;
}

export type OnlineAudioSourceResult =
    | { kind: 'ok'; audioSrc: string; blobUrl?: string; replayGain?: ReplayGainInfo }
    | { kind: 'failed'; failure: PlaybackFailure };   // 原来的 'unavailable' 改名，避免暗示“下架”

export interface OnlineRecoveryOptions {
    failedSrc?: string | null;
    resumeAt?: number;
    autoplay: boolean;
    shouldAutoplay?: () => boolean;
    force?: boolean;             // 跳过按媒体文件去重（手动重试）
    bypassMediaCache?: boolean;  // 跳过媒体缓存 blob（缓存 blob 解码失败）
}

export type OnlineRecoveryResult =
    | { status: 'recovered' }
    | { status: 'stale' }          // 歌曲已切换或 audio 元素已不在：调用方什么都不做
    | { status: 'not-attempted' }  // 不适用，或这个媒体文件已经刷新过
    | { status: 'failed'; failure: PlaybackFailure };

export interface PlaybackFailureSkipOptions {
    failedSongKey?: string;   // getPlaybackSongKey(失败歌曲)，在 await 之前捕获
    failedGeneration?: number; // 出错时的播放代次（playbackGenerationRef），在 await 之前捕获；同一首歌重新点播落地后旧失败不再算当前
    retry?: () => void;
}

export type RestorePlaybackSourceOutcome = 'restored' | 'failed' | 'stale';

export type OmniPlaybackFailure = PlaybackFailure;
export type OmniPlaybackFailureReason = PlaybackFailureReason;
