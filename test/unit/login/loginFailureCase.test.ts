import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { LoginFailureDetail, LoginStep } from '@/types/onlineMusic';
import { LOGIN_CASE_IDS, loginCaseOf, loginFailureFacts, noteLoginFailure } from '@/services/onlineMusic/login/loginFailureCase';
import { LoginRequestTimeout } from '@/services/onlineMusic/login/loginRequestLimit';

// test/unit/login/loginFailureCase.test.ts
// The shared half of "why did the sign-in fail": the table of cases, the rules that sort facts no
// platform named a case for, what is kept out of a fact, and that the file knows no platform.
// What each platform's own errors sort to is in test/unit/onlineMusic/loginFailurePlatforms.test.ts and
// test/unit/spotify/spotifyLoginFailure.test.ts.

const facts = (step: LoginStep, detail?: LoginFailureDetail, extra: { inBrowser?: boolean; scanned?: boolean; error?: unknown } = {}) => (
    loginFailureFacts({ step, inBrowser: extra.inBrowser ?? false, scanned: extra.scanned ?? false }, { detail, error: extra.error })
);
const sorted = (...args: Parameters<typeof facts>) => loginCaseOf(facts(...args));

describe('the table of sign-in cases', () => {
    // The maker's table (u5-signin, THE KINDS): kind, action and whether 详情 is offered. "retry"
    // there is a new code for a QR sign-in, and signing in again for one made in the browser.
    it('gives every case its kind, its action and whether it has details', () => {
        const table = Object.fromEntries(LOGIN_CASE_IDS.map(id => {
            const { kind, action, details } = loginCaseOf(facts('check', { case: id }));
            const inBrowser = loginCaseOf(facts('check', { case: id }, { inBrowser: true })).action;
            return [id, `${kind} ${action}${inBrowser === action ? '' : `|${inBrowser}`} ${details ? 'details' : 'none'}`];
        }));
        expect(table).toEqual({
            'code-expired': 'A refresh-code none',
            'expired-after-scan': 'A refresh-code details',
            'browser-unfinished': 'A sign-in-again none',
            'not-authorized': 'A sign-in-again details',
            unreachable: 'B refresh-code|sign-in-again details',
            'no-answer': 'B refresh-code|sign-in-again details',
            refused: 'C refresh-code|sign-in-again details',
            'retry-later': 'C wait-then-retry details',
            'device-limit': 'C refresh-code|sign-in-again details',
            'wrong-scan-app': 'C refresh-code|sign-in-again details',
            'local-service-stopped': 'D restart-service details',
            'local-service-unavailable': 'D refresh-code|sign-in-again details',
            'cannot-listen': 'D refresh-code|sign-in-again details',
            'no-browser': 'E refresh-code|sign-in-again details',
            'browser-still-open': 'E refresh-code|sign-in-again details',
            'browser-closed-early': 'E refresh-code|sign-in-again details',
            'browser-unread': 'E refresh-code|sign-in-again details',
            'browser-not-opened': 'E reopen-browser details',
            'account-not-read': 'F refresh-code|sign-in-again details',
            unknown: 'G refresh-code|sign-in-again details',
        });
    });
});

describe('sorting facts no platform named a case for', () => {
    it('code-expired, expired-after-scan, browser-unfinished: a sign-in that ran out while waiting, by how it is made and whether the code was scanned', () => {
        expect(sorted('wait').id).toBe('code-expired');
        expect(sorted('wait', {}, { scanned: true }).id).toBe('expired-after-scan');
        expect(sorted('wait', {}, { inBrowser: true }).id).toBe('browser-unfinished');
    });

    it('browser-not-opened and account-not-read: by the step alone, whatever the error says', () => {
        expect(sorted('open', {}, { inBrowser: true, error: new OnlineProviderError('network', 'x') })).toMatchObject({ id: 'browser-not-opened', action: 'reopen-browser' });
        expect(sorted('account').id).toBe('account-not-read');
    });

    it('retry-later: the platform asked for a wait', () => {
        expect(sorted('check', { retryAfterMs: 0, message: 'slow down' })).toMatchObject({ id: 'retry-later', action: 'wait-then-retry' });
    });

    it('unreachable: an HTTP status of 5xx, or an error of the shared code "network" that came with no status', () => {
        expect(sorted('start', {}, { error: new OnlineProviderError('network', 'desktop request failed') }).id).toBe('unreachable');
        expect(sorted('check', { httpStatus: 502 }).id).toBe('unreachable');
        expect(sorted('check', { httpStatus: 599 }, { error: new OnlineProviderError('auth-required', 'x') }).id).toBe('unreachable');
    });

    // The rules about an HTTP status, in their order. A transport may call every non-2xx
    // 'network': the status decides, not that word.
    it('sorts by the HTTP status before the shared code: 429 waits, 5xx is unreachable, any other 4xx is a refusal', () => {
        const network = () => new OnlineProviderError('network', 'request failed: N');
        expect(sorted('check', { httpStatus: 429 })).toMatchObject({ id: 'retry-later', action: 'wait-then-retry' });
        expect(sorted('check', { httpStatus: 429, message: 'too many requests' }, { error: network() }).id).toBe('retry-later');
        for (const httpStatus of [400, 401, 403, 404, 408, 499]) {
            expect(sorted('check', { httpStatus }).id, String(httpStatus)).toBe('refused');
            expect(sorted('start', { httpStatus }, { error: network() }).id, String(httpStatus)).toBe('refused');
        }
        // An answer with a status that is no failure of HTTP is not "cannot reach" either.
        expect(sorted('check', { httpStatus: 200 }, { error: network() }).id).toBe('unknown');
        expect(sorted('check', { httpStatus: 200, message: 'no' }, { error: network() }).id).toBe('refused');
    });

    it('lets a wait the platform asked for win over "unreachable"', () => {
        expect(sorted('check', { retryAfterMs: 5000, httpStatus: 503 }).id).toBe('retry-later');
        expect(sorted('check', { retryAfterMs: 5000 }, { error: new OnlineProviderError('network', 'x') }).id).toBe('retry-later');
        // A wait that is no time at all is no wait.
        expect(facts('check', { retryAfterMs: Infinity, httpStatus: 503 })).toEqual({ step: 'check', inBrowser: false, scanned: false, httpStatus: 503 });
        expect(facts('check', { retryAfterMs: -1 })).not.toHaveProperty('retryAfterMs');
    });

    it('unknown: a case no table knows, whoever named it', () => {
        const made = facts('check', { case: 'made-up' as never, code: '7' });
        expect(made.case).toBe('unknown');
        expect(loginCaseOf(made)).toEqual({ id: 'unknown', kind: 'G', action: 'refresh-code', details: true });
        expect(loginCaseOf(facts('check', { case: 'constructor' as never }))).toMatchObject({ id: 'unknown', kind: 'G' });
    });

    it('refused: the platform said something, a code or words', () => {
        expect(sorted('check', { code: '8821' }).id).toBe('refused');
        expect(sorted('check', { message: 'no' }).id).toBe('refused');
    });

    it('unknown: nothing to go by, also for an error of another shared code and for a sentence nobody vouched for', () => {
        expect(sorted('start').id).toBe('unknown');
        expect(sorted('check', {}, { error: new OnlineProviderError('invalid-response', 'operation failed') }).id).toBe('unknown');
        expect(sorted('check', {}, { error: 'sign-in-failed' }).id).toBe('unknown');
    });

    it('no-answer: a request that ran into the sign-in\'s time limit, unless the platform named a case for it', () => {
        expect(sorted('start', undefined, { error: new LoginRequestTimeout() })).toMatchObject({ id: 'no-answer', kind: 'B', action: 'refresh-code' });
        expect(sorted('check', undefined, { inBrowser: true, error: new LoginRequestTimeout() })).toMatchObject({ id: 'no-answer', action: 'sign-in-again' });
        const named = new LoginRequestTimeout();
        noteLoginFailure(named, { case: 'local-service-unavailable' });
        expect(sorted('start', undefined, { error: named }).id).toBe('local-service-unavailable');
    });

    it('takes the case a platform names over every rule', () => {
        expect(sorted('wait', { case: 'refused', httpStatus: 502, retryAfterMs: 5 }, { error: new OnlineProviderError('network', 'x') }).id).toBe('refused');
    });

    it('reads what a provider said of a thrown error from the error itself, and only from that one', () => {
        const error = new Error('boom');
        noteLoginFailure(error, { case: 'no-browser', mainCode: 'no-browser' });
        noteLoginFailure('a string cannot carry it', { case: 'refused' });
        noteLoginFailure(new Error('boom'), null);
        expect(facts('start', undefined, { inBrowser: true, error })).toEqual({
            step: 'start', inBrowser: true, scanned: false, case: 'no-browser', mainCode: 'no-browser',
        });
        expect(facts('start', undefined, { error: new Error('boom') })).toEqual({ step: 'start', inBrowser: false, scanned: false });
    });
});

describe('what a fact may hold', () => {
    // The facts are shown in the sign-in window and copied into a report. A thrown error's own
    // sentence is Folia's or a library's, not the platform's words: it reaches no fact, whatever it
    // says, and goes into the timeline instead (describeLoginError).
    it('takes nothing of the sentence of a thrown error, nor of the sentence of an error state', () => {
        const sentences = [
            "KuGou request failed (operation=login_qr_check): EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\folia\\config.json'",
            'connect ETIMEDOUT 2408:8756:f50:10:3::1f:443',
            'getaddrinfo ENOTFOUND interface.music.example.test',
            'uid 123456 is banned',
            'plain words',
        ];
        for (const sentence of sentences) {
            const thrown = facts('check', undefined, { error: new OnlineProviderError('network', sentence, 'kugou', new Error(sentence)) });
            expect(thrown).toEqual({ step: 'check', inBrowser: false, scanned: false, errorCode: 'network' });
            expect(facts('check', undefined, { error: new Error(sentence) })).toEqual({ step: 'check', inBrowser: false, scanned: false });
            expect(facts('check', undefined, { error: sentence })).toEqual({ step: 'check', inBrowser: false, scanned: false });
        }
    });

    it('keeps the words a platform said and every code it gave as they are', () => {
        expect(facts('check', { message: '当前登录环境异常，请稍后再试' }).message).toBe('当前登录环境异常，请稍后再试');
        expect(facts('check', { message: 'uin 2873651094 at 203.0.113.7' }).message).toBe('uin 2873651094 at 203.0.113.7');
        expect(facts('check', { message: '' }).message).toBeUndefined();
        const coded = facts('check', { code: '800', upstreamCode: '50006', mainCode: 'exited 1' });
        expect(coded).toEqual({ step: 'check', inBrowser: false, scanned: false, code: '800', upstreamCode: '50006', mainCode: 'exited 1' });
        // A mod may hand a number where a string belongs.
        expect(facts('check', { code: 800 as never }).code).toBe('800');
    });

    // The shared code of a thrown error is one of a few fixed words. An error a mod built may hold
    // anything there: a string or a number is kept, anything else is not.
    it('keeps the shared code of a thrown error when it is a string or a number', () => {
        const withCode = (code: unknown) => facts('check', undefined, { error: new OnlineProviderError(code as 'network', 'x') }).errorCode;
        expect(withCode('auth-required')).toBe('auth-required');
        expect(withCode('a code a mod made up')).toBe('a code a mod made up');
        expect(withCode(42)).toBe('42');
        expect(withCode({ code: 'x' })).toBeUndefined();
    });
});

describe('the shared files know no platform', () => {
    // One platform's rule stays with the platform: what a platform's own code means is said in
    // its folder. A platform id or an import of an adapter in a shared file is a rule that left.
    it('name no built-in platform and import nothing from a platform', async () => {
        const ids = listOnlineMusicProviders().map(provider => provider.id);
        expect(ids.length).toBeGreaterThanOrEqual(6);
        const imports: string[] = [];
        for (const file of ['src/services/onlineMusic/login/loginFailureCase.ts', 'src/services/onlineMusic/login/loginRequestLimit.ts', 'src/utils/errorText.ts']) {
            const source = await readFile(file, 'utf8');
            const named = ids.filter(id => new RegExp(`(?<![A-Za-z])${id}(?![a-z])`, 'i').test(source));
            expect(named, file).toEqual([]);
            expect(source, file).not.toMatch(/网易|酷狗|波点|QQ|Spotify|YouTube/i);
            imports.push(...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]));
        }
        expect(imports.length).toBeGreaterThan(0);
        expect(imports.filter(path => /services|onlineMusic\/[a-z]+\//i.test(path))).toEqual([]);
    });

    it('sorts the failures of a platform it has never heard of, by what that platform hands over', () => {
        // A seventh platform: its adapter names the case for its own code, or hands over shared facts.
        const describeSeventh = (error: unknown): LoginFailureDetail | null => (
            error instanceof Error && error.message === 'E_SEVENTH_QUOTA' ? { case: 'retry-later', code: 'E_SEVENTH_QUOTA', retryAfterMs: 60_000 } : null
        );
        const quota = new Error('E_SEVENTH_QUOTA');
        noteLoginFailure(quota, describeSeventh(quota));
        expect(loginCaseOf(facts('start', undefined, { error: quota }))).toEqual({ id: 'retry-later', kind: 'C', action: 'wait-then-retry', details: true });
        expect(sorted('check', { code: '42', message: 'seventh says no' }).id).toBe('refused');
        expect(sorted('check', { httpStatus: 503 }).id).toBe('unreachable');
    });
});
