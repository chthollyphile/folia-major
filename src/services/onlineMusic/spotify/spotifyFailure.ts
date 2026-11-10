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

// Soloist's failures (electron/spotify/soloist.cjs) and the Spotify app's, by the reason word they are given:
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
    // Spotify's own desktop app is not on this computer (spotifyClientPlayback.ts): installing it, or
    // another way to play, mends it, so the failure offers the setup checklist as well.
    'client-missing': { case: 'not-configured' },
    // Spotify's own player named the track as one it will not play, before any wait ran out
    // (spotifyClientPlayback.ts): the song is taken down, and Folia already has that case and its
    // words for a song a platform took down. One it refuses for the free account alone names a plan
    // instead, and Folia has that case too. Neither will play however often it is tried, so a queue
    // that counts down to a skip skips them at once.
    'track-unavailable': { case: 'taken-down', skipAtOnce: true },
    'premium-only': { case: 'subscription-required', skipAtOnce: true },
    // The app is installed but its player was not found inside it, or it was not found soon enough:
    // Spotify's own build is what did not answer, so the failure is the app being unsteerable rather
    // than the song (electron/spotify/officialClient.cjs names both).
    'player-not-found': { case: 'unreachable', playerCause: 'player-not-found' },
    'player-not-installed': { case: 'not-configured', playerCause: 'player-not-installed' },
    // The listener has a Spotify open without Folia's DevTools port and has not agreed to Folia
    // closing it (electron/restartConsent.cjs): the app is theirs to close, so this stops where it
    // is, and only their answer moves it on.
    'player-restart-consent': { case: 'not-configured', playerCause: 'player-restart-consent' },
};

export const describeSpotifyFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'spotify') return null;
    if (typeof error.cause === 'string' && Object.hasOwn(SOLOIST_REASONS, error.cause)) return SOLOIST_REASONS[error.cause];
    return Object.hasOwn(NAMED, error.message) ? NAMED[error.message] : null;
};
