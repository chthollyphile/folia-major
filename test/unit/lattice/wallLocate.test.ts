import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/lattice/wallLocate.test.ts — the wall's part in "locate the playing song": a press
// asks the wall that is up under that wall's own key, and the wall answers for its tiles: it
// shows the tile of the song, or the locator says that the song is not here. A question put to
// another page, or to the other wall, is not the wall's to answer.

vi.mock('../../../src/i18n/config', async importOriginal => ({ ...await importOriginal<object>(), default: { t: (key: string) => key, on: () => {}, language: 'en' } }));
import { answerWallLocate, locatePlayingSongOnWall, wallPageKey } from '../../../src/components/app/lattice/wallLocate';
import { locatePlayingSongOnPage } from '../../../src/components/app/playing-song-locator/playingSongLocator';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../src/stores/usePlayingSongLocatorStore';
import { useStatusMessageStore } from '../../../src/stores/useStatusMessageStore';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';

const song = (id: string): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, duration: 0,
    sourceRef: { kind: 'online', providerId: 'ytm', mediaId: id },
} as unknown as SongResult);
const [a, b, elsewhere] = ['a', 'b', 'elsewhere'].map(song);
const tiles = [a, b].map(entry => ({ id: getPlaybackSongKey(entry) }));
const request = () => usePlayingSongLocatorStore.getState().request;
const message = () => useStatusMessageStore.getState().message;

// The wall of `source` is up, and `playing` plays.
const stand = (source: 'queue' | 'explore', playing: SongResult | null) => {
    useAppViewStore.setState({ view: 'lattice', latticeSource: source });
    usePlaybackStore.setState({ currentSong: playing, playQueue: playing ? [playing] : [] });
};

describe('locating the playing song on the wall', () => {
    beforeEach(() => {
        useStatusMessageStore.getState().setMessage(null);
        usePlayingSongLocatorStore.getState().setRequest(null);
    });

    it('a press asks the wall that is up, each wall under its own key, and nothing while no song plays', () => {
        expect(wallPageKey('queue')).not.toBe(wallPageKey('explore'));
        stand('queue', b);
        locatePlayingSongOnWall();
        expect(request()).toMatchObject({ collectionKey: wallPageKey('queue'), songKey: getPlaybackSongKey(b), waits: false });
        stand('explore', b);
        locatePlayingSongOnWall();
        expect(request()).toMatchObject({ collectionKey: wallPageKey('explore'), songKey: getPlaybackSongKey(b), waits: false });
        usePlayingSongLocatorStore.getState().setRequest(null);
        stand('queue', null);
        locatePlayingSongOnWall();
        expect(request()).toBeNull();
    });

    it('found: the tile of the song is shown, the question is answered, and nothing is said', () => {
        stand('queue', b);
        locatePlayingSongOnWall();
        const showTile = vi.fn();
        answerWallLocate(request(), wallPageKey('queue'), tiles, showTile);
        expect(showTile.mock.calls).toEqual([[getPlaybackSongKey(b)]]);
        expect(request()).toBeNull();
        expect(message()).toBeNull();
    });

    it('not on this wall: no tile is shown, and the locator says that the song is not here', () => {
        stand('explore', elsewhere);
        locatePlayingSongOnWall();
        const showTile = vi.fn();
        answerWallLocate(request(), wallPageKey('explore'), tiles, showTile);
        expect(showTile).not.toHaveBeenCalled();
        expect(request()).toBeNull();
        expect(message()).toEqual({ type: 'info', text: 'status.playingSongNotHere' });
    });

    it('a question put to the other wall, or to a collection page, is left for it, as is no question', () => {
        stand('explore', b);
        const showTile = vi.fn();
        locatePlayingSongOnWall();
        const forOtherWall = request();
        answerWallLocate(forOtherWall, wallPageKey('queue'), tiles, showTile);
        expect(request()).toBe(forOtherWall);
        locatePlayingSongOnPage('online:playlist:shown');
        const forPage = request();
        answerWallLocate(forPage, wallPageKey('explore'), tiles, showTile);
        expect(request()).toBe(forPage);
        answerWallLocate(null, wallPageKey('explore'), tiles, showTile);
        expect(showTile).not.toHaveBeenCalled();
        expect(message()).toBeNull();
    });
});
