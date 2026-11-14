import type { FoliumSourceError, FoliumSourceFailureDetail } from '@folia/folium';
import { BODIAN_BRIDGE_FAILED } from './bodianTransport';

// sources/bodian/client/bodianFailure.ts
// What a Bodian request for a song's audio or a collection's tracks that failed hands to the shared
// rules (the host's failure cases). What the package's errors mean is said here only: the bridge hands
// its code and sentence through as they are (bodian-music-api/src/api.cjs), and the sentence is the
// package's own (src/http.cjs). The host asks this only of Bodian's own requests.

// The package's own sentences for a play right it was not given (bodian-music-api@0.1.2, src/playback.cjs):
// checkRight status 7, or no status at all; status 3 (a preview) with no clip to play.
const ADDITIONAL_RIGHTS = 'Bodian requires additional playback rights';
const RIGHTS_UNAVAILABLE = 'Bodian playback rights are unavailable';
const PREVIEW_UNAVAILABLE = 'Bodian preview is unavailable';

// An error made with folium.sources.error (bodianTransport.ts): it has the host's code. Anything else (a
// TypeError of a page that did not read) is not one the package's sentences can tell of.
const isSourceError = (error: unknown): error is FoliumSourceError => (
    error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
);

export const describeBodianFailure = (_operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null => {
    if (!isSourceError(error)) return null;
    // The bridge itself failed (the main entry threw): the local service, not the network.
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
