import type { OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureMessage } from '../../../../services/onlineMusic/failure/onlineFailureTexts';
import type { StatusMessage } from '../../../../types';

// src/components/app/playback/source/onlineFailureToast.ts
// The toast for an online song that could not be played: what happened (with the platform's mark),
// what to do and the platform's own words. One shape for every route that tells of it (playSong,
// the restore, the skip after a media error); the countdown and the buttons are added where it is shown.

// Longer than a toast's usual 3 s: there are up to three lines to read.
const FAILURE_TOAST_MS = 6000;

export const onlineFailureToast = (
    shown: OnlineFailure,
    t: (key: string, values?: Record<string, string | number>) => string,
): StatusMessage => {
    const { title, note, quote } = onlineFailureMessage(shown, t);
    return {
        type: 'error',
        text: title,
        ...(note ? { note } : {}),
        ...(quote ? { quote } : {}),
        ...(shown.providerId ? { providerId: shown.providerId } : {}),
        durationMs: FAILURE_TOAST_MS,
    };
};
