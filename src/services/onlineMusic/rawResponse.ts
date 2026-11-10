import type { JsonValue } from '../../types/onlineMusic';

// src/services/onlineMusic/rawResponse.ts
// What omni does to a platform's raw answer before it leaves the host (`omni.requestProviderRaw`, the
// Folium experimental `platform.raw`): every field that may carry a credential is taken out, at any
// depth. The names here are the ones every platform's credentials go by (cookie, token, password,
// secret, csrf); a platform names its own on top (`OnlineRawRequestProvider.credentialFields`).

// A field whose name says it holds a credential.
const CREDENTIAL_FIELD = /cookie|token|passw(?:or)?d|secret|csrf|credential/i;

// Deeper than this is no answer a platform gives; what lies below is dropped rather than walked.
const MAX_DEPTH = 64;

const strip = (value: unknown, depth: number, isCredential: (name: string) => boolean): JsonValue | undefined => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'object' || depth >= MAX_DEPTH) return undefined;
    if (Array.isArray(value)) return value.map((item) => strip(item, depth + 1, isCredential) ?? null);
    const result: Record<string, JsonValue> = {};
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
        if (isCredential(key)) continue;
        const kept = strip(field, depth + 1, isCredential);
        if (kept !== undefined) result[key] = kept;
    }
    return result;
};

/**
 * A copy of a raw answer as plain JSON without its credential fields: the shared names in the header,
 * and `platformFields` (compared without case). Values JSON has no place for (functions, undefined) are
 * left out, as JSON.stringify would.
 */
export const withoutCredentials = (answer: unknown, platformFields: readonly string[] = []): JsonValue => {
    const own = new Set(platformFields.map((name) => name.toLowerCase()));
    return strip(answer, 0, (name) => CREDENTIAL_FIELD.test(name) || own.has(name.toLowerCase())) ?? null;
};
