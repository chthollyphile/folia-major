import { registerLyricSourceAccess } from '../../../utils/lyrics/lyricSources';
import { fetchQQLyrics, searchQQLyrics } from './qqLyricProvider';

// src/services/onlineMusic/qq/qqLyricSource.ts
// How QQ is reached as a lyric source: its lyrics are read from QQ's own lyric service, which needs no QQ
// account and knows a song by its mid. Registered when the provider loads (Folium 2.0 S1: moved here from
// the host's lyricMatchSources.ts, which imported qqLyricProvider directly).

// QQ's search has only ever been asked for one page of 20 songs at most.
const QQ_SEARCH_PAGE_MAX = 20;

export const registerQqLyricSource = (): void => registerLyricSourceAccess('qq', {
    search: (query, limit) => searchQQLyrics(query, 1, Math.min(limit, QQ_SEARCH_PAGE_MAX)),
    fetch: async (song, lent) => ({ lyrics: await fetchQQLyrics(song, lent) ?? null, isPureMusic: false }),
    songKey: song => String(song.qqMid ?? song.id),
    marksChorusOnFetch: true,
});
