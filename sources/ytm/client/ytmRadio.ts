import { requestYtm } from './ytmTransport';
import type { YtmWirePage, YtmWireSong } from './ytmTransport';

// src/services/onlineMusic/ytm/ytmRadio.ts
// A song's radio, and the songs a radio is asked with ("seeds"). Two things are made of them: the
// explore page's shelves of the songs like one song (ytmExplore.ts) and the radio tab's personal
// FM (ytmRecommendations.ts). A radio is the queue YouTube Music makes up for the list `RDAMVM` +
// the song's id, read as a guest: 50 songs with the song itself first, the same when asked again
// (measured 2026-10-08). The songs asked with are the ones the listener played in the app and,
// for the FM, the first rows of the account's liked-music list.

export interface YtmSeed { id: string; name: string }
export const ytmSeedOf = (song: { id: string | number; name: string }): YtmSeed => ({ id: String(song.id), name: song.name });

// The account's liked-music list. It is read as the account, 100 rows a request (2026-10-09):
// the songs to ask with are one request's rows, not a walk of the list.
const LIKED_LIST = 'LM';

// The songs the listener played in the app, as the explore page was last handed them
// (`OnlineExploreProvider.getFeed`): the personal FM is not handed them, and asks with these.
let listened: YtmSeed[] = [];
export const noteYtmListened = (songs: YtmSeed[]): void => { listened = songs; };
export const ytmListenedSeeds = (): YtmSeed[] => listened;

/** Puts `songs` among the ones `pool` may still ask with; a song is put there once. */
export const addYtmSeeds = (pool: { seeds: YtmSeed[]; known: Set<string> }, songs: YtmSeed[]): void => {
    for (const song of songs) {
        if (!song.name || pool.known.has(song.id)) continue;
        pool.known.add(song.id);
        pool.seeds.push(song);
    }
};

/** The first rows of the account's liked-music list, as songs to ask with. One request. */
export const ytmLikedSeeds = async (): Promise<YtmSeed[]> => {
    const page = await requestYtm<YtmWirePage<YtmWireSong>>('playlist', { id: LIKED_LIST });
    return page.items.map(ytmSeedOf);
};

/** The songs of the radio of the song `id`, as YouTube Music lists them (the song itself among them). One request. */
export const ytmRadioSongs = async (id: string): Promise<YtmWireSong[]> => (
    (await requestYtm<YtmWirePage<YtmWireSong>>('mix', { id: `RDAMVM${id}`, videoId: id })).items
);
