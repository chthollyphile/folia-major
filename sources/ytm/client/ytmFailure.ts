import type { FoliumSourceFailureDetail } from '@folia/folium';

// sources/ytm/client/ytmFailure.ts
// What a YouTube Music request for a song's audio or a collection's tracks that failed hands to the host's
// shared rules (`FoliumSourceDef.describeFailure`). What the desktop side's words for a failure mean is said
// here only (they are made in main/). A network that fails and 5xx come as `network` and need nothing here.
// The host asks this of YouTube Music's own requests only.

// main/errors.cjs gives YouTube's 429 this sentence, under the code of a network that fails. A sign-in that
// fails on it is told apart by it too (ytmLoginFailure.ts).
export const YTM_ASKED_TO_WAIT = 'YouTube Music asked to wait before trying again';

/** The code and sentence of an error made with folium.sources.error (ytmTransport.ts); nothing for any other. */
export const ytmCodeOf = (error: unknown): { code: string; message: string } | null => {
    if (!(error instanceof Error)) return null;
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? { code, message: error.message } : null;
};

export const describeYtmFailure = (_operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null => {
    const failed = ytmCodeOf(error);
    if (!failed) return null;
    if (failed.code === 'network' && failed.message === YTM_ASKED_TO_WAIT) return { case: 'retry-later', httpStatus: 429 };
    // main/ytmApiBridge.cjs puts YouTube's playability status word in its sentence
    // ("cannot play this track (UNPLAYABLE)"): LOGIN_REQUIRED, AGE_CHECK_REQUIRED and the others are
    // quoted. A track blocked in the listener's country is one of them, on purpose.
    const word = failed.code === 'not-playable' ? /\(([A-Z_]{2,40})\)$/.exec(failed.message)?.[1] : undefined;
    // YouTube wants a sign-in for the track. The bridge reports this word where nobody is signed
    // in, or where the account's own player said it too (loadPlan).
    if (word === 'LOGIN_REQUIRED') return { case: 'sign-in-needed', code: word };
    return word ? { code: word } : null;
};
