// src/services/onlineMusic/qishui/qishuiSentences.ts
// The sentences qishui-music-api itself puts into its errors (src/playback.cjs, src/client.cjs, src/catalog.cjs).
// They live in their own file because two sides read them: qishuiFailure says what they mean, and
// qishuiPlayback reads two of them for its own control flow. This file holds no state, so reading a sentence
// never pulls in a request module.

// src/playback.cjs: the service gave only encrypted audio, which Folia does not decrypt.
export const PROTECTED_ONLY = 'Qishui returned protected audio only; decryption is disabled';
// src/client.cjs: an account request made with no session at all.
export const SIGNED_OUT = 'Sign in to Qishui first';
// src/catalog.cjs `track`: the service answered a look-up without the track. An audio request meets the same
// sentence for a media it will not serve, which is why qishuiPlayback re-checks the service's own record.
export const TRACK_NOT_RETURNED = 'Qishui did not return the track';
// Folia's own sentence, not the package's: qishuiPlayback re-checked the service's record for one media and
// it says `check_tracks` status 20 — a media the service will not serve at all. qishuiFailure names the case.
export const TAKEN_DOWN_CONFIRMED = 'Qishui will not serve the track (check_tracks status 20)';