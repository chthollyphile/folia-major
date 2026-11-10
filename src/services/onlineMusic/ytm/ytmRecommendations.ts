import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineRecommendationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { forgetYtmMusicPage, ytmMusicPagePlaylists } from './ytmExplore';
import { normalizeYtmSong } from './ytmNormalize';
import { addYtmSeeds, noteYtmListened, ytmLikedSeeds, ytmListenedSeeds, ytmRadioSongs } from './ytmRadio';
import type { YtmSeed } from './ytmRadio';
import { errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/ytm/ytmRecommendations.ts
// The radio tab for YouTube Music:
//  - Personal FM: one song radio after another (ytmRadio.ts), each asked with a song of the
//    account's liked-music list or one the listener played in the app. The song is picked at
//    random among the ones not yet asked with: a radio is the same list every time, so a fixed
//    order would begin every run of the app with the same songs. A call hands out the next few
//    songs; a song is handed out once in a run of the app. A trashed song is not handed out again
//    in that run, and what was left of the radio it came from is dropped; YouTube is told nothing.
//    With no song to ask with there is no FM: no song is made up.
//  - Recommended playlists: the playlists and mixes of the account's music page, the page the
//    explore tab shows by shelf (ytmExplore.ts), taken from that page as it was last read.
//  - No daily songs: YouTube Music has no list of that kind. There is no `getDailySongs` here, so
//    the card is not offered.
// Nothing here outlasts a run of the app, and all of it is forgotten when the account changes.

// A call hands out this many songs. The queue asks for more when "next" finds the song playing
// among its last two (usePlaybackQueueController.ts). With two a call the queue always knows the
// song to come (one a call and it never would), and at most two songs handed out before a trash
// are still to come after it (three a call and it would be three).
const FM_BATCH = 2;
// A call asks for this many radios at most (one request each) before it hands out what it has.
const FM_RADIOS_A_CALL = 3;

// What the personal FM holds for one account in one run of the app.
const newFm = () => ({
    /** The songs a radio may still be asked with. */
    seeds: [] as YtmSeed[],
    /** Every song that was put among them: a song is asked with once. */
    known: new Set<string>(),
    /** Whether the account's liked songs were put among them. */
    hasLiked: false,
    /** The radio being handed out: the song it was asked with, and what is left of it. */
    radio: null as { seed: YtmSeed; songs: UnifiedSong[] } | null,
    /** Every song handed out or trashed, with the song its radio was asked with ('' for a song no radio here gave). */
    gone: new Map<string, string>(),
    /** Calls take turns, so that two of them do not hand out the same songs. */
    queue: Promise.resolve() as Promise<unknown>,
});
type Fm = ReturnType<typeof newFm>;
let fm = newFm();

/** Forgets the FM, the songs played here and the music page read: for when the account signs out, or a sign-in begins. */
export const resetYtmRecommendations = (): void => {
    fm = newFm();
    noteYtmListened([]);
    forgetYtmMusicPage();
};

const wordsOf = (error: unknown) => errorMessage(error);
const isOffline = (error: unknown) => error instanceof OnlineProviderError && error.code === 'network';

// The songs to ask with. The ones played here join as the explore page hands them over. The liked
// ones are read once, and again when every song was asked with and the last radio is used up.
// Where they cannot be read the FM goes on with the songs played here, and with none of those
// there is no FM; only offline is the call failed, so that the tab is asked for again.
const gatherSeeds = async (session: Fm): Promise<void> => {
    addYtmSeeds(session, ytmListenedSeeds());
    const hasSongsLeft = session.seeds.length > 0 || Boolean(session.radio?.songs.length);
    if (session.hasLiked && hasSongsLeft) return;
    try {
        const liked = await ytmLikedSeeds();
        addYtmSeeds(session, liked);
        session.hasLiked = true;
        console.log(`[Ytm] Personal FM: ${liked.length} rows of the liked-music list read to ask with; ${session.seeds.length} songs to ask with`);
    } catch (error) {
        if (isOffline(error) && !hasSongsLeft) throw error;
        console.warn(`[Ytm] Personal FM: the liked-music list could not be read (${wordsOf(error)}); it goes on with the ${session.seeds.length} songs played here`);
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
            const found = (await ytmRadioSongs(seed.id)).map(normalizeYtmSong);
            session.radio = { seed, songs: found };
            console.log(`[Ytm] Personal FM: the radio of ${seed.id}, ${found.length} songs; ${session.seeds.length} more songs to ask with`);
        } catch (error) {
            // Offline, the song is asked with again later; a radio YouTube refuses is not asked for twice.
            if (isOffline(error)) session.seeds.push(seed);
            console.warn(`[Ytm] Personal FM: the radio of ${seed.id} could not be read (${wordsOf(error)})`);
            if (isOffline(error) && songs.length === 0) throw error;
            if (isOffline(error)) break;
        }
    }
    console.log(`[Ytm] Personal FM: ${songs.length} songs handed out, ${session.gone.size} handed out or trashed in this run; ${session.seeds.length} songs left to ask with`);
    return songs;
};

export const ytmRecommendations: OnlineRecommendationProvider = {
    getPersonalFm() {
        const session = fm;
        const turn = session.queue.catch(() => undefined).then(() => nextFmSongs(session));
        session.queue = turn;
        return turn;
    },
    // The FM's trash button. YouTube is told nothing: the song is kept out of the FM for this run
    // of the app, and so is what was left of the radio it came from.
    async dislikeSong(id) {
        const session = fm;
        const song = String(id);
        const seed = session.gone.get(song) ?? '';
        session.gone.set(song, seed);
        const left = session.radio?.seed.id === seed ? session.radio.songs.length : null;
        if (left !== null) session.radio = null;
        console.log(`[Ytm] Personal FM: ${song} was trashed and is not handed out again in this run${left === null ? '' : `; the ${left} songs left of the radio it came from were dropped`}`);
        return {};
    },
    // A page YouTube refuses leaves the tab without its playlists; offline, the read fails instead
    // and the tab is asked for again.
    async getRecommendedCollections(limit) {
        const lists = await ytmMusicPagePlaylists().catch(error => {
            if (isOffline(error)) throw error;
            console.warn(`[Ytm] Recommended playlists: the music page could not be read (${wordsOf(error)}); the tab goes on without them`);
            return [] as ProviderCollection[];
        });
        console.log(`[Ytm] Recommended playlists: ${Math.min(lists.length, limit)} of the ${lists.length} playlists and mixes of the music page`);
        return lists.slice(0, limit);
    },
};
