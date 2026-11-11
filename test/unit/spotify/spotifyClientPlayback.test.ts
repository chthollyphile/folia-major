// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyClientPlayback.test.ts — what the Spotify app's own answers become for
// Folia: the song it was told to play, the handoff to a track Folia put in the app's queue, the end
// of the song near its own end, an advertisement between songs, the fallback answer that names no
// track, the queue that is only written once the app took it, and the run that stops steering
// with a reason of its own where the app is not on this computer.

// A start answers the word the app answers with: it took the track. Every other call answers
// the probe's answer unless the test says otherwise.
const request = vi.hoisted(() => vi.fn(async (operation: string): Promise<unknown> => (
    operation === 'client_play' ? 'loaded' : { available: true }
)));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { OnlineProviderError } from '@/types/onlineMusic';
import { describeSpotifyFailure } from '@/services/onlineMusic/spotify/spotifyFailure';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { normalizeSpotifySong } from '@/services/onlineMusic/spotify/spotifyNormalize';
import {
    PREPARED_SONGS, PREPARED_SONGS_UNCLEARABLE,
    canSteerSpotifyApp, resetSpotifyClientPlayback, spotifyClientAttempt, spotifyClientPlayback,
    spotifyClientWrittenTrackIds, statusOfClient,
} from '@/services/onlineMusic/spotify/spotifyClientPlayback';
import { spotifyExternalPlayback } from '@/services/onlineMusic/spotify/spotifyExternalPlayback';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode } from '@/services/onlineMusic/spotify/spotifySoloistPlayback';
import type { SongResult } from '@/types';

// The page's own queue code, run here as the app runs it: the two layers are mocked apart in every
// other case, and a song written twice is exactly what the seam between them can produce.
const { MAX_QUEUED, QUEUE_SOURCE, START_QUEUE_SOURCE } = createRequire(import.meta.url)('../../../electron/spotify/officialClient.cjs') as {
    MAX_QUEUED: number;
    QUEUE_SOURCE: string;
    START_QUEUE_SOURCE: string;
};

const id = (letter: string) => letter.repeat(22);
const songOf = (letter: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`,
    artists: { items: [{ uri: `spotify:artist:${id('r')}`, profile: { name: 'Artist' } }] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

/** A song Spotify lists two artists for: its media session names only the leading one. */
const duetOf = (letter: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`,
    artists: { items: [
        { uri: `spotify:artist:${id('r')}`, profile: { name: 'Artist' } },
        { uri: `spotify:artist:${id('s')}`, profile: { name: 'Guest' } },
    ] },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

/** A song of the given title and artists, whose artist names the media session may show a part of. */
const named = (letter: string, name: string, artists: string[]): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name,
    artists: { items: artists.map((artist, index) => ({ uri: `spotify:artist:${id(String.fromCharCode(114 + index))}`, profile: { name: artist } })) },
    albumOfTrack: { uri: `spotify:album:${id('m')}`, name: 'Album', coverArt: { sources: [] } },
    duration: { totalMilliseconds: 200000 },
} as never);

const playing = (mediaId: string, extra: Record<string, unknown> = {}) => ({
    id: mediaId, ad: false, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 200000, ...extra,
});

/** The media session's answer: no track id, no duration of its own, its own coarse position. */
const degraded = (extra: Record<string, unknown> = {}) => ({
    id: '', ad: false, fallback: true, isPaused: false, isBuffering: false, positionMs: 1000, durationMs: 0, ...extra,
});

/**
 * What the page answers a queue write the app took whole, into a queue it can empty: the shape most
 * cases need, so a case about the queue itself is told apart by the player it runs against.
 */
const queueTaken = (params?: unknown) => {
    const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
    return { aborted: false, cleared: true, canClear: true, written: ids, read: ids };
};

beforeEach(() => {
    // The steering asks the desktop side whether the app is there at all.
    Object.defineProperty(window, 'electron', {
        value: { platform: 'win32', spotifyRequest: vi.fn() },
        configurable: true,
        writable: true,
    });
    request.mockReset();
    delete (window as unknown as { __foliaPlay?: number }).__foliaPlay;
    request.mockImplementation(async (operation: string, params?: unknown) => {
        if (operation === 'client_play') return 'loaded';
        if (operation === 'client_queue') return queueTaken(params);
        // The app takes the repeat of the track: a test about a refusal answers instead.
        if (operation === 'client_repeat') return { read: true, changed: false, now: 2 };
        return { available: true };
    });
    resetSpotifyClientPlayback();
});

describe('a song the app is playing', () => {
    it('answers for the song Folia asked for, and names the track it holds', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 0, userAction: true, written: [], replaceQueue: false });

        const status = statusOfClient(playing(id('a')));
        expect(status.mediaId).toBe(id('a'));
        expect(status.isPlaying).toBe(true);
        expect(status.ended).toBe(false);
        expect(spotifyClientAttempt()?.hasPlayed).toBe(true);
    });

    it('takes a track change to the song Folia queued next for the end of this one', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [] });
        statusOfClient(playing(id('a')));

        const handoff = statusOfClient(playing(id('b')));
        expect(handoff.ended).toBe(true);
        expect(handoff.mediaId).toBe(id('a'));
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(true);
    });

    it('adopts the song the app already moved on to, without starting it again', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(playing(id('a')));
        statusOfClient(playing(id('b')));
        request.mockClear();

        await spotifyClientPlayback.play!(b, 0);
        expect(request).not.toHaveBeenCalledWith('client_play', expect.anything());
        expect(spotifyClientAttempt()?.hasPlayed).toBe(true);
    });

    it('takes a track change near the end of the song for its end, even to a song of the app itself', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a'), { positionMs: 198000 }));

        const status = statusOfClient(playing(id('c')));
        expect(status.ended).toBe(true);
        expect(spotifyClientPlayback.isPrepared!(songOf('c'))).toBe(false);
    });

    it('leaves a track change that happens before the song ever played as the song still loading', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);

        // Folia just asked for the song: the app still answering with the old track is not a skip.
        const status = statusOfClient(playing(id('c')));
        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
    });
});

describe('a track change the app made by its own controls', () => {
    it('is pulled back to Folia queue: a track that is not the previous one steps on', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a'), { positionMs: 10000 }));

        const status = statusOfClient(playing(id('c')));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('next');
        expect(status.mediaId).toBe(id('a'));
    });

    it('is pulled back one step back when the app went to the track Folia played before', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.play!(b, 0);
        statusOfClient(playing(id('b'), { positionMs: 10000 }));

        const status = statusOfClient(playing(id('a')));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('previous');
    });

    it('is pulled back once only, however long the app stays on the other track', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a'), { positionMs: 10000 }));
        expect(statusOfClient(playing(id('c'))).skipped).toBe('next');
        expect(statusOfClient(playing(id('c'))).skipped).toBeUndefined();
    });

    it('is not a skip when the song ran out, when the app went on to the song Folia queued, or for an advertisement', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(playing(id('a'), { positionMs: 10000 }));
        statusOfClient({ id: '', ad: true, isPaused: false, isBuffering: false, positionMs: 0, durationMs: 30000 });
        const queued = statusOfClient(playing(id('b')));
        expect(queued.ended).toBe(true);
        expect(queued.skipped).toBeUndefined();

        await spotifyClientPlayback.play!(songOf('d'), 0);
        statusOfClient(playing(id('d'), { positionMs: 198000 }));
        const ran = statusOfClient(playing(id('c')));
        expect(ran.ended).toBe(true);
        expect(ran.skipped).toBeUndefined();
    });
});

describe('the press of play on a song whose Spotify was closed', () => {
    const gone = () => new OnlineProviderError('unavailable', 'The media session did not answer', 'spotify');

    it('starts Spotify again on the song from the position Folia holds, as the listener asked', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(playing(id('a'), { positionMs: 83000 }));
        request.mockClear();
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_resume') throw gone();
            if (operation === 'client_queue') return queueTaken(params);
            return operation === 'client_play' ? 'loaded' : { available: true };
        });

        await spotifyClientPlayback.resume!();
        expect(request).toHaveBeenCalledWith('client_resume');
        const operations = request.mock.calls.map(call => call[0]);
        expect(operations).toEqual(['client_resume', 'client_play', 'client_queue']);
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 83000, userAction: true });
        // What was queued in the closed app went with it: the songs that follow are put back, and
        // Folia's record of them holds again (its prepared-queue key does not change, so it would not ask).
        // The restart began a new player, so nothing written before is recorded as still held.
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [] });
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('b')]);
        expect(spotifyClientAttempt()?.hasPlayed).toBe(false);
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(false);
        statusOfClient(playing(id('a'), { positionMs: 84000 }));
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(true);
    });

    it('still resumes when the songs that follow cannot be put back, and leaves none recorded as prepared', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(playing(id('a'), { positionMs: 5000 }));
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_resume') throw gone();
            if (operation === 'client_queue') throw gone();
            return operation === 'client_play' ? 'loaded' : { available: true };
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(spotifyClientPlayback.resume!()).resolves.toBeUndefined();
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('puts nothing back for a song that was changed while the app started', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(playing(id('a'), { positionMs: 5000 }));
        request.mockClear();
        let changed = false;
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_resume') throw gone();
            if (operation === 'client_play' && !changed) {
                // The listener picks another song while Spotify is still starting.
                changed = true;
                await spotifyClientPlayback.play!(c, 0);
                return 'loaded';
            }
            if (operation === 'client_queue') return queueTaken(params);
            return operation === 'client_play' ? 'loaded' : { available: true };
        });
        await spotifyClientPlayback.resume!();
        expect(request.mock.calls.filter(call => call[0] === 'client_queue')).toEqual([]);
        expect(spotifyClientAttempt()?.id).toBe(id('c'));
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);
    });

    it('does nothing more when the resume worked, and does not mistake a refused request for a closed app', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        request.mockClear();
        await spotifyClientPlayback.resume!();
        expect(request.mock.calls.map(call => call[0])).toEqual(['client_resume']);

        request.mockClear();
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_resume') throw new OnlineProviderError('invalid-response', 'refused', 'spotify');
            return { available: true };
        });
        await expect(spotifyClientPlayback.resume!()).rejects.toMatchObject({ code: 'invalid-response' });
        expect(request).not.toHaveBeenCalledWith('client_play', expect.anything());
    });

    it('never starts Spotify for a pause', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        request.mockClear();
        request.mockImplementation(async () => { throw gone(); });
        await expect(spotifyClientPlayback.pause!()).rejects.toMatchObject({ code: 'unavailable' });
        expect(request.mock.calls.map(call => call[0])).toEqual(['client_pause']);
    });
});

describe('the songs that follow', () => {
    it('writes nothing prepared for a repeat of one song', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        // Repeat one keeps the queue Folia has: nothing is put in the app's own queue, and the
        // preparation held stays empty so the next song is never adopted from it.
        request.mockClear();
        await spotifyClientPlayback.prepareNext!(a, []);
        expect(request).not.toHaveBeenCalledWith('client_queue', expect.anything());
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);
    });

    it('records nothing as written where the app emptied its queue and refused the songs back', async () => {
        // The clear ran and the songs were refused: the app holds none of them, and the songs the
        // listener had queued there are not songs of Folia's. The write is not a failure of the play.
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') {
                return { aborted: false, cleared: true, restored: false, canClear: true, written: [], read: [] };
            }
            return { available: true };
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(spotifyClientPlayback.prepareNext!(a, [b])).resolves.toBeUndefined();

        expect(spotifyClientAttempt()?.nextIds).toEqual([]);
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(false);
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain('were lost');
        warn.mockRestore();
    });

    it('remembers only the queue the app took, so a failed write is tried again', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        request.mockRejectedValueOnce(new OnlineProviderError('unavailable', 'Spotify did not answer', 'spotify'));

        await expect(spotifyClientPlayback.prepareNext!(a, [b])).rejects.toThrow();
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(false);
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);

        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [] });
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(true);
    });
});

describe('the names held of the songs written', () => {
    it('lets go of them once a start emptied the app queue', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(spotifyClientWrittenTrackIds()).toEqual([id('b')]);

        // A start empties the app's queue where it can, so the song written behind this one is not
        // there any more: its name is held for nothing.
        await spotifyClientPlayback.play!(b, 0);
        expect(spotifyClientWrittenTrackIds()).toEqual([]);
    });

    it('lets go of the one the app moved on to by itself', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(spotifyClientWrittenTrackIds()).toEqual([id('b')]);

        // The app ends this song and goes on to the one Folia wrote behind it: that song is the
        // app's own track now, so its name is no longer held for reading a move the app made.
        statusOfClient(playing(id('a')));
        const handedOver = statusOfClient(playing(id('b')));
        expect(handedOver.ended).toBe(true);
        expect(spotifyClientWrittenTrackIds()).toEqual([]);
    });

    it('lets go of every one of them when the run is forgotten', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b]);

        resetSpotifyClientPlayback();
        expect(spotifyClientWrittenTrackIds()).toEqual([]);
    });
});

describe('an advertisement between songs', () => {
    it('is reported as one, and never as another song to stop', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient({ id: '', ad: true, isPaused: false, isBuffering: false, positionMs: 0, durationMs: 30000 });
        expect(status.advertisement).toBe(true);
        expect(status.ended).toBe(false);
        expect(status.mediaId).toBe(id('a'));
    });

    it('is not advertised on an ordinary answer', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        expect(statusOfClient(playing(id('a'))).advertisement).toBeUndefined();
    });
});

describe('the fallback answer', () => {
    it('is marked degraded when the media session answered instead of the app', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        const status = statusOfClient(degraded({ isPaused: true, positionMs: 0 }));
        expect(status.degraded).toBe(true);
        expect(status.mediaId).toBe(id('a'));
    });

    it('never replaces the song duration with a coarse answer that has none', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient(degraded());
        expect(status.durationMs).toBe(200000);
        expect(spotifyClientAttempt()?.durationMs).toBe(200000);
    });

    it('is not degraded when the app itself answered', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        expect(statusOfClient(playing(id('a'))).degraded).toBe(false);
    });

    it('prepares nothing while the app is steered coarsely', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        statusOfClient(degraded());
        request.mockClear();

        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(request).not.toHaveBeenCalledWith('client_queue', expect.anything());
    });

    it('ends the session when the title it shows is another song', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient(degraded({ title: 'Something Else', artist: 'Somebody' }));
        expect(status.ended).toBe(true);
        expect(status.mediaId).toBe(id('a'));
    });

    it('reads a title that only gained a "(with …)" credit as another song', async () => {
        const a = named('a', 'Song', ['Artist']);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient(degraded({ title: 'Song (With You)', artist: 'Artist' }));
        expect(status.ended).toBe(true);
    });

    it('ends the session when the title it shows is a song Folia had written and then took back', async () => {
        // Repeat one: the songs behind this one were written and, where the app can empty its queue,
        // taken back. A tail the app could not give up still plays, and read coarsely it is only its
        // title and artist that say which song it is. That one playing now is this song ending - the
        // app moved on by itself - and not the listener pressing next.
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') {
                const ids = (params as { ids?: string[] }).ids ?? [];
                return { aborted: false, cleared: false, canClear: false, written: ids, read: ids };
            }
            return { available: true };
        });
        await spotifyClientPlayback.prepareNext!(a, [b]);
        // Steered coarsely from here: nothing is written, and the retract leaves the queue as it is.
        statusOfClient(degraded({ title: 'Song a', artist: 'Artist' }));
        request.mockClear();
        await spotifyClientPlayback.prepareNext!(a, [], { retract: true });

        const status = statusOfClient(degraded({ title: 'Song b', artist: 'Artist' }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBeUndefined();
    });

    it('treats a title Folia never wrote as the listener stepping the app itself', async () => {
        // The record names the songs Folia put behind this one. A title that is none of them was not
        // the app moving on by itself but the listener using the app's own controls, and it is pulled
        // back exactly as the app's own answer is.
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(degraded({ title: 'Song a', artist: 'Artist' }));

        const status = statusOfClient(degraded({ title: 'Something Else', artist: 'Somebody' }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('next');
    });

    it('keeps the session when the title it shows is the same song', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient(degraded({ title: 'Song a', artist: 'Artist' }));
        expect(status.ended).toBe(false);
    });
});

describe('a start and where it stopped', () => {
    it('tells the desktop side that no one pressed play for an advance of its own', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0, { userAction: false });
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 0, userAction: false, written: [], replaceQueue: false });
    });

    it('says nothing when a newer play took the app', async () => {
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('preempted');
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).resolves.toBeUndefined();
        // Nothing went wrong: the app is still steered.
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('reports a failure when the app never got to the song, and keeps steering', async () => {
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('not-loaded');
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({ code: 'not-playable' });
        // One track the app did not load does not retire the app for the rest of the run.
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('reports a song Spotify will not play as the case Folia already has for a taken-down song', async () => {
        request.mockResolvedValueOnce({ available: true })
            .mockResolvedValueOnce({ answer: 'unavailable', code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE'] });
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({
            code: 'not-playable', cause: 'track-unavailable',
        });
        // The song is taken down rather than missing its audio: Folia shows it as it shows one.
        expect(describeSpotifyFailure('audio', new OnlineProviderError('not-playable', 'x', 'spotify', 'track-unavailable')))
            .toEqual({ case: 'taken-down', skipAtOnce: true });
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('reports a song only a paying account may play as needing a plan', async () => {
        // The player said the free account is what stops this track: it is not taken down, and Folia
        // shows it with the words it has for a song that needs a membership.
        request.mockResolvedValueOnce({ available: true })
            .mockResolvedValueOnce({ answer: 'premium-only', code: 'ONE_TRACK_UNPLAYABLE', reasons: ['NOT_AVAILABLE_IN_NON_PREMIUM'] });
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({
            code: 'not-playable', cause: 'premium-only',
        });
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('marks both ways Spotify refuses a track as one to skip at once', () => {
        const failure = (reason: string) => describeSpotifyFailure('audio', new OnlineProviderError('not-playable', 'x', 'spotify', reason));
        expect(failure('track-unavailable')).toEqual({ case: 'taken-down', skipAtOnce: true });
        expect(failure('premium-only')).toEqual({ case: 'subscription-required', skipAtOnce: true });
    });

    it('leaves every other failed start as a song without audio', async () => {
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('not-loaded');
        const failed = await spotifyClientPlayback.play!(songOf('a'), 0).then(() => null, (error: unknown) => error);
        expect(failed).toMatchObject({ code: 'not-playable' });
        expect(onlineFailureOf({ operation: 'audio', providerId: 'spotify' }, { error: failed }).case).toBe('no-audio');
    });

    it('keeps steering when an advance of its own could not reach the app', async () => {
        request.mockResolvedValueOnce({ available: true })
            .mockRejectedValueOnce(new OnlineProviderError('unavailable', 'Spotify runs without its DevTools port', 'spotify'));
        await expect(spotifyClientPlayback.play!(songOf('a'), 0, { userAction: false })).rejects.toMatchObject({ code: 'unavailable' });
        // No one pressed play: the next press may still start the app, so the route is not given up.
        expect(canSteerSpotifyApp()).toBe(true);
    });
});

describe('an app that is not there', () => {
    it('fails the song with a reason that opens the setup checklist, and never plays it in Folia', async () => {
        request.mockResolvedValueOnce({ available: false });
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({ code: 'unavailable', cause: 'client-missing' });
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'client-missing'))).toEqual({ case: 'not-configured' });
        // Nothing but the question was sent to the app.
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith('client_probe');
    });

    it('asks again for the next song: installing the app later is enough, no restart of Folia', async () => {
        request.mockResolvedValueOnce({ available: false });
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({ cause: 'client-missing' });
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('loaded');
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).resolves.toBeUndefined();
        expect(request).toHaveBeenCalledWith('client_play', expect.objectContaining({ id: id('a') }));
    });

    it('does not retire the app for the run when a play is refused as unavailable', async () => {
        request.mockResolvedValueOnce({ available: true })
            .mockRejectedValueOnce(new OnlineProviderError('unavailable', 'The Spotify app is not installed', 'spotify'));
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({ code: 'unavailable' });
        expect(canSteerSpotifyApp()).toBe(true);
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('loaded');
        await expect(spotifyClientPlayback.play!(songOf('b'), 0)).resolves.toBeUndefined();
    });

    it('keeps steering when the refusal is about the request itself', async () => {
        const a = songOf('a');
        request.mockResolvedValueOnce({ available: true })
            .mockRejectedValueOnce(new OnlineProviderError('invalid-response', 'Invalid Spotify track', 'spotify'));
        await expect(spotifyClientPlayback.play!(a, 0)).rejects.toMatchObject({ code: 'invalid-response' });
        expect(canSteerSpotifyApp()).toBe(true);
    });
});

describe('an advertisement the start waits through', () => {
    it('is an accepted start, and the status reads follow it', async () => {
        const a = songOf('a');
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('advertisement');
        await expect(spotifyClientPlayback.play!(a, 0)).resolves.toBeUndefined();
        // The song is held, and the advertisement reads as it still loading rather than as its end.
        const status = statusOfClient({ id: '', ad: true, isPaused: false, isBuffering: false, positionMs: 0, durationMs: 30000 });
        expect(status.advertisement).toBe(true);
        expect(status.mediaId).toBe(id('a'));
    });
});

describe('a track the app is still playing after the window that started it', () => {
    it('takes the track over so the queue that follows is written and its end is read again', async () => {
        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await setSpotifyPlaybackMode('client');
        const a = songOf('a');
        const b = songOf('b');

        // The window that started the song is gone: the app plays on and nothing is started here.
        spotifyExternalPlayback.adopt!(a);
        expect(request).not.toHaveBeenCalledWith('client_play', expect.anything());
        expect(spotifyClientAttempt()?.id).toBe(id('a'));

        // Nothing is held of what this window put there, so the songs are written from Folia's own
        // record and the app still moves on without a gap.
        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [] });
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(true);

        // The app going on to a song of its own after this one ran out is this song's end, not a
        // track Folia knows nothing about.
        expect(statusOfClient(playing(id('a'))).mediaId).toBe(id('a'));
        const ranOut = statusOfClient(playing(id('z'), { positionMs: 199000 }));
        expect(ranOut.ended).toBe(true);
        expect(ranOut.mediaId).toBe(id('a'));
    });
});

describe('the songs that follow, kept three deep and written once', () => {
    /** The write Folia makes on its own clock: the first one asks the app what it can do, the next fills the tail in. */
    const prepare = async (song: SongResult, following: SongResult[]) => {
        await spotifyClientPlayback.prepareNext!(song, following);
        await spotifyClientPlayback.prepareNext!(song, following);
    };
    /** What an app that cannot empty its queue answers a write: it takes the songs it is given. */
    const cannotEmpty = (params?: unknown) => {
        const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
        return { aborted: false, cleared: false, canClear: false, written: ids, read: ids };
    };

    it('keeps three songs queued after the one playing, once it knows the app can empty its queue', async () => {
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        // The first write of a run is the one that asks whether the app can empty its queue, and it
        // takes the least that can be taken back: one song.
        await spotifyClientPlayback.prepareNext!(a, [b, c, d]);
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [] });
        await spotifyClientPlayback.prepareNext!(a, [b, c, d]);

        expect(request).toHaveBeenLastCalledWith('client_queue', {
            ids: [id('b'), id('c'), id('d')], queued: [id('b')],
        });
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('b'), id('c'), id('d')]);
        // What the app named is a record of its own, kept apart from what Folia wrote.
        expect(spotifyClientAttempt()?.confirmedIds).toEqual([id('b'), id('c'), id('d')]);
    });

    it('tops the tail up after the app moves on, handing over the songs it already holds', async () => {
        const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        statusOfClient(playing(id('a')));
        expect(statusOfClient(playing(id('b'))).ended).toBe(true);

        // The app took the first of the three by itself: the two behind it are still its queue.
        await spotifyClientPlayback.play!(b, 0);
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('c'), id('d')]);
        request.mockClear();

        await spotifyClientPlayback.prepareNext!(b, [c, d, e]);
        expect(request).toHaveBeenLastCalledWith('client_queue', {
            ids: [id('c'), id('d'), id('e')], queued: [id('c'), id('d')],
        });
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('c'), id('d'), id('e')]);
    });

    it('writes nothing again when the songs that follow are the ones the app was given', async () => {
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c]);
        request.mockClear();

        await spotifyClientPlayback.prepareNext!(a, [b, c]);
        expect(request).not.toHaveBeenCalledWith('client_queue', expect.anything());
    });

    it('keeps one song, and says why, when the app cannot empty its queue', async () => {
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') return cannotEmpty(params);
            return { available: true };
        });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            await spotifyClientPlayback.play!(a, 0);
            await prepare(a, [b, c, d]);

            // One song and no more: the window is one while a queue can only grow, so the second
            // write asked for the song it was already given and nothing went.
            expect(request.mock.calls.filter(call => call[0] === 'client_queue')).toHaveLength(1);
            expect(spotifyClientAttempt()?.nextIds).toEqual([id('b')]);
            expect(info).toHaveBeenCalledWith(expect.stringContaining('it cannot empty its queue, so one song is kept at a time'));
        } finally {
            info.mockRestore();
        }
    });

    it('says in one line on every write what the app took, what it read, and whether it can empty its queue', async () => {
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            await spotifyClientPlayback.play!(a, 0);
            await prepare(a, [b, c]);

            // A write that went as asked is logged as well: it says the queue was emptied first, how
            // many songs were written and how many the app named afterwards.
            expect(info).toHaveBeenCalledWith(
                '[SpotifyClient] the songs that follow: its queue was emptied first, 1 of 1 written, 1 read back, the same songs',
            );
        } finally {
            info.mockRestore();
        }
    });
});

describe('the queue a window writes into the app own player', () => {
    const writeInPage = (new Function('return (' + QUEUE_SOURCE + ')')()) as (input: unknown) => Promise<{
        aborted?: boolean; canClear: boolean | null; cleared: boolean; written: string[]; read: string[] | null;
    }>;
    const startQueueInPage = (new Function('return (' + START_QUEUE_SOURCE + ')')()) as (input: unknown) => Promise<{
        cleared: boolean; canClear: boolean | null; restored?: boolean; written: string[]; read: string[] | null;
    }>;

    /**
     * The app as the page drives it: the songs it holds behind the one playing, in the order it will
     * play them, whether it can empty that queue at all, and a read that may still show the queue as
     * it was before a write, because Spotify writes its own state a moment late.
     */
    const fakeApp = (options: { start?: string[]; clear?: 'works' | 'noop' | 'none'; lag?: boolean } = {}) => {
        const queue: string[] = [...(options.start ?? [])];
        /** Every id the app was ever given, in the order it was given them. */
        const given: string[] = [];
        let playing = '';
        let shown: string[] | null = null;
        const track = (entry: { uri: string }) => entry.uri.slice(14);
        const asState = (ids: string[]) => ({ nextTracks: ids.map(entry => ({ uri: 'spotify:track:' + entry })) });
        const player: Record<string, unknown> = {
            getState: () => asState(shown ?? queue),
            addToQueue: (entries: { uri: string }[]) => {
                if (options.lag) shown ??= [...queue];
                for (const entry of entries) { queue.push(track(entry)); given.push(track(entry)); }
            },
        };
        if (options.clear === 'works') player.clearQueue = async () => { queue.length = 0; };
        if (options.clear === 'noop') player.clearQueue = async () => {};
        return {
            player, queue, given,
            /**
             * A start: the app plays that track. Emptying the queue is the start's own call
             * (`START_QUEUE_SOURCE`), not the player's play, so it is not done here.
             */
            begin: (next: string) => { playing = next; },
            /** The app ends the track it plays and moves on to the first song of its own queue. */
            advance: () => { playing = queue.shift() ?? ''; return playing; },
            current: () => playing,
            /** The read catches up with what was written. */
            settle: () => { shown = null; },
        };
    };

    /**
     * The renderer's queue write, answered by the page's own code, with the page's own memory of this
     * run: the capability its first write found, and the play every write belongs to.
     */
    let probed: boolean | null = null;
    let generation = 0;
    const answerInPage = (app: ReturnType<typeof fakeApp>) => {
        probed = null;
        generation = 0;
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') {
                // A start takes the next generation and writes it into the page, as the client does.
                generation += 1;
                (window as unknown as { __foliaPlay?: number }).__foliaPlay = generation;
                // The start's own emptying of the queue: only the songs of Folia's record are its own,
                // and the listener's are given back where they held. A player that cannot empty its
                // queue keeps it, and the write below adds to it.
                const emptied = await startQueueInPage({
                    api: { player: app.player },
                    owned: (params as { written?: string[] }).written ?? [],
                    // Passed on as the client passes it: a play that replaces the whole queue takes
                    // the app's queue with it, and gives none of it back.
                    replaceQueue: (params as { replaceQueue?: boolean }).replaceQueue === true,
                });
                if (typeof emptied.canClear === 'boolean') probed = emptied.canClear;
                app.begin((params as { id: string }).id);
                return 'loaded';
            }
            if (operation !== 'client_queue') return { available: true };
            const { ids, queued } = params as { ids: string[]; queued: string[] };
            const answer = await writeInPage({
                api: { player: app.player },
                uris: ids.map(entry => 'spotify:track:' + entry),
                queued, probed, generation,
            });
            if (typeof answer.canClear === 'boolean') probed = answer.canClear;
            return answer;
        });
    };

    /** The write Folia makes on its own clock, twice: the first asks the app, the second fills the tail in. */
    const prepare = async (song: SongResult, following: SongResult[]) => {
        await spotifyClientPlayback.prepareNext!(song, following);
        await spotifyClientPlayback.prepareNext!(song, following);
    };
    /** The app ends this song and moves on to the song Folia put next, and Folia follows it there. */
    const handOver = async (app: ReturnType<typeof fakeApp>, next: string) => {
        statusOfClient(playing(app.current()));
        expect(app.advance()).toBe(id(next));
        const adopted = statusOfClient(playing(id(next)));
        expect(adopted.ended).toBe(true);
        expect(adopted.skipped).toBeUndefined();
        await spotifyClientPlayback.play!(songOf(next), 0);
    };

    it('keeps a song the listener queued in the app when Folia plays a song of its own', async () => {
        // The listener put 'u' in Spotify's own queue, then played 'a' in Folia: the start empties
        // that queue for its own reason, and 'u' is theirs, not Folia's to take.
        const app = fakeApp({ clear: 'works', start: [id('u')] });
        answerInPage(app);
        await spotifyClientPlayback.play!(songOf('a'), 0);

        expect(app.queue).toEqual([id('u')]);
        // The songs that follow are written behind it, so 'u' stays ahead of them where it was.
        await prepare(songOf('a'), [songOf('b'), songOf('c')]);
        expect(app.queue).toEqual([id('u'), id('b'), id('c')]);
    });

    it('takes the app queue whole where the listener played a whole list here', async () => {
        // The listener played a playlist in Folia: that list replaces the queue Folia holds, so the
        // queue they built in Spotify's window goes with the queue it replaced - both the songs of
        // Folia's and their own, and none of them is put back.
        const app = fakeApp({ clear: 'works', start: [id('u'), id('b'), id('v')] });
        answerInPage(app);
        await spotifyClientPlayback.play!(songOf('a'), 0, { replaceQueue: true });

        expect(request).toHaveBeenCalledWith('client_play', expect.objectContaining({ replaceQueue: true }));
        expect(app.queue).toEqual([]);
        // What follows the new song is Folia's list, with nothing of the listener's left among it.
        await prepare(songOf('a'), [songOf('b'), songOf('c')]);
        expect(app.queue).toEqual([id('b'), id('c')]);
    });

    it('keeps those songs where the same play is not a whole list', async () => {
        // A single song played, a skip, and an advance of Folia's own are not a list: the same
        // player is emptied of the songs Folia wrote only, and the listener's are given back.
        const app = fakeApp({ clear: 'works', start: [id('u'), id('v')] });
        answerInPage(app);
        await spotifyClientPlayback.play!(songOf('a'), 0);

        expect(request).toHaveBeenCalledWith('client_play', expect.objectContaining({ replaceQueue: false }));
        expect(app.queue).toEqual([id('u'), id('v')]);
    });

    it('rewrites its own part of the queue when Folia gains a song, and leaves the listener\'s where they are', async () => {
        // Folia wrote b behind a, the listener then queued u in Spotify's window, and a song was
        // added to Folia's queue: the tail Folia wrote is written again with c on it, while u keeps
        // the place it held.
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b]);
        expect(app.queue).toEqual([id('b')]);

        (app.player.addToQueue as (entries: { uri: string }[]) => void)([{ uri: 'spotify:track:' + id('u') }]);
        expect(app.queue).toEqual([id('b'), id('u')]);

        // The queue Folia holds now runs a, b, then c: its own part is written again, u is untouched.
        await spotifyClientPlayback.prepareNext!(a, [b, c]);
        expect(app.queue).toEqual([id('b'), id('u'), id('c')]);
    });

    it('never holds a song twice, over four songs in a row', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        expect(app.queue).toEqual([id('b'), id('c'), id('d')]);

        await handOver(app, 'b');
        await prepare(b, [c, d, e]);
        expect(app.queue).toEqual([id('c'), id('d'), id('e')]);

        await handOver(app, 'c');
        await prepare(c, [d, e]);
        await handOver(app, 'd');
        await prepare(d, [e]);

        expect(app.queue).toEqual([id('e')]);
        expect(new Set(app.queue).size).toBe(app.queue.length);
    });

    it('plays what Folia has next after the songs that follow were rewritten, and skips no song', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c]);
        expect(app.queue).toEqual([id('b'), id('c')]);

        // The listener shuffles: the songs after this one are others now.
        await spotifyClientPlayback.prepareNext!(a, [d, c]);
        expect(app.queue).toEqual([id('d'), id('c')]);

        // The app moves on to the first song Folia put there, and that song is the one Folia has
        // next: a handoff, not a move of the app's own that Folia then has to follow.
        statusOfClient(playing(id('a')));
        expect(app.advance()).toBe(id('d'));
        const handoff = statusOfClient(playing(id('d')));
        expect(handoff.ended).toBe(true);
        expect(handoff.skipped).toBeUndefined();
    });

    it('keeps three songs queued while the app can empty its queue', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);

        expect(app.queue).toEqual([id('b'), id('c'), id('d')]);
        expect(app.queue).toHaveLength(PREPARED_SONGS);
    });

    it('keeps one song and grows no further while the app cannot empty its queue', async () => {
        const app = fakeApp({ clear: 'none' });
        answerInPage(app);
        const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        expect(app.queue).toEqual([id('b')]);
        expect(app.queue).toHaveLength(PREPARED_SONGS_UNCLEARABLE);

        await handOver(app, 'b');
        await prepare(b, [c, d, e]);
        expect(app.queue).toEqual([id('c')]);
        await handOver(app, 'c');
        await prepare(c, [d, e]);
        expect(app.queue).toEqual([id('d')]);

        // Four songs in: each was written once, and one at a time waits behind the song playing.
        expect(app.given).toEqual([id('b'), id('c'), id('d')]);
        expect(app.queue).toHaveLength(PREPARED_SONGS_UNCLEARABLE);
    });

    it('adds nothing behind the tail the app already holds, where a read comes back short', async () => {
        // A window before this one left the app with a tail, and this one starts knowing nothing of
        // it. Spotify writes its own state a moment late, so a read is no proof of what is missing:
        // what the app names before this run wrote anything is what it holds.
        const app = fakeApp({ clear: 'none', lag: true, start: [id('b'), id('c')] });
        answerInPage(app);
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [songOf('b'), songOf('c'), songOf('d')]);

        expect(app.given).toEqual([]);
        expect(app.queue).toEqual([id('b'), id('c')]);
    });

    it('adds a song once when the read after the write still shows the queue as it was', async () => {
        const app = fakeApp({ clear: 'none', lag: true });
        answerInPage(app);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        expect(app.queue).toEqual([id('b')]);

        // The app goes on to the song, and Folia asks for the tail behind it while the read still
        // shows the queue of a moment ago.
        await handOver(app, 'b');
        await prepare(b, [c, d]);
        app.settle();
        await prepare(b, [c, d]);

        expect(app.given).toEqual([id('b'), id('c')]);
    });

    it('writes only the one or two songs the queue has left behind the song playing', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b]);
        expect(app.queue).toEqual([id('b')]);

        await prepare(a, [b, c]);
        expect(app.queue).toEqual([id('b'), id('c')]);
    });

    it('leaves the app own queue alone when the song goes on to nothing', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        expect(app.queue).toEqual([id('b'), id('c'), id('d')]);

        // Repeat one: the queue Folia has hands the app nothing, and the app's own queue is not
        // emptied for a list that has nothing to say.
        request.mockClear();
        await spotifyClientPlayback.prepareNext!(a, []);

        expect(request).not.toHaveBeenCalledWith('client_queue', expect.anything());
        expect(app.queue).toEqual([id('b'), id('c'), id('d')]);
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('b'), id('c'), id('d')]);
    });

    it('reads the app going on to a song it could not give up as this song ending, not as a press', async () => {
        const app = fakeApp({ clear: 'none' });
        answerInPage(app);
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b]);
        statusOfClient(playing(app.current()));

        // Repeat one, where the app cannot empty its queue: what Folia wrote stays behind this one,
        // and Folia has nothing left to put there.
        await spotifyClientPlayback.prepareNext!(a, [], { retract: true });
        expect(app.queue).toEqual([id('b')]);

        // The app goes on to the first of them by itself. That song is Folia's own queue, so this is
        // the end of the song playing - not the listener pressing next in the app.
        expect(app.advance()).toBe(id('b'));
        const status = statusOfClient(playing(app.current()));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBeUndefined();
    });

    it('hands over the song it wrote when nothing was taken back', async () => {
        const app = fakeApp({ clear: 'none' });
        answerInPage(app);
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b]);
        statusOfClient(playing(app.current()));

        // No repeat one was asked for, so nothing is taken back: the song Folia wrote is what
        // follows this one, and the record still names it.
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('b')]);

        // The app goes on to it by itself: a handoff to Folia's own queue, and the play that follows
        // adopts that song instead of starting it again.
        expect(app.advance()).toBe(id('b'));
        const status = statusOfClient(playing(app.current()));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBeUndefined();
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(true);
        request.mockClear();
        await spotifyClientPlayback.play!(b, 0);
        expect(request).not.toHaveBeenCalledWith('client_play', expect.anything());
    });

    it('takes back the songs it wrote when the queue is asked to go on to nothing', async () => {
        const app = fakeApp({ clear: 'works' });
        answerInPage(app);
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b, c, d]);
        expect(app.queue).toEqual([id('b'), id('c'), id('d')]);

        // Repeat one, where the page is asked to empty what Folia wrote: the songs behind this one
        // would play after it wherever the app can be steered on, and repeat one goes on to nothing.
        await spotifyClientPlayback.prepareNext!(a, [], { retract: true });

        expect(app.queue).toEqual([]);
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);
    });

    it('drops a write a newer play took the app from, and records nothing of it', async () => {
        const app = fakeApp({ clear: 'none' });
        answerInPage(app);
        const [a, b, c] = ['a', 'b', 'c'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await prepare(a, [b]);
        const handedOver = generation;

        // The listener picks another song while this write is under way: a start has emptied the
        // queue for its own tail, and the songs of the song before it do not go behind it.
        await spotifyClientPlayback.play!(c, 0);
        const stale = await writeInPage({
            api: { player: app.player }, uris: ['spotify:track:' + id('b')], queued: [], probed: true,
            generation: handedOver,
        });

        expect(stale.aborted).toBe(true);
        expect(stale.written).toEqual([]);
        expect(app.queue).toEqual([id('b')]);
    });

    it('lets the page take a tail no shorter than the one the renderer keeps', () => {
        // One number over two sides: the renderer decides how many songs follow, and the page only
        // caps them, so a tail can never be cut by a ceiling smaller than the window.
        expect(MAX_QUEUED).toBeGreaterThanOrEqual(PREPARED_SONGS);
        expect(PREPARED_SONGS).toBeGreaterThan(PREPARED_SONGS_UNCLEARABLE);
    });
});


describe('the media keys and the failures that stop an advance', () => {
    it('declares that a song started here keeps the keys with Folia', () => {
        expect(spotifyClientPlayback.holdsMediaKeysWhilePlaying).toBe(true);
    });

    it('counts only the app being out of reach as unreachable', () => {
        const unreachable = spotifyClientPlayback.isUnreachableFailure!;
        expect(unreachable(new OnlineProviderError('unavailable', 'The Spotify app cannot be reached', 'spotify'))).toBe(true);
        expect(unreachable(new OnlineProviderError('network', 'Spotify desktop request failed', 'spotify'))).toBe(true);
        // A song the app will not play, a call it refuses, and the app not being there are other cases.
        expect(unreachable(new OnlineProviderError('not-playable', 'Not a Spotify track', 'spotify'))).toBe(false);
        expect(unreachable(new OnlineProviderError('unavailable', 'The Spotify app is not installed', 'spotify', 'client-missing'))).toBe(false);
        expect(unreachable(new OnlineProviderError('invalid-response', 'Invalid Spotify seek position', 'spotify'))).toBe(false);
        expect(unreachable(new Error('something else'))).toBe(false);
    });

    it('is declared by the way Spotify plays, not by every way of playing it', async () => {
        // Soloist takes no keys: its own program registers no media session with a queue of its own.
        request.mockResolvedValueOnce({ mode: 'soloist', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(spotifyExternalPlayback.holdsMediaKeysWhilePlaying).toBe(false);
        expect(spotifyExternalPlayback.stopsAutoAdvanceWhenUnreachable?.()).toBe(false);

        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(spotifyExternalPlayback.holdsMediaKeysWhilePlaying).toBe(true);
        expect(spotifyExternalPlayback.stopsAutoAdvanceWhenUnreachable?.()).toBe(true);

        // The standard way has no external player at all.
        await setSpotifyPlaybackMode('standard');
        expect(spotifyExternalPlayback.holdsMediaKeysWhilePlaying).toBe(false);
    });
});

describe('a song restored while the app is still on it', () => {
    // Where the app is on that song, read once: a fresh run has found no port yet, so the answer is
    // the media session's, which names the track only by the title and artist it shows.
    const mode = async () => {
        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await setSpotifyPlaybackMode('client');
    };

    it('answers its position where both the title and the artist are that song\'s', async () => {
        await mode();
        const a = songOf('a');
        request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: 'Artist', positionMs: 75_400 }));

        await expect(spotifyExternalPlayback.runningPositionMs!(a)).resolves.toBe(75_400);
        // A read and nothing else: no start, no pause, no resume, no seek, no launch, and no attempt
        // held of a song Folia was never told to play.
        expect(request.mock.calls.map(call => call[0])).toEqual(['playback_mode', 'client_status']);
        expect(spotifyClientAttempt()).toBeNull();
    });

    it('answers nothing where the app is on another title', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Another song', artist: 'Artist', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(songOf('a'))).resolves.toBeNull();
    });

    it('answers nothing where the title is the same but the artist is not the song\'s', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: 'Nobody Here', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(songOf('a'))).resolves.toBeNull();
    });

    it('answers its position where the session names only the leading artist of a duet', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: 'Artist', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(duetOf('a'))).resolves.toBe(75_400);
    });

    it('answers nothing where the session shows only part of an artist name the song has', async () => {
        await mode();
        const reported: [string, string][] = [['DJ Snake', 'DJ'], ['Earth, Wind & Fire', 'Fire'], ['AC/DC', 'DC']];
        for (const [artist, shown] of reported) {
            request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: shown, positionMs: 75_400 }));

            await expect(spotifyClientPlayback.runningPositionMs!(named('a', 'Song a', [artist]))).resolves.toBeNull();
        }
    });

    it('answers its position where the session names one artist of a duet, or both of them', async () => {
        await mode();
        const helpless = named('a', 'Helpless', ['Phillipa Soo', 'Original Broadway Cast of Hamilton']);
        request.mockResolvedValueOnce(degraded({ title: 'Helpless', artist: 'Phillipa Soo', positionMs: 75_400 }));
        await expect(spotifyClientPlayback.runningPositionMs!(helpless)).resolves.toBe(75_400);

        request.mockResolvedValueOnce(degraded({ title: 'Helpless', artist: 'Phillipa Soo, Lin-Manuel Miranda', positionMs: 75_400 }));
        await expect(spotifyClientPlayback.runningPositionMs!(helpless)).resolves.toBe(75_400);
    });

    it('answers nothing where the session adds a "(with …)" credit to the title', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Song (With You)', artist: 'Artist', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(named('a', 'Song', ['Artist']))).resolves.toBeNull();
    });

    it('names the two sides in the log of a position it refuses', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Song a', artist: 'Nobody Here', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(duetOf('a'))).resolves.toBeNull();
        expect(info).toHaveBeenCalledTimes(1);
        expect(String(info.mock.calls[0][0])).toContain('Nobody Here');
        info.mockRestore();
    });

    it('reads a full-width title and a trailing credit as the song\'s own', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ title: 'Ｓｏｎｇ ａ (feat. Guest)', artist: 'Artist', positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(duetOf('a'))).resolves.toBe(75_400);
    });

    it('answers its position where the app names the track Folia asked for', async () => {
        await mode();
        request.mockResolvedValueOnce(playing(id('a'), { positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(duetOf('a'))).resolves.toBe(75_400);
    });

    it('answers nothing where the app names another track', async () => {
        await mode();
        request.mockResolvedValueOnce(playing(id('b'), { positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(duetOf('a'))).resolves.toBeNull();
    });

    it('answers nothing where the media session answers without a title', async () => {
        await mode();
        request.mockResolvedValueOnce(degraded({ positionMs: 75_400 }));

        await expect(spotifyClientPlayback.runningPositionMs!(songOf('a'))).resolves.toBeNull();
    });

    it('answers nothing where the app could not be asked', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await mode();
        request.mockRejectedValueOnce(new OnlineProviderError('unavailable', 'The Spotify app cannot be reached', 'spotify'));

        await expect(spotifyClientPlayback.runningPositionMs!(songOf('a'))).resolves.toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('answers nothing for a way of playing that steers no app of its own', async () => {
        await setSpotifyPlaybackMode('standard');

        await expect(spotifyExternalPlayback.runningPositionMs!(songOf('a'))).resolves.toBeNull();
    });
});

describe('the state a session restore reads', () => {
    const song = songOf('a');
    // Every read answers what the test says it does, and the one look more a run is allowed is taken
    // at once rather than a few seconds later.
    const reads = (answer: () => Record<string, unknown>) => request.mockImplementation(async (operation: string) => (
        operation === 'client_status_found' ? answer() : { available: true }
    ));
    const readAfterTheSecondLook = async (song: SongResult) => {
        vi.useFakeTimers();
        try {
            const answer = spotifyClientPlayback.runningStatus!(song);
            await vi.advanceTimersByTimeAsync(3000);
            return await answer;
        } finally {
            vi.useRealTimers();
        }
    };

    it('names the song the coarse channel shows by its title and artist, so its position comes with it', async () => {
        reads(() => ({ ...degraded(), title: 'Song a', artist: 'Artist' }));

        const status = await readAfterTheSecondLook(song);

        // The answer is this song's own - it carries the id a restore compares with - and it stays
        // degraded: the coarse channel names a track, it cannot steer one.
        expect(status?.mediaId).toBe(id('a'));
        expect(status?.degraded).toBe(true);
        expect(status?.positionMs).toBe(1000);
    });

    it('names a song of two artists when the session shows only the leading one', async () => {
        // Measured: the media session of a two-artist track reports one artist. The track taken over
        // on that answer is still the song Folia remembers, and its position comes with it.
        reads(() => ({ ...degraded(), title: 'Song a', artist: 'Artist', positionMs: 42_000 }));

        const status = await readAfterTheSecondLook(duetOf('a'));

        expect(status?.mediaId).toBe(id('a'));
        expect(status?.degraded).toBe(true);
        expect(status?.positionMs).toBe(42_000);
    });

    it('names no track where the coarse channel shows another song', async () => {
        reads(() => ({ ...degraded(), title: 'Song b', artist: 'Artist' }));

        const status = await readAfterTheSecondLook(song);

        expect(status?.mediaId).toBe('');
        expect(status?.degraded).toBe(true);
    });

    it('answers at once where the coarse channel already names the song, and asks no second time', async () => {
        reads(() => ({ ...degraded(), title: 'Song a', artist: 'Artist' }));
        vi.useFakeTimers();
        try {
            let answered = false;
            const answer = spotifyClientPlayback.runningStatus!(song).then(status => {
                answered = true;
                return status;
            });
            // No few seconds waited: the answer already names the song.
            await vi.advanceTimersByTimeAsync(0);
            expect(answered).toBe(true);

            const status = await answer;
            expect(status?.mediaId).toBe(id('a'));
            expect(request.mock.calls.filter(call => call[0] === 'client_status_found')).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks again a few seconds later where the first read named no track', async () => {
        vi.useFakeTimers();
        try {
            const answers = [{ ...degraded() }, { ...playing(id('a')) }];
            reads(() => (answers.length > 1 ? answers.shift()! : answers[0]));

            const answer = spotifyClientPlayback.runningStatus!(song);
            await vi.advanceTimersByTimeAsync(3000);
            const status = await answer;

            expect(status?.mediaId).toBe(id('a'));
            expect(status?.degraded).toBe(false);
            expect(request.mock.calls.filter(call => call[0] === 'client_status_found')).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the first answer where the second read fails', async () => {
        vi.useFakeTimers();
        try {
            let read = 0;
            request.mockImplementation(async (operation: string) => {
                if (operation !== 'client_status_found') return { available: true };
                read += 1;
                if (read > 1) throw new OnlineProviderError('network', 'The request did not arrive', 'spotify');
                return { ...degraded(), title: 'Song a', artist: 'Artist' };
            });

            const answer = spotifyClientPlayback.runningStatus!(song);
            await vi.advanceTimersByTimeAsync(3000);
            const status = await answer;

            expect(status?.mediaId).toBe(id('a'));
            expect(status?.degraded).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('repeat one carried out by the app\'s own repeat of the track', () => {
    it('reads the listener\'s own press beside the end of the song as their press, not as the song ending', async () => {
        const [a] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.setTrackRepeat!(true);
        // The song is in its last seconds, the app repeats the track, and the listener pressed next
        // in Spotify's own window: the app names another track from right beside this song's end.
        // Where the song is when they press says nothing about why it moved - the app's own repeat
        // would bring this same track round - so the press is read as the press it is.
        statusOfClient(playing(id('a'), { positionMs: 198500 }));

        const status = statusOfClient(playing(id('b'), { positionMs: 0 }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('next');
    });

    it('reads a track change beside the end of the song as the song ending where the app does not repeat it', async () => {
        const [a] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a'), { positionMs: 198500 }));

        // No repeat of the track: the app went on to something of its own when this song ran out,
        // which is what the end of the song reads as.
        const status = statusOfClient(playing(id('b'), { positionMs: 0 }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBeUndefined();
    });

    it('goes round to the start of the song when the bar is dragged to its end', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        // Repeat one: the song that followed was written and then taken back, so nothing Folia wrote
        // is behind this one, and the app repeats this track itself.
        await spotifyClientPlayback.prepareNext!(a, [b]);
        await spotifyClientPlayback.prepareNext!(a, [], { retract: true });
        await spotifyClientPlayback.setTrackRepeat!(true);
        statusOfClient(playing(id('a'), { positionMs: 30000 }));

        // The bar is dragged to the far right. The app repeats the track, so the read that follows
        // names this same song at its start: that is the song heard again, not the end of it, and
        // Folia's queue does not step on to the next song of the list.
        await spotifyClientPlayback.seek!(200);
        const status = statusOfClient(playing(id('a'), { positionMs: 0 }));
        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
        expect(status.replayed).toBe(true);
        expect(status.mediaId).toBe(id('a'));
    });

    it('reads a drag back as a seek where the app no longer repeats the track', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.setTrackRepeat!(true);
        statusOfClient(playing(id('a'), { positionMs: 60000 }));

        // The listener turned the app's repeat off in Spotify's own window: a read that names this
        // song further back is their drag, not the app taking the song round again.
        const status = statusOfClient(playing(id('a'), { positionMs: 0, repeat: 'off' }));
        expect(status.replayed).toBeUndefined();
        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
    });

    it('never steps on to the next song of the list while the app repeats the track itself', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.setTrackRepeat!(true);
        let positionMs = 1000;
        // The song plays round and round: every read names it, and its position starts over.
        for (const read of [30000, 199000, 0, 1000, 200000, 0]) {
            const status = statusOfClient(playing(id('a'), { positionMs: read }));
            expect(status.ended).toBe(false);
            expect(status.skipped).toBeUndefined();
            positionMs = read;
        }
        expect(positionMs).toBe(0);
    });

    it('keeps the song when a coarse read still names it, however near its own end it was', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        await spotifyClientPlayback.prepareNext!(a, [b]);
        await spotifyClientPlayback.setTrackRepeat!(true);
        // The media session answers instead of the app's own player: it names no track, and the
        // position it carries is the only sign of how far the song got.
        statusOfClient(degraded({ positionMs: 1000, title: 'Song a', artist: 'Artist' }));
        statusOfClient(degraded({ positionMs: 199500, title: 'Song a', artist: 'Artist' }));

        // It is still this song at its own end, and the app repeats it: nothing steps on.
        const status = statusOfClient(degraded({ positionMs: 199900, title: 'Song a', artist: 'Artist' }));
        expect(status.ended).toBe(false);
        expect(status.skipped).toBeUndefined();
    });

    it('reads a name Folia never wrote by the name, never by where the song had got to', async () => {
        // How far the song had got is no sign of what became of it: the same answer reads the same
        // way near its end as far from it. Guessing from it called the listener's own press the end
        // of the song, and the song's end their press.
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(degraded({ positionMs: 1000, title: 'Song a', artist: 'Artist' }));
        statusOfClient(degraded({ positionMs: 199500, title: 'Song a', artist: 'Artist' }));

        const status = statusOfClient(degraded({ positionMs: 199900, title: 'Something Else', artist: 'Somebody' }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('next');
    });

    it('still pulls a coarse answer far from the end of the song back to Folia queue', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        await spotifyClientPlayback.prepareNext!(a, [b]);
        statusOfClient(degraded({ positionMs: 1000, title: 'Song a', artist: 'Artist' }));

        const status = statusOfClient(degraded({ positionMs: 1000, title: 'Something Else', artist: 'Somebody' }));
        expect(status.ended).toBe(true);
        expect(status.skipped).toBe('next');
    });

    it('keeps repeat one as Folia\'s own replay where the app would not turn its repeat of the track on', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        // The desktop side answers with the repeat the app holds afterwards: off, so nothing of this
        // song is handed over to the app and Folia's own replay is what carries repeat one.
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_repeat') return { read: true, changed: false, now: 0 };
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') return queueTaken(params);
            return { available: true };
        });
        await spotifyClientPlayback.setTrackRepeat!(true);
        statusOfClient(playing(id('a'), { positionMs: 60000 }));

        // A read that names this song further back is the listener's own drag: without the app's
        // repeat the song would never come round by itself, so it is no turn of the song.
        const status = statusOfClient(playing(id('a'), { positionMs: 0 }));
        expect(status.replayed).toBeUndefined();
    });

    it('reads a read back into the song\'s turn once the app says it holds its repeat of the track', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_repeat') return { read: true, changed: true, now: 2 };
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') return queueTaken(params);
            return { available: true };
        });
        await spotifyClientPlayback.setTrackRepeat!(true);
        statusOfClient(playing(id('a'), { positionMs: 60000 }));

        const status = statusOfClient(playing(id('a'), { positionMs: 0 }));
        expect(status.replayed).toBe(true);
        expect(status.ended).toBe(false);
    });

    it('leaves a newer song\'s own repeat record alone when a repeat answers after it replaced this one', async () => {
        const [a, b] = ['a', 'b'].map(songOf);
        await spotifyClientPlayback.play!(a, 0);
        // A repeat asked for the song the app plays now, answered only after another song was asked
        // for: what came back belongs to that song, and the app is on this one by then.
        let answer!: (value: unknown) => void;
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_repeat') return new Promise(resolve => { answer = resolve; });
            if (operation === 'client_play') return 'loaded';
            if (operation === 'client_queue') return queueTaken(params);
            return { available: true };
        });
        const asked = spotifyClientPlayback.setTrackRepeat!(true);
        const next = songOf('b');
        await spotifyClientPlayback.play!(next, 0);
        expect(spotifyClientAttempt()?.id).toBe(id('b'));
        expect(spotifyClientAttempt()?.nativeRepeat).toBe(false);

        answer({ read: true, changed: true, now: 2 });
        await asked;
        // The new song never had its repeat confirmed, so the answer of the one before may not say
        // it did: the record of this attempt stays as it was made.
        expect(spotifyClientAttempt()?.id).toBe(id('b'));
        expect(spotifyClientAttempt()?.nativeRepeat).toBe(false);
        expect(b.name).toBe('Song b');
    });

    it('leaves a start in repeat one to the app\'s repeat only where the app says it holds it', async () => {
        const a = songOf('a');
        // The start answers the repeat the app holds after it: the track, which is what the app then
        // sounds again by itself.
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') return { answer: 'loaded', repeat: 2 };
            if (operation === 'client_queue') return queueTaken(params);
            return { available: true };
        });
        await spotifyClientPlayback.play!(a, 0, { singleLoop: true });
        statusOfClient(playing(id('a'), { positionMs: 60000 }));

        const status = statusOfClient(playing(id('a'), { positionMs: 0 }));
        expect(status.replayed).toBe(true);
    });

    it('keeps Folia\'s own replay of a start in repeat one the app did not leave the repeat on', async () => {
        const a = songOf('a');
        // A player that refused the write leaves the repeat where it was, and the start says so: no
        // repeat of the track is the app's, so a read further back is a drag and not the turn.
        request.mockImplementation(async (operation: string, params?: unknown) => {
            if (operation === 'client_play') return { answer: 'loaded', repeat: null };
            if (operation === 'client_queue') return queueTaken(params);
            return { available: true };
        });
        await spotifyClientPlayback.play!(a, 0, { singleLoop: true });
        statusOfClient(playing(id('a'), { positionMs: 60000 }));

        const status = statusOfClient(playing(id('a'), { positionMs: 0 }));
        expect(status.replayed).toBeUndefined();
    });
});

describe('the track the watcher of the app reads', () => {
    // Watched every few seconds for the whole of a run: it must ask for the read that carries the
    // watcher's own, slower port-search budget, never the one a session restore spends.
    it('asks for the watcher read, which carries no restore budget', async () => {
        request.mockImplementation(async () => playing(id('a')));

        const status = await spotifyClientPlayback.runningTrack!();

        expect(status?.mediaId).toBe(id('a'));
        expect(status?.isPlaying).toBe(true);
        expect(request.mock.calls.filter(call => call[0] === 'client_status_follow')).toHaveLength(1);
        expect(request.mock.calls.filter(call => call[0] === 'client_status_found')).toHaveLength(0);
    });

    it('asks nothing of a restore when it is read over and over', async () => {
        request.mockImplementation(async () => degraded());

        for (let read = 0; read < 20; read += 1) await spotifyClientPlayback.runningTrack!();

        // Twenty reads, three seconds apart: twenty of the watcher's, and not one of the restore's.
        expect(request.mock.calls.filter(call => call[0] === 'client_status_follow')).toHaveLength(20);
        expect(request.mock.calls.filter(call => call[0] === 'client_status_found')).toHaveLength(0);
    });

    it('answers nothing where the app named no track of its own', async () => {
        request.mockResolvedValueOnce(degraded());

        await expect(spotifyClientPlayback.runningTrack!()).resolves.toBeNull();
    });
});
