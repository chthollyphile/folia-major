import { registerLyricSourceAccess } from '../../../utils/lyrics/lyricSources';

// src/services/onlineMusic/qishui/qishuiLyricSource.ts
// How Qishui is reached as a lyric source where that differs from its provider: a song id alone is enough to
// fetch its lyrics. Its track ids are 1-30 digits, past what a number holds exactly: kept as text, never made
// a number. Registered when the provider loads (Folium 2.0 S1: moved here from the host's lyricMatchSources.ts).

export const registerQishuiLyricSource = (): void => registerLyricSourceAccess('qishui', {
    knownById: songId => (typeof songId === 'string' ? /^\d{1,30}$/.test(songId) ? songId : null
        : Number.isSafeInteger(songId) && songId >= 0 ? String(songId) : null),
});
