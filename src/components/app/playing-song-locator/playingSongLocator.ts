import i18n from '../../../i18n/config';
import type { SongResult } from '../../../types';
import { collectionKey, type GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { getActiveGridViewCollection, useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore, type LocateRequest, type PlaybackSource } from '../../../stores/usePlayingSongLocatorStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';

// src/components/app/playing-song-locator/playingSongLocator.ts
// "Where is the song that is playing": two actions, each with one job.
//  - `locatePlayingSongOnPage`: the button of a collection page (over its grid, in its list).
//    Only that page is asked, and it answers at once from the cards it has: it centres the
//    song's card, or a status line says that the song is not there, or that the list is not
//    whole and so cannot tell. No other page is opened.
//  - `locatePlayingSong`: back to where the song was started (the player's "playing from", the
//    command, the control slot). The page of the collection the queue was started from is
//    opened and asked; it waits for its tracks before it says no. A queue that is of no
//    collection has no such page, and a status line says so.
// A page is asked through the request in usePlayingSongLocatorStore and answers with
// `answerLocateRequest`; see that store for why the page answers.
// The wall (lattice) is asked as a page is, under a key of its own, by the same button in its
// corner; it answers for its tiles (lattice/wallLocate.ts).

/**
 * The collection the queue is of, for as long as it is: every song in it is one of the songs the
 * queue was started with. A queue that was replaced, or that took in a song from elsewhere, is no
 * longer that collection's, and there is then no page to send the listener to.
 */
export const playbackSourceOf = (source: PlaybackSource | null, queue: SongResult[], song: SongResult | null): GridViewCollectionDescriptor | null => {
    if (!source || !song) return null;
    return [song, ...queue].every(entry => source.songKeys.has(getPlaybackSongKey(entry))) ? source.collection : null;
};

// A queue that was asked for and that the player has not taken yet: where it was started, its
// songs, and what the player had then (its queue, and the song that played). It becomes the source
// once the player has put a queue of its songs in the place of the one it had, and plays a song of it.
//  - Not when it is asked for: a play may be refused (no song of it can be played, the song is
//    marked unavailable, an extension cancels it), and the queue that goes on playing keeps its
//    own source.
//  - Not by its songs alone: the queue that goes on playing may be made of songs of the one asked
//    for (the app's own "recently played" holds every song of a queue played here).
// It is forgotten when another song than one of it begins: the play was refused, or overtaken.
// Left: after a refused play, a queue that is made of songs of the one asked for, has no other
// song begin, and is then edited (the player puts the edited queue in its place) is taken for it.
let asked: { collection: GridViewCollectionDescriptor | null; songKeys: ReadonlySet<string>; queue: SongResult[]; playing: string | null } | null = null;
const takeAskedQueue = (): void => {
    if (!asked) return;
    const { currentSong, playQueue } = usePlaybackStore.getState();
    if (!currentSong) return;
    const playing = getPlaybackSongKey(currentSong);
    if (!asked.songKeys.has(playing)) {
        if (playing !== asked.playing) asked = null;
        return;
    }
    if (playQueue === asked.queue || !playQueue.every(song => asked!.songKeys.has(getPlaybackSongKey(song)))) return;
    usePlayingSongLocatorStore.getState().setSource(asked.collection && { collection: asked.collection, songKeys: asked.songKeys });
    asked = null;
};
usePlaybackStore.subscribe(takeAskedQueue);

/**
 * A queue of these songs is being started: on this collection's page, or (null) somewhere that is
 * no collection's page. Whatever starts a queue from the home screen says so (buildHomeModel.ts).
 * Without the second, a queue made of songs that the collection before also holds would pass for
 * that collection's. Not covered: a queue started by something that is not the home screen (the
 * personal radio's own controller, a play asked for over the remote-control interface, an
 * extension) leaves the source as it was. So does a play that ends on another song than one of
 * the queue (an extension sends it elsewhere, the listener takes the song offered in place of an
 * unavailable one): that queue took in a song from elsewhere, and is no collection's.
 */
export const noteQueueStarted = (collection: GridViewCollectionDescriptor | null, queue: SongResult[]): void => {
    const { currentSong, playQueue } = usePlaybackStore.getState();
    asked = { collection, songKeys: new Set(queue.map(getPlaybackSongKey)), queue: playQueue, playing: currentSong && getPlaybackSongKey(currentSong) };
};

let nonces = 0;
const ask = (pageKey: string, songKey: string, waits: boolean): void => {
    nonces += 1;
    usePlayingSongLocatorStore.getState().setRequest({ nonce: nonces, collectionKey: pageKey, songKey, waits });
};

/**
 * Shows the card of the song that is playing on the collection page `pageKey` (the page's own
 * `collectionKey`), if that page has it. The page answers from the cards it has, at once.
 */
export const locatePlayingSongOnPage = (pageKey: string): void => {
    const { currentSong } = usePlaybackStore.getState();
    if (currentSong) ask(pageKey, getPlaybackSongKey(currentSong), false);
};

/** Opens the page of the collection the queue was started from, and shows the playing song's card there. */
export const locatePlayingSong = (): void => {
    const { currentSong, playQueue } = usePlaybackStore.getState();
    if (!currentSong) return;
    const { source: kept, navigator } = usePlayingSongLocatorStore.getState();
    const source = playbackSourceOf(kept, playQueue, currentSong);
    if (!source || !navigator) {
        setStatusMessage({ type: 'info', text: i18n.t('status.playingSongNoSource') });
        return;
    }
    const view = useAppViewStore.getState().view;
    const open = getActiveGridViewCollection(useCollectionNavigationStore.getState().snapshot);
    ask(collectionKey(source), getPlaybackSongKey(currentSong), true);
    if (open && collectionKey(open) === collectionKey(source)) {
        // The page is open already. Under the player or the wall, showing the home screen shows it.
        if (view !== 'home') navigator.navigateToHome();
    } else if (view === 'home' && open) navigator.pushCollection(source);
    else navigator.navigateToCollection(source, view === 'player' ? 'player' : 'home');
};

// A question is for the page that is open, about the song that plays. Once another page is open
// (or none), the home screen is left, or another song plays, nobody is to answer it: left
// standing, it would be answered the day that collection's page is next shown.
const dropRequestUnless = (stands: (request: LocateRequest) => boolean): void => {
    const { request, setRequest } = usePlayingSongLocatorStore.getState();
    if (request && !stands(request)) setRequest(null);
};
useCollectionNavigationStore.subscribe(state => dropRequestUnless(request => request.collectionKey === collectionKey(getActiveGridViewCollection(state.snapshot))));
// (Leaving home, not being elsewhere: a question asked from the player is on its way to a page.)
useAppViewStore.subscribe((state, before) => dropRequestUnless(() => !(before.view === 'home' && state.view !== 'home')));
usePlaybackStore.subscribe(state => dropRequestUnless(request => state.currentSong !== null && getPlaybackSongKey(state.currentSong) === request.songKey));

/**
 * A page's answer to the request `nonce`: whether it holds the song (and has centred its card),
 * or 'unread' where it cannot tell because its list is not whole: tracks are still to come, or
 * its reading failed.
 */
export const answerLocateRequest = (nonce: number, answer: boolean | 'unread'): void => {
    const { request, setRequest } = usePlayingSongLocatorStore.getState();
    if (request?.nonce !== nonce) return;
    setRequest(null);
    if (answer === 'unread') setStatusMessage({ type: 'info', text: i18n.t('status.playingSongListUnread') });
    else if (!answer) setStatusMessage({ type: 'info', text: i18n.t('status.playingSongNotHere') });
};
