import type { OnlineProviderId } from '../../types/onlineMusic';
import type { PlaybackFailure } from '../../types/playbackFailure';
import { PLAYBACK_FAILURE_POLICY } from './playbackFailurePolicy';

// src/services/playbackRecovery/providerPlaybackCooldown.ts
// 按 provider 记录的音源请求冷却（模块级状态，只活在本会话）。
// 上游明确给了 Retry-After 时，冷却期内用户点播和预取都不再请求；没给时长时只让预取退避，用户主动点播仍会真正请求一次。

export const MAX_PROVIDER_COOLDOWN_MS = 600_000;
export const PREFETCH_BACKOFF_MS = 30_000;

type ProviderCooldownEntry = {
    playUntil: number;
    prefetchUntil: number;
};

const cooldowns = new Map<OnlineProviderId, ProviderCooldownEntry>();

/** 记下一次失败：只有策略表标了 cooldown 'retry-after' 的原因（限流、服务异常）才登记；冷却期内直接返回的那条不再续期。 */
export const noteProviderFailure = (failure: PlaybackFailure, now: number = Date.now()): void => {
    const providerId = failure.providerId;
    if (failure.stage === 'cooldown' || !providerId) return;
    if (PLAYBACK_FAILURE_POLICY[failure.reason].cooldown !== 'retry-after') return;

    const entry = cooldowns.get(providerId) ?? { playUntil: 0, prefetchUntil: 0 };
    const retryAfterMs = failure.retryAfterMs;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        entry.playUntil = Math.max(entry.playUntil, now + Math.min(retryAfterMs, MAX_PROVIDER_COOLDOWN_MS));
    } else {
        entry.prefetchUntil = Math.max(entry.prefetchUntil, now + PREFETCH_BACKOFF_MS);
    }
    cooldowns.set(providerId, entry);
};

/** 查询 provider 还要冷却多久；play 级冷却同时阻断预取，预取退避不阻断用户点播。没有冷却时返回 null。 */
export const getProviderPlaybackCooldown = (
    providerId: OnlineProviderId,
    scope: 'play' | 'prefetch',
    now: number = Date.now(),
): { remainingMs: number } | null => {
    const entry = cooldowns.get(providerId);
    if (!entry) return null;
    if (entry.playUntil <= now && entry.prefetchUntil <= now) {
        cooldowns.delete(providerId);
        return null;
    }
    const until = scope === 'play' ? entry.playUntil : Math.max(entry.playUntil, entry.prefetchUntil);
    return until > now ? { remainingMs: until - now } : null;
};

/** 清空全部冷却（测试用）。 */
export const resetProviderPlaybackCooldowns = (): void => {
    cooldowns.clear();
};
