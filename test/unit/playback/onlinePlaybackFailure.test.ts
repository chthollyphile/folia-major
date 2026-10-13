import { describe, expect, it } from 'vitest';
import {
    classifyMediaPlaybackFailure,
    classifyMissingAudioUrl,
    classifyPlaybackError,
    isTransientPlaybackFailure,
    type PlaybackFailureClassifyContext,
} from '@/services/playbackRecovery/onlinePlaybackFailure';
import { OnlineProviderError, type ProviderErrorCode } from '@/types/onlineMusic';
import type { PlaybackFailureReason } from '@/types/playbackFailure';

// test/unit/playback/onlinePlaybackFailure.test.ts
// 播放失败分类器：只有显式的 taken-down code 能得出“已下架”，其余证据不足一律 unknown。

const ctx: PlaybackFailureClassifyContext = { stage: 'resolve-url', providerId: 'kugou' };

const providerError = (
    code: ProviderErrorCode,
    extra: { httpStatus?: number; retryAfterMs?: number; details?: OnlineProviderError['details']; providerId?: string } = {},
) => new OnlineProviderError(code, `failed: ${code}`, extra.providerId, undefined, extra.httpStatus, extra.retryAfterMs, extra.details);

const ALL_CODES: ProviderErrorCode[] = [
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'region-restricted', 'network', 'invalid-response', 'timeout', 'rate-limited', 'service-unavailable',
    'membership-required', 'purchase-required', 'entitlement-required', 'taken-down',
];

describe('classifyPlaybackError: auth-required', () => {
    it.each([
        ['signed-out', 'not-signed-in'],
        ['expired', 'session-expired'],
    ] as const)('trusts details.auth %s over the account snapshot', (auth, reason) => {
        const error = providerError('auth-required', { details: { auth } });
        expect(classifyPlaybackError(error, { ...ctx, account: { status: 'authenticated' } }).reason).toBe(reason);
        expect(classifyPlaybackError(error, { ...ctx, account: { status: 'anonymous' } }).reason).toBe(reason);
    });

    it.each([
        ['authenticated', { status: 'authenticated' }, 'session-expired'],
        ['error', { status: 'error' }, 'session-expired'],
        ['anonymous after an auth failure', { status: 'anonymous', error: 'auth-required' }, 'session-expired'],
        ['anonymous', { status: 'anonymous' }, 'not-signed-in'],
        ['unknown', { status: 'unknown' }, 'not-signed-in'],
        ['missing', undefined, 'not-signed-in'],
    ] as const)('reads the pre-request snapshot (%s) when the adapter gave no auth state', (_label, account, reason) => {
        const failure = classifyPlaybackError(providerError('auth-required'), { ...ctx, account });
        expect(failure.reason).toBe(reason);
    });
});

describe('classifyPlaybackError: provider codes', () => {
    it.each<[string, OnlineProviderError, PlaybackFailureReason]>([
        ['network with HTTP 429', providerError('network', { httpStatus: 429 }), 'rate-limited'],
        ['network with retryAfterMs', providerError('network', { retryAfterMs: 25_000 }), 'rate-limited'],
        ['service-unavailable with HTTP 429', providerError('service-unavailable', { httpStatus: 429 }), 'rate-limited'],
        ['unavailable with retryAfterMs', providerError('unavailable', { retryAfterMs: 1_000 }), 'rate-limited'],
        ['rate-limited', providerError('rate-limited'), 'rate-limited'],
        ['network with HTTP 504', providerError('network', { httpStatus: 504 }), 'timeout'],
        ['network with HTTP 503', providerError('network', { httpStatus: 503 }), 'service-unavailable'],
        ['network with HTTP 500', providerError('network', { httpStatus: 500 }), 'service-unavailable'],
        ['network with HTTP 400', providerError('network', { httpStatus: 400 }), 'invalid-response'],
        ['network with HTTP 404', providerError('network', { httpStatus: 404 }), 'invalid-response'],
        ['network with an upstream code', providerError('network', { details: { upstreamCode: 20028 } }), 'unknown'],
        ['network with an upstream code and HTTP 503', providerError('network', { httpStatus: 503, details: { upstreamCode: 1 } }), 'unknown'],
        ['bare network', providerError('network'), 'network'],
        ['timeout', providerError('timeout'), 'timeout'],
        ['unavailable', providerError('unavailable'), 'service-unavailable'],
        ['service-unavailable', providerError('service-unavailable'), 'service-unavailable'],
        ['invalid-response', providerError('invalid-response'), 'invalid-response'],
        ['not-playable', providerError('not-playable'), 'unknown'],
        ['unsupported', providerError('unsupported'), 'unknown'],
        ['not-public', providerError('not-public'), 'unknown'],
        ['preview-only', providerError('preview-only'), 'preview-only'],
        ['region-restricted', providerError('region-restricted'), 'region-restricted'],
        ['membership-required', providerError('membership-required'), 'membership-required'],
        ['purchase-required', providerError('purchase-required'), 'purchase-required'],
        ['entitlement-required', providerError('entitlement-required'), 'entitlement-required'],
        ['taken-down', providerError('taken-down'), 'taken-down'],
    ])('%s', (_label, error, reason) => {
        expect(classifyPlaybackError(error, ctx).reason).toBe(reason);
    });

    it('passes transient through for unavailable, so a missing service reads as "not configured"', () => {
        const failure = classifyPlaybackError(providerError('unavailable', { details: { stage: 'config', transient: false } }), ctx);
        expect(failure).toMatchObject({ reason: 'service-unavailable', transient: false, providerStage: 'config' });
    });

    it('never infers taken-down from any other code, whatever the HTTP status', () => {
        const statuses = [undefined, 200, 400, 401, 403, 404, 410, 429, 451, 500, 501, 502, 503, 504];
        for (const code of ALL_CODES.filter(candidate => candidate !== 'taken-down')) {
            for (const httpStatus of statuses) {
                for (const retryAfterMs of [undefined, 5_000]) {
                    const failure = classifyPlaybackError(providerError(code, { httpStatus, retryAfterMs }), ctx);
                    expect(failure.reason, `${code} / ${httpStatus} / ${retryAfterMs}`).not.toBe('taken-down');
                }
            }
        }
    });

    it('keeps every piece of evidence for diagnostics and the presenter', () => {
        const attempts = [{ stage: 'song_url', outcome: 'empty' as const }];
        const error = new OnlineProviderError(
            'network', 'backend said no', 'qq', undefined, 429, 25_000,
            { stage: 'upstream', upstreamCode: 'E1', transient: true, signInMayHelp: true, attempts },
        );
        const failure = classifyPlaybackError(error, { stage: 'refresh', providerId: 'kugou' });
        expect(failure).toEqual({
            reason: 'rate-limited',
            stage: 'refresh',
            providerId: 'qq',
            providerCode: 'network',
            providerStage: 'upstream',
            upstreamCode: 'E1',
            httpStatus: 429,
            retryAfterMs: 25_000,
            transient: true,
            hint: 'sign-in-may-help',
            attempts,
            message: 'backend said no',
            cause: error,
        });
    });

    it('falls back to the context provider when the error carries none', () => {
        expect(classifyPlaybackError(providerError('not-playable'), ctx).providerId).toBe('kugou');
    });
});

describe('classifyPlaybackError: other errors', () => {
    it('reads a fetch TypeError as a network failure and keeps the cause', () => {
        const error = new TypeError('Failed to fetch');
        expect(classifyPlaybackError(error, ctx)).toMatchObject({ reason: 'network', cause: error, providerId: 'kugou' });
    });

    it.each(['NetworkError when attempting to fetch resource.', 'Load failed', 'fetch failed'])('recognises "%s"', message => {
        expect(classifyPlaybackError(new TypeError(message), ctx).reason).toBe('network');
    });

    it('reads an unrelated TypeError as unknown', () => {
        expect(classifyPlaybackError(new TypeError('x is not a function'), ctx).reason).toBe('unknown');
    });

    it('reads a DOMException TimeoutError as a timeout', () => {
        expect(classifyPlaybackError(new DOMException('signal timed out', 'TimeoutError'), ctx).reason).toBe('timeout');
    });

    it('reads an AbortError as unknown', () => {
        expect(classifyPlaybackError(new DOMException('aborted', 'AbortError'), ctx).reason).toBe('unknown');
    });

    it('reads a plain Error as unknown and keeps its message', () => {
        expect(classifyPlaybackError(new Error('boom'), ctx)).toMatchObject({ reason: 'unknown', message: 'boom', stage: 'resolve-url' });
    });
});

describe('classifyMissingAudioUrl', () => {
    it.each([null, undefined, ''])('reads %j as unknown with no source', rawUrl => {
        expect(classifyMissingAudioUrl(rawUrl, ctx)).toEqual({
            reason: 'unknown',
            stage: 'resolve-url',
            providerId: 'kugou',
            providerStage: 'no-source',
        });
    });

    it('reads a URL the safety check rejected as an invalid response', () => {
        expect(classifyMissingAudioUrl('javascript:x', ctx)).toMatchObject({ reason: 'invalid-response', providerId: 'kugou' });
    });
});

describe('classifyMediaPlaybackFailure', () => {
    it('ignores an aborted load', () => {
        expect(classifyMediaPlaybackFailure(1, { providerId: 'kugou' })).toBeNull();
    });

    it('reads MEDIA_ERR_NETWORK as a network failure', () => {
        expect(classifyMediaPlaybackFailure(2, { providerId: 'kugou' })).toEqual({
            reason: 'network',
            stage: 'media-element',
            providerId: 'kugou',
        });
    });

    it.each([3, 4])('reads media error %s as unknown and keeps the code', code => {
        expect(classifyMediaPlaybackFailure(code, { providerId: 'kugou' })).toEqual({
            reason: 'unknown',
            stage: 'media-element',
            providerId: 'kugou',
            mediaErrorCode: code,
        });
    });

    it.each([null, 0, 5])('reads code %s as unknown', code => {
        expect(classifyMediaPlaybackFailure(code, {})).toEqual({ reason: 'unknown', stage: 'media-element' });
    });
});

describe('isTransientPlaybackFailure', () => {
    it.each<[PlaybackFailureReason, boolean]>([
        ['network', true],
        ['timeout', true],
        ['service-unavailable', true],
        ['rate-limited', true],
        ['unknown', false],
        ['taken-down', false],
        ['session-expired', false],
        ['invalid-response', false],
    ])('%s -> %s', (reason, expected) => {
        expect(isTransientPlaybackFailure({ reason, stage: 'replacement' })).toBe(expected);
    });
});
