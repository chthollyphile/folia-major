import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBodianProviderError, type BodianBridgeError } from '@/services/onlineMusic/bodianErrors';
import { classifyPlaybackError } from '@/services/playbackRecovery/onlinePlaybackFailure';
import { OnlineProviderError, type OnlineProviderErrorDetails, type ProviderErrorCode } from '@/types/onlineMusic';
import type { PlaybackFailureReason } from '@/types/playbackFailure';

// test/unit/onlineMusic/bodianErrors.test.ts — bodian-music-api@0.1.2 的 message 模板映射；契约部分驱动真实的包。

const require = createRequire(import.meta.url);
const { createBodianApiBridge } = require('../../../electron/bodianApiBridge.cjs');
const { createSessionRepository } = require('../../../electron/bodian/session.cjs');
const { createWire } = require('../../helpers/bodianWire.cjs');
const createStore = () => {
    const values = new Map<string, unknown>();
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });
const account = { uid: '123', token: 'fixture-private', user: { id: '123', nickname: 'Fixture', avatarUrl: '' } };

const REGION_MESSAGE = '由于版权保护，该资源仅限中国大陆地区使用';

interface Expected {
    code: ProviderErrorCode;
    details?: OnlineProviderErrorDetails;
    httpStatus?: number;
}

const expectMapped = (error: OnlineProviderError, source: BodianBridgeError, expected: Expected) => {
    expect(error).toBeInstanceOf(OnlineProviderError);
    expect(error.code).toBe(expected.code);
    expect(error.providerId).toBe('bodian');
    expect(error.message).toBe(source.message);
    expect(error.details).toEqual(expected.details);
    expect(error.httpStatus).toBe(expected.httpStatus);
    expect(error.retryAfterMs).toBeUndefined();
};

describe('toBodianProviderError (§11.4 table)', () => {
    it.each<[string, BodianBridgeError, Expected]>([
        ['anonymous status 7', { code: 'auth-required', message: 'Bodian requires additional playback rights' },
            { code: 'auth-required', details: { auth: 'signed-out' } }],
        ['anonymous missing status', { code: 'auth-required', message: 'Bodian playback rights are unavailable' },
            { code: 'auth-required', details: { auth: 'signed-out' } }],
        ['HTTP 401', { code: 'auth-required', message: 'Bodian HTTP 401' },
            { code: 'auth-required', details: { auth: 'expired' }, httpStatus: 401 }],
        ['business code 11012', { code: 'auth-required', message: 'Bodian rejected the request (code 11012)' },
            { code: 'auth-required', details: { auth: 'expired', upstreamCode: 11012 } }],
        ['signed-in status 7', { code: 'not-playable', message: 'Bodian requires additional playback rights' },
            { code: 'entitlement-required' }],
        ['business code 20018', { code: 'not-playable', message: 'Bodian rejected the request (code 20018)' },
            { code: 'entitlement-required', details: { upstreamCode: 20018 } }],
        ['status 3 without audition', { code: 'not-playable', message: 'Bodian preview is unavailable' },
            { code: 'preview-only' }],
        ['signed-in missing status', { code: 'not-playable', message: 'Bodian playback rights are unavailable' },
            { code: 'not-playable' }],
        ['timeout', { code: 'network', message: 'Bodian request timed out' }, { code: 'timeout' }],
        ['HTTP 503', { code: 'network', message: 'Bodian HTTP 503' }, { code: 'network', httpStatus: 503 }],
        ['HTTP 429', { code: 'network', message: 'Bodian HTTP 429' }, { code: 'network', httpStatus: 429 }],
        ['HTTP 504', { code: 'network', message: 'Bodian HTTP 504' }, { code: 'network', httpStatus: 504 }],
        ['HTTP 404', { code: 'network', message: 'Bodian HTTP 404' }, { code: 'network', httpStatus: 404 }],
        ['request failed', { code: 'network', message: 'Bodian request failed' }, { code: 'network' }],
        ['response interrupted', { code: 'network', message: 'Bodian response was interrupted' }, { code: 'network' }],
        ['other business code', { code: 'invalid-response', message: 'Bodian rejected the request (code 500)' },
            { code: 'invalid-response', details: { upstreamCode: 500 } }],
        ['missing business code', { code: 'invalid-response', message: 'Bodian rejected the request (code missing)' },
            { code: 'invalid-response', details: { upstreamCode: 'missing' } }],
        ['invalid audio URL', { code: 'invalid-response', message: 'Bodian returned an invalid audio URL' },
            { code: 'invalid-response' }],
        ['region restriction', { code: 'region-restricted', message: REGION_MESSAGE }, { code: 'region-restricted' }],
        ['library sign-in', { code: 'auth-required', message: 'Bodian sign-in is required' }, { code: 'auth-required' }],
        ['unsupported operation', { code: 'unsupported', message: 'Unsupported Bodian operation' }, { code: 'unsupported' }],
        ['expired QR code', { code: 'unavailable', message: 'Bodian QR code expired' }, { code: 'unavailable' }],
    ])('maps %s', (_label, source, expected) => {
        expectMapped(toBodianProviderError(source), source, expected);
    });

    it.each([
        'Bodian requires additional playback rights', 'Bodian playback rights are unavailable', 'Bodian HTTP 401',
        'Bodian rejected the request (code 11012)', 'Bodian account changed', 'Bodian session identity is inconsistent', 'anything else',
    ])('never renames auth-required (%s)', message => {
        expect(toBodianProviderError({ code: 'auth-required', message }).code).toBe('auth-required');
    });

    it('does not read business codes that are not part of the matching template', () => {
        // 只有 11012 属于鉴权、只有 20018 属于权限；其他业务码不会被挪进这两类。
        expect(toBodianProviderError({ code: 'auth-required', message: 'Bodian rejected the request (code 500)' }).details).toBeUndefined();
        expect(toBodianProviderError({ code: 'not-playable', message: 'Bodian rejected the request (code 500)' }).code).toBe('not-playable');
        expect(toBodianProviderError({ code: 'network', message: 'Bodian HTTP 5030' }).httpStatus).toBeUndefined();
    });
});

// 用真实的 bodian-music-api@0.1.2 + 桌面桥产生错误，确认模板没有漂移；升级包时这里先红。
describe('bodian-music-api@0.1.2 contract', () => {
    type WireCall = { url: URL };
    type WireReply = Record<string, unknown> | Promise<never>;

    const CHECK_RIGHT = '/api/play/music/v2/checkRight';
    const AUDIO_URL = '/api/play/music/v2/audioUrl';

    const createBridge = (respond: (call: WireCall) => WireReply, signedIn: boolean) => {
        const store = createStore(), safeStorage = cipher();
        if (signedIn) createSessionRepository({ store, safeStorage }).set(account);
        const wire = createWire(respond);
        return { bridge: createBodianApiBridge({ store, safeStorage, requestFactory: wire.factory }), wire };
    };

    const requestAudioError = async (respond: (call: WireCall) => WireReply, signedIn: boolean) => {
        const { bridge } = createBridge(respond, signedIn);
        const result = await bridge.request('audio', { id: '228908', quality: 'high' });
        expect(result.ok).toBe(false);
        return result.error as BodianBridgeError;
    };

    const checkRight = (reply: Record<string, unknown>) => ({ url }: WireCall) => (
        url.pathname.endsWith(CHECK_RIGHT) ? reply : { code: 200, data: { audioHttpsUrl: 'https://audio.example.test/full.mp3' } }
    );

    afterEach(() => vi.useRealTimers());

    it.each<[string, (call: WireCall) => WireReply, boolean, Expected, PlaybackFailureReason]>([
        ['status 7 with a session', checkRight({ code: 200, data: { status: 7 } }), true,
            { code: 'entitlement-required' }, 'entitlement-required'],
        ['status 7 without a session', checkRight({ code: 200, data: { status: 7 } }), false,
            { code: 'auth-required', details: { auth: 'signed-out' } }, 'not-signed-in'],
        ['status 3 without audition', checkRight({ code: 200, data: { status: 3 } }), true,
            { code: 'preview-only' }, 'preview-only'],
        ['missing status with a session', checkRight({ code: 200, data: {} }), true,
            { code: 'not-playable' }, 'unknown'],
        ['missing status without a session', checkRight({ code: 200, data: {} }), false,
            { code: 'auth-required', details: { auth: 'signed-out' } }, 'not-signed-in'],
        ['business code 20018', checkRight({ code: 20018 }), true,
            { code: 'entitlement-required', details: { upstreamCode: 20018 } }, 'entitlement-required'],
        ['business code 11012', checkRight({ code: 11012 }), true,
            { code: 'auth-required', details: { auth: 'expired', upstreamCode: 11012 } }, 'session-expired'],
        ['other business code', checkRight({ code: 500 }), true,
            { code: 'invalid-response', details: { upstreamCode: 500 } }, 'invalid-response'],
        ['missing business code', checkRight({ data: { status: 1 } }), true,
            { code: 'invalid-response', details: { upstreamCode: 'missing' } }, 'invalid-response'],
        ['HTTP 503', checkRight({ httpStatus: 503, code: 503 }), true,
            { code: 'network', httpStatus: 503 }, 'service-unavailable'],
        ['HTTP 429', checkRight({ httpStatus: 429 }), true,
            { code: 'network', httpStatus: 429 }, 'rate-limited'],
        ['HTTP 401', checkRight({ httpStatus: 401 }), true,
            { code: 'auth-required', details: { auth: 'expired' }, httpStatus: 401 }, 'session-expired'],
        ['empty audioUrl', ({ url }) => url.pathname.endsWith(AUDIO_URL)
            ? { code: 200, data: { audioUrl: '' } } : { code: 200, data: { status: 1 } }, true,
            { code: 'invalid-response' }, 'invalid-response'],
        ['region restriction', checkRight({ code: 407, msg: REGION_MESSAGE }), true,
            { code: 'region-restricted' }, 'region-restricted'],
        ['request failure', () => Promise.reject(new Error('socket hang up')), true,
            { code: 'network' }, 'network'],
    ])('maps %s from the real package', async (_label, respond, signedIn, expected, reason) => {
        const source = await requestAudioError(respond, signedIn);
        const error = toBodianProviderError(source);
        expectMapped(error, source, expected);
        expect(classifyPlaybackError(error, { stage: 'resolve-url', providerId: 'bodian' }).reason).toBe(reason);
    });

    it('maps a request that never answers to timeout after 15 seconds', async () => {
        vi.useFakeTimers();
        const { bridge, wire } = createBridge(() => new Promise<never>(() => {}), true);
        const pending = bridge.request('audio', { id: '228908', quality: 'high' });
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pending;
        expect(wire.calls).toHaveLength(1);
        expect(result.ok).toBe(false);
        const error = toBodianProviderError(result.error);
        expectMapped(error, result.error, { code: 'timeout' });
        expect(classifyPlaybackError(error, { stage: 'resolve-url', providerId: 'bodian' }).reason).toBe('timeout');
    });
});
