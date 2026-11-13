import { registerLyricSourceAccess } from '../../../utils/lyrics/lyricSources';

// src/services/onlineMusic/netease/neteaseLyricSource.ts
// How NetEase is reached as a lyric source where that differs from its provider: a song id alone is enough
// to fetch its lyrics, and the chorus ranges it gives are lent to a fetch that marks the chorus itself.
// Registered when the provider loads (Folium 2.0 S1: moved here from the host's lyricMatchSources.ts).

export const registerNeteaseLyricSource = (): void => registerLyricSourceAccess('netease', {
    knownById: (songId) => {
        const numericId = typeof songId === 'number' ? songId : Number(songId);
        return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
    },
    sharesChorusRanges: true,
});
