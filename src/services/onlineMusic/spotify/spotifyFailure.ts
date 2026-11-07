import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';

// src/services/onlineMusic/spotify/spotifyFailure.ts
// What a Spotify request for a song's audio or a collection's tracks that failed hands to the
// shared rules (services/onlineMusic/failure/). What the desktop side's words for a failure mean is
// said here only (they are made in electron/spotify/). A network that fails and 5xx come as
// `network` and need nothing here.

// The desktop side's sentences that name a case: Spotify's 429 (electron/spotify/errors.cjs), and
// Spotify refusing a track's key before and after it gave this account one in this run
// (electron/spotify/audio.cjs).
const NAMED: Record<string, OnlineFailureDetail> = {
    'Spotify asked to wait before trying again': { case: 'retry-later', httpStatus: 429 },
    'Spotify gives this account no audio key': { case: 'account-refused' },
    'Spotify refused the audio key for now': { case: 'retry-later' },
};

// Soloist's failures (electron/spotify/soloist.cjs), by the reason word the desktop side gives them:
// one that setting it up mends (the program, its key, its pairing, a start that fails) is a source
// that is not set up, and the failure offers the setup checklist; the program gone or refusing a
// track may pass when tried again.
const SOLOIST_REASONS: Record<string, OnlineFailureDetail> = {
    'soloist-program': { case: 'not-configured' },
    'soloist-key': { case: 'not-configured' },
    'soloist-expired': { case: 'not-configured' },
    'soloist-unpaired': { case: 'not-configured' },
    'soloist-start': { case: 'not-configured' },
    'soloist-gone': { case: 'unreachable' },
    'soloist-refused': { case: 'refused' },
};

export const describeSpotifyFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'spotify') return null;
    if (typeof error.cause === 'string' && Object.hasOwn(SOLOIST_REASONS, error.cause)) return SOLOIST_REASONS[error.cause];
    return Object.hasOwn(NAMED, error.message) ? NAMED[error.message] : null;
};
