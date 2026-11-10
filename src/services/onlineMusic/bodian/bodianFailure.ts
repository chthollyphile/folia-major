import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { BODIAN_BRIDGE_FAILED, BODIAN_NEEDS_DESKTOP } from './bodianTransport';

// src/services/onlineMusic/bodian/bodianFailure.ts
// What a Bodian request for a song's audio or a collection's tracks that failed hands to the shared
// rules (services/onlineMusic/failure/). What the package's errors mean is said here only: the
// bridge hands its code and sentence through as they are (bodian-music-api/src/api.cjs), and the
// sentence is the package's own (src/http.cjs).

// The package's own sentences for a play right it was not given (bodian-music-api@0.1.2, src/playback.cjs):
// checkRight status 7, or no status at all; status 3 (a preview) with no clip to play.
const ADDITIONAL_RIGHTS = 'Bodian requires additional playback rights';
const RIGHTS_UNAVAILABLE = 'Bodian playback rights are unavailable';
const PREVIEW_UNAVAILABLE = 'Bodian preview is unavailable';

export const describeBodianFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'bodian') return null;
    // This page has no desktop bridge (the web build): Bodian cannot be used here at all.
    if (error.message === BODIAN_NEEDS_DESKTOP) return { case: 'not-configured' };
    // The bridge itself failed (the main process threw): the local service, not the network.
    if (error.message === BODIAN_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    // Without a session the package answers a right it was not given with auth-required: nobody is signed in.
    if (error.code === 'auth-required' && (error.message === ADDITIONAL_RIGHTS || error.message === RIGHTS_UNAVAILABLE)) {
        return { signedOut: true };
    }
    // Signed in, the account lacks the right (status 7); Bodian does not say whether a membership or a purchase.
    if (error.code === 'not-playable' && error.message === ADDITIONAL_RIGHTS) return { case: 'entitlement-required' };
    if (error.code === 'not-playable' && error.message === PREVIEW_UNAVAILABLE) return { case: 'preview-only' };
    // A status outside 2xx: "Bodian HTTP 503".
    const status = /^Bodian HTTP (\d{3})$/.exec(error.message)?.[1];
    if (status) return { httpStatus: Number(status) };
    // Bodian answered with a code other than 200: "Bodian rejected the request (code 20018)". 20018
    // comes as not-playable, the rest as invalid-response; the code is quoted either way.
    const code = /\(code (-?\d{1,6})\)$/.exec(error.message)?.[1];
    if (code) return { code };
    // A track only for the mainland (code 407): the sentence is Bodian's own words.
    if (error.code === 'region-restricted') return { message: error.message };
    return null;
};
