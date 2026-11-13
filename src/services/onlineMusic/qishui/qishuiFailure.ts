import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { QISHUI_BRIDGE_FAILED, QISHUI_NEEDS_DESKTOP, QishuiRequestError } from './qishuiTransport';
import { PROTECTED_ONLY, SIGNED_OUT, TAKEN_DOWN_CONFIRMED } from './qishuiSentences';

// src/services/onlineMusic/qishui/qishuiFailure.ts
// What a Qishui request for a song's audio or a collection's tracks that failed hands to the shared
// rules (services/onlineMusic/failure/). What the package's errors mean is said here only: the bridge
// hands its code, sentence and upstream code through as they are (qishui-music-api/src/api.cjs), and
// the sentences are the package's own (src/client.cjs, src/playback.cjs, src/catalog.cjs) — the
// sentences themselves sit together in qishuiSentences.ts, where a module without state can read them.

export const describeQishuiFailure = (operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'qishui') return null;
    // This page has no desktop bridge (the web build): Qishui cannot be used here at all.
    if (error.message === QISHUI_NEEDS_DESKTOP) return { case: 'not-configured' };
    // The bridge itself failed (the main process threw): the local side, not the network.
    if (error.message === QISHUI_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    // Nobody is signed in: say "sign in to play", not "the sign-in ran out".
    if (error.code === 'auth-required' && error.message === SIGNED_OUT) return { signedOut: true };
    // A media the service will not serve is named only once qishuiPlayback has asked the service's own record
    // for that one media and it says `check_tracks` status 20. The audio request's not-playable sentence alone
    // is not a takedown: a changed id, a stale id and a temporary empty answer all give the same sentence, and
    // an empty answer is never evidence that the platform took the song down (services/onlineMusic/README.md:
    // 不推断下架). What is left unintercepted stays the shared rules' `no-audio`, which is what it was before.
    if (operation === 'audio' && error.message === TAKEN_DOWN_CONFIRMED) return { case: 'taken-down' };
    // Only encrypted audio came back: there is no address Folia can play, and asking again gives the same.
    if (error.code === 'unsupported' && error.message === PROTECTED_ONLY) return { case: 'no-audio' };
    // A status outside 2xx: "Qishui HTTP 503" (429 comes as unavailable, 401/403 as auth-required).
    const status = /^Qishui HTTP (\d{3})$/.exec(error.message)?.[1];
    if (status) return { httpStatus: Number(status) };
    // Qishui answered with an error number ("Qishui rejected the request"): its code is quoted.
    if (error instanceof QishuiRequestError && error.upstreamCode) return { code: error.upstreamCode };
    return null;
};
