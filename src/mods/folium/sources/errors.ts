import { OnlineProviderError, type ProviderErrorCode } from '@/types/onlineMusic';
import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from './contract';

// src/mods/folium/sources/errors.ts
// `folium.sources.error` (plan §4.6): an error a source throws from a capability member, with a code the host
// reads. It is the host's own OnlineProviderError, made without a provider id; the adapter
// (registries/sources.ts) names the source on it as it passes the error on, so omni, the failure cases
// (failure/onlineFailureCase.ts) and the login cases read it as they read a built-in provider's.

/** The codes a source may give, the host's ProviderErrorCode one for one. */
export const FOLIUM_SOURCE_ERROR_CODES: readonly FoliumSourceErrorCode[] = Object.freeze([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
] satisfies readonly ProviderErrorCode[]);

const CODES: ReadonlySet<string> = new Set(FOLIUM_SOURCE_ERROR_CODES);

const made = new WeakSet();

/** `folium.sources.error`. Throws a TypeError for a code that is not one of FOLIUM_SOURCE_ERROR_CODES. */
export const createFoliumSourceError = (
    code: FoliumSourceErrorCode,
    message: string,
    details?: FoliumSourceErrorDetails,
): FoliumSourceError => {
    // Read as a mod may hand them, whatever the types say.
    const given: unknown = details;
    const extra = typeof given === 'object' && given !== null ? given as Record<string, unknown> : {};
    if (!CODES.has(code)) {
        throw new TypeError(`sources.error: code must be one of ${FOLIUM_SOURCE_ERROR_CODES.join(', ')}`);
    }
    const httpStatus = typeof extra.httpStatus === 'number' && Number.isInteger(extra.httpStatus) ? extra.httpStatus : undefined;
    const retryAfterMs = typeof extra.retryAfterMs === 'number' && Number.isFinite(extra.retryAfterMs) && extra.retryAfterMs >= 0 ? extra.retryAfterMs : undefined;
    const text: unknown = message;
    const error = new OnlineProviderError(code, typeof text === 'string' ? text : 'source error', undefined, extra.cause, httpStatus, retryAfterMs);
    made.add(error);
    return error;
};

/** Whether `value` was made by `folium.sources.error`. */
export const isFoliumSourceError = (value: unknown): value is FoliumSourceError => (
    typeof value === 'object' && value !== null && made.has(value)
);
