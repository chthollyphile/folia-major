import { beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_ONLINE_COOLDOWN_MS,
    PREFETCH_BACKOFF_MS,
    noteOnlineRequestCooldown,
    onlineRequestCooldown,
    resetOnlineRequestCooldowns,
} from '@/services/onlineMusic/failure/onlineRequestCooldown';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import type { OnlineFailureDetail, OnlineProviderId } from '@/types/onlineMusic';

// test/unit/onlineMusic/onlineRequestCooldown.test.ts
// 要求稍后再试之后的冷却：说了等多久时点歌和预取都挡住；没说多久、或平台的服务出了错时只让预取退让。

const NOW = 1_000_000;

// `null`: a failure that names no platform.
const failure = (detail: OnlineFailureDetail = {}, providerId: OnlineProviderId | null = 'qq') => (
    onlineFailureOf({ operation: 'audio', providerId: providerId ?? undefined }, { detail: { case: 'retry-later', ...detail } })
);

describe('the cooldown after a platform asks to wait', () => {
    beforeEach(() => {
        resetOnlineRequestCooldowns();
    });

    it('blocks play and prefetch until a stated wait has passed', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 25_000 }), false, NOW);

        expect(onlineRequestCooldown('qq', 'play', NOW)).toEqual({ remainingMs: 25_000 });
        expect(onlineRequestCooldown('qq', 'prefetch', NOW + 5_000)).toEqual({ remainingMs: 20_000 });
        expect(onlineRequestCooldown('qq', 'play', NOW + 25_000)).toBeNull();
        expect(onlineRequestCooldown('qq', 'prefetch', NOW + 25_000)).toBeNull();
    });

    it('caps the cooldown at ten minutes', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 3_600_000 }), false, NOW);

        expect(MAX_ONLINE_COOLDOWN_MS).toBe(600_000);
        expect(onlineRequestCooldown('qq', 'play', NOW)).toEqual({ remainingMs: MAX_ONLINE_COOLDOWN_MS });
        expect(onlineRequestCooldown('qq', 'play', NOW + MAX_ONLINE_COOLDOWN_MS)).toBeNull();
    });

    it('only backs prefetch off for 30 seconds when no wait was stated', () => {
        noteOnlineRequestCooldown(failure(), false, NOW);

        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
        expect(onlineRequestCooldown('qq', 'prefetch', NOW)).toEqual({ remainingMs: PREFETCH_BACKOFF_MS });
        expect(onlineRequestCooldown('qq', 'prefetch', NOW + PREFETCH_BACKOFF_MS)).toBeNull();
    });

    it('backs prefetch off after the platform\'s service failed too, and not after the network did', () => {
        noteOnlineRequestCooldown(failure({ case: 'unreachable', httpStatus: 503 }), false, NOW);
        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
        expect(onlineRequestCooldown('qq', 'prefetch', NOW)).toEqual({ remainingMs: PREFETCH_BACKOFF_MS });

        noteOnlineRequestCooldown(failure({ case: 'unreachable' }, 'kugou'), false, NOW);
        expect(onlineRequestCooldown('kugou', 'prefetch', NOW)).toBeNull();
    });

    it.each(['unreachable', 'unknown', 'sign-in-needed', 'taken-down', 'no-audio'] as const)('does not record %s, even with a wait', caseId => {
        noteOnlineRequestCooldown(failure({ case: caseId, retryAfterMs: 25_000 }), false, NOW);

        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
        expect(onlineRequestCooldown('qq', 'prefetch', NOW)).toBeNull();
    });

    it('does not extend a cooldown from the failure the cooldown itself gave', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 25_000 }), true, NOW);

        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
    });

    it('ignores a failure without a platform', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 25_000 }, null), false, NOW);

        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
    });

    it('keeps platforms apart', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 25_000 }), false, NOW);

        expect(onlineRequestCooldown('kugou', 'play', NOW)).toBeNull();
    });

    it('resets everything', () => {
        noteOnlineRequestCooldown(failure({ retryAfterMs: 25_000 }), false, NOW);
        noteOnlineRequestCooldown(failure({}, 'kugou'), false, NOW);

        resetOnlineRequestCooldowns();

        expect(onlineRequestCooldown('qq', 'play', NOW)).toBeNull();
        expect(onlineRequestCooldown('kugou', 'prefetch', NOW)).toBeNull();
    });
});
