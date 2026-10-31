import { describe, expect, it } from 'vitest';
import { LOGIN_CASE_TEXTS, LOGIN_KIND_TEXTS, loginStepText } from '@/components/login/window/loginCaseTexts';
import {
    accountView, failureNoteKey, failureQuote, filterRows, loginScene, rowLeadsTo, sceneHeadline, stepMarks,
} from '@/components/login/window/loginView';
import { accountPictureSrc } from '@/components/login/PlatformMark';
import { orderRows, pillNameUnfolds, pillProvider, pillSeenNext, rowStatus, type PillSeen } from '@/components/login/platformRows';
import { resolvePlatformMark } from '@/components/login/resolvePlatformMark';
import en from '@/i18n/locales/en';
import id from '@/i18n/locales/in';
import zh from '@/i18n/locales/zh-CN';
import { retryOpensAt, retryWaitEndsAt, secondsLeft } from '@/library/core/account/accountRules';
import { omni } from '@/services/onlineMusic/omni';
import { LOGIN_CASE_IDS, loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';
import type { LoginFailure } from '@/types/loginFailure';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import type { LoginFailureDetail, LoginStep, ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/login/loginView.test.ts
// What the sign-in window decides by rule and a person cannot check by looking once: the order of
// the platform column, what a chosen row leads to, which picture and headline a state gets, where
// the step marks stand, when a wait ends, and that every text it can ask for exists in the three
// languages. The window's parts only draw what these rules answer.

const row = (providerId: string, extra: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId, shortName: providerId, displayName: `${providerId} music`, availability: { configured: true },
    status: 'anonymous', user: null, collections: [], ...extra,
});
const signedIn = { status: 'authenticated' as const, user: { id: 1, nickname: 'someone' } };
const ranOut = { error: 'auth-required' };
const off = { availability: { configured: false, reason: 'not-configured' as const } };

describe('the platform column', () => {
    it('tells the state of a row: signed in, ran out, signed out, no account needed, out of reach', () => {
        expect(rowStatus(row('a', signedIn))).toBe('signed-in');
        expect(rowStatus(row('a', ranOut))).toBe('ran-out');
        expect(rowStatus(row('a'))).toBe('signed-out');
        expect(rowStatus(row('a', { requiresAccount: false }))).toBe('accountless');
        // Out of reach wins over everything: such a row cannot be chosen, whoever was signed in there.
        expect(rowStatus(row('a', { ...signedIn, ...off }))).toBe('off');
    });

    it('orders the rows: the platform in use, the signed-in ones, the ones that ran out, the rest as registered', () => {
        const rows = [row('a'), row('b', ranOut), row('c', signedIn), row('d'), row('e', signedIn), row('f', off), row('g', { requiresAccount: false })];
        expect(orderRows(rows, 'd').map(entry => entry.providerId)).toEqual(['d', 'c', 'e', 'b', 'a', 'f', 'g']);
        expect(orderRows(rows, null).map(entry => entry.providerId)).toEqual(['c', 'e', 'b', 'a', 'd', 'f', 'g']);
        // The platform in use comes first also when it is signed in, and is not listed twice.
        expect(orderRows(rows, 'e').map(entry => entry.providerId)).toEqual(['e', 'c', 'b', 'a', 'd', 'f', 'g']);
    });

    it('leaves out a platform this runtime cannot use at all, and keeps one that is only not configured', () => {
        const rows = [row('a'), row('b', { availability: { configured: false, reason: 'runtime-unavailable' } }), row('c', off)];
        expect(orderRows(rows, 'b').map(entry => entry.providerId)).toEqual(['a', 'c']);
    });

    it('filters by a piece of the short or the long name, whatever the case', () => {
        const rows = [row('alpha'), row('beta', { displayName: 'Second Service' }), row('gamma')];
        expect(filterRows(rows, ' SERV ').map(entry => entry.providerId)).toEqual(['beta']);
        expect(filterRows(rows, 'a').map(entry => entry.providerId)).toEqual(['alpha', 'beta', 'gamma']);
        expect(filterRows(rows, '  ')).toHaveLength(3);
        expect(filterRows(rows, 'none')).toEqual([]);
    });
});

// Rules the old switcher and the old row of badges had tests for; the parts are gone, the rules stay.
describe('the switcher pill and an account\'s picture', () => {
    it('shows the platform in use, and the first listed one when that platform cannot be used in this runtime', () => {
        const unusable = { availability: { configured: false, reason: 'runtime-unavailable' as const } };
        const rows = [row('a', unusable), row('b'), row('c', off)];
        expect(pillProvider(rows, 'b')?.providerId).toBe('b');
        expect(pillProvider(rows, 'a')?.providerId).toBe('b');
        expect(pillProvider([row('a', unusable)], 'a')).toBeNull();
    });

    // A click on the pill opens the window on the platform it shows, and a row that is out of
    // reach cannot be chosen there: so the pill shows such a platform only when no other is listed.
    it('never shows a platform that cannot be chosen while one that can is listed: a signed-in one first', () => {
        const unusable = { availability: { configured: false, reason: 'runtime-unavailable' as const } };
        // The second check's case: the platform in use is gone, the first listed one is not configured.
        expect(pillProvider([row('gone', unusable), row('off', off), row('in', signedIn)], 'gone')?.providerId).toBe('in');
        // The platform in use itself is not configured.
        expect(pillProvider([row('a'), row('c', off), row('d', ranOut), row('e', signedIn)], 'c')?.providerId).toBe('e');
        expect(pillProvider([row('c', off), row('d', ranOut), row('a')], 'c')?.providerId).toBe('d');
        expect(pillProvider([row('c', off), row('a')], 'c')?.providerId).toBe('a');
        // Nothing can be chosen: the platform in use, as before.
        expect(pillProvider([row('b', off), row('c', off)], 'c')?.providerId).toBe('c');
        expect(pillProvider([], 'c')).toBeNull();
    });

    // The name beside the pill says "this just changed". Reading a remembered account at launch is not a change.
    it('unfolds the platform\'s name after a switch or a sign-in, and not at launch nor after a sign-out', () => {
        const seen = (shownId: string, signedIn: boolean, known = true) => ({ shownId, signedIn, known });
        expect(pillNameUnfolds(seen('a', true), seen('b', true))).toBe(true);
        expect(pillNameUnfolds(seen('a', false), seen('a', true))).toBe(true);
        expect(pillNameUnfolds(seen('a', true), seen('a', false))).toBe(false);
        expect(pillNameUnfolds(seen('a', true), seen('a', true))).toBe(false);
        // At launch the account store starts as 'unknown' and then names the remembered account.
        expect(pillNameUnfolds(seen('a', false, false), seen('a', true))).toBe(false);
        expect(pillNameUnfolds(seen('a', false, false), seen('b', true))).toBe(false);
    });

    // After a sign-in the account's picture flies from the window to the pill. While it is on its
    // way to the platform the pill shows (`landing`), the pill has not seen the change yet: it
    // compares with what it saw before once the picture has landed.
    it('holds the name until the picture has landed, and unfolds nothing when no picture came', () => {
        const seen = (shownId: string, signedIn: boolean): PillSeen => ({ shownId, signedIn, known: true });
        // The moments at which the name unfolds, as the pill is drawn again and again.
        const unfoldedAt = (first: PillSeen, moments: Array<[PillSeen, boolean]>) => {
            let before = first;
            return moments.flatMap(([now, landing], at) => {
                const next = pillSeenNext(before, now, landing);
                before = next.seen;
                return next.unfolds ? [at] : [];
            });
        };
        // Signed in to A, B signs in: A stays as it is while B's account is read. The read fails, or the window is closed: nothing unfolds.
        expect(unfoldedAt(seen('a', true), [[seen('a', true), false], [seen('a', true), false]])).toEqual([]);
        // B's account is read: the pill shows B, whose picture is on its way; the name unfolds when it has landed.
        expect(unfoldedAt(seen('a', true), [[seen('a', true), false], [seen('b', true), true], [seen('b', true), true], [seen('b', true), false]])).toEqual([3]);
        // A sign-in to the platform the pill shows: the same, from the confirm on.
        expect(unfoldedAt(seen('a', false), [[seen('a', false), true], [seen('a', true), true], [seen('a', true), false]])).toEqual([2]);
        // Its account could not be read: nothing unfolds.
        expect(unfoldedAt(seen('a', false), [[seen('a', false), true], [seen('a', false), false]])).toEqual([]);
        // With no animation (motion off) the name unfolds when the account is read.
        expect(unfoldedAt(seen('a', true), [[seen('b', true), false]])).toEqual([0]);
    });

    it('keeps an http picture address as it is in the desktop app, and asks for https on the web', () => {
        const address = 'http://img1.kwcdn.kuwo.cn/star/avatar.jpg';
        expect(accountPictureSrc(address, true)).toBe(address);
        expect(accountPictureSrc(address, false)).toBe('https://img1.kwcdn.kuwo.cn/star/avatar.jpg');
        expect(accountPictureSrc('https://example.test/a.png?from=http://x', false)).toBe('https://example.test/a.png?from=http://x');
    });
});

describe('what a chosen row leads to', () => {
    // How the sign-in goes (methods first, the browser button, a code at once) is the account controller's: its tests.
    it('the account, no sign-in, or a sign-in; a row out of reach leads nowhere', () => {
        expect(rowLeadsTo('signed-in')).toBe('account');
        expect(rowLeadsTo('accountless')).toBe('accountless');
        expect(rowLeadsTo('signed-out')).toBe('sign-in');
        expect(rowLeadsTo('ran-out')).toBe('sign-in');
        expect(rowLeadsTo('off')).toBeNull();
    });
});

describe('the scene on the right of the column', () => {
    const scene = (lead: Parameters<typeof loginScene>[0]['lead'], phase: Parameters<typeof loginScene>[0]['phase'], extra: Partial<Parameters<typeof loginScene>[0]> = {}) => (
        loginScene({ lead, phase, inBrowser: false, failed: false, ...extra })
    );

    // That nothing is fetched until then is the controller's rule: providerAccountController.test.ts.
    it('shows nothing of a sign-in until a row is chosen and the person took the next step', () => {
        expect(scene(null, null)).toBe('none');
        // A sign-in that went on before the window was opened does not show while nothing is chosen.
        expect(scene(null, 'waiting', { failed: true })).toBe('none');
        expect(scene('sign-in', 'choosing-method')).toBe('methods');
        expect(scene('sign-in', 'ready', { inBrowser: true })).toBe('browser-ready');
        expect(scene('account', null)).toBe('account');
        expect(scene('accountless', 'error', { failed: true })).toBe('accountless');
    });

    it('follows a sign-in: preparing, the code or the browser, scanned, reading the account', () => {
        expect(scene('sign-in', null)).toBe('preparing');
        expect(scene('sign-in', 'resolving-methods')).toBe('preparing');
        expect(scene('sign-in', 'loading')).toBe('preparing');
        expect(scene('sign-in', 'waiting')).toBe('code');
        expect(scene('sign-in', 'loading', { inBrowser: true })).toBe('preparing');
        expect(scene('sign-in', 'waiting', { inBrowser: true })).toBe('browser');
        expect(scene('sign-in', 'scanned')).toBe('scanned');
        expect(scene('sign-in', 'confirmed')).toBe('reading');
    });

    it('shows a failure as soon as one is told, also while the sign-in still waits (the browser did not open)', () => {
        expect(scene('sign-in', 'expired', { failed: true })).toBe('failed');
        expect(scene('sign-in', 'error', { failed: true })).toBe('failed');
        expect(scene('sign-in', 'waiting', { inBrowser: true, failed: true })).toBe('failed');
        expect(scene('sign-in', 'choosing-method', { failed: true })).toBe('failed');
    });

    // Which sentence stands as the headline. Until the window was rebuilt the sign-in hook made
    // these (its `statusText`); the rule that a sign-in in the browser has its own sentences is kept here.
    it('gives each scene its headline: a sentence, the platform\'s own title, a name or the case', () => {
        expect(sceneHeadline('none', false)).toBe('login.choosePlatform');
        expect(sceneHeadline('methods', false)).toBe('home.loginMethodTitle');
        expect(sceneHeadline('preparing', false)).toBe('title');
        expect(sceneHeadline('code', false)).toBe('title');
        expect(sceneHeadline('preparing', true)).toBe('home.loginBrowserLoading');
        expect(sceneHeadline('browser-ready', true)).toBe('title');
        expect(sceneHeadline('browser', true)).toBe('home.loginCodeWaiting');
        expect(sceneHeadline('scanned', false)).toBe('home.qrScanned');
        expect(sceneHeadline('reading', false)).toBe('login.readingAccount');
        expect(sceneHeadline('reading', true)).toBe('login.readingAccount');
        expect(sceneHeadline('account', false)).toBe('name');
        expect(sceneHeadline('accountless', false)).toBe('name');
        expect(sceneHeadline('failed', false)).toBe('case');
    });

    it('puts the step marks where the sign-in stands: code, phone, account; or browser, account', () => {
        expect(stepMarks('preparing', false)).toEqual({ marks: ['code', 'phone', 'account'], current: 0 });
        expect(stepMarks('code', false)?.current).toBe(0);
        expect(stepMarks('scanned', false)?.current).toBe(1);
        expect(stepMarks('reading', false)?.current).toBe(2);
        expect(stepMarks('browser', true)).toEqual({ marks: ['browser', 'account'], current: 0 });
        expect(stepMarks('reading', true)?.current).toBe(1);
        for (const still of ['none', 'account', 'accountless', 'methods', 'browser-ready', 'failed'] as const) expect(stepMarks(still, false), still).toBeNull();
    });
});

describe('the account of a chosen row', () => {
    it('is shown with its profile, by the platform\'s name where there is none, and as gone when the sign-in is no more', () => {
        expect(accountView('signed-in', true)).toBe('user');
        // Signed in without a profile: still an account, with switch and sign-out.
        expect(accountView('signed-in', false)).toBe('nameless');
        // The sign-in ran out, or was ended elsewhere, while the account was shown: a way to sign in again.
        expect(accountView('ran-out', false)).toBe('gone');
        expect(accountView('signed-out', true)).toBe('gone');
        // The row left the list (a mod was taken away).
        expect(accountView(null, false)).toBe('gone');
    });
});

describe('what a failure says under its headline', () => {
    const failed = (id: Parameters<typeof loginCaseOf>[0]['case'], step: LoginStep = 'check', detail: LoginFailureDetail = {}): LoginFailure => {
        const facts = loginFailureFacts({ step, inBrowser: false, scanned: false }, { detail: { case: id, ...detail } });
        return { case: loginCaseOf(facts), facts, at: 0 };
    };

    // One way for a platform to say its own sentence: by the case (LoginTexts.caseNotes). Then the shared line.
    it('takes the platform\'s sentence for the case, then the shared one', () => {
        const notes = { 'no-browser': 'home.platformSaysOfTheCase' } as const;
        expect(failureNoteKey(failed('no-browser', 'start'), notes)).toBe('home.platformSaysOfTheCase');
        expect(failureNoteKey(failed('no-browser', 'check'), notes)).toBe('home.platformSaysOfTheCase');
        expect(failureNoteKey(failed('unreachable', 'start'), notes)).toBe('login.noteCheckNetwork');
        expect(failureNoteKey(failed('unreachable'), undefined)).toBe('login.noteCheckNetwork');
        // Where the case has a shared line, the platform's own still comes first.
        expect(failureNoteKey(failed('unreachable'), { unreachable: 'home.platformSaysOfTheCase' })).toBe('home.platformSaysOfTheCase');
        // A case without a shared line, on a platform that declares none for it, has no second line.
        expect(failureNoteKey(failed('no-browser', 'start'), undefined)).toBeUndefined();
        expect(failureNoteKey(failed('code-expired', 'wait'), undefined)).toBeUndefined();
    });

    it('quotes the platform\'s words with its code, the code alone, or the local service\'s own words', () => {
        expect(failureQuote(failed('refused', 'check', { code: '8821', message: '需要验证' }), null)).toEqual({ text: '需要验证', code: '8821' });
        expect(failureQuote(failed('refused', 'check', { message: '需要验证' }), null)).toEqual({ text: '需要验证', code: undefined });
        expect(failureQuote(failed('refused', 'check', { code: '8821' }), null)).toEqual({ text: '8821' });
        // Only a case that offers a restart quotes the service, in its own words.
        const serviceSaid = "EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\key'";
        expect(failureQuote(failed('local-service-stopped', 'start'), serviceSaid)).toEqual({ text: serviceSaid });
        expect(failureQuote(failed('local-service-unavailable', 'start'), serviceSaid)).toBeUndefined();
        expect(failureQuote(failed('local-service-stopped', 'start'), null)).toBeUndefined();
        // The platform's words come before the service's.
        expect(failureQuote(failed('local-service-stopped', 'start', { message: 'said' }), serviceSaid)).toEqual({ text: 'said', code: undefined });
    });
});

describe('the wait before another try', () => {
    const failed = (retryAfterMs?: number): LoginFailure => {
        const facts = loginFailureFacts({ step: 'check', inBrowser: false, scanned: false }, { detail: { case: 'retry-later', retryAfterMs } });
        return { case: loginCaseOf(facts), facts, at: 1_000_000 };
    };

    it('ends as long after the failure as the platform said, and 20 s after it where the platform named no time', () => {
        expect(retryWaitEndsAt(failed(31_000))).toBe(1_031_000);
        expect(retryWaitEndsAt(failed())).toBe(1_020_000);
        expect(retryWaitEndsAt(failed(0))).toBe(1_000_000);
    });

    // A platform that names a day (or seconds where milliseconds were meant): the button counts
    // five minutes at most. The fact keeps what the platform said.
    it('never waits longer than five minutes, whatever the platform said', () => {
        expect(retryWaitEndsAt(failed(300_000))).toBe(1_300_000);
        expect(retryWaitEndsAt(failed(86_400_000))).toBe(1_300_000);
        expect(secondsLeft(retryWaitEndsAt(failed(86_400_000)), 1_000_000)).toBe(300);
        expect(failed(86_400_000).facts.retryAfterMs).toBe(86_400_000);
    });

    // The code picture's refresh opens with the message's button: a code given up on the phone, for which
    // the platform named a wait, waits too; one that simply ran out does not.
    it('opens a retry when the wait ends, for every case whose action waits, and at once for the others', () => {
        expect(retryOpensAt(failed(31_000))).toBe(1_031_000);
        const given = (retryAfterMs?: number): LoginFailure => {
            const facts = loginFailureFacts({ step: 'wait', inBrowser: false, scanned: true }, { detail: retryAfterMs === undefined ? undefined : { retryAfterMs } });
            return { case: loginCaseOf(facts), facts, at: 1_000_000 };
        };
        expect(given(30_000).case.id).toBe('expired-after-scan');
        expect(retryOpensAt(given(30_000))).toBe(1_030_000);
        expect(retryOpensAt(given())).toBe(0);
    });

    it('counts whole seconds down to zero and never below', () => {
        expect(secondsLeft(1_020_000, 1_000_000)).toBe(20);
        expect(secondsLeft(1_020_000, 1_000_001)).toBe(20);
        expect(secondsLeft(1_020_000, 1_019_000)).toBe(1);
        expect(secondsLeft(1_020_000, 1_019_999)).toBe(1);
        expect(secondsLeft(1_020_000, 1_020_000)).toBe(0);
        expect(secondsLeft(1_020_000, 1_500_000)).toBe(0);
    });
});

describe('a platform the window has never heard of', () => {
    it('gets a mark from its own short name and a neutral colour; a declared mark is taken as it is', () => {
        expect(resolvePlatformMark(null, ' tidal ')).toEqual({ letter: 'T', color: '#5d5d66' });
        expect(resolvePlatformMark(null, '咪咕音乐').letter).toBe('咪');
        expect(resolvePlatformMark(null, '').letter).toBe('?');
        expect(resolvePlatformMark({ letter: 'K', color: '#2563eb' }, 'whatever')).toEqual({ letter: 'K', color: '#2563eb' });
    });
});

describe('the texts the window can ask for', () => {
    const has = (texts: unknown, key: string): boolean => (
        typeof key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], texts) === 'string'
    );
    const missing = (keys: string[]) => keys.flatMap(key => [['zh-CN', zh], ['en', en], ['in', id]].filter(([, texts]) => !has(texts, key)).map(([name]) => `${key} in ${name}`));

    it('has a headline for each of the 19 cases, a name for each kind and each step, in the three languages', () => {
        expect(Object.keys(LOGIN_CASE_TEXTS).sort()).toEqual([...LOGIN_CASE_IDS].sort());
        const keys = [
            ...Object.values(LOGIN_CASE_TEXTS).flatMap(texts => [texts.title, ...(texts.note ? [texts.note] : [])]),
            ...Object.values(LOGIN_KIND_TEXTS),
            ...(['start', 'open', 'wait', 'check', 'account'] as LoginStep[]).flatMap(step => [loginStepText(step, false), loginStepText(step, true)]),
            // What a screen reader is told of a row's state.
            'login.rowSignedIn', 'login.rowRanOut', 'home.providerNotConfigured',
            // The app's message after a sign-out, when a sign-in ran out, and the line on the colour after a sign-in.
            'status.loggedOut', 'login.signInRanOut', 'home.loginSuccess',
        ];
        expect(missing(keys)).toEqual([]);
        // One state, one word: the row's spoken state and the app's message say the same.
        for (const texts of [zh, en, id]) expect(texts.login.rowRanOut).toBe(texts.login.signInRanOut);
    });

    it('has every title, note and second line a platform declares, in the three languages', () => {
        const keys = listOnlineMusicProviders().flatMap(provider => {
            const texts = omni.getLoginTexts(provider.id);
            return texts ? [texts.title, texts.note, ...Object.values(texts.caseNotes ?? {})] : [];
        });
        expect(keys.length).toBeGreaterThanOrEqual(12);
        expect(missing(keys)).toEqual([]);
    });

    it('declares a second line of its own only where the sentence names that platform\'s own thing', () => {
        const notes = Object.fromEntries(listOnlineMusicProviders().map(provider => [provider.id, omni.getLoginTexts(provider.id)?.caseNotes ?? null]));
        expect(notes).toEqual({
            netease: null, kugou: null, bodian: null, fnmusic: null, qishui: null,
            // 扫错 App 的那一句按后端有没有 QQ 音乐 App 扫码说（这里还没问到后端）。
            qq: { 'local-service-unavailable': 'home.loginCaseQqRestart', 'wrong-scan-app': 'home.loginCaseQqWrongScanAppMobileOnly', 'device-limit': 'home.loginCaseQqDeviceLimit' },
            ytm: { 'browser-unfinished': 'home.loginCaseYtmUnfinished', 'no-browser': 'home.loginNoBrowserYtm' },
            spotify: { 'browser-unfinished': 'home.loginCaseSpotifyUnfinished', 'not-authorized': 'home.loginCaseSpotifyDenied', 'cannot-listen': 'home.loginCaseSpotifyPort' },
        });
    });
});
