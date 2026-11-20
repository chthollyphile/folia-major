import type { FoliumSourceLoginCase, FoliumSourceLoginFailure, FoliumSourceLoginStep } from '@folia/folium';
import { spotifyCodeOf, spotifyReasonOf } from './spotifyTransport';

// sources/spotify/client/spotifyLoginFailure.ts
// What the sign-in window is handed of a Spotify sign-in that failed. What the desktop side's own words for a
// failure mean is said here only (they are made in sources/spotify/main/).

// The desktop side's word for the failure, and the case it is. The four last say why Spotify sent
// no code back, why the code was not exchanged or why the account was not read after the approval:
// Spotify could not be reached, did not answer in time, asked to wait, or refused. 'sign-in-failed'
// is of no case: no code came back, or it was not exchanged, and the desktop side tells no more.
const CASE_OF = new Map<string, FoliumSourceLoginCase>([
    ['cannot-listen', 'cannot-listen'],
    ['account-not-read', 'account-not-read'],
    ['access-denied', 'not-authorized'],
    ['unreachable', 'unreachable'],
    ['no-answer', 'no-answer'],
    ['asked-to-wait', 'retry-later'],
    ['refused', 'refused'],
]);

// The desktop side's word as a fact. It is the message of an error that `login_check` answers.
export const spotifyLoginFailure = (mainCode: unknown): FoliumSourceLoginFailure | undefined => {
    if (typeof mainCode !== 'string' || !mainCode) return undefined;
    const named = CASE_OF.get(mainCode);
    return { mainCode, ...(named ? { case: named } : {}) };
};

// A step of the sign-in threw: the desktop side's word comes as the error's cause (spotifyTransport.ts).
export const describeSpotifyLoginFailure = (_step: FoliumSourceLoginStep, error: unknown): FoliumSourceLoginFailure | null => (
    (spotifyCodeOf(error) && spotifyLoginFailure(spotifyReasonOf(error))) || null
);
