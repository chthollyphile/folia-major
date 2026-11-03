import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineRecommendationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { spotifyPlaylistTracks } from './spotifyCatalog';
import { spotifyMadeForAccount, wordsOf } from './spotifyExplore';
import { addSpotifySeeds, noteSpotifyListened, spotifyLikedSeeds, spotifyListenedSeeds, spotifyRadioSongs } from './spotifyRadio';
import type { SpotifySeed } from './spotifyRadio';

// src/services/onlineMusic/spotify/spotifyRecommendations.ts
// The radio tab for Spotify, all of it what Spotify itself has for the account:
//  - Personal FM: one radio after another (spotifyRadio.ts), each asked with a song the account
//    liked or the listener played in the app. The song is picked at random among the ones not yet
//    asked with: a radio is the same list every time, so a fixed order would begin every run of
//    the app with the same songs. A call hands out the next few songs; a song is handed out once
//    in a run of the app. A trashed song is not handed out again in that run, and what was left
//    of the radio it came from is dropped. With no song to ask with there is no FM: no song is
//    made up.
//  - Daily songs: the first of Spotify's daily mixes, the lists it makes for the account anew
//    every day out of what the account listens to. (Its weekly discovery list changes once a week,
//    and the card says "daily".) The account's other daily mixes stand among the playlists.
//  - Recommended playlists: the other lists Spotify makes for the account, in the order of its
//    own page of them (the same lists the explore page shows by section).
// Nothing here outlasts a run of the app, and all of it is forgotten when the account changes.

// A call hands out this many songs. The queue asks for more when "next" finds the song playing
// among its last two (usePlaybackQueueController.ts). With two a call the queue always knows the
// song to come (one a call and it never would), and at most two songs handed out before a trash
// are still to come after it (three a call and it would be three).
const FM_BATCH = 2;
// A call asks for this many radios at most (two requests each) before it hands out what it has.
const FM_RADIOS_A_CALL = 3;
// The id of a daily mix's playlist begins so (checked on one account, 2026-10-08: the daily mix
// was found among its 57 lists). A daily mix whose id begins otherwise is not found, and the log
// says so (the daily card is then empty).
const DAILY_MIX_ID = /^37i9dQZF1E3/;
const DAILY_ROWS = 100;
// One read of the lists made for the account serves the daily songs and the playlists, which the
// radio tab asks for together, and whatever asks within this time.
const MADE_MAX_AGE_MS = 60 * 1000;

// What the personal FM holds for one account in one run of the app.
const newFm = () => ({
    /** The songs a radio may still be asked with. */
    seeds: [] as SpotifySeed[],
    /** Every song that was put among them: a song is asked with once. */
    known: new Set<string>(),
    /** Whether the account's liked songs were put among them. */
    hasLiked: false,
    /** The radio being handed out: the song it was asked with, and what is left of it. */
    radio: null as { seed: SpotifySeed; songs: UnifiedSong[] } | null,
    /** Every song handed out or trashed, with the song its radio was asked with ('' for a song no radio here gave). */
    gone: new Map<string, string>(),
    /** Calls take turns, so that two of them do not hand out the same songs. */
    queue: Promise.resolve() as Promise<unknown>,
});
type Fm = ReturnType<typeof newFm>;
let fm = newFm();
// The read of the lists made for the account that is under way or was made last.
let made: { at: number; lists: Promise<ProviderCollection[]> } | null = null;

/** Forgets the FM and the lists read: for when the account signs out, or a sign-in begins. */
export const resetSpotifyRecommendations = (): void => {
    fm = newFm();
    made = null;
    noteSpotifyListened([]);
};

const isOffline = (error: unknown) => error instanceof OnlineProviderError && error.code === 'network';

// The songs to ask with. The ones played here join as the explore page hands them over. The liked
// ones are read once, and again when every song was asked with and the last radio is used up: the
// account may have liked others since (the FM's own heart is Spotify's like).
const gatherSeeds = async (session: Fm): Promise<void> => {
    addSpotifySeeds(session, spotifyListenedSeeds());
    const hasSongsLeft = session.seeds.length > 0 || Boolean(session.radio?.songs.length);
    if (session.hasLiked && hasSongsLeft) return;
    try {
        addSpotifySeeds(session, await spotifyLikedSeeds());
        session.hasLiked = true;
    } catch (error) {
        // Offline with nothing to hand out, the call fails and the tab is asked for again. A read Spotify
        // refuses leaves the FM the songs played here (with none of those there is no FM card) and the
        // rest of the tab as it is; the next call asks for the liked songs again.
        if (isOffline(error) && !hasSongsLeft) throw error;
        console.warn(`[Spotify] Personal FM: the liked songs could not be read (${wordsOf(error)}); it goes on with the ${session.seeds.length} songs played here`);
    }
};

/** The next songs of the FM: what is left of the radio being handed out, then the radio of another song. None once there is no song left to ask with. */
const nextFmSongs = async (session: Fm): Promise<UnifiedSong[]> => {
    await gatherSeeds(session);
    const songs: UnifiedSong[] = [];
    let asked = 0;
    while (songs.length < FM_BATCH) {
        const radio = session.radio;
        if (radio && radio.songs.length > 0) {
            const song = radio.songs.shift()!;
            const id = String(song.id);
            // (Not the song asked with, and none that was handed out or trashed before.)
            if (id === radio.seed.id || session.gone.has(id)) continue;
            session.gone.set(id, radio.seed.id);
            songs.push(song);
            continue;
        }
        if (session.seeds.length === 0 || asked >= FM_RADIOS_A_CALL) break;
        asked += 1;
        const [seed] = session.seeds.splice(Math.floor(Math.random() * session.seeds.length), 1);
        try {
            const found = await spotifyRadioSongs(seed.id);
            session.radio = { seed, songs: found };
            console.log(`[Spotify] Personal FM: the radio of ${seed.id}, ${found.length} songs; ${session.seeds.length} more songs to ask with`);
        } catch (error) {
            // Offline, the song is asked with again later; a radio Spotify refuses is not asked for twice.
            if (isOffline(error)) session.seeds.push(seed);
            console.warn(`[Spotify] Personal FM: the radio of ${seed.id} could not be read (${wordsOf(error)})`);
            if (isOffline(error) && songs.length === 0) throw error;
            if (isOffline(error)) break;
        }
    }
    console.log(`[Spotify] Personal FM: ${songs.length} songs handed out, ${session.gone.size} handed out or trashed in this run; ${session.seeds.length} songs left to ask with`);
    return songs;
};

// Spotify replaces its queries without notice: what a refused one would have brought is left
// out, and the rest of the tab stays. Offline, the read fails instead and the tab is asked for again.
const leftOut = <T>(what: string, none: T) => (error: unknown): T => {
    if (isOffline(error)) throw error;
    console.warn(`[Spotify] Radio tab: ${what} could not be read (${wordsOf(error)}); the tab goes on without it`);
    return none;
};

const madeLists = (): Promise<ProviderCollection[]> => {
    if (made && Date.now() - made.at < MADE_MAX_AGE_MS) return made.lists;
    const lists = spotifyMadeForAccount().catch(leftOut('the page of the lists made for the account', [] as ProviderCollection[]));
    made = { at: Date.now(), lists };
    // (A read that failed is not kept: the next one asks Spotify again.)
    lists.catch(() => { if (made?.lists === lists) made = null; });
    return lists;
};
const isDailyMix = (list: ProviderCollection) => DAILY_MIX_ID.test(String(list.id));

export const spotifyRecommendations: OnlineRecommendationProvider = {
    getPersonalFm() {
        const session = fm;
        const turn = session.queue.catch(() => undefined).then(() => nextFmSongs(session));
        session.queue = turn;
        return turn;
    },
    // The FM's trash button. Spotify is told nothing: the song is kept out of the FM for this run
    // of the app, and so is what was left of the radio it came from.
    async dislikeSong(id) {
        const session = fm;
        const song = String(id);
        const seed = session.gone.get(song) ?? '';
        session.gone.set(song, seed);
        const left = session.radio?.seed.id === seed ? session.radio.songs.length : null;
        if (left !== null) session.radio = null;
        console.log(`[Spotify] Personal FM: ${song} was trashed and is not handed out again in this run${left === null ? '' : `; the ${left} songs left of the radio it came from were dropped`}`);
        return {};
    },
    // `refresh` reads Spotify's page again; when the list changes is Spotify's to say.
    async getDailySongs(refresh) {
        if (refresh) made = null;
        const lists = await madeLists();
        const daily = lists.find(isDailyMix);
        if (!daily) {
            console.log(`[Spotify] Daily songs: none of the ${lists.length} lists made for the account is a daily mix`);
            return [];
        }
        const songs = await spotifyPlaylistTracks(String(daily.id), DAILY_ROWS, 0).then(page => page.items, leftOut('the daily mix', [] as UnifiedSong[]));
        console.log(`[Spotify] Daily songs: ${songs.length} songs of the first daily mix (${daily.id}) among the ${lists.length} lists made for the account`);
        return songs;
    },
    async getRecommendedCollections(limit) {
        const lists = await madeLists();
        const daily = lists.find(isDailyMix);
        const others = lists.filter(list => list !== daily).slice(0, limit);
        console.log(`[Spotify] Recommended playlists: ${others.length} of the ${lists.length} lists made for the account`);
        return others;
    },
};
