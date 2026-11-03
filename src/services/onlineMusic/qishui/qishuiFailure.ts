import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { QISHUI_BRIDGE_FAILED, QISHUI_NEEDS_DESKTOP, QishuiRequestError } from './qishuiTransport';

// src/services/onlineMusic/qishui/qishuiFailure.ts
// What a Qishui request for a song's audio or a collection's tracks that failed hands to the shared
// rules (services/onlineMusic/failure/). What the package's errors mean is said here only: the bridge
// hands its code, sentence and upstream code through as they are (qishui-music-api/src/api.cjs), and
// the sentences are the package's own (src/client.cjs, src/playback.cjs).

// The package's own sentences (qishui-music-api@0.2.1):
// src/playback.cjs: the service gave only encrypted audio, which Folia does not decrypt.
const PROTECTED_ONLY = 'Qishui returned protected audio only; decryption is disabled';
// src/client.cjs: an account request made with no session at all.
const SIGNED_OUT = 'Sign in to Qishui first';

export const describeQishuiFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'qishui') return null;
    // This page has no desktop bridge (the web build): Qishui cannot be used here at all.
    if (error.message === QISHUI_NEEDS_DESKTOP) return { case: 'not-configured' };
    // The bridge itself failed (the main process threw): the local side, not the network.
    if (error.message === QISHUI_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    // Nobody is signed in: say "sign in to play", not "the sign-in ran out".
    if (error.code === 'auth-required' && error.message === SIGNED_OUT) return { signedOut: true };
    // Only encrypted audio came back: there is no address Folia can play, and asking again gives the same.
    if (error.code === 'unsupported' && error.message === PROTECTED_ONLY) return { case: 'no-audio' };
    // A status outside 2xx: "Qishui HTTP 503" (429 comes as unavailable, 401/403 as auth-required).
    const status = /^Qishui HTTP (\d{3})$/.exec(error.message)?.[1];
    if (status) return { httpStatus: Number(status) };
    // Qishui answered with an error number ("Qishui rejected the request"): its code is quoted.
    if (error instanceof QishuiRequestError && error.upstreamCode) return { code: error.upstreamCode };
    return null;
};
