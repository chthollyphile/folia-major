import { beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_PROVIDER_COOLDOWN_MS,
    PREFETCH_BACKOFF_MS,
    getProviderPlaybackCooldown,
    noteProviderFailure,
    resetProviderPlaybackCooldowns,
} from '@/services/playbackRecovery/providerPlaybackCooldown';
import type { PlaybackFailure } from '@/types/playbackFailure';

// test/unit/playback/providerPlaybackCooldown.test.ts
// 限流冷却：明确的 Retry-After 同时挡住点播和预取；没有时长只让预取退避。

const NOW = 1_000_000;

const failure = (extra: Partial<PlaybackFailure>): PlaybackFailure => ({
    reason: 'rate-limited',
    stage: 'resolve-url',
    providerId: 'qq',
    ...extra,
});

describe('provider playback cooldown', () => {
    beforeEach(() => {
        resetProviderPlaybackCooldowns();
    });

    it('blocks play and prefetch until a stated Retry-After has passed', () => {
        noteProviderFailure(failure({ retryAfterMs: 25_000 }), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toEqual({ remainingMs: 25_000 });
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW + 5_000)).toEqual({ remainingMs: 20_000 });
        expect(getProviderPlaybackCooldown('qq', 'play', NOW + 25_000)).toBeNull();
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW + 25_000)).toBeNull();
    });

    it('caps the cooldown at ten minutes', () => {
        noteProviderFailure(failure({ retryAfterMs: 3_600_000 }), NOW);

        expect(MAX_PROVIDER_COOLDOWN_MS).toBe(600_000);
        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toEqual({ remainingMs: MAX_PROVIDER_COOLDOWN_MS });
        expect(getProviderPlaybackCooldown('qq', 'play', NOW + MAX_PROVIDER_COOLDOWN_MS)).toBeNull();
    });

    it('only backs prefetch off for 30 seconds when no wait was stated', () => {
        noteProviderFailure(failure({}), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW)).toEqual({ remainingMs: PREFETCH_BACKOFF_MS });
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW + PREFETCH_BACKOFF_MS)).toBeNull();
    });

    it('backs prefetch off after a service failure too', () => {
        noteProviderFailure(failure({ reason: 'service-unavailable', httpStatus: 503 }), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW)).toEqual({ remainingMs: PREFETCH_BACKOFF_MS });
    });

    it.each(['network', 'unknown', 'timeout', 'session-expired', 'taken-down'] as const)('does not record %s', reason => {
        noteProviderFailure(failure({ reason, retryAfterMs: 25_000 }), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
        expect(getProviderPlaybackCooldown('qq', 'prefetch', NOW)).toBeNull();
    });

    it('does not extend a cooldown from the failure the cooldown itself returned', () => {
        noteProviderFailure(failure({ stage: 'cooldown', retryAfterMs: 25_000 }), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
    });

    it('ignores a failure without a provider', () => {
        noteProviderFailure(failure({ providerId: undefined, retryAfterMs: 25_000 }), NOW);

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
    });

    it('keeps providers apart', () => {
        noteProviderFailure(failure({ retryAfterMs: 25_000 }), NOW);

        expect(getProviderPlaybackCooldown('kugou', 'play', NOW)).toBeNull();
    });

    it('resets everything', () => {
        noteProviderFailure(failure({ retryAfterMs: 25_000 }), NOW);
        noteProviderFailure(failure({ providerId: 'kugou' }), NOW);

        resetProviderPlaybackCooldowns();

        expect(getProviderPlaybackCooldown('qq', 'play', NOW)).toBeNull();
        expect(getProviderPlaybackCooldown('kugou', 'prefetch', NOW)).toBeNull();
    });
});
