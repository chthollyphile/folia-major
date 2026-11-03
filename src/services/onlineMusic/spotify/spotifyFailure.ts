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

export const describeSpotifyFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => (
    error instanceof OnlineProviderError && error.providerId === 'spotify' && Object.hasOwn(NAMED, error.message)
        ? NAMED[error.message]
        : null
);
