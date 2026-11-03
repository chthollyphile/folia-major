import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { GridViewCollectionDescriptor } from '@/components/app/home/gridViewCollectionAdapters';

// test/unit/playing-song-locator/playingSongLocator.test.ts — "locate the playing song": a page's own button asks
// that page alone; "playing from" opens the page of the collection the queue was started from
// and asks it; and when the listener is told that there is none. Also what counts as "the queue
// is still that collection's".

// (The home model reads the module's other exports on its way in: those stay the real ones.)
vi.mock('@/i18n/config', async importOriginal => ({ ...await importOriginal<object>(), default: { t: (key: string) => key, on: () => {}, language: 'en' } }));
import { answerLocateRequest, locatePlayingSong, locatePlayingSongOnPage, playbackSourceOf } from '@/components/app/playing-song-locator/playingSongLocator';
import { buildHomeModel } from '@/components/app/home/buildHomeModel';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '@/stores/usePlayingSongLocatorStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';

const song = (id: string): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, duration: 0,
    sourceRef: { kind: 'online', providerId: 'ytm', mediaId: id },
} as unknown as SongResult);
const collection = (id: string, type = 'playlist'): GridViewCollectionDescriptor => ({ source: 'online', providerId: 'ytm', id, name: `List ${id}`, type } as GridViewCollectionDescriptor);
// A collection's key names its provider (collectionKey, library/core/collection/collectionIdentity).
const keyOf = (id: string, type = 'playlist') => `online:ytm:${type}:${id}`;
const songKey = (id: string) => `online:ytm:${id}`;
// What the store keeps of a queue of these songs started on this collection's page.
const sourceOf = (from: GridViewCollectionDescriptor, queue: SongResult[]) => ({ collection: from, songKeys: new Set(queue.map(entry => songKey(String(entry.id)))) });

const [a, b, c, other] = ['a', 'b', 'c', 'other'].map(song);
const started = collection('started');
const shown = collection('shown');
const navigator = { navigateToHome: vi.fn(), navigateToCollection: vi.fn(), pushCollection: vi.fn() };
const request = () => usePlayingSongLocatorStore.getState().request;
const message = () => useStatusMessageStore.getState().message;
const moves = () => [navigator.navigateToHome.mock.calls, navigator.navigateToCollection.mock.calls, navigator.pushCollection.mock.calls];

// The listener is on `view`, with the page of `open` on (or under) it; the queue was started from `started`.
const stand = (view: 'home' | 'player' | 'lattice', open: GridViewCollectionDescriptor | null, queue: SongResult[] = [a, b, c], playing: SongResult | null = b) => {
    useAppViewStore.setState({ view });
    useCollectionNavigationStore.getState().restore(open ? { origin: 'home', stack: [open] } : null);
    usePlaybackStore.setState({ currentSong: playing, playQueue: queue });
};

describe('the collection a queue is of', () => {
    const source = { collection: started, songKeys: new Set(['a', 'b', 'c'].map(songKey)) };

    it('is the one it was started from while every song in it is one of that collection', () => {
        expect(playbackSourceOf(source, [a, b, c], b)).toBe(started);
        // In another order, or with songs taken out, it is still of that collection.
        expect(playbackSourceOf(source, [c, a], a)).toBe(started);
        expect(playbackSourceOf(source, [], a)).toBe(started);
    });

    it('is none once the queue took in a song from elsewhere, was replaced, or nothing plays', () => {
        expect(playbackSourceOf(source, [a, other, c], a)).toBeNull();
        expect(playbackSourceOf(source, [other], other)).toBeNull();
        // The playing song counts too, where the queue does not list it.
        expect(playbackSourceOf(source, [a, b], other)).toBeNull();
        expect(playbackSourceOf(source, [a, b, c], null)).toBeNull();
        expect(playbackSourceOf(null, [a], a)).toBeNull();
    });
});

describe('locating the playing song', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useStatusMessageStore.getState().setMessage(null);
        const locator = usePlayingSongLocatorStore.getState();
        locator.setRequest(null);
        locator.setNavigator(navigator);
        locator.setSource(sourceOf(started, [a, b, c]));
    });

    it('does nothing when no song plays', () => {
        stand('home', shown, [], null);
        locatePlayingSong();
        locatePlayingSongOnPage(keyOf('shown'));
        expect(request()).toBeNull();
        expect(message()).toBeNull();
        expect(moves()).toEqual([[], [], []]);
    });

    it('a page asked by its own button is the only one asked, answers at once, and no other page is opened', () => {
        // The queue was started from another collection than the one on screen.
        stand('home', shown);
        locatePlayingSongOnPage(keyOf('shown'));
        const first = request()!;
        expect(first).toMatchObject({ collectionKey: keyOf('shown'), songKey: songKey('b'), waits: false });
        // The page does not hold it: that is said, and the listener stays where they are.
        answerLocateRequest(first.nonce, false);
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNotHere' });
        expect(moves()).toEqual([[], [], []]);
        // An answer to a question that is no longer asked changes nothing.
        useStatusMessageStore.getState().setMessage(null);
        locatePlayingSongOnPage(keyOf('shown'));
        const second = request()!;
        expect(second.nonce).not.toBe(first.nonce);
        answerLocateRequest(first.nonce, false);
        expect(request()).toBe(second);
        expect(message()).toBeNull();
        // The page holds it: nothing is said.
        answerLocateRequest(second.nonce, true);
        expect(request()).toBeNull();
        expect(message()).toBeNull();
        expect(moves()).toEqual([[], [], []]);
    });

    it('"playing from" asks the page of the collection the queue was started from, whatever page is on screen', () => {
        // Another collection's page is on screen: the one of the queue is opened over it, and waits for its tracks.
        stand('home', shown);
        locatePlayingSong();
        expect(request()).toMatchObject({ collectionKey: keyOf('started'), songKey: songKey('b'), waits: true });
        expect(moves()).toEqual([[], [], [[started]]]);
        // Its own page is on screen already: it is asked where it stands.
        vi.clearAllMocks();
        stand('home', started);
        locatePlayingSong();
        expect(request()).toMatchObject({ collectionKey: keyOf('started'), waits: true });
        expect(moves()).toEqual([[], [], []]);
        // That page does not hold the song (the collection changed since): that is said.
        answerLocateRequest(request()!.nonce, false);
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNotHere' });
        expect(moves()).toEqual([[], [], []]);
    });

    it('opens the collection the queue was started from when no page of tracks is on screen', () => {
        // From the player, over nothing: the page is opened, and going back from it returns to the player.
        stand('player', null);
        locatePlayingSong();
        expect(request()).toMatchObject({ collectionKey: keyOf('started'), songKey: songKey('b'), waits: true });
        expect(moves()).toEqual([[], [[started, 'player']], []]);
        // From the player, over that very page: the home screen is shown, and the page is there.
        vi.clearAllMocks();
        stand('player', collection('started'));
        locatePlayingSong();
        expect(moves()).toEqual([[[]], [], []]);
        // From the player, over another page.
        vi.clearAllMocks();
        stand('player', shown);
        locatePlayingSong();
        expect(moves()).toEqual([[], [[started, 'player']], []]);
        // From the wall, and from the home screen with no page open.
        vi.clearAllMocks();
        stand('lattice', null);
        locatePlayingSong();
        stand('home', null);
        locatePlayingSong();
        expect(moves()).toEqual([[], [[started, 'home'], [started, 'home']], []]);
        // Over an artist's page, which is of albums and cannot answer.
        vi.clearAllMocks();
        stand('home', collection('someone', 'artist'));
        locatePlayingSong();
        expect(request()).toMatchObject({ collectionKey: keyOf('started') });
        expect(moves()).toEqual([[], [], [[started]]]);
    });

    it('"playing from" says so when the queue is of no collection, and asks no page', () => {
        stand('player', shown, [a, other], a);
        locatePlayingSong();
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNoSource' });
        expect(moves()).toEqual([[], [], []]);
        // Also with a page of tracks on screen: that page is not asked in the collection's place.
        useStatusMessageStore.getState().setMessage(null);
        stand('home', shown, [a, other], a);
        locatePlayingSong();
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNoSource' });
        expect(moves()).toEqual([[], [], []]);
    });
});

describe('a queue started from the home screen', () => {
    const playSong = vi.fn();
    const playAll = vi.fn();
    const { onPlaySong, onPlayAll } = buildHomeModel({ playSong, playAll } as unknown as Parameters<typeof buildHomeModel>[0]).surfaceProps;
    const source = () => usePlayingSongLocatorStore.getState().source;
    // What the player does once it has accepted a play: the song, then the queue.
    const playerTakes = (playing: SongResult, queue: SongResult[]) => {
        usePlaybackStore.setState({ currentSong: playing });
        usePlaybackStore.setState({ playQueue: queue });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useStatusMessageStore.getState().setMessage(null);
        const locator = usePlayingSongLocatorStore.getState();
        locator.setRequest(null);
        locator.setNavigator(navigator);
        // The queue of `started` plays, and is its queue.
        stand('player', null, [a, b, c], b);
        locator.setSource(sourceOf(started, [a, b, c]));
    });

    it('is of the collection on whose page it was started, once the player has taken it', () => {
        onPlaySong(other, [other], false, shown);
        expect(playSong.mock.calls).toEqual([[other, [other], false]]);
        // Asked for, and not playing yet: the queue that plays is still the one of `started`.
        expect(source()?.collection).toBe(started);
        usePlaybackStore.setState({ currentSong: other });
        expect(source()?.collection).toBe(started);
        usePlaybackStore.setState({ playQueue: [other] });
        expect(source()?.collection).toBe(shown);
        expect([...source()!.songKeys]).toEqual([songKey('other')]);
        // "Play all" of a collection page likewise. The queue alone is not the player playing it: the song has to be of it too.
        onPlayAll!([a, c], started);
        expect(playAll.mock.calls).toEqual([[[a, c]]]);
        expect(source()?.collection).toBe(shown);
        usePlaybackStore.setState({ playQueue: [a, c] });
        expect(source()?.collection).toBe(shown);
        usePlaybackStore.setState({ currentSong: a });
        expect(source()?.collection).toBe(started);
        expect([...source()!.songKeys]).toEqual([songKey('a'), songKey('c')]);
    });

    it('is of no collection when it was started anywhere else, though the collection before holds every song of it', () => {
        // The explore tab, an artist's page: a song with its own queue, and no page named.
        onPlaySong(a, [a, b]);
        expect(source()?.collection).toBe(started);
        playerTakes(a, [a, b]);
        expect(source()).toBeNull();
        // So the listener is not sent to the collection before, whose page does hold the song.
        locatePlayingSong();
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNoSource' });
        expect(moves()).toEqual([[], [], []]);
        // "Play all" of something that is no collection page, and the personal radio.
        usePlayingSongLocatorStore.getState().setSource(sourceOf(started, [a, b, c]));
        onPlayAll!([b, c]);
        playerTakes(b, [b, c]);
        expect(source()).toBeNull();
        usePlayingSongLocatorStore.getState().setSource(sourceOf(started, [a, b, c]));
        onPlaySong(c, [c, a], true);
        playerTakes(c, [c, a]);
        expect(source()).toBeNull();
    });

    it('leaves the queue that goes on playing its collection when the play is refused', () => {
        // No song of it can be played, the song is marked unavailable, an extension cancels it: the player takes nothing.
        onPlayAll!([other]);
        onPlaySong(other, [other], false, shown);
        expect(source()?.collection).toBe(started);
        // The queue that plays goes on to its next song, and is still the one of `started`.
        usePlaybackStore.setState({ currentSong: c });
        expect(source()?.collection).toBe(started);
        expect(playbackSourceOf(source(), [a, b, c], c)).toBe(started);
        // What was asked for then is not taken later either, by a queue of its songs that something else starts.
        playerTakes(other, [other]);
        expect(source()?.collection).toBe(started);
    });

    it('leaves the queue that goes on playing its collection when the play is refused, though each of its songs is one of the queue asked for', () => {
        // The app's own "recently played" holds every song of a queue played here; a larger collection may too.
        onPlaySong(other, [other, a, b, c]);
        expect(source()?.collection).toBe(started);
        // The player's other changes (the line being sung, the song's own details) are not it taking a queue.
        usePlaybackStore.setState({ currentLineIndex: 3 });
        usePlaybackStore.setState({ currentSong: { ...b } });
        expect(source()?.collection).toBe(started);
        // Nor is its queue going on to its next song.
        usePlaybackStore.setState({ currentSong: c });
        expect(source()?.collection).toBe(started);
        // Asked again, and taken this time: the song, and then a queue in the place of the one the player had.
        onPlaySong(other, [other, a, b, c]);
        usePlaybackStore.setState({ currentSong: other });
        expect(source()?.collection).toBe(started);
        usePlaybackStore.setState({ playQueue: [other, a, b, c] });
        expect(source()).toBeNull();
    });

    it('is not a queue that holds songs of the one asked for among others', () => {
        // Asked for and refused; then something that is not the home screen starts a queue with one of its songs in it.
        onPlayAll!([other], shown);
        playerTakes(other, [a, other]);
        expect(source()?.collection).toBe(started);
        expect(playbackSourceOf(source(), [a, other], other)).toBeNull();
    });

    it('counts the song that was picked among the songs of its queue', () => {
        // A page hands the songs that can be played as the queue; the one picked may not be among them.
        onPlaySong(other, [a], false, shown);
        playerTakes(other, [a]);
        expect(source()?.collection).toBe(shown);
    });

    it('leaves the queue that is playing its collection when a song is played with no queue of its own', () => {
        onPlaySong(other);
        onPlaySong(other, []);
        playerTakes(other, [a, b, c, other]);
        expect(source()?.collection).toBe(started);
        expect(playSong).toHaveBeenCalledTimes(2);
        // Also where the song is all that is left of the queue: it is played again, and no queue is started.
        usePlayingSongLocatorStore.getState().setSource(sourceOf(started, [a, b, c]));
        playerTakes(a, [a]);
        onPlaySong(a);
        expect(source()?.collection).toBe(started);
    });
});

describe('the collection a queue was started from', () => {
    it('is kept across a restart, and stored data of another shape is not taken', async () => {
        const kept = new Map<string, string>();
        let isFull = false;
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => kept.get(key) ?? null,
            setItem: (key: string, value: string) => { if (isFull) throw new Error('The storage is full'); kept.set(key, value); },
            removeItem: (key: string) => { kept.delete(key); },
        });
        try {
            vi.resetModules();
            const first = await import('@/stores/usePlayingSongLocatorStore');
            expect(first.usePlayingSongLocatorStore.getState().source).toBeNull();
            first.usePlayingSongLocatorStore.getState().setSource(sourceOf(started, [a, b]));
            vi.resetModules();
            const second = await import('@/stores/usePlayingSongLocatorStore');
            const source = second.usePlayingSongLocatorStore.getState().source!;
            expect(source.collection).toEqual(started);
            expect([...source.songKeys]).toEqual([songKey('a'), songKey('b')]);
            // A queue of no collection leaves none stored either.
            second.usePlayingSongLocatorStore.getState().setSource(null);
            expect(second.usePlayingSongLocatorStore.getState().source).toBeNull();
            expect(kept.has('folia_playback_source')).toBe(false);
            second.usePlayingSongLocatorStore.getState().setSource(sourceOf(started, [a, b]));
            expect(kept.has('folia_playback_source')).toBe(true);
            // A write that fails leaves no record of the queue before: the next start begins with none.
            isFull = true;
            second.usePlayingSongLocatorStore.getState().setSource(sourceOf(shown, [c]));
            expect(second.usePlayingSongLocatorStore.getState().source?.collection).toEqual(shown);
            expect(kept.has('folia_playback_source')).toBe(false);
            isFull = false;

            const wrong = [
                '{', '[]', '{"collection":"x","songKeys":[]}', '{"collection":{},"songKeys":"a"}',
                // A collection that does not say which one it is.
                '{"collection":[],"songKeys":["a"]}', '{"collection":{},"songKeys":["a"]}', '{"collection":{"name":"Old"},"songKeys":["a"]}',
                '{"collection":{"source":"online","type":"playlist"},"songKeys":["a"]}',
            ];
            for (const stored of wrong) {
                kept.set('folia_playback_source', stored);
                vi.resetModules();
                expect((await import('@/stores/usePlayingSongLocatorStore')).usePlayingSongLocatorStore.getState().source).toBeNull();
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('a question that waits for a page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useStatusMessageStore.getState().setMessage(null);
        const locator = usePlayingSongLocatorStore.getState();
        locator.setRequest(null);
        locator.setNavigator(navigator);
        locator.setSource(sourceOf(started, [a, b, c]));
    });

    it('stays while that page is the open one, and is dropped when another page or none is', () => {
        // Asked on the way to the page: it is still there once the page is open.
        stand('player', null);
        locatePlayingSong();
        expect(request()?.collectionKey).toBe(keyOf('started'));
        useCollectionNavigationStore.getState().openRoot(started, 'player');
        expect(request()?.collectionKey).toBe(keyOf('started'));

        // The listener goes on to another page before the first has answered.
        useCollectionNavigationStore.getState().push(shown);
        expect(request()).toBeNull();
        expect(message()).toBeNull();

        // And home, with no page open.
        stand('home', shown, [other], other);
        locatePlayingSongOnPage(keyOf('shown'));
        expect(request()?.collectionKey).toBe(keyOf('shown'));
        useCollectionNavigationStore.getState().clear();
        expect(request()).toBeNull();
    });
});

describe('a question nobody is to answer any more', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useStatusMessageStore.getState().setMessage(null);
        const locator = usePlayingSongLocatorStore.getState();
        locator.setRequest(null);
        locator.setNavigator(navigator);
        locator.setSource(sourceOf(started, [a, b, c]));
    });

    it('is dropped when the listener leaves the home screen before the page has answered', () => {
        stand('home', shown, [other], other);
        locatePlayingSongOnPage(keyOf('shown'));
        expect(request()?.collectionKey).toBe(keyOf('shown'));
        useAppViewStore.setState({ view: 'player' });
        expect(request()).toBeNull();
        expect(message()).toBeNull();
    });

    it('stays on the way from the player to the page it was put to', () => {
        stand('player', null);
        locatePlayingSong();
        useCollectionNavigationStore.getState().openRoot(started, 'player');
        useAppViewStore.setState({ view: 'home' });
        expect(request()?.collectionKey).toBe(keyOf('started'));
    });

    it('is dropped when another song begins before the page has answered', () => {
        stand('home', shown, [other], other);
        locatePlayingSongOnPage(keyOf('shown'));
        expect(request()?.songKey).toBe(songKey('other'));
        // The same song, said again by the player, changes nothing.
        usePlaybackStore.setState({ currentSong: { ...other } });
        expect(request()?.songKey).toBe(songKey('other'));
        usePlaybackStore.setState({ currentSong: a });
        expect(request()).toBeNull();
        expect(message()).toBeNull();
    });

    it('is answered with what the page could not do where its list is not whole', () => {
        stand('home', shown, [other], other);
        locatePlayingSongOnPage(keyOf('shown'));
        answerLocateRequest(request()!.nonce, 'unread');
        expect(request()).toBeNull();
        expect(message()?.text).toBe('status.playingSongListUnread');
        expect(moves()).toEqual([[], [], []]);
    });
});
