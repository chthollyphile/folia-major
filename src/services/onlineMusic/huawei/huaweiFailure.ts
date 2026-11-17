import type { OnlineFailureDetail } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { HUAWEI_NEEDS_DESKTOP } from './huaweiTransport';

// src/services/onlineMusic/huawei/huaweiFailure.ts

export function describeHuaweiFailure(error: unknown): OnlineFailureDetail | null {
    if (!(error instanceof OnlineProviderError)) return null;
    const message = error.message;
    const base = {
        ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
        ...(message ? { message } : {}),
    };
    // Let the shared classifier handle HTTP failures (especially 429 and 5xx) before
    // applying song-specific fallbacks such as no-audio or local-service-stopped.
    if (error.httpStatus !== undefined && error.httpStatus >= 400) return base;
    switch (error.code) {
        case 'auth-required':
            return { ...base, case: 'sign-in-needed', likelyCause: 'sign-in' };
        case 'subscription-required':
            return { ...base, case: 'subscription-required', likelyCause: 'subscription' };
        case 'preview-only':
            return { ...base, case: 'preview-only' };
        case 'not-playable':
            return { ...base, case: 'no-audio' };
        case 'region-restricted':
            return { ...base, case: 'region-restricted', likelyCause: 'region' };
        case 'network':
            return { ...base, case: 'unreachable' };
        case 'unavailable':
            return { ...base, case: message === HUAWEI_NEEDS_DESKTOP ? 'not-configured'
                : error.httpStatus !== undefined ? 'refused' : 'local-service-stopped' };
        case 'unsupported':
            return { ...base, case: 'not-configured' };
        case 'not-public':
            return { ...base, case: 'not-public' };
        case 'invalid-response':
            return base;
        default:
            return base;
    }
}
