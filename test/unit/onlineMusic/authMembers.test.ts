import { describe, expect, it } from 'vitest';
import { getOnlineMusicProvider, listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';

// test/unit/onlineMusic/authMembers.test.ts
// Which members the `auth` object of each built-in platform has. All but two members of
// OnlineAuthProvider are optional, so one that goes missing from an adapter gives no type error:
// Omni then answers as if the platform never had it (no QR picture, no page to open, no timer).
// A member added or removed on purpose changes its row here.

const AUTH_MEMBERS: Record<string, string[]> = {
    netease: [
        'canRunLoginSelfCheck', 'checkLogin', 'createQr', 'describeLoginFailure', 'forgetOldKeptAccount', 'getLoginDiagnostics', 'getLoginStatus', 'getLoginTexts', 'localService',
        'logout', 'oldKeptAccount', 'runLoginSelfCheck', 'showsKeptAccountAtStart', 'signInRanOut', 'startLogin',
    ],
    qq: [
        'canRunLoginSelfCheck', 'cancelLogin', 'checkLogin', 'createQr', 'describeLoginFailure', 'getLoginDiagnostics', 'getLoginMethods', 'getLoginStatus',
        'getLoginTexts', 'getLoginTtlMs', 'logout', 'resolveLoginMethods', 'runLoginSelfCheck', 'showsKeptAccountAtStart', 'signInRanOut', 'startLogin',
    ],
    kugou: [
        'checkLogin', 'createQr', 'describeLoginFailure', 'getLoginStatus', 'getLoginTexts', 'logout', 'showsKeptAccountAtStart', 'signInRanOut',
        'startLogin',
    ],
    // No `describeLoginFailure`: the desktop side answers Bodian's failures in the shared codes already.
    bodian: [
        'cancelLogin', 'checkLogin', 'createQr', 'getLoginStatus', 'getLoginTexts', 'getLoginTtlMs', 'logout', 'startLogin',
    ],
    spotify: [
        'cancelLogin', 'checkLogin', 'describeLoginFailure', 'getLoginStatus', 'getLoginTexts', 'getLoginTtlMs', 'logout', 'openLoginPage',
        'startLogin',
    ],
    ytm: [
        'cancelLogin', 'checkLogin', 'describeLoginFailure', 'getLoginStatus', 'getLoginTexts', 'getLoginTtlMs', 'logout', 'openLoginPage',
        'opensLoginPageItself', 'signInRanOut', 'startLogin',
    ],
    qishui: [
        'cancelLogin', 'checkLogin', 'createQr', 'describeLoginFailure', 'getLoginDiagnostics', 'getLoginStatus',
        'getLoginTexts', 'getLoginTtlMs', 'logout', 'signInRanOut', 'startLogin',
    ],
    // 表单式登录：不扫码不开浏览器，登录窗口按 getLoginForm 声明渲染账号密码表单。
    fnmusic: [
        'checkLogin', 'describeLoginFailure', 'getLoginForm', 'getLoginStatus', 'getLoginTexts', 'logout', 'startLogin', 'submitLoginForm',
    ],
};

describe('the sign-in members of each built-in platform', () => {
    it.each(Object.entries(AUTH_MEMBERS))('%s has exactly these', (providerId, members) => {
        expect(Object.keys(getOnlineMusicProvider(providerId)!.auth!).sort()).toEqual(members);
    });

    it('has a row for every built-in platform', () => {
        expect(listOnlineMusicProviders().map(provider => provider.id).sort()).toEqual(Object.keys(AUTH_MEMBERS).sort());
    });
});
