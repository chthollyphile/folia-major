import type { OnlineProviderId } from '../../../types/onlineMusic';
import type { OnlineFailure } from './onlineFailureCase';

// src/services/onlineMusic/failure/onlineRequestCooldown.ts
// 平台要求稍后再试之后，这个平台的播放地址先不再去要（只记在这一次运行里）。平台说了等多久时，到点之前
// 用的人点歌和预取都不要；没说多久时只让预取先停 30 秒，用的人自己点的歌照样去要一次。平台的服务出了错
// （连不上，带着 5xx）时也只让预取先停 30 秒。

export const MAX_ONLINE_COOLDOWN_MS = 600_000;
export const PREFETCH_BACKOFF_MS = 30_000;

type CooldownEntry = {
    playUntil: number;
    prefetchUntil: number;
};

const cooldowns = new Map<OnlineProviderId, CooldownEntry>();

/**
 * 记下一次要地址的失败：只有「要求稍后再试」和服务出错才记。`fromCooldown`：这次失败就是冷却期里没去要的那一次，
 * 不再延长冷却。
 */
export const noteOnlineRequestCooldown = (shown: OnlineFailure, fromCooldown = false, now: number = Date.now()): void => {
    const providerId = shown.providerId;
    const serviceFailed = shown.case === 'unreachable' && (shown.facts.httpStatus ?? 0) >= 500;
    if (fromCooldown || !providerId || (shown.case !== 'retry-later' && !serviceFailed)) return;

    const entry = cooldowns.get(providerId) ?? { playUntil: 0, prefetchUntil: 0 };
    const wait = shown.facts.retryAfterMs;
    if (shown.case === 'retry-later' && typeof wait === 'number' && Number.isFinite(wait) && wait > 0) {
        entry.playUntil = Math.max(entry.playUntil, now + Math.min(wait, MAX_ONLINE_COOLDOWN_MS));
    } else {
        entry.prefetchUntil = Math.max(entry.prefetchUntil, now + PREFETCH_BACKOFF_MS);
    }
    cooldowns.set(providerId, entry);
};

/** 这个平台还要等多久才能再要地址；点歌的冷却也挡住预取，预取的退让不挡点歌。不用等时回 null。 */
export const onlineRequestCooldown = (
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

/** 清掉全部冷却（测试用）。 */
export const resetOnlineRequestCooldowns = (): void => {
    cooldowns.clear();
};
