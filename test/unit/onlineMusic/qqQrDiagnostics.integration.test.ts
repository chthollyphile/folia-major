import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAccountAuthPort, LibraryAccountClock } from '@/library/core/account/account.contract';

// test/unit/onlineMusic/qqQrDiagnostics.integration.test.ts
// 正式的 transport、provider 与 core 的登录会话串起来，只把 HTTP 换成桩：后端回了什么，复制出来的报告里就有它说的
// （失败阶段与原因、HTTP 状态、退避时长、窗口显示的那一种情况），而登录凭据（session 的值）永远不出现。
vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({ fetchQQLyrics: vi.fn(), searchQQLyrics: vi.fn(), searchQQSongs: vi.fn() }));

const storage = new Map<string, string>();
const fetchMock = vi.fn();

/** 手动时钟：advance 按到期顺序触发计时器，每次触发前后排空微任务。 */
const createManualClock = () => {
    let now = Date.UTC(2026, 9, 7, 12, 0, 0);
    let seq = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const flush = () => new Promise<void>(resolve => setImmediate(resolve));
    const clock: LibraryAccountClock = {
        now: () => now,
        setTimeout: (callback, ms) => {
            const id = ++seq;
            timers.set(id, { at: now + ms, callback });
            return id;
        },
        clearTimeout: handle => { timers.delete(handle as number); },
    };
    const advance = async (ms: number) => {
        const target = now + ms;
        for (; ;) {
            await flush();
            const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort(([, a], [, b]) => a.at - b.at)[0];
            if (!due) break;
            timers.delete(due[0]);
            now = due[1].at;
            due[1].callback();
        }
        now = target;
        await flush();
    };
    return { clock, advance };
};

const createSession = async () => {
    const { qqProvider } = await import('@/services/onlineMusic/qq/qqProvider');
    const { createProviderLoginSession } = await import('@/library/core/account/providerLoginSession.service');
    const { noteLoginFailure } = await import('@/services/onlineMusic/login/loginFailureCase');
    const qqAuth = qqProvider.auth!;
    // omni's runLoginStep: the provider's own words for a thrown error go with it.
    const step = async <T,>(name: 'start' | 'check', run: () => Promise<T>): Promise<T> => {
        try {
            return await run();
        } catch (error) {
            noteLoginFailure(error, qqAuth.describeLoginFailure?.(name, error));
            throw error;
        }
    };
    const auth: LibraryAccountAuthPort = {
        resolveLoginMethods: async () => [],
        startLogin: (_providerId, methodId) => step('start', async () => {
            const key = await qqAuth.startLogin!(methodId);
            return { key, imageUrl: await qqAuth.createQr!(key) };
        }),
        checkLogin: (_providerId, key) => step('check', () => qqAuth.checkLogin!(key)),
        cancelLogin: (_providerId, key) => qqAuth.cancelLogin!(key),
        confirmsLoginInBrowser: () => false,
        opensLoginPageItself: () => false,
        openLoginPage: async () => { },
        getLoginTtlMs: () => null,
        getLoginTexts: () => null,
        getLoginLocalService: () => null,
        getLoginDiagnostics: () => qqAuth.getLoginDiagnostics!(),
        canRunLoginSelfCheck: () => false,
        runLoginSelfCheck: async () => null,
        getProviderCapabilities: () => ({ auth: true }),
        dropRequestLimits: () => { },
    };
    const manual = createManualClock();
    const session = createProviderLoginSession({
        auth,
        clock: manual.clock,
        diagnostics: { appVersion: 'test', userAgent: 'test' },
        log: () => { },
        onConfirmed: () => qqAuth.getLoginStatus().then(user => (user ? true : false)),
    });
    return { session, manual };
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
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it.each(['qq', 'wechat'])('keeps the backend cooldown, its cause and the last failure for %s', async (method) => {
        fetchMock.mockResolvedValueOnce(Response.json({
            code: 429,
            message: 'QR login is temporarily backed off',
            failureStage: 'qr-key',
            failureReason: 'local-backoff',
            retryAfterMs: 30000,
            lastFailure: { failureStage: 'session-issue', failureReason: 'unexpected-error', upstreamHttpStatus: 200 },
        }, { status: 429 }));
        const { session } = await createSession();

        await session.start('qq', method).settled;

        expect(session.getSnapshot()).toMatchObject({
            phase: 'error', failureKind: 'start-error', failure: { case: { id: 'retry-later', action: 'wait-then-retry' }, facts: { retryAfterMs: 30000 } },
        });
        const report = await session.buildDiagnosticReport();
        expect(report).toContain(`provider: qq (method ${method})`);
        expect(report).toContain('QR login is temporarily backed off');
        expect(report).toContain('httpStatus=429');
        expect(report).toContain('case: retry-later');
        expect(String(fetchMock.mock.calls[0][0])).toContain(`channel=${method}`);
    });

    it('reports the failure stage behind "QR login failed" after the phone confirmed', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json({ code: 200, data: { unikey: 'qr-key' } }))
            .mockResolvedValueOnce(Response.json({ code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } }))
            .mockResolvedValueOnce(Response.json({ code: 802, message: 'QR code scanned' }))
            .mockResolvedValueOnce(Response.json({
                code: 800,
                message: 'QR login failed',
                failureStage: 'credential-exchange',
                failureReason: 'upstream-rejected',
                upstreamCode: 1000,
                retryAfterMs: 30000,
            }));
        const { session, manual } = await createSession();
        await session.start('qq', 'qq').settled;

        await manual.advance(4000);

        expect(session.getSnapshot()).toMatchObject({ phase: 'error', failureKind: 'check-error', failure: { facts: { retryAfterMs: 30000 } } });
        const report = await session.buildDiagnosticReport();
        expect(report).toContain('state state=scanned polls=1');
        expect(report).toContain('stage credential-exchange, reason upstream-rejected');
    });

    it('says why the account did not load after a confirmed scan, without the session value', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json({ code: 200, data: { unikey: 'qr-key' } }))
            .mockResolvedValueOnce(Response.json({ code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } }))
            .mockResolvedValueOnce(Response.json({ code: 803, message: 'Authorization login successful', cookie: 'qqmusic_session=secret-session-token' }))
            .mockResolvedValueOnce(Response.json({ code: 200, data: {} }));
        const { session, manual } = await createSession();
        await session.start('qq', 'qq').settled;

        await manual.advance(2000);

        expect(session.getSnapshot()).toMatchObject({ phase: 'error', failureKind: 'account-refresh-failed', failure: { case: { id: 'account-not-read' } } });
        const report = await session.buildDiagnosticReport();
        expect(report).toContain('complete completed=false');
        expect(report).toContain('last account check:');
        expect(report).toContain('login_status: the backend does not recognize the stored session');
        expect(report).toContain('session: backend session stored=yes');
        expect(report).not.toContain('secret-session-token');
    });
});
