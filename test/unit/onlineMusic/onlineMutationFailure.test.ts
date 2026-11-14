import { describe, expect, it } from 'vitest';
import i18n from '../../../src/i18n/config';
import { onlineMutationFailureText } from '../../../src/services/onlineMusic/failure/onlineMutationFailure';
import { OnlineProviderError } from '../../../src/types/onlineMusic';

// A refused like or playlist addition says what failed and, where the error tells it, why.
const t = (key: string, values?: Record<string, string | number>) => i18n.t(key, { ...values, lng: 'en' });
const text = (error: unknown) => onlineMutationFailureText(error, 'Failed', t);

describe('online mutation failure text', () => {
    it('names the reason from the shared error code and HTTP status', () => {
        expect(text(new OnlineProviderError('auth-required', 'x', 'appleMusic'))).toBe('Failed: Apple Music sign-in expired');
        expect(text(new OnlineProviderError('unsupported', 'x', 'appleMusic'))).toBe('Failed: Apple Music does not support this for this song');
        expect(text(new OnlineProviderError('network', 'x', 'appleMusic'))).toBe('Failed: Cannot connect to Apple Music');
        expect(text(new OnlineProviderError('unavailable', 'x', 'appleMusic', 'upstream-error', 403))).toBe('Failed: Request refused by Apple Music (HTTP 403)');
        expect(text(new OnlineProviderError('unavailable', 'x', 'appleMusic', 'upstream-error', 429))).toBe('Failed: Apple Music: try again later');
    });
    it('keeps the caller\'s text alone when the error says nothing usable', () => {
        expect(text(new Error('boom'))).toBe('Failed');
        expect(text(new OnlineProviderError('invalid-response', 'x', 'appleMusic'))).toBe('Failed');
        expect(text(new OnlineProviderError('auth-required', 'x'))).toBe('Failed');
    });
});
