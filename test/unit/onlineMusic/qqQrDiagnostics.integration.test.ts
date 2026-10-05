import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatQrLoginDiagnosticReport } from '@/utils/qrLoginDiagnosticReport';

// test/unit/onlineMusic/qqQrDiagnostics.integration.test.ts
// 使用正式 transport 和 provider，把模拟 HTTP 响应送到最终复制报告。
vi.mock('@/utils/lyrics/providers/qqLyricProvider', () => ({ fetchQQLyrics: vi.fn(), searchQQLyrics: vi.fn() }));

const storage = new Map<string, string>();
const fetchMock = vi.fn();
const reportFor = async () => {
    const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
    return formatQrLoginDiagnosticReport({ generatedAt: Date.now(), appVersion: 'test', userAgent: 'test',
        providerId: 'qq', methodId: 'qq', failure: 'start-error', timeline: [],
        providerLines: await qqProvider.auth!.getQrLoginDiagnostics!() });
};

describe('QQ QR copied report integration', () => {
    beforeEach(() => {
        vi.resetModules();
        storage.clear();
        fetchMock.mockReset();
        vi.stubEnv('VITE_QQ_API_BASE', 'https://qq.example.test');
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it.each(['qq', 'wechat'])('preserves backend HTTP and cooldown origin for %s', async (method) => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 429, failureStage: 'qr-key', failureReason: 'local-backoff',
            retryAfterMs: 30000, lastFailure: { failureStage: 'device-bootstrap', failureReason: 'upstream-rejected',
                upstreamHttpStatus: 200, upstreamCode: -30002, upstreamSubCode: -99 },
            token: 'private-token', cookie: 'private-cookie', uin: 'private-account', ip: '192.0.2.1' }, { status: 429 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await expect(qqProvider.auth!.getQrKey!(method)).rejects.toMatchObject({ httpStatus: 429 });
        const report = await reportFor();
        expect(report).toContain('qq details:\n  qr-key: transport=network httpStatus=429 stage=qr-key reason=local-backoff');
        expect(report).toContain('last-failure: stage=device-bootstrap reason=upstream-rejected upstreamCode=-30002');
        expect(report).not.toMatch(/private-|192\.0\.2\.1|qq\.example\.test/);
    });

    it('reports a non-JSON failure from an older backend without inventing a cause', async () => {
        fetchMock.mockResolvedValueOnce(new Response('private-token', { status: 429 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.getQrKey!('qq').catch(() => undefined);
        const report = await reportFor();
        expect(report).toContain('httpStatus=429 stage=unavailable reason=unavailable');
        expect(report).not.toMatch(/private-token|last-failure/);
    });

    it('reports HTTP 502 and the distinct upstream HTTP status when QR creation fails', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 502, failureStage: 'qr-create', failureReason: 'upstream-http-error',
            upstreamHttpStatus: 503 }, { status: 502 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.createQr!('private-key').catch(() => undefined);
        const report = await reportFor();
        expect(report).toContain('qr-create: transport=network httpStatus=502 stage=qr-create reason=upstream-http-error');
        expect(report).toContain('upstreamHttpStatus=503');
        expect(report).not.toContain('private-key');
    });

    it('reports MQTT failure from a successful HTTP check response', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 800, message: 'QR login failed', failureStage: 'mqtt-listener',
            failureReason: 'mqtt-websocket-closed', retryAfterMs: 30000, token: 'private-token' }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await expect(qqProvider.auth!.checkQr!('private-key')).resolves.toMatchObject({ state: 'error' });
        const report = await reportFor();
        expect(report).toContain('qr-check: stage=mqtt-listener reason=mqtt-websocket-closed');
        expect(report).not.toMatch(/private-key|private-token/);
    });

    it('discards unrecognised categories and invalid numbers from an HTTP failure', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ failureStage: 'private-stage', failureReason: 'private-reason',
            upstreamHttpStatus: 999, upstreamCode: 'private-account', upstreamSubCode: 'private-token', retryAfterMs: -1,
            lastFailure: { failureStage: 'private-stage', failureReason: 'private-reason', upstreamCode: 'private-cookie' },
            message: 'private-message' }, { status: 502 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.getQrKey!('qq').catch(() => undefined);
        const report = await reportFor();
        expect(report).toContain('httpStatus=502 stage=unavailable reason=unavailable upstreamCode=unavailable retryAfterMs=unavailable');
        expect(report).toContain('upstreamHttpStatus=unavailable');
        expect(report).not.toMatch(/private-|999|retryAfterMs=-1/);
    });

    it('records confirmation without a session and does not request an account', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.checkQr!('key');
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await reportFor()).toContain('account-refresh: reason=missing-session');
    });

    it('records a loaded profile without copying its account data', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-cookie' }));
        fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: { profile: { musicid: 'private-account',
            info: { nick: 'private-nickname', logo: 'https://private-avatar.example' } } } }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.checkQr!('key');
        await expect(qqProvider.auth!.getLoginStatus()).resolves.not.toBeNull();
        const report = await reportFor();
        expect(report).toContain('account-refresh: reason=profile-present');
        expect(report).not.toMatch(/private-|qqmusic_session/);
    });

    it('reports a rejected account after confirmation and keeps cookies out of the report', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-cookie' }));
        fetchMock.mockResolvedValueOnce(Response.json({ code: 401 }, { status: 401 }));
        const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
        await qqProvider.auth!.checkQr!('private-key');
        await expect(qqProvider.auth!.getLoginStatus()).resolves.toBeNull();
        const report = await reportFor();
        expect(report).toContain('qr-check: result=confirmed hasSession=true');
        expect(report).toContain('account-refresh: transport=auth-required httpStatus=401');
        expect(report).not.toMatch(/private-cookie|private-key/);
        expect([...storage.values()].join('')).not.toContain('private-cookie');
    });
});
