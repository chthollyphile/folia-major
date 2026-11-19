import type { FoliumSourceError, FoliumSourceFailureDetail } from '@folia/folium';
import { QISHUI_BRIDGE_FAILED, qishuiRefusalOf } from './qishuiTransport';

// sources/qishui/client/qishuiFailure.ts
// What a Qishui request for a song's audio or a collection's songs that failed hands to the host's shared
// rules (`FoliumSourceDef.describeFailure`). What the package's errors mean is said here only: the main entry
// hands its code, sentence and upstream code through as they are (qishui-music-api/src/api.cjs), and the
// sentences are the package's own (src/client.cjs, src/playback.cjs). The host asks this of Qishui's own
// requests only.

// The package's own sentences (qishui-music-api@0.2.2):
// src/playback.cjs: the service gave only encrypted audio, which Folia does not decrypt.
const PROTECTED_ONLY = 'Qishui returned protected audio only; decryption is disabled';
// src/client.cjs: an account request made with no session at all.
const SIGNED_OUT = 'Sign in to Qishui first';

// An error made with folium.sources.error (qishuiTransport.ts) carries the host's code; anything else (a
// TypeError of a page that did not read) is none the package's sentences can tell of.
const isSourceError = (error: unknown): error is FoliumSourceError => (
    error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
);

export const describeQishuiFailure = (_operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null => {
    if (!isSourceError(error)) return null;
    // The bridge itself failed (the main entry threw): the local side, not the network.
    if (error.message === QISHUI_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    // Nobody is signed in: say "sign in to play", not "the sign-in ran out".
    if (error.code === 'auth-required' && error.message === SIGNED_OUT) return { signedOut: true };
    // Only encrypted audio came back: there is no address Folia can play, and asking again gives the same.
    if (error.code === 'unsupported' && error.message === PROTECTED_ONLY) return { case: 'no-audio' };
    // A status outside 2xx: "Qishui HTTP 503" (429 comes as unavailable, 401/403 as auth-required).
    const status = /^Qishui HTTP (\d{3})$/.exec(error.message)?.[1];
    if (status) return { httpStatus: Number(status) };
    // Qishui answered with an error number ("Qishui rejected the request"): its code is quoted.
    const upstreamCode = qishuiRefusalOf(error)?.upstreamCode;
    if (upstreamCode) return { code: upstreamCode };
    return null;
};
