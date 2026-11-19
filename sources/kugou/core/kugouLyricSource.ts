import { registerLyricSourceAccess } from '../../../src/utils/lyrics/lyricSources';

// sources/kugou/core/kugouLyricSource.ts
// How KuGou is reached as a lyric source where that differs from its provider: it knows a song by its hash,
// in capitals. Registered when the provider loads (Folium 2.0 S1: moved here from the host's lyricMatchSources.ts).

export const registerKugouLyricSource = (): void => registerLyricSourceAccess('kugou', {
    songKey: song => String(song.kgHash ?? song.id).toUpperCase(),
});
