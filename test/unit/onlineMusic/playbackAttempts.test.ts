import { describe, expect, it } from 'vitest';
import {
    attemptChainDecision,
    attemptFromError,
    emptyAttempt,
    summarizePlaybackAttempts,
} from '@/services/onlineMusic/playbackAttempts';
import { classifyPlaybackError } from '@/services/playbackRecovery/onlinePlaybackFailure';
import { getPlaybackFailureMessage } from '@/services/playbackRecovery/playbackFailurePolicy';
import { OnlineProviderError, type ProviderErrorCode, type ProviderPlaybackAttempt } from '@/types/onlineMusic';

// test/unit/onlineMusic/playbackAttempts.test.ts
// 多次音源尝试的汇总：结论必须有证据，前面档位的会员拒绝不能盖过后面档位的断网。

const error = (
    code: ProviderErrorCode,
    extra: { httpStatus?: number; retryAfterMs?: number; details?: OnlineProviderError['details'] } = {},
) => new OnlineProviderError(code, `failed: ${code}`, 'kugou', undefined, extra.httpStatus, extra.retryAfterMs, extra.details);

const failed = (code: ProviderErrorCode, extra?: Parameters<typeof error>[1], quality?: ProviderPlaybackAttempt['quality']) => (
    attemptFromError('song_url', error(code, extra), quality ? { quality } : undefined)
);
const empty = (quality?: ProviderPlaybackAttempt['quality']) => emptyAttempt('song_url', quality ? { quality } : undefined);

const conclude = (attempts: ProviderPlaybackAttempt[], options?: Parameters<typeof summarizePlaybackAttempts>[2]) => (
    summarizePlaybackAttempts('kugou', attempts, options)
);

describe('attempt records', () => {
    it('emptyAttempt records a reply without a URL', () => {
        expect(emptyAttempt('song_url', { quality: 'hires', variant: 'metadata', detail: 'status=3', upstreamCode: 3 })).toEqual({
            stage: 'song_url',
            outcome: 'empty',
            quality: 'hires',
            variant: 'metadata',
            detail: 'status=3',
            upstreamCode: 3,
        });
    });

    it('attemptFromError copies the evidence of an OmniError', () => {
        const source = new OnlineProviderError('network', 'Bad gateway', 'kugou', undefined, 502, 3_000, { upstreamCode: 31000, transient: true });
        expect(attemptFromError('legacy_play_info', source, { quality: 'high' })).toEqual({
            stage: 'legacy_play_info',
            outcome: 'error',
            quality: 'high',
            code: 'network',
            httpStatus: 502,
            retryAfterMs: 3_000,
            upstreamCode: 31000,
            transient: true,
            detail: 'Bad gateway',
        });
    });

    it('attemptFromError keeps a plain Error as an unproven attempt', () => {
        const attempt = attemptFromError('song_url', new Error('boom'));
        expect(attempt).toEqual({ stage: 'song_url', outcome: 'error', detail: 'boom' });
        expect(attemptChainDecision(attempt)).toBe('continue');
    });
});

describe('attemptChainDecision', () => {
    it.each<[string, ProviderPlaybackAttempt, ReturnType<typeof attemptChainDecision>]>([
        ['auth-required', failed('auth-required'), 'stop-chain'],
        ['timeout', failed('timeout'), 'stop-chain'],
        ['network with HTTP 504', failed('network', { httpStatus: 504 }), 'stop-chain'],
        ['HTTP 429', failed('network', { httpStatus: 429 }), 'stop-all'],
        ['retryAfterMs', failed('network', { retryAfterMs: 1_000 }), 'stop-all'],
        ['rate-limited', failed('rate-limited'), 'stop-all'],
        ['unavailable', failed('unavailable'), 'stop-all'],
        ['service-unavailable that is not transient', failed('service-unavailable', { details: { transient: false } }), 'stop-all'],
        ['HTTP 501', failed('network', { httpStatus: 501 }), 'stop-all'],
        ['network', failed('network'), 'continue'],
        ['network with HTTP 503', failed('network', { httpStatus: 503 }), 'continue'],
        ['network with an upstream code', failed('network', { details: { upstreamCode: 20028 } }), 'continue'],
        ['network with HTTP 404', failed('network', { httpStatus: 404 }), 'continue'],
        ['empty', empty(), 'continue'],
        ['membership-required', failed('membership-required'), 'continue'],
        ['not-playable', failed('not-playable'), 'continue'],
        ['invalid-response', failed('invalid-response'), 'continue'],
    ])('%s -> %s', (_label, attempt, decision) => {
        expect(attemptChainDecision(attempt)).toBe(decision);
    });
});

describe('summarizePlaybackAttempts', () => {
    it('reads all-empty as not-playable (unknown), never as taken-down', () => {
        const summary = conclude([empty('hires'), empty('lossless')]);
        expect(summary.code).toBe('not-playable');
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' }).reason).toBe('unknown');
    });

    it('lets a later network failure outrank an earlier membership refusal', () => {
        const summary = conclude([failed('membership-required', {}, 'hires'), failed('network', {}, 'lossless')]);
        expect(summary.code).toBe('network');
    });

    it('takes the refusal of the last tier', () => {
        expect(conclude([empty('hires'), failed('entitlement-required', {}, 'standard')]).code).toBe('entitlement-required');
    });

    it('does not promote a refusal from an earlier tier', () => {
        expect(conclude([failed('entitlement-required', {}, 'hires'), empty('standard')]).code).toBe('not-playable');
    });

    it('ranks a timeout above a network failure', () => {
        expect(conclude([failed('timeout'), failed('network')]).code).toBe('timeout');
    });

    it('ranks a 5xx above a timeout and keeps the deciding HTTP status', () => {
        const summary = conclude([failed('network', { httpStatus: 503 }), failed('timeout')]);
        expect(summary).toMatchObject({ code: 'service-unavailable', httpStatus: 503 });
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' }).reason).toBe('service-unavailable');
    });

    it.each([0, 1, 2])('reads rate limiting anywhere (position %s) as rate-limited with the longest wait', position => {
        const attempts = [empty(), failed('network'), failed('network', { retryAfterMs: 5_000 })];
        attempts.splice(position, 0, failed('network', { httpStatus: 429, retryAfterMs: 25_000 }));
        const summary = conclude(attempts);
        expect(summary).toMatchObject({ code: 'rate-limited', retryAfterMs: 25_000 });
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' }).reason).toBe('rate-limited');
    });

    it('reads a missing service as unavailable and keeps transient:false', () => {
        const summary = conclude([failed('network', { httpStatus: 501, details: { stage: 'config', transient: false } })]);
        expect(summary).toMatchObject({ code: 'unavailable', httpStatus: 501, details: { transient: false } });
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' })).toMatchObject({ reason: 'service-unavailable', transient: false });
    });

    it('leaves transient unset for a missing service that was not proven permanent', () => {
        const summary = conclude([failed('unavailable')]);
        expect(summary.code).toBe('unavailable');
        expect(summary.details?.transient).toBeUndefined();
    });

    it('reads all invalid responses as invalid-response', () => {
        expect(conclude([failed('invalid-response'), failed('invalid-response')]).code).toBe('invalid-response');
    });

    it('reads mixed invalid and empty replies as not-playable', () => {
        expect(conclude([failed('invalid-response'), empty()]).code).toBe('not-playable');
    });

    it('reads a network attempt with an HTTP 4xx as an answer, so the last attempt decides and the sign-in hint survives', () => {
        const summary = conclude([empty(), failed('network', { httpStatus: 404 })], { signInMayHelp: true });
        expect(summary).toMatchObject({ code: 'not-playable', details: { signInMayHelp: true } });
        expect(summary.httpStatus).toBeUndefined();
        const failure = classifyPlaybackError(summary, { stage: 'resolve-url' });
        expect(failure).toMatchObject({ reason: 'unknown', hint: 'sign-in-may-help' });
        expect(getPlaybackFailureMessage(failure).key).toBe('status.songTemporarilyUnavailableSignInHint');
    });

    it('reads all HTTP 4xx network attempts as invalid-response', () => {
        expect(conclude([failed('network', { httpStatus: 400 }), failed('network', { httpStatus: 403 })]).code).toBe('invalid-response');
    });

    it.each([
        ['before', [failed('network', { httpStatus: 404 }), failed('network')]],
        ['after', [failed('network'), failed('network', { httpStatus: 404 })]],
    ])('still lets a real network failure %s an HTTP 4xx decide', (_order, attempts) => {
        const summary = conclude(attempts);
        expect(summary.code).toBe('network');
        expect(summary.httpStatus).toBeUndefined();
    });

    it('reads no attempts at all as invalid-response', () => {
        expect(conclude([]).code).toBe('invalid-response');
    });

    it('puts a session failure above everything else', () => {
        const attempts = [
            failed('network', { httpStatus: 429, retryAfterMs: 25_000 }),
            failed('unavailable'),
            failed('timeout'),
            failed('auth-required'),
            failed('membership-required'),
        ];
        expect(conclude(attempts).code).toBe('auth-required');
    });

    it('keeps the auth state of the session attempt', () => {
        const attempts = [failed('auth-required', { details: { auth: 'expired' } }), failed('network')];
        const summary = conclude(attempts, { lastError: error('network') });
        expect(summary).toMatchObject({ code: 'auth-required', details: { auth: 'expired' } });
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' }).reason).toBe('session-expired');
    });

    it('keeps the attempts, the sign-in hint and the last error', () => {
        const lastError = error('not-playable');
        const attempts = [empty('hires'), empty('high')];
        const summary = conclude(attempts, { lastError, signInMayHelp: true });

        expect(summary).toBeInstanceOf(OnlineProviderError);
        expect(summary).toMatchObject({
            code: 'not-playable',
            providerId: 'kugou',
            cause: lastError,
            message: 'All kugou playback attempts failed (not-playable)',
            details: { stage: 'audio-source', attempts, signInMayHelp: true },
        });
        expect(classifyPlaybackError(summary, { stage: 'resolve-url' })).toMatchObject({ reason: 'unknown', hint: 'sign-in-may-help', attempts });
    });
});
