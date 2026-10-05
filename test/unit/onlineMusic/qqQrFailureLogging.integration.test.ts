import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqQrFailureLogging.integration.test.ts
// 经过正式 HTTP transport、provider 和日志 buffer，验证日志面板及复制内容。
vi.mock('@/utils/lyrics/providers/qqLyricProvider', () => ({ fetchQQLyrics: vi.fn(), searchQQLyrics: vi.fn() }));

const fetchMock = vi.fn();
const storage = new Map<string, string>();
const privateFields = { token: 'private-token', cookie: 'private-cookie', uin: 'private-account',
    ip: '192.0.2.1', deviceId: 'private-device', message: 'https://private.example/?token=private-token' };
const failure = { failureStage: 'credential-validation', failureReason: 'upstream-rejected', upstreamCode: -30002,
    upstreamGlobalCode: -1, upstreamSubCode: -99, upstreamHttpStatus: 200, retryAfterMs: 30000, ...privateFields };

const setup = async () => {
    const buffer = await import('@/utils/consoleLogBuffer');
    buffer.installConsoleLogCapture();
    const { qqProvider } = await import('@/services/onlineMusic/qqProvider');
    return { auth: qqProvider.auth!, buffer,
        warnings: () => buffer.getConsoleLogEntries().filter(entry => entry.level === 'warn'),
        log: () => buffer.formatConsoleLog() };
};
const deferred = () => {
    let resolve!: (response: Response) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

describe('QQ QR ordinary failure logs', () => {
    beforeEach(() => {
        vi.resetModules();
        fetchMock.mockReset();
        storage.clear();
        vi.stubEnv('VITE_QQ_API_BASE', 'https://qq.example.test');
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('window', { addEventListener: vi.fn() });
        vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
        for (const level of ['info', 'warn', 'error', 'log', 'debug'] as const) vi.spyOn(console, level).mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

    it.each(['qq', 'wechat'])('shows HTTP 429 and its safe backoff origin for %s', async method => {
        const { auth, warnings, log } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ failureStage: 'qr-key', failureReason: 'local-backoff',
            retryAfterMs: 30000, lastFailure: failure, ...privateFields }, { status: 429 }));
        await auth.getQrKey!(method).catch(() => undefined);
        expect(warnings()).toHaveLength(1);
        expect(warnings()[0].scope).toBe('QQProvider');
        expect(log()).toContain(`method=${method}`);
        expect(log()).toContain('qr-key: transport=network httpStatus=429 stage=qr-key reason=local-backoff');
        expect(log()).toContain('last-failure: stage=credential-validation reason=upstream-rejected upstreamCode=-30002');
        expect(log()).toContain('upstreamHttpStatus=200 upstreamGlobalCode=-1 upstreamSubCode=-99');
        expect(log()).not.toMatch(/private-|192\.0\.2\.1|https?:|qqmusic_session/);
    });

    it.each(['qr-create', 'qr-check'] as const)('shows HTTP 502 and upstream HTTP 503 for %s', async step => {
        const { auth, warnings, log } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ ...failure, failureStage: 'qr-create',
            failureReason: 'upstream-http-error', upstreamHttpStatus: 503 }, { status: 502 }));
        await (step === 'qr-create' ? auth.createQr!('private-key') : auth.checkQr!('private-key')).catch(() => undefined);
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain(`${step}: transport=network httpStatus=502`);
        expect(log()).toContain('upstreamHttpStatus=503');
        expect(log()).not.toMatch(/private-|https?:/);
    });

    it.each(['qq', 'wechat'])('logs HTTP 200 QR failure once, including its backoff origin, for %s', async method => {
        const { auth, warnings, log } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'private-key' } }));
        await auth.getQrKey!(method);
        fetchMock.mockResolvedValueOnce(Response.json({ code: 800, ...failure, lastFailure: failure }));
        fetchMock.mockResolvedValueOnce(Response.json({ code: 800, ...failure, retryAfterMs: 29000, lastFailure: failure }));
        await auth.checkQr!('private-key');
        await auth.checkQr!('private-key');
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain(`method=${method}`);
        expect(log()).toContain('qr-check: stage=credential-validation reason=upstream-rejected');
        expect(log()).toContain('last-failure: stage=credential-validation');
        expect(log()).not.toMatch(/private-|https?:/);
    });

    it.each(['qr-key', 'qr-create', 'qr-check'] as const)('shows missing QR material or unknown code for %s', async step => {
        const { auth, warnings, log } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ code: 'private-code', data: {}, ...privateFields }));
        await (step === 'qr-key' ? auth.getQrKey!('qq') : step === 'qr-create' ? auth.createQr!('private-key') : auth.checkQr!('private-key'));
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain(step === 'qr-check' ? 'qr-check: unexpected-code=unavailable' : `${step}: reason=missing-${step === 'qr-key' ? 'key' : 'image'}`);
        expect(log()).not.toMatch(/private-|https?:/);
    });

    it.each([800, 999])('logs numeric QR terminal code %s safely', async code => {
        const { auth, warnings, log } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ code, message: 'QR code expired' }));
        await auth.checkQr!('private-key');
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain(code === 800 ? 'reason=qr-expired' : 'unexpected-code=999');
    });

    it.each([false, true])('filters invalid categories and numbers in HTTP success=%s', async ok => {
        const { auth, log, warnings } = await setup();
        const body = { code: 800, ...privateFields, failureStage: 'private-stage', failureReason: 'private-reason',
            upstreamCode: 'private-account', upstreamGlobalCode: 1.5, upstreamSubCode: 1e30, upstreamHttpStatus: 999,
            retryAfterMs: -1, lastFailure: { failureStage: 'private-stage', failureReason: 'private-reason', upstreamCode: 'private-token' } };
        fetchMock.mockResolvedValueOnce(Response.json(body, { status: ok ? 200 : 502 }));
        await auth.checkQr!('private-key').catch(() => undefined);
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain('stage=unavailable reason=unavailable upstreamCode=unavailable retryAfterMs=unavailable');
        expect(log()).toContain('upstreamHttpStatus=unavailable upstreamGlobalCode=unavailable upstreamSubCode=unavailable');
        expect(log()).not.toMatch(/private-|999|1\.5|1e\+30|retryAfterMs=-1|https?:/);
    });

    it('keeps older non-JSON HTTP failures honest', async () => {
        const { auth, log } = await setup();
        fetchMock.mockResolvedValueOnce(new Response('private-body', { status: 429 }));
        await auth.getQrKey!('private-method').catch(() => undefined);
        expect(log()).toContain('httpStatus=429 stage=unavailable reason=unavailable');
        expect(log()).not.toMatch(/private-|last-failure/);
    });

    it.each(['missing-session', 'anonymous', 'auth-required', 'network', 'raw-network'] as const)('logs account-refresh %s once with safe confirmation context', async reason => {
        const { auth, log, warnings } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803,
            ...(reason === 'missing-session' ? {} : { cookie: 'qqmusic_session=private-cookie' }) }));
        await auth.checkQr!('private-key');
        if (reason === 'anonymous') fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: {}, ...privateFields }));
        if (reason === 'auth-required' || reason === 'network') fetchMock.mockResolvedValueOnce(Response.json(failure, { status: reason === 'network' ? 502 : 401 }));
        if (reason === 'raw-network') fetchMock.mockRejectedValueOnce(new Error('private-error https://private.example/?cookie=private-cookie'));
        await auth.getLoginStatus().catch(() => undefined);
        expect(warnings()).toHaveLength(1);
        expect(log()).toContain(`qr-check: result=confirmed hasSession=${reason !== 'missing-session'} hasCookie=${reason !== 'missing-session'}`);
        expect(log()).toContain(reason === 'missing-session' || reason === 'anonymous' ? `account-refresh: reason=${reason}`
            : `account-refresh: transport=${reason === 'raw-network' ? 'unknown' : reason}`);
        expect(log()).not.toMatch(/private-|https?:|qqmusic_session/);
    });

    it.each(['qr-key', 'qr-create', 'qr-check', 'account-refresh'] as const)('ignores old %s failures after a new attempt', async step => {
        const { auth, log, warnings, buffer } = await setup();
        if (step === 'account-refresh') {
            fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-cookie' }));
            await auth.checkQr!('old-key');
        }
        const old = deferred();
        fetchMock.mockReturnValueOnce(old.promise);
        const pending = (step === 'qr-key' ? auth.getQrKey!('qq') : step === 'qr-create' ? auth.createQr!('old-key')
            : step === 'qr-check' ? auth.checkQr!('old-key') : auth.getLoginStatus()).catch(() => undefined);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(step === 'account-refresh' ? 2 : 1));
        fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'new-key' } }));
        await auth.getQrKey!('wechat');
        buffer.clearConsoleLog();
        old.resolve(Response.json(failure, { status: 502 }));
        await pending;
        expect(warnings()).toEqual([]);
        expect(log()).toBe('');
        expect(await auth.getQrLoginDiagnostics!()).toEqual([]);
    });

    it.each(['qr-key', 'qr-create', 'qr-check', 'account-refresh'] as const)('ignores late HTTP 200 %s terminal responses', async step => {
        const { auth, log, buffer } = await setup();
        if (step === 'account-refresh') {
            fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-cookie' }));
            await auth.checkQr!('old-key');
        }
        const old = deferred();
        fetchMock.mockReturnValueOnce(old.promise);
        const pending = step === 'qr-key' ? auth.getQrKey!('qq') : step === 'qr-create' ? auth.createQr!('old-key')
            : step === 'qr-check' ? auth.checkQr!('old-key') : auth.getLoginStatus();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(step === 'account-refresh' ? 2 : 1));
        fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'new-key' } }));
        await auth.getQrKey!('wechat');
        buffer.clearConsoleLog();
        old.resolve(Response.json({ code: step === 'qr-check' ? 800 : 200, ...failure, data: {} }));
        await pending;
        expect(log()).toBe('');
        expect(await auth.getQrLoginDiagnostics!()).toEqual([]);
    });

    it('keeps a late account failure out of a newly confirmed attempt', async () => {
        const { auth, log, buffer } = await setup();
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-old-cookie' }));
        await auth.checkQr!('old-key');
        const old = deferred();
        fetchMock.mockReturnValueOnce(old.promise);
        const pending = auth.getLoginStatus().catch(() => undefined);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'new-key' } }));
        await auth.getQrKey!('wechat');
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-new-cookie' }));
        await auth.checkQr!('new-key');
        buffer.clearConsoleLog();
        old.reject(new Error('private-old-error https://private.example'));
        await pending;
        expect(log()).toBe('');
        expect(await auth.getQrLoginDiagnostics!()).toEqual(['qr-check: result=confirmed hasSession=true hasCookie=true']);
    });

    it('does not copy raw cancellation errors into the log panel', async () => {
        const { auth, log } = await setup();
        fetchMock.mockRejectedValueOnce(new Error('private-error https://private.example/?token=private-token'));
        await auth.cancelQr!('private-key');
        expect(log()).toContain('qr-cancel:failed');
        expect(log()).toContain('unknown');
        expect(log()).not.toMatch(/private-|https?:/);
    });

    it('keeps the account failure handler from logging the raw QQ error again', async () => {
        const { auth, log, warnings } = await setup();
        const { handleLoginStatusFailure } = await import('@/services/onlineMusic/loginStatusFailure');
        fetchMock.mockResolvedValueOnce(Response.json({ code: 803, cookie: 'qqmusic_session=private-cookie' }));
        await auth.checkQr!('private-key');
        fetchMock.mockRejectedValueOnce(new Error('private-error https://private.example/?cookie=private-cookie'));
        const updateAccount = vi.fn();
        await auth.getLoginStatus().catch(error => handleLoginStatusFailure(error, { providerId: 'qq', cachedUser: null,
            fallbackMessage: 'qq_login_status_failed', clearAuthState: vi.fn(), updateAccount }));
        expect(warnings().filter(entry => entry.scope === 'QQProvider')).toHaveLength(1);
        expect(log()).toContain('account-refresh: transport=unknown');
        expect(warnings()).toHaveLength(1);
        expect(log()).not.toContain('[LoginStatus] failure');
        expect(log()).not.toMatch(/private-|https?:|qqmusic_session/);
        expect(updateAccount).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', freshness: 'error' }));
    });

    it('keeps waiting polls quiet and allows the same failure in a new attempt before recovery', async () => {
        const { auth, log, warnings, buffer } = await setup();
        for (let attempt = 0; attempt < 2; attempt++) {
            fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'key' } }));
            await auth.getQrKey!('qq');
            fetchMock.mockResolvedValueOnce(Response.json({ code: 800, ...failure }));
            await auth.checkQr!('key');
        }
        expect(warnings()).toHaveLength(2);
        fetchMock.mockResolvedValueOnce(Response.json({ data: { unikey: 'key' } }));
        await auth.getQrKey!('wechat');
        buffer.clearConsoleLog();
        for (const code of [801, 801, 802, 803]) {
            fetchMock.mockResolvedValueOnce(Response.json({ code, ...(code === 803 ? { cookie: 'qqmusic_session=private-cookie' } : {}) }));
            await auth.checkQr!('key');
        }
        expect(log()).toBe('');
        fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: { profile: { musicid: 'private-account', info: { nick: 'private-nick' } } } }));
        await expect(auth.getLoginStatus()).resolves.not.toBeNull();
        expect(warnings()).toHaveLength(0);
        expect(log()).toContain('login-status:profile');
        expect(log()).not.toMatch(/private-|last-failure|upstreamCode/);
        expect((await auth.getQrLoginDiagnostics!()).join(' ')).toContain('profile-present');
    });
});
