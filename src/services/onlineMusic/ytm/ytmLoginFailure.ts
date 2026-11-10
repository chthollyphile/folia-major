import { OnlineProviderError } from '../../../types/onlineMusic';
import type { LoginCaseId, LoginFailureDetail, LoginStep, ProviderErrorCode } from '../../../types/onlineMusic';
import { YTM_ASKED_TO_WAIT } from './ytmFailure';

// src/services/onlineMusic/ytm/ytmLoginFailure.ts
// What the sign-in dialog is handed of a YouTube Music sign-in that failed. What the desktop
// side's own words for a failure mean is said here only (they are made in electron/ytm/).

// The desktop side's reason, and the case it is: no browser it can open is installed; the folder
// of an earlier sign-in is still held; the browser ended at once; its cookies could not be read
// (three ways); YouTube Music did not take the cookies; it did not answer whose they are; it took
// them and named no account.
const CASE_OF = new Map<string, LoginCaseId>([
    ['no-browser', 'no-browser'],
    ['folder-in-use', 'browser-still-open'],
    ['exited', 'browser-closed-early'],
    ['not-started', 'browser-unread'],
    ['timeout', 'browser-unread'],
    ['protocol', 'browser-unread'],
    ['not-taken', 'refused'],
    ['no-answer', 'no-answer'],
    ['account-missing', 'account-not-read'],
]);

// A failure as the desktop side tells it: its code, its sentence and, where it has one, its
// reason. Without a reason only a failure to reach YouTube Music is of a known case, and of two:
// YouTube asked to wait (429, a sentence of its own), or it could not be reached.
export const ytmLoginFailure = (code: ProviderErrorCode | undefined, reason: unknown, message?: unknown): LoginFailureDetail | undefined => {
    const mainCode = typeof reason === 'string' && reason ? reason : undefined;
    if (!mainCode && code === 'network' && message === YTM_ASKED_TO_WAIT) return { case: 'retry-later', httpStatus: 429 };
    const named = (mainCode && CASE_OF.get(mainCode)) || (code === 'network' ? 'unreachable' as const : undefined);
    return mainCode || named ? { ...(mainCode ? { mainCode } : {}), ...(named ? { case: named } : {}) } : undefined;
};

// A step of the sign-in threw: the reason comes as the error's cause (ytmTransport.ts).
export const describeYtmLoginFailure = (_step: LoginStep, error: unknown): LoginFailureDetail | null => (
    (error instanceof OnlineProviderError && ytmLoginFailure(error.code, error.cause, error.message)) || null
);
