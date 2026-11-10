import type { UnifiedSong } from '../../../types';
import { spotifyPlaylistTracks } from './spotifyCatalog';
import type { SpotifyLikedAnswer } from './spotifyLibrary';
import { present, spotifyId, spotifySongOf } from './spotifyNormalize';
import { querySpotify, requestSpotify } from './spotifyTransport';
import type { SpotifyWireRadio } from './spotifyTransport';

// src/services/onlineMusic/spotify/spotifyRadio.ts
// A song's radio, and the songs a radio is asked with ("seeds"). Two things are made of them: the
// explore page's shelves of the songs like one song (spotifyExplore.ts) and the radio tab's
// personal FM (spotifyRecommendations.ts). A radio is the playlist Spotify keeps of the songs
// like one song: 50 of them with the song itself first, the same when asked again (measured
// 2026-10-08). The songs asked with are the ones the listener played in the app and the ones the
// account liked on Spotify.

export interface SpotifySeed { id: string; name: string }
export const spotifySeedOf = (song: UnifiedSong): SpotifySeed => ({ id: String(song.id), name: song.name });

// The liked songs read to ask with, the latest first.
const SEED_ROWS = 50;
// A radio is read this many rows deep at most.
const RADIO_ROWS = 100;

// The songs the listener played in the app, as the explore page last handed them over
// (`OnlineExploreProvider.getFeed`): the personal FM is not handed them, and asks with these.
let listened: SpotifySeed[] = [];
export const noteSpotifyListened = (songs: SpotifySeed[]): void => { listened = songs; };
export const spotifyListenedSeeds = (): SpotifySeed[] => listened;

/** Puts `songs` among the ones `pool` may still ask with; a song is put there once. */
export const addSpotifySeeds = (pool: { seeds: SpotifySeed[]; known: Set<string> }, songs: SpotifySeed[]): void => {
    for (const song of songs) {
        if (!song.name || pool.known.has(song.id)) continue;
        pool.known.add(song.id);
        pool.seeds.push(song);
    }
};

/** The songs the account liked on Spotify, the latest first, as songs to ask with. */
export const spotifyLikedSeeds = async (): Promise<SpotifySeed[]> => {
    const liked = await querySpotify<SpotifyLikedAnswer>('fetchLibraryTracks', { offset: 0, limit: SEED_ROWS });
    return (liked.me?.library?.tracks?.items ?? []).map(row => spotifySongOf(row.track?.data, { uri: row.track?._uri })).filter(present).map(spotifySeedOf);
};

/** The songs of the radio of the song `id`, as Spotify lists them (the song itself among them); none where Spotify keeps no radio of it. */
export const spotifyRadioSongs = async (id: string): Promise<UnifiedSong[]> => {
    const radio = await requestSpotify<SpotifyWireRadio | null>('radio', { id });
    const list = spotifyId(radio?.uri, 'playlist');
    return list ? (await spotifyPlaylistTracks(list, RADIO_ROWS, 0)).items : [];
};
