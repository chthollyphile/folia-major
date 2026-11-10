import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBodianApi } from 'bodian-music-api';
import { omni } from '@/services/onlineMusic/omni';
import { requestKugou } from '@/services/onlineMusic/kugou/kugouTransport';
import { neteaseApi } from '@/services/onlineMusic/netease/netease';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { requestQq, resetQqTransportRuntimeCache } from '@/services/onlineMusic/qq/qqTransport';
import type { LoginStep, LoginState } from '@/types/onlineMusic';
import { loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';
import { failureNoteKey } from '@/components/login/window/loginView';

// test/unit/onlineMusic/loginFailurePlatforms.test.ts
// Which case each platform's own failure sorts to, through the real facade, adapter and
// transport: only the outermost thing is a stand-in (fetch, or the desktop side's answer). Each
// test is named after the case it ends in. Spotify, whose answers are made by its desktop side,
// is in test/unit/spotify/spotifyLoginFailure.test.ts.
// The shapes of the answers are the ones the code reads today; no platform was asked.
// The 'no-answer' tests run under fake timers: the request is never answered, and 20 s go by.

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));

const require = createRequire(import.meta.url);
const { createWire } = require('../../helpers/bodianWire.cjs');
const { createKugouApiBridge, normalizeBridgeError } = require('../../../electron/kugou/kugouApiBridge.cjs');
const { BrowserSignInError } = require('../../../electron/ytm/browserSignIn.cjs');
const { toErrorResult: ytmErrorResult } = require('../../../electron/ytm/errors.cjs');
const { createLoginQrCheck } = require('../../../electron/netease/neteaseApiStartup.cjs');
const neteaseQrKey = require('@neteasecloudmusicapienhanced/api/module/login_qr_key.js');
const createNeteaseOption = require('@neteasecloudmusicapienhanced/api/util/option.js');

// The facts and the case of a step that threw, and of a check that answered an error, put
// together as the sign-in hook puts them together.
const thrown = async (step: LoginStep, run: () => Promise<unknown>, inBrowser = false) => {
    const error = await run().then(() => { throw new Error('the step did not fail'); }, (failure: unknown) => failure);
    const facts = loginFailureFacts({ step, inBrowser, scanned: false }, { error });
    return { ...facts, id: loginCaseOf(facts).id };
};
const answered = async (run: () => Promise<LoginState>, inBrowser = false) => {
    const state = await run();
    if (state.state !== 'error') throw new Error(`the check answered ${state.state}`);
    const facts = loginFailureFacts({ step: 'check', inBrowser, scanned: false }, { detail: state.failure, error: state.message });
    return { ...facts, id: loginCaseOf(facts).id };
};
const waitedOut = (inBrowser = false, scanned = false) => loginCaseOf(loginFailureFacts({ step: 'wait', inBrowser, scanned })).id;

const offline = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
const answers = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status }));
// A fetch that never answers. Like the real one, it ends only when the request is aborted.
const silent = () => vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
}));
// A step whose request is never answered: nothing ends for 20 s, then the step fails, the
// request (`asked`, where it is a fetch) is aborted and no timer is left. Answers what `thrown` does.
const unanswered = async (step: LoginStep, run: () => Promise<unknown>, asked?: ReturnType<typeof silent>) => {
    let ended = false;
    const outcome = thrown(step, run).finally(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const failed = await outcome;
    if (asked) expect(asked.mock.calls.at(-1)![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    return failed;
};

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('NetEase', () => {
    // The desktop app: the local service's port, or none while it is down.
    const desktop = (port: number | null) => vi.stubGlobal('window', {
        electron: { getNeteasePort: async () => port, getNeteaseApiStatus: async () => ({ status: port ? 'running' : 'error' }) },
    });

    it('local-service-stopped: the local service is not listening', async () => {
        desktop(null);
        expect(await thrown('start', () => omni.startLogin('netease'))).toMatchObject({ id: 'local-service-stopped' });
    });

    it('unreachable: the local service could not start for want of the network, and is still down when asked again', async () => {
        const down = { status: 'error', port: null, error: 'getaddrinfo ENOTFOUND interface.music.163.com', offline: true, updatedAt: 1 };
        vi.stubGlobal('window', { electron: { getNeteasePort: async () => null, getNeteaseApiStatus: async () => down, restartNeteaseApi: async () => down } });
        expect((await thrown('start', () => omni.startLogin('netease'))).id).toBe('unreachable');
    });

    it('unreachable: the request does not get through', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', offline());
        expect((await thrown('start', () => omni.startLogin('netease'))).id).toBe('unreachable');
        expect((await thrown('check', () => omni.checkLogin('netease', 'qr-key'))).id).toBe('unreachable');
    });

    it('unreachable: the local service is up and cannot reach NetEase, at the start and during the wait', async () => {
        desktop(35001);
        // How the package's util/request.js rejects a request that does not get through (2026-10-16 log, and run with DNS failing).
        const notThrough = () => Promise.reject({ status: 502, body: { code: 502, msg: 'getaddrinfo ENOTFOUND interfacepc.music.163.com' }, cookie: [] });
        // What the package's server.js answers the page for a module: a rejection with a body as it is, any other as 404.
        const served = (module: (query: object, request: typeof notThrough) => Promise<{ status: number; body: unknown }>) => vi.fn(async () => {
            const answer = await module({ key: 'qr-key', cookie: {} }, notThrough)
                .catch((rejected: any) => (rejected?.body ? rejected : { status: 404, body: { code: 404, data: null, msg: 'Not Found' } }));
            return Response.json(answer.body, { status: answer.status });
        });
        vi.stubGlobal('fetch', served(neteaseQrKey));
        expect(await thrown('start', () => omni.startLogin('netease'))).toMatchObject({ id: 'unreachable', httpStatus: 502 });
        // The check while the code waits: the local backend's 502 is a check that did not get through. The sign-in keeps
        // checking (transient); once it gives up, the case is the same.
        vi.stubGlobal('fetch', served(createLoginQrCheck(createNeteaseOption)));
        const check = await omni.checkLogin('netease', 'qr-key');
        expect(check).toMatchObject({ state: 'error', transient: true, failure: { httpStatus: 502, code: '502' } });
        expect(await answered(async () => check)).toMatchObject({ id: 'unreachable', httpStatus: 502 });
    });

    it('unknown: the key request is answered with no key, and the sign-in stops at the start', async () => {
        desktop(35001);
        const asked = answers({ code: 200, data: {} });
        vi.stubGlobal('fetch', asked);
        expect((await thrown('start', () => omni.startLogin('netease'))).id).toBe('unknown');
        // The picture for an empty key is not asked for.
        expect(asked).toHaveBeenCalledOnce();
    });

    it('refused: the check answers a code that is none of 800 to 803, with NetEase\'s words', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 8821, message: '需要行为验证码验证' }));
        expect(await answered(() => omni.checkLogin('netease', 'qr-key'))).toMatchObject({ id: 'refused', code: '8821', message: '需要行为验证码验证' });
    });

    it('unknown: an answer that cannot be read, and a check that answers neither code nor words', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
        expect((await thrown('start', () => omni.startLogin('netease'))).id).toBe('unknown');
        vi.stubGlobal('fetch', answers({}));
        expect((await answered(() => omni.checkLogin('netease', 'qr-key'))).id).toBe('unknown');
    });

    it('code-expired and expired-after-scan: the check answers 800', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 800, message: '二维码不存在或已过期' }));
        expect(await omni.checkLogin('netease', 'qr-key')).toEqual({ state: 'expired' });
        expect(waitedOut()).toBe('code-expired');
        expect(waitedOut(false, true)).toBe('expired-after-scan');
    });

    it('no-answer: a sign-in request that is not answered in 20 s (the key, the picture, the check)', async () => {
        vi.useFakeTimers();
        desktop(35001);
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        expect(await unanswered('start', () => omni.startLogin('netease'), asked)).toMatchObject({
            id: 'no-answer',
        });
        asked.mockImplementationOnce(async () => Response.json({ data: { unikey: 'qr-key' } }));
        expect((await unanswered('start', () => omni.startLogin('netease'), asked)).id).toBe('no-answer');
        expect(String(asked.mock.calls.at(-1)![0])).toContain('/login/qr/create');
        expect((await unanswered('check', () => omni.checkLogin('netease', 'qr-key'), asked)).id).toBe('no-answer');
    });

    it('times the request only: the wait for the local service is not counted, and no other request is timed', async () => {
        vi.useFakeTimers();
        // The local service takes 30 s to start, and then answers at once.
        const readyAt = Date.now() + 30_000;
        vi.stubGlobal('window', {
            electron: { getNeteasePort: async () => (Date.now() >= readyAt ? 35001 : null), getNeteaseApiStatus: async () => ({ status: 'starting' }) },
        });
        vi.stubGlobal('fetch', answers({ data: { unikey: 'qr-key', qrimg: 'qr.png' } }));
        const started = omni.startLogin('netease');
        await vi.advanceTimersByTimeAsync(31_000);
        await expect(started).resolves.toEqual({ key: 'qr-key', imageUrl: 'qr.png' });
        expect(vi.getTimerCount()).toBe(0);

        // Reading who is signed in is not a request a sign-in waits for: it is sent without a limit.
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        void neteaseApi.getLoginStatus().catch(() => { });
        await vi.advanceTimersByTimeAsync(0);
        expect(asked).toHaveBeenCalledTimes(1);
        expect(asked.mock.calls[0][1]?.signal).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('QQ Music', () => {
    const desktop = (port: number | null) => {
        resetQqTransportRuntimeCache();
        vi.stubGlobal('window', { electron: { getQqPort: async () => port } });
    };

    it('local-service-unavailable: the embedded backend has no port', async () => {
        desktop(null);
        expect((await thrown('start', () => omni.startLogin('qq', 'qq'))).id).toBe('local-service-unavailable');
    });

    it('unreachable: the request does not get through, or the backend answers 502', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', offline());
        expect((await thrown('start', () => omni.startLogin('qq', 'qq'))).id).toBe('unreachable');
        vi.stubGlobal('fetch', answers({ message: 'Bad Gateway' }, 502));
        expect(await thrown('check', () => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'unreachable', httpStatus: 502, errorCode: 'network' });
    });

    // qrLogin.js failBootstrap (start) and failSession (wait): no upstream code, and a wait it backs off for.
    it('unreachable, waiting for the backend: QQ was not reached at the start (502 with no QQ code), or was lost during the wait', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 502, message: 'Unable to start QR login', retryAfterMs: 30000 }, 502));
        const start = await thrown('start', () => omni.startLogin('qq', 'qq'));
        expect(start).toMatchObject({ id: 'unreachable', httpStatus: 502, retryAfterMs: 30000 });
        expect(loginCaseOf(start).action).toBe('wait-then-retry');
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', retryAfterMs: 30000 }));
        expect(await answered(() => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'unreachable', retryAfterMs: 30000 });
        // With QQ's code it is QQ that refused: retry later, as before.
        vi.stubGlobal('fetch', answers({ code: 502, message: 'Unable to start QR login', retryAfterMs: 30000, upstreamCode: 1000 }, 502));
        expect((await thrown('start', () => omni.startLogin('qq', 'qq'))).id).toBe('retry-later');
    });

    // qrLogin.js finalizeLogin: after the person confirmed, a failed credential exchange answers the same.
    it('retry-later: the login failed after this code was scanned, which may be the exchange and not the line', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 802, message: 'QR code scanned' }));
        expect(await omni.checkLogin('qq', 'scanned-key')).toEqual({ state: 'scanned' });
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', retryAfterMs: 30000 }));
        expect(await answered(() => omni.checkLogin('qq', 'scanned-key'))).toMatchObject({ id: 'retry-later', retryAfterMs: 30000 });
    });

    // qrLogin.js onQrEvent: a cancel on the phone (or a refusal in WeChat) ends the code and backs off.
    it('expired-after-scan, waiting for the backend: the code was given up on the phone', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR code expired', retryAfterMs: 30000 }));
        const state = await omni.checkLogin('qq', 'qr-key');
        expect(state).toEqual({ state: 'expired', failure: { retryAfterMs: 30000 } });
        // As the sign-in hook ends a code that ran out after a scan.
        const facts = loginFailureFacts({ step: 'wait', inBrowser: false, scanned: true }, { detail: state.state === 'expired' ? state.failure : undefined });
        expect(loginCaseOf(facts)).toMatchObject({ id: 'expired-after-scan', action: 'wait-then-retry' });
    });

    it('retry-later: 800 that carries an upstream code and a wait', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 50006, retryAfterMs: 31000 }));
        expect(await answered(() => omni.checkLogin('qq', 'qr-key'))).toMatchObject({
            id: 'retry-later', code: '800', message: 'QR login failed', upstreamCode: '50006', retryAfterMs: 31000,
        });
        // The upstream code alone is enough: no wait was given, and it is still not an expired code.
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 50006 }));
        expect((await answered(() => omni.checkLogin('qq', 'qr-key'))).id).toBe('retry-later');
    });

    // qq-music-api 3.3.3 loginHints.ts: a failure it recognises carries `failureHint` { key, message }.
    it('retry-later: 800 whose hint says there were too many sign-ins, with or without an upstream code', async () => {
        desktop(3300);
        const hint = { key: 'login.rate-limited', message: 'Too many login attempts. Wait a moment and try again.' };
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', failureStage: 'credential-exchange', failureHint: hint, retryAfterMs: 30000 }));
        expect(await answered(() => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'retry-later', retryAfterMs: 30000 });
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 104604, failureHint: hint }));
        expect((await answered(() => omni.checkLogin('qq', 'qr-key'))).id).toBe('retry-later');
    });

    it('refused: 800 whose hint says QQ rejected the sign-in, quoting the backend\'s words', async () => {
        desktop(3300);
        const message = 'words for login.rejected';
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 1000, failureHint: { key: 'login.rejected', message }, retryAfterMs: 30000 }));
        const failed = await answered(() => omni.checkLogin('qq', 'qr-key'));
        expect(failed).toMatchObject({ id: 'refused', code: '800', message, upstreamCode: '1000' });
        expect(loginCaseOf(failed).action).toBe('wait-then-retry');
        expect(failureNoteKey({ case: loginCaseOf(failed), facts: failed, at: 0 }, omni.getLoginTexts('qq')?.caseNotes)).toBe('login.noteRetryLater');
    });

    // The backend's words for these are English defaults it says a front end may replace by key
    // (qq-music-api 3.3.3 loginHints.ts): the window says in Folia's words what is wrong with the
    // account, never that trying again later helps, and quotes the answer's own message.
    it('refused: 800 whose hint names a problem with the account itself, said in Folia\'s words', async () => {
        desktop(3300);
        const NOTES: Record<string, string> = {
            'login.account-banned': 'home.loginCaseQqAccountBanned',
            'login.account-restricted': 'home.loginCaseQqAccountRestricted',
            'login.account-binding': 'home.loginCaseQqAccountBinding',
        };
        const locales = await Promise.all(['en', 'in', 'zh-CN'].map(name => import(`@/i18n/locales/${name}.ts`)));
        for (const [key, note] of Object.entries(NOTES)) {
            vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 1000, failureHint: { key, message: `words for ${key}` }, retryAfterMs: 30000 }));
            const failed = await answered(() => omni.checkLogin('qq', 'qr-key'));
            expect(failed, key).toMatchObject({ id: 'refused', code: '800', message: 'QR login failed', upstreamCode: '1000' });
            expect(failureNoteKey({ case: loginCaseOf(failed), facts: failed, at: 0 }, omni.getLoginTexts('qq')?.caseNotes), key).toBe(note);
            for (const locale of locales) expect(locale.default.home[note.split('.')[1]], note).toEqual(expect.any(String));
        }
        // A new code clears it: a refusal at another step does not carry the account's words.
        vi.stubGlobal('fetch', answers({ code: 200, data: { unikey: 'next-key', qrimg: 'data:image/png;base64,fixture' } }));
        await omni.startLogin('qq', 'qq');
        expect(omni.getLoginTexts('qq')?.caseNotes?.refused).toBeUndefined();
    });

    // Where Folia reaches the backend: the desktop app's embedded one, a same-origin serverless entry
    // (Vercel, Cloudflare) and a backend at an address of its own (Docker, Node). The window reads
    // the same answer the same way on each.
    const DEPLOYMENTS: Array<[string, () => void]> = [
        ['the desktop app', () => desktop(3300)],
        ['a serverless entry', () => {
            resetQqTransportRuntimeCache();
            vi.stubGlobal('window', {});
            vi.stubEnv('VITE_QQ_API_BASE', '/api/qq');
        }],
        ['a backend of its own', () => {
            resetQqTransportRuntimeCache();
            vi.stubGlobal('window', {});
            vi.stubEnv('VITE_QQ_API_BASE', 'https://qq-api.example.test');
        }],
    ];

    // qq-music-api 3.3.3 qrService.ts: the mobile QQ code exchanged over MQTT fails with 50006 and the
    // fallback check after it with 1000 when the QQ Music app scanned it.
    it.each(DEPLOYMENTS)('wrong-scan-app: the code of mobile QQ was scanned with the QQ Music app, on %s', async (_where, reach) => {
        reach();
        vi.stubGlobal('fetch', answers({
            code: 800, message: 'QR login failed', failureStage: 'credential-validation', upstreamCode: 1000,
            primaryFailure: { failureStage: 'credential-exchange', upstreamCode: 50006 }, fallbackAttempted: true,
            failureHint: { key: 'login.wrong-scan-app', message: 'If you scanned with the QQ Music app, choose QQ Music app login instead.' },
        }));
        const failed = await answered(() => omni.checkLogin('qq', 'qr-key'));
        // The window says what to do (QQ's caseNotes); the quote stays the backend's own sentence.
        expect(failed).toMatchObject({ id: 'wrong-scan-app', code: '800', message: 'QR login failed', upstreamCode: '1000' });
        expect(loginCaseOf(failed)).toMatchObject({ kind: 'C', action: 'refresh-code' });
    });

    // Any of the three apps may scan a code of the QQ Music app channel, so there a wrong app is not
    // what went wrong: the same answer reads as a refusal with no name, as it did before the hint.
    it('no wrong-scan-app for a code asked for on the QQ Music app channel', async () => {
        desktop(3300);
        const wrongApp = {
            code: 800, message: 'QR login failed', failureStage: 'credential-validation', upstreamCode: 1000,
            primaryFailure: { failureStage: 'credential-exchange', upstreamCode: 50006 }, fallbackAttempted: true,
            failureHint: { key: 'login.wrong-scan-app', message: 'If you scanned with the QQ Music app, choose QQ Music app login instead.' },
        };
        vi.stubGlobal('fetch', vi.fn(async (url: unknown) => Response.json(
            String(url).includes('/login/qr/key') ? { code: 200, data: { unikey: 'app-key' } }
                : String(url).includes('/login/qr/create') ? { code: 200, data: { qrimg: 'data:image/png;base64,fixture' } }
                    : wrongApp,
        )));
        await omni.startLogin('qq', 'qqmusic');
        expect(await answered(() => omni.checkLogin('qq', 'app-key'))).toMatchObject({ id: 'retry-later', code: '800', upstreamCode: '1000' });
        // Another code than the one asked for on that channel keeps the hint.
        expect((await answered(() => omni.checkLogin('qq', 'qr-key'))).id).toBe('wrong-scan-app');
    });

    // The shapes qq-music-api gives for a full device list, by channel and by how the code was read.
    const hint = { key: 'login.device-limit', message: 'This account has reached its login device limit.' };
    const DEVICE_LIMITS: Array<[string, Record<string, unknown>]> = [
        // WeChat: the exchange itself answers 20279 (every deployment).
        ['wechat', { code: 800, message: 'QR login failed', failureStage: 'credential-exchange', failureReason: 'upstream-rejected', upstreamCode: 20279, upstreamErrorKey: 'auth.device-limit', failureHint: hint }],
        // Mobile QQ and the QQ Music app over MQTT (desktop, Docker, Node, Cloudflare with a Durable
        // Object): the fallback check answers last, the exchange's 20279 is in primaryFailure.
        ['qq over MQTT', { code: 800, message: 'QR login failed', failureStage: 'credential-validation', failureReason: 'upstream-rejected', upstreamCode: 1000, primaryFailure: { failureStage: 'credential-exchange', upstreamCode: 20279, upstreamErrorKey: 'auth.device-limit' }, fallbackAttempted: true, failureHint: hint }],
        ['qqmusic over MQTT', { code: 800, message: 'QR login failed', failureStage: 'credential-validation', failureReason: 'upstream-rejected', upstreamCode: 1000, primaryFailure: { failureStage: 'credential-exchange', upstreamCode: 20279, upstreamErrorKey: 'auth.device-limit' }, fallbackAttempted: true, failureHint: hint }],
        // Mobile QQ by the web sign-in (Vercel, Cloudflare without one): 20279 on top, no error key.
        ['qq by the web sign-in', { code: 800, message: 'QR login failed', failureStage: 'credential-exchange', failureReason: 'upstream-rejected', upstreamCode: 20279, failureHint: hint, retryAfterMs: 15000 }],
        // A hint alone is enough.
        ['the hint alone', { code: 800, message: 'QR login failed', failureStage: 'credential-exchange', failureHint: hint, retryAfterMs: 15000 }],
    ];

    it.each(DEPLOYMENTS)('device-limit: for every channel, on %s', async (_where, reach) => {
        reach();
        for (const [channel, shape] of DEVICE_LIMITS) {
            vi.stubGlobal('fetch', answers(shape));
            expect((await answered(() => omni.checkLogin('qq', 'qr-key'))).id, channel).toBe('device-limit');
        }
    });

    it('keeps the device limit ahead of the hint, and reads an unknown hint as if there were none', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 20279, failureHint: { key: 'login.device-limit', message: 'full' } }));
        expect((await answered(() => omni.checkLogin('qq', 'qr-key'))).id).toBe('device-limit');
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR login failed', upstreamCode: 50006, failureHint: { key: 'login.something-new', message: 'new' } }));
        expect(await answered(() => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'retry-later', message: 'QR login failed' });
        // A plain expired code carries no hint and stays expired.
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR code expired', failureReason: 'qr-timeout', failureStage: 'polling' }));
        expect(await omni.checkLogin('qq', 'qr-key')).toEqual({ state: 'expired' });
    });

    it('retry-later: the backend answers 429, with the wait its answer names or with none', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ message: 'QR login is temporarily backed off', retryAfterMs: 31000 }, 429));
        expect(await thrown('start', () => omni.startLogin('qq', 'qq'))).toMatchObject({ id: 'retry-later', httpStatus: 429, retryAfterMs: 31000 });
        vi.stubGlobal('fetch', answers({}, 429));
        const bare = await thrown('check', () => omni.checkLogin('qq', 'qr-key'));
        expect(bare).toMatchObject({ id: 'retry-later', httpStatus: 429 });
        expect(bare).not.toHaveProperty('retryAfterMs');
    });

    it('refused: the backend was reached and answers another 4xx', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ message: 'Bad Request' }, 400));
        // The transport calls every such answer 'network'; the status says it is not "cannot reach".
        expect(await thrown('check', () => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'refused', httpStatus: 400, errorCode: 'network' });
        vi.stubGlobal('fetch', answers({}, 403));
        expect((await thrown('start', () => omni.startLogin('qq', 'qq'))).id).toBe('refused');
    });

    it('code-expired: a plain 800', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ code: 800, message: 'QR code expired' }));
        expect(await omni.checkLogin('qq', 'qr-key')).toEqual({ state: 'expired' });
        expect(waitedOut()).toBe('code-expired');
    });

    it('refused: another code, with the backend\'s words', async () => {
        desktop(3300);
        // Which other codes the backend answers is not in this repository; the fields are the ones read.
        vi.stubGlobal('fetch', answers({ code: 500, message: 'QR login failed' }));
        expect(await answered(() => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'refused', code: '500', message: 'QR login failed' });
    });

    it('unknown: a backend without the route, and an answer that cannot be read', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({}, 404));
        expect(await thrown('check', () => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'unknown', errorCode: 'unsupported' });
        vi.stubGlobal('fetch', vi.fn(async () => new Response('not json')));
        expect(await thrown('check', () => omni.checkLogin('qq', 'qr-key'))).toMatchObject({ id: 'unknown', errorCode: 'invalid-response' });
    });

    it('no-answer: a sign-in request that is not answered in 20 s (the key, the picture, the check); no other request is timed', async () => {
        vi.useFakeTimers();
        desktop(3300);
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        expect((await unanswered('start', () => omni.startLogin('qq', 'qq'), asked)).id).toBe('no-answer');
        asked.mockImplementationOnce(async () => Response.json({ data: { unikey: 'qr-key' } }));
        expect((await unanswered('start', () => omni.startLogin('qq', 'qq'), asked)).id).toBe('no-answer');
        expect(String(asked.mock.calls.at(-1)![0])).toContain('/login/qr/create');
        expect((await unanswered('check', () => omni.checkLogin('qq', 'qr-key'), asked)).id).toBe('no-answer');

        asked.mockClear();
        void requestQq('login_status').catch(() => { });
        await vi.advanceTimersByTimeAsync(0);
        expect(asked).toHaveBeenCalledTimes(1);
        expect(asked.mock.calls[0][1]?.signal).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('KuGou', () => {
    // What the desktop app's request rejects with: the bridge's one line, behind Electron's prefix.
    const rejection = (operation: string, answer: unknown) => new Error(
        `Error invoking remote method 'kugou-api-request': KuGouApiError: ${normalizeBridgeError(operation, answer).message}`,
    );
    const desktop = (kugouRequest: (...args: unknown[]) => unknown) => vi.stubGlobal('window', { electron: { kugouRequest } });
    const web = () => {
        vi.stubGlobal('window', undefined);
        vi.stubEnv('VITE_KUGOU_API_BASE', 'https://kugou.example.test');
    };

    it('local-service-unavailable: the desktop side could not load KuGouMusicApi', async () => {
        // The real bridge, with a package that does not load; no OS encryption, so the session stays in memory.
        const values = new Map<string, unknown>();
        const bridge = createKugouApiBridge({
            store: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) },
            safeStorage: { isEncryptionAvailable: () => false },
            warn: () => { },
            apiLoader: () => { throw new Error("Cannot find module 'kugoumusicapi'"); },
        });
        // Electron carries only the error's sentence across, behind its prefix.
        desktop(vi.fn((operation: unknown) => bridge.request(operation, {}).catch((error: Error) => {
            throw new Error(`Error invoking remote method 'kugou-api-request': KuGouApiError: ${error.message}`);
        })));
        expect((await thrown('start', () => omni.startLogin('kugou'))).id).toBe('local-service-unavailable');
    });

    it('unreachable: KuGouMusicApi fails with no error code of KuGou\'s (desktop), the request does not get through or is answered 502 (web)', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('login_qr_key', { status: 502, body: { msg: 'connect ETIMEDOUT' } })));
        expect(await thrown('start', () => omni.startLogin('kugou'))).toMatchObject({ id: 'unreachable', httpStatus: 502, errorCode: 'network' });
        web();
        vi.stubGlobal('fetch', offline());
        expect((await thrown('start', () => omni.startLogin('kugou'))).id).toBe('unreachable');
        vi.stubGlobal('fetch', answers({}, 502));
        expect(await thrown('check', () => omni.checkLogin('kugou', 'qr-key'))).toMatchObject({ id: 'unreachable', httpStatus: 502 });
    });

    it('refused: KuGou answers with an error code of its own (desktop), or the check answers a status that is none of 0 to 4', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('login_qr_check', { status: 502, body: { error_code: 20028, msg: '本次请求需要验证' } })));
        expect(await thrown('check', () => omni.checkLogin('kugou', 'qr-key'))).toMatchObject({
            id: 'refused', code: '20028', message: '本次请求需要验证', httpStatus: 502,
        });
        // Which other statuses KuGou answers is not in this repository; the fields are the ones read.
        desktop(vi.fn().mockResolvedValue({ data: { status: 9, msg: '二维码状态异常' } }));
        expect(await answered(() => omni.checkLogin('kugou', 'qr-key'))).toMatchObject({ id: 'refused', code: '9', message: '二维码状态异常' });
    });

    it('refused: KuGouMusicApi answers a 4xx without an error code (desktop and web)', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('login_qr_key', { status: 400, body: { msg: 'bad request' } })));
        expect(await thrown('start', () => omni.startLogin('kugou'))).toMatchObject({ id: 'refused', httpStatus: 400, message: 'bad request' });
        web();
        vi.stubGlobal('fetch', answers({}, 400));
        expect(await thrown('check', () => omni.checkLogin('kugou', 'qr-key'))).toMatchObject({ id: 'refused', httpStatus: 400 });
    });

    it('unknown: the desktop side fails before KuGou is asked, and a check that answers no status', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('login_qr_key', new Error('KuGou device registration did not return a dfid'))));
        // The transport calls this one 'network' too; the adapter says it is not KuGou that failed to answer.
        expect(await thrown('start', () => omni.startLogin('kugou'))).toMatchObject({ id: 'unknown', errorCode: 'network' });
        // The main process's own error text travels in the thrown error's sentence (a file path
        // with the user's folder, here). Nothing of it is in a fact.
        const fileError = Object.assign(new Error("EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\folia\\config.json'"), { code: 'EPERM' });
        desktop(vi.fn().mockRejectedValue(rejection('login_qr_check', fileError)));
        expect(await thrown('check', () => omni.checkLogin('kugou', 'qr-key'))).toEqual({
            step: 'check', inBrowser: false, scanned: false, case: 'unknown', errorCode: 'network', id: 'unknown',
        });
        desktop(vi.fn().mockResolvedValue({ data: {} }));
        expect((await answered(() => omni.checkLogin('kugou', 'qr-key'))).id).toBe('unknown');
    });

    it('code-expired: status 0', async () => {
        desktop(vi.fn().mockResolvedValue({ data: { status: 0 } }));
        expect(await omni.checkLogin('kugou', 'qr-key')).toEqual({ state: 'expired' });
        expect(waitedOut()).toBe('code-expired');
    });

    it('no-answer: a sign-in request that is not answered in 20 s (web: the key, the picture; desktop: the check); no other request is timed', async () => {
        vi.useFakeTimers();
        web();
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        expect((await unanswered('start', () => omni.startLogin('kugou'), asked)).id).toBe('no-answer');
        asked.mockImplementationOnce(async () => Response.json({ data: { qrcode: 'qr-key' } }));
        expect((await unanswered('start', () => omni.startLogin('kugou'), asked)).id).toBe('no-answer');
        expect(String(asked.mock.calls.at(-1)![0])).toContain('/login/qr/create');

        asked.mockClear();
        void requestKugou('user_detail').catch(() => { });
        await vi.advanceTimersByTimeAsync(0);
        expect(asked).toHaveBeenCalledTimes(1);
        expect(asked.mock.calls[0][1]?.signal).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);

        // The desktop app: the request goes to the desktop side, which cannot be told to stop.
        const kugouRequest = vi.fn(() => new Promise(() => { }));
        desktop(kugouRequest);
        expect((await unanswered('check', () => omni.checkLogin('kugou', 'qr-key'))).id).toBe('no-answer');
        void requestKugou('user_detail').catch(() => { });
        expect(kugouRequest).toHaveBeenLastCalledWith('user_detail', {});
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('Bodian', () => {
    // The real package, as the desktop side runs it, over a stand-in for the network.
    const desktop = (respond: () => unknown) => {
        const api = createBodianApi({ deviceId: 'a'.repeat(32), requestFactory: createWire(respond).factory });
        vi.stubGlobal('window', { electron: { bodianRequest: api.request } });
    };

    it('unreachable: the request fails, or is answered 502', async () => {
        desktop(() => { throw new Error('socket hang up'); });
        expect(await thrown('start', () => omni.startLogin('bodian'))).toMatchObject({ id: 'unreachable', errorCode: 'network' });
        desktop(() => ({ httpStatus: 502 }));
        expect(await thrown('start', () => omni.startLogin('bodian'))).toMatchObject({ id: 'unreachable' });
    });

    it('unknown: Bodian answers a code of its own, which the package tells in a sentence only', async () => {
        desktop(() => ({ code: 500, msg: 'fail' }));
        expect(await thrown('start', () => omni.startLogin('bodian'))).toMatchObject({
            id: 'unknown', errorCode: 'invalid-response',
        });
    });
});

describe('YouTube Music', () => {
    // The desktop side's answers, by operation.
    const desktop = (byOperation: Record<string, unknown>) => vi.stubGlobal('window', {
        electron: { ytmRequest: async (operation: string) => byOperation[operation] ?? { ok: true, data: {} } },
    });
    // The case a check ends in once the sign-in has begun and the desktop side answers `state`.
    const checked = async (state: unknown) => {
        const byOperation: Record<string, unknown> = {};
        desktop(byOperation);
        const { key } = await omni.startLogin('ytm');
        byOperation.web_login_check = { ok: true, data: state };
        return answered(() => omni.checkLogin('ytm', key), true);
    };
    // An error state as the desktop side answers it for a failure (electron/ytm/webSignIn.cjs).
    const failed = (error: unknown) => ({ state: 'error', ...ytmErrorResult(error).error });

    it('no-browser: none of the browsers it opens is installed', async () => {
        desktop({ web_login_start: { ok: false, error: { code: 'unsupported', message: 'No browser for the YouTube Music sign-in was found', reason: 'no-browser' } } });
        expect(await thrown('start', () => omni.startLogin('ytm'), true)).toMatchObject({ id: 'no-browser', mainCode: 'no-browser' });
    });

    it('browser-still-open: the folder of an earlier sign-in is still held', async () => {
        desktop({ web_login_start: { ok: false, error: {
            code: 'unavailable', message: 'The folder of an earlier YouTube Music sign-in could not be removed; a browser may still be open on it', reason: 'folder-in-use',
        } } });
        expect(await thrown('start', () => omni.startLogin('ytm'), true)).toMatchObject({ id: 'browser-still-open', mainCode: 'folder-in-use' });
    });

    it('browser-closed-early: the browser ended at once', async () => {
        expect(await checked(failed(new BrowserSignInError('exited')))).toMatchObject({ id: 'browser-closed-early', mainCode: 'exited' });
    });

    it.each(['not-started', 'timeout', 'protocol'])('browser-unread: the cookies could not be read (%s)', async code => {
        expect(await checked(failed(new BrowserSignInError(code)))).toMatchObject({ id: 'browser-unread', mainCode: code });
    });

    it('refused: YouTube Music did not take the sign-in', async () => {
        expect(await checked({ state: 'error', code: 'unavailable', message: 'YouTube Music did not take the sign-in', reason: 'not-taken' }))
            .toMatchObject({ id: 'refused', mainCode: 'not-taken' });
    });

    it('account-not-read: it took the sign-in and named no account', async () => {
        expect(await checked({ state: 'error', code: 'invalid-response', message: 'YouTube Music account is missing', reason: 'account-missing' }))
            .toMatchObject({ id: 'account-not-read', mainCode: 'account-missing' });
    });

    it('unreachable: YouTube Music could not be reached after the browser closed, or the desktop side did not answer', async () => {
        expect((await checked(failed(new Error('fetch failed')))).id).toBe('unreachable');
        vi.stubGlobal('window', { electron: { ytmRequest: async () => { throw new Error('ipc'); } } });
        expect(await thrown('start', () => omni.startLogin('ytm'), true)).toMatchObject({ id: 'unreachable' });
    });

    it('retry-later: YouTube answered 429 when it was asked who signed in, which is not a network that fails', async () => {
        expect(await checked(failed(new Error('Request failed with status code 429')))).toMatchObject({ id: 'retry-later', httpStatus: 429 });
    });

    it('unknown: a failure the desktop side has no word for', async () => {
        expect(await checked(failed(new Error('something else')))).toMatchObject({ id: 'unknown' });
    });

    it('browser-unfinished: the window was closed without a sign-in', async () => {
        const byOperation: Record<string, unknown> = { web_login_check: { ok: true, data: { state: 'expired' } } };
        desktop(byOperation);
        const { key } = await omni.startLogin('ytm');
        expect(await omni.checkLogin('ytm', key)).toEqual({ state: 'expired' });
        expect(waitedOut(true)).toBe('browser-unfinished');
    });
});

describe('every platform', () => {
    it('hands on the error of a failed step as it is when the platform\'s own account of it throws', async () => {
        const auth = getOnlineMusicProvider('netease')!.auth!;
        vi.spyOn(auth, 'describeLoginFailure').mockImplementation(() => { throw new Error('the describing itself failed'); });
        const failed = new Error('the key was not made');
        vi.spyOn(auth, 'startLogin').mockRejectedValue(failed);
        await expect(omni.startLogin('netease')).rejects.toBe(failed);
        expect(loginFailureFacts({ step: 'start', inBrowser: false, scanned: false }, { error: failed })).toEqual({ step: 'start', inBrowser: false, scanned: false });
    });

    it('account-not-read: the sign-in was confirmed and the account then not read', () => {
        expect(loginCaseOf(loginFailureFacts({ step: 'account', inBrowser: false, scanned: true })).id).toBe('account-not-read');
    });
});
