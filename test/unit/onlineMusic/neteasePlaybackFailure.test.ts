import { describe, expect, it } from 'vitest';
import { OnlineProviderError, type ProviderErrorCode } from '@/types/onlineMusic';
import {
    classifyNeteaseSongUrlResponse,
    isNeteaseRouteMissingResponse,
    NETEASE_API_BASE_MISSING,
    neteaseUpstreamNetworkError,
    resolveNeteaseSongAvailability,
    toNeteaseRequestError,
} from '@/services/onlineMusic/neteasePlaybackFailure';
import { classifyPlaybackError } from '@/services/playbackRecovery/onlinePlaybackFailure';

// test/unit/onlineMusic/neteasePlaybackFailure.test.ts
// 覆盖网易云失败归一化表（spec §11.1）的每一行：响应形态、transport 抛错形态、静态可用性。

const ROUTE_MISSING = { code: 404, data: null, msg: 'Not Found' };

describe('classifyNeteaseSongUrlResponse', () => {
    it('returns null for a playable URL, with or without a top-level code', () => {
        expect(classifyNeteaseSongUrlResponse({ code: 200, data: [{ code: 200, url: 'http://m.test/a.mp3', fee: 8 }] })).toBeNull();
        expect(classifyNeteaseSongUrlResponse({ data: [{ url: 'http://m.test/a.mp3' }] })).toBeNull();
        // VIP fee alone never blocks a URL the API did hand out.
        expect(classifyNeteaseSongUrlResponse({ code: 200, data: [{ code: 200, url: 'http://m.test/a.mp3', fee: 1 }] })).toBeNull();
    });

    it('treats a URL that carries freeTrialInfo as preview-only', () => {
        const error = classifyNeteaseSongUrlResponse({
            code: 200,
            data: [{ code: 200, url: 'http://m.test/preview.mp3', fee: 1, freeTrialInfo: { start: 0, end: 30 } }],
        });
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ code: 'preview-only', providerId: 'netease', details: { stage: 'song-url', upstreamCode: 200 } });
    });

    it('does not treat a null freeTrialInfo as a preview', () => {
        expect(classifyNeteaseSongUrlResponse({
            code: 200,
            data: [{ code: 200, url: 'http://m.test/a.mp3', freeTrialInfo: null }],
        })).toBeNull();
    });

    it.each([
        [1, 'membership-required'],
        [4, 'purchase-required'],
        [8, 'entitlement-required'],
        [undefined, 'entitlement-required'],
    ] as const)('maps an empty URL with code -110 and fee %s to %s', (fee, code) => {
        const error = classifyNeteaseSongUrlResponse({ code: 200, data: [{ id: 1, url: null, code: -110, fee }] });
        expect(error).toMatchObject({ code, providerId: 'netease', details: { stage: 'song-url', upstreamCode: -110 } });
    });

    it('keeps an empty URL with code 404 as not-playable (unknown), never taken-down', () => {
        const error = classifyNeteaseSongUrlResponse({ code: 200, data: [{ id: 1, url: null, code: 404, fee: 0 }] });
        expect(error).toMatchObject({ code: 'not-playable', details: { stage: 'song-url', upstreamCode: 404 } });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe('unknown');
    });

    it('does not classify by fee alone when the URL is empty for another reason', () => {
        const error = classifyNeteaseSongUrlResponse({ code: 200, data: [{ id: 1, url: '', code: 200, fee: 1 }] });
        expect(error).toMatchObject({ code: 'not-playable', details: { upstreamCode: 200 } });
    });

    it('maps a top-level 502 with a timeout text to timeout', () => {
        const raw = { code: 502, msg: 'connect ETIMEDOUT 1.2.3.4:443' };
        const error = classifyNeteaseSongUrlResponse(raw);
        expect(error).toMatchObject({ code: 'timeout', providerId: 'netease', details: { stage: 'song-url', upstreamCode: 502 } });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe('timeout');
    });

    it('maps a top-level 502 with a connection reset to network so the classifier says network', () => {
        const error = classifyNeteaseSongUrlResponse({ code: 502, msg: 'read ECONNRESET' });
        expect(error).toMatchObject({ code: 'network', details: { stage: 'song-url' } });
        expect(error?.details).not.toHaveProperty('upstreamCode');
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe('network');
    });

    it('keeps a top-level 502 without a network text as not-playable', () => {
        expect(classifyNeteaseSongUrlResponse({ code: 502, msg: 'upstream said no' })).toMatchObject({
            code: 'not-playable',
            details: { upstreamCode: 502 },
        });
    });

    it('maps the local API Not Found shape to unavailable at the local-api stage', () => {
        const error = classifyNeteaseSongUrlResponse(ROUTE_MISSING);
        expect(error).toMatchObject({ code: 'unavailable', details: { stage: 'local-api' } });
    });

    it('maps an empty data list to invalid-response', () => {
        expect(classifyNeteaseSongUrlResponse({ code: 200, data: [] })).toMatchObject({ code: 'invalid-response' });
        expect(classifyNeteaseSongUrlResponse({ code: 200 })).toMatchObject({ code: 'invalid-response' });
        expect(classifyNeteaseSongUrlResponse(undefined)).toMatchObject({ code: 'invalid-response' });
    });

    it.each([301, 401, 403])('maps top-level code %s to auth-required', (code) => {
        expect(classifyNeteaseSongUrlResponse({ code, msg: '需要登录' })).toMatchObject({
            code: 'auth-required',
            details: { stage: 'song-url', upstreamCode: code },
        });
    });

    it.each([-460, -462, 500])('keeps other top-level code %s as not-playable with the upstream code', (code) => {
        const error = classifyNeteaseSongUrlResponse({ code, msg: 'Cheating' });
        expect(error).toMatchObject({ code: 'not-playable', details: { stage: 'song-url', upstreamCode: code } });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe('unknown');
    });

    it('never produces taken-down from any song URL response', () => {
        const responses: unknown[] = [
            { code: 200, data: [{ url: null, code: -110, fee: 1 }] },
            { code: 200, data: [{ url: null, code: 404 }] },
            { code: 200, data: [{ url: null, code: -200 }] },
            { code: -200, msg: 'no copyright' },
            { code: 502, msg: 'read ECONNRESET' },
            ROUTE_MISSING,
            { code: 200, data: [] },
        ];
        for (const response of responses) {
            expect(classifyNeteaseSongUrlResponse(response)?.code).not.toBe('taken-down');
        }
    });
});

describe('neteaseUpstreamNetworkError', () => {
    it.each([
        ['connect ETIMEDOUT 1.2.3.4:443', 'timeout'],
        ['ESOCKETTIMEDOUT', 'timeout'],
        ['timeout of 15000ms exceeded', 'timeout'],
        ['read ECONNRESET', 'network'],
        ['connect ECONNREFUSED 127.0.0.1:7890', 'network'],
        ['getaddrinfo ENOTFOUND music.163.com', 'network'],
    ] as const)('maps 502 %s to %s', (msg, code) => {
        expect(neteaseUpstreamNetworkError({ code: 502, msg }, 'replacement')).toMatchObject({
            code,
            providerId: 'netease',
            details: { stage: 'replacement' },
        });
    });

    it('returns null when the code is not 502 or the text is not a network failure', () => {
        expect(neteaseUpstreamNetworkError({ code: 200, msg: 'read ECONNRESET' }, 'song-url')).toBeNull();
        expect(neteaseUpstreamNetworkError({ code: 502, msg: 'bad gateway' }, 'song-url')).toBeNull();
        expect(neteaseUpstreamNetworkError(null, 'song-url')).toBeNull();
    });
});

describe('isNeteaseRouteMissingResponse', () => {
    it('matches only the exact Not Found shape', () => {
        expect(isNeteaseRouteMissingResponse(ROUTE_MISSING)).toBe(true);
        expect(isNeteaseRouteMissingResponse({ code: 404 })).toBe(false);
        expect(isNeteaseRouteMissingResponse({ code: 404, msg: 'Not Found', data: {} })).toBe(false);
        expect(isNeteaseRouteMissingResponse({ code: 200, msg: 'Not Found', data: null })).toBe(false);
        expect(isNeteaseRouteMissingResponse(undefined)).toBe(false);
    });
});

describe('toNeteaseRequestError', () => {
    it('maps a rejected fetch (networkFailure tag) to network and keeps the message and cause', () => {
        const fetchError = new TypeError('Failed to fetch');
        const tagged = Object.assign(
            new Error('NetEase API request /song/url/v1 failed: Failed to fetch', { cause: fetchError }),
            { networkFailure: true },
        );
        const error = toNeteaseRequestError(tagged, 'song-url');
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({
            code: 'network',
            providerId: 'netease',
            message: 'NetEase API request /song/url/v1 failed: Failed to fetch',
            cause: tagged,
            details: { stage: 'song-url' },
        });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe('network');
    });

    it('maps NETEASE_API_UNAVAILABLE to unavailable at the backend stage', () => {
        const tagged = Object.assign(
            new Error('NETEASE_API_UNAVAILABLE: local NetEase API is failed (EADDRINUSE)'),
            { code: 'NETEASE_API_UNAVAILABLE' },
        );
        expect(toNeteaseRequestError(tagged, 'song-url')).toMatchObject({
            code: 'unavailable',
            message: 'NETEASE_API_UNAVAILABLE: local NetEase API is failed (EADDRINUSE)',
            details: { stage: 'backend' },
        });
    });

    it('maps a missing API base to a persistent unavailable at the config stage', () => {
        const tagged = Object.assign(new Error('Failed to access environment variables for API base.'), { code: NETEASE_API_BASE_MISSING });
        const error = toNeteaseRequestError(tagged, 'song-url');
        expect(error).toMatchObject({ code: 'unavailable', details: { stage: 'config', transient: false } });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' })).toMatchObject({
            reason: 'service-unavailable',
            transient: false,
        });
    });

    it.each([
        [503, 'service-unavailable', 'service-unavailable'],
        [500, 'service-unavailable', 'service-unavailable'],
        [200, 'invalid-response', 'invalid-response'],
        [404, 'invalid-response', 'invalid-response'],
    ] as const)('maps a non-JSON body with HTTP %s to %s', (httpStatus, code, reason) => {
        const tagged = Object.assign(new Error(`NetEase API /song/url/v1 returned HTTP ${httpStatus} without a JSON body: <html>`), { httpStatus });
        const error = toNeteaseRequestError(tagged, 'song-url');
        expect(error).toMatchObject({ code, httpStatus, details: { stage: 'song-url' } });
        expect(classifyPlaybackError(error, { stage: 'resolve-url' }).reason).toBe(reason);
    });

    it('returns an OmniError and any untagged error unchanged', () => {
        const omniError = new OnlineProviderError('network', 'upstream', 'netease');
        expect(toNeteaseRequestError(omniError, 'replacement')).toBe(omniError);

        const plain = new Error('Invalid NetEase id: x');
        expect(toNeteaseRequestError(plain, 'song-url')).toBe(plain);
        expect(toNeteaseRequestError('boom', 'song-url')).toBe('boom');
    });

    it('never produces taken-down from a transport error', () => {
        const errors: unknown[] = [
            Object.assign(new Error('a'), { networkFailure: true }),
            Object.assign(new Error('b'), { code: 'NETEASE_API_UNAVAILABLE' }),
            Object.assign(new Error('c'), { code: NETEASE_API_BASE_MISSING }),
            Object.assign(new Error('d'), { httpStatus: 451 }),
        ];
        for (const error of errors) {
            expect((toNeteaseRequestError(error, 'song-url') as { code?: ProviderErrorCode }).code).not.toBe('taken-down');
        }
    });
});

describe('resolveNeteaseSongAvailability', () => {
    it('marks st -200 without a playable level or cloud copy as taken-down with the recommendation label', () => {
        expect(resolveNeteaseSongAvailability({
            privilege: { st: -200, pl: 0 },
            noCopyrightRcmd: { typeDesc: '其它版本可播' },
        })).toEqual({ state: 'unavailable', reason: 'taken-down', label: '其它版本可播' });
        expect(resolveNeteaseSongAvailability({ privilege: { st: -200 } })).toEqual({ state: 'unavailable', reason: 'taken-down' });
    });

    it('leaves other negative st values to the runtime as unknown / restricted', () => {
        expect(resolveNeteaseSongAvailability({ privilege: { st: -300, pl: 0 } })).toEqual({ state: 'unknown', reason: 'restricted' });
        expect(resolveNeteaseSongAvailability({ privilege: { st: -1 } })).toEqual({ state: 'unknown', reason: 'restricted' });
    });

    it('does not block st -200 when a playable level or a cloud copy exists', () => {
        expect(resolveNeteaseSongAvailability({ privilege: { st: -200, pl: 128000 } })).toEqual({ state: 'unknown', reason: 'restricted' });
        expect(resolveNeteaseSongAvailability({ privilege: { st: -200, pl: 0, cs: true } })).toEqual({ state: 'unknown', reason: 'restricted' });
    });

    it('keeps songs without a privilege, or with st >= 0, playable', () => {
        expect(resolveNeteaseSongAvailability({})).toEqual({ state: 'playable' });
        expect(resolveNeteaseSongAvailability({ privilege: { st: 0, pl: 0, fee: 1 } })).toEqual({ state: 'playable' });
        expect(resolveNeteaseSongAvailability(null)).toEqual({ state: 'playable' });
    });
});
