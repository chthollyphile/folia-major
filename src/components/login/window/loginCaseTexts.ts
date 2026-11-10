import type { LoginCaseKind } from '../../../types/loginFailure';
import type { LoginCaseId, LoginStep } from '../../../types/onlineMusic';

// src/components/login/window/loginCaseTexts.ts
// 登录没有成功时窗口说的话：每一种情况的标题和标题下面的那一句，都是 i18n key。标题里的 {{provider}}
// 由窗口填上平台的名字。只在某个平台上才说得通的那一句由那个平台自己声明（LoginTexts.caseNotes），
// 它在的时候用它，不在才用这里的。少写一种情况，编译不过。

export const LOGIN_CASE_TEXTS: Record<LoginCaseId, { title: string; note?: string }> = {
    'code-expired': { title: 'login.caseCodeExpired' },
    'expired-after-scan': { title: 'login.caseNotConfirmed', note: 'login.caseCodeExpired' },
    'browser-unfinished': { title: 'login.caseUnfinished' },
    'not-authorized': { title: 'login.caseNotAuthorized' },
    unreachable: { title: 'login.caseUnreachable', note: 'login.noteCheckNetwork' },
    'no-answer': { title: 'login.caseNoAnswer', note: 'login.noteCheckNetwork' },
    refused: { title: 'login.caseRefused', note: 'login.noteRetryLater' },
    'retry-later': { title: 'login.caseRetryLater' },
    'device-limit': { title: 'login.caseDeviceLimit', note: 'login.noteDeviceLimit' },
    'wrong-scan-app': { title: 'login.caseWrongScanApp', note: 'login.noteWrongScanApp' },
    'local-service-stopped': { title: 'login.caseLocalService' },
    'local-service-unavailable': { title: 'login.caseLocalService' },
    'cannot-listen': { title: 'login.caseCannotListen' },
    'no-browser': { title: 'login.caseNoBrowser' },
    'browser-still-open': { title: 'login.caseBrowserStillOpen', note: 'login.noteCloseBrowser' },
    'browser-closed-early': { title: 'login.caseBrowserClosedEarly' },
    'browser-unread': { title: 'login.caseBrowserUnread' },
    'browser-not-opened': { title: 'login.caseBrowserNotOpened' },
    'account-not-read': { title: 'login.caseAccountNotRead' },
    unknown: { title: 'login.caseUnknown', note: 'login.noteUnknown' },
};

/** 类别的名字，详情里的「类别」那一行用。 */
export const LOGIN_KIND_TEXTS: Record<LoginCaseKind, string> = {
    A: 'login.kindUnfinished',
    B: 'login.kindUnreachable',
    C: 'login.kindRefused',
    D: 'login.kindLocalService',
    E: 'login.kindBrowser',
    F: 'login.kindAccount',
    G: 'login.kindUnknown',
};

/** 环节的名字，详情里的「环节」那一行用。'wait' 在浏览器登录里是另一句。 */
export const loginStepText = (step: LoginStep, inBrowser: boolean): string => {
    if (step === 'start') return inBrowser ? 'login.stepStartBrowser' : 'login.stepStartCode';
    if (step === 'open') return 'login.stepOpen';
    if (step === 'wait') return inBrowser ? 'login.stepWaitBrowser' : 'login.stepWaitPhone';
    return step === 'check' ? 'login.stepCheck' : 'login.stepAccount';
};
