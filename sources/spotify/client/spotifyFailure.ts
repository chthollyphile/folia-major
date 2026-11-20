import type { FoliumSourceFailureDetail } from '@folia/folium';
import { spotifyCodeOf, spotifyReasonOf } from './spotifyTransport';

// sources/spotify/client/spotifyFailure.ts
// What a Spotify request for a song's audio or a collection's tracks that failed hands to the host's shared rules
// (`FoliumSourceDef.describeFailure`). What the desktop side's words for a failure mean is said here only (they
// are made in sources/spotify/main/). A network that fails and 5xx come as `network` and need nothing here. The
// host asks this of Spotify's own requests only.

// The desktop side's sentences that name a case: Spotify's 429 (sources/spotify/main/errors.cjs), and
// Spotify refusing a track's key before and after it gave this account one in this run
// (sources/spotify/main/audio.cjs).
const NAMED: Record<string, FoliumSourceFailureDetail> = {
    'Spotify asked to wait before trying again': { case: 'retry-later', httpStatus: 429 },
    'Spotify gives this account no audio key': { case: 'account-refused' },
    'Spotify refused the audio key for now': { case: 'retry-later' },
};

// Soloist's failures (sources/spotify/main/soloist.cjs), by the reason word the desktop side gives them:
// one that setting it up mends (the program, its key, its pairing, a start that fails) is a source
// that is not set up, and the failure offers the setup checklist; the program gone or refusing a
// track may pass when tried again.
const SOLOIST_REASONS: Record<string, FoliumSourceFailureDetail> = {
    'soloist-program': { case: 'not-configured' },
    'soloist-key': { case: 'not-configured' },
    'soloist-expired': { case: 'not-configured' },
    'soloist-unpaired': { case: 'not-configured' },
    'soloist-start': { case: 'not-configured' },
    'soloist-gone': { case: 'unreachable' },
    'soloist-refused': { case: 'refused' },
};

export const describeSpotifyFailure = (_operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null => {
    const failed = spotifyCodeOf(error);
    if (!failed) return null;
    const reason = spotifyReasonOf(error);
    if (reason && Object.hasOwn(SOLOIST_REASONS, reason)) return SOLOIST_REASONS[reason];
    return Object.hasOwn(NAMED, failed.message) ? NAMED[failed.message] : null;
};
