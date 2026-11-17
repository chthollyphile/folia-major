import { OnlineProviderError } from '../../../types/onlineMusic';
import { omni } from '../omni';

// src/services/onlineMusic/failure/onlineMutationFailure.ts
// A like or a playlist addition the platform did not take: the message the user sees says what failed
// (the caller's own text) and, where the thrown error tells it, why. No platform is named here: the reason
// comes from the shared error codes and the HTTP status the transport put on the error.

type Translate = (key: string, values?: Record<string, string | number>) => string;

// The reason for one refused mutation, already translated; undefined when the error says nothing usable.
const reasonOf = (error: unknown, t: Translate): string | undefined => {
    if (!(error instanceof OnlineProviderError)) return undefined;
    const provider = error.providerId ? omni.getProviderLabel(error.providerId) : undefined;
    if (!provider) return undefined;
    const status = error.httpStatus;
    if (error.code === 'auth-required' || status === 401) return t('failure.signInNeeded', { provider });
    if (error.code === 'unsupported') return t('failure.mutationUnsupported', { provider });
    if (error.retryAfterMs !== undefined || status === 429) return t('failure.retryLater', { provider });
    if (error.code === 'network' || (status !== undefined && status >= 500)) return t('failure.unreachable', { provider });
    if (status !== undefined && status >= 400) return `${t('failure.refused', { provider })} (HTTP ${status})`;
    if (error.code === 'unavailable') return t('failure.refused', { provider });
    return undefined;
};

/** `action` is the caller's own failure text ("Couldn't add"); the reason follows it when the error has one. */
export const onlineMutationFailureText = (error: unknown, action: string, t: Translate): string => {
    const reason = reasonOf(error, t);
    return reason ? t('failure.withReason', { action, reason }) : action;
};
