// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyClientPlayback.test.ts — what the Spotify app's own answers become for
// Folia: the song it was told to play, the handoff to a track Folia put in the app's queue, the end
// of the song near its own end, an advertisement between songs, the fallback answer that names no
// track, the queue that is only written once the app took it, and the run that stops steering
// with a reason of its own where the app is not on this computer.

// A start answers the word the app answers with: it took the track. Every other call answers
// the probe's answer unless the test says otherwise.
const request = vi.hoisted(() => vi.fn(async (operation: string, _params?: unknown): Promise<unknown> => (
    operation === 'client_play' ? 'loaded' : { available: true }
)));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { OnlineProviderError } from '@/types/onlineMusic';
import { describeSpotifyFailure } from '@/services/onlineMusic/spotify/spotifyFailure';
import { normalizeSpotifySong } from '@/services/onlineMusic/spotify/spotifyNormalize';
import {
    canSteerSpotifyApp, resetSpotifyClientPlayback, spotifyClientAttempt, spotifyClientPlayback, statusOfClient,
} from '@/services/onlineMusic/spotify/spotifyClientPlayback';
import { spotifyExternalPlayback } from '@/services/onlineMusic/spotify/spotifyExternalPlayback';
import { readSpotifyPlaybackMode, setSpotifyPlaybackMode } from '@/services/onlineMusic/spotify/spotifySoloistPlayback';
import type { SongResult } from '@/types';

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

beforeEach(() => {
    // The steering asks the desktop side whether the app is there at all.
    Object.defineProperty(window, 'electron', {
        value: { platform: 'win32', spotifyRequest: vi.fn() },
        configurable: true,
        writable: true,
    });
    request.mockReset();
    request.mockImplementation(async (operation: string) => (operation === 'client_play' ? 'loaded' : { available: true }));
    resetSpotifyClientPlayback();
});

describe('a song the app is playing', () => {
    it('answers for the song Folia asked for, and names the track it holds', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 0, userAction: true });

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
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_resume') throw gone();
            return operation === 'client_play' ? 'loaded' : { available: true };
        });

        await spotifyClientPlayback.resume!();
        expect(request).toHaveBeenCalledWith('client_resume');
        const operations = request.mock.calls.map(call => call[0]);
        expect(operations).toEqual(['client_resume', 'client_play', 'client_queue']);
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 83000, userAction: true });
        // What was queued in the closed app went with it: the songs that follow are put back, and
        // Folia's record of them holds again (its prepared-queue key does not change, so it would not ask).
        // They are named as the songs to write down: a queue that could not be emptied still holds them.
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')], queued: [id('b')] });
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
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_resume') throw gone();
            if (operation === 'client_play' && !changed) {
                // The listener picks another song while Spotify is still starting.
                changed = true;
                await spotifyClientPlayback.play!(c, 0);
                return 'loaded';
            }
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
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 0, userAction: false });
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
    it('keeps three songs queued after the one playing', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        const d = songOf('d');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b, c, d]);

        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b'), id('c'), id('d')], queued: [] });
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('b'), id('c'), id('d')]);
    });

    it('tops the tail up after the app moves on, adding only the song it does not hold', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        const d = songOf('d');
        const e = songOf('e');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b, c, d]);
        statusOfClient(playing(id('a')));
        expect(statusOfClient(playing(id('b'))).ended).toBe(true);

        // The app took the first of the three by itself: the two behind it are still its queue.
        await spotifyClientPlayback.play!(b, 0);
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('c'), id('d')]);
        request.mockClear();

        // Three again, and only the song the app does not hold is added to what it already has.
        await spotifyClientPlayback.prepareNext!(b, [c, d, e]);
        expect(request).toHaveBeenLastCalledWith('client_queue', {
            ids: [id('c'), id('d'), id('e')], queued: [id('c'), id('d')],
        });
        expect(spotifyClientAttempt()?.nextIds).toEqual([id('c'), id('d'), id('e')]);
    });

    it('writes nothing again when the songs that follow are the ones the app was given', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        await spotifyClientPlayback.play!(a, 0);
        await spotifyClientPlayback.prepareNext!(a, [b, c]);
        request.mockClear();

        await spotifyClientPlayback.prepareNext!(a, [b, c]);
        expect(request).not.toHaveBeenCalledWith('client_queue', expect.anything());
    });

    it('empties and writes once more a queue that does not hold what was written', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        await spotifyClientPlayback.play!(a, 0);
        // The app names the queue it holds, and it holds one of the two songs twice.
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_play') return 'loaded';
            return operation === 'client_queue'
                ? { added: 2, cleared: true, queue: [id('b'), id('c'), id('c')] }
                : { available: true };
        });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            await spotifyClientPlayback.prepareNext!(a, [b, c]);

            const writes = request.mock.calls.filter(call => call[0] === 'client_queue');
            // Written once, and then once more asking for exactly these songs.
            expect(writes).toHaveLength(2);
            // The second write is handed the queue the app reported, not the list Folia wants.
            expect(writes[1]).toEqual(['client_queue', { ids: [id('b'), id('c')], queued: [id('b'), id('c'), id('c')] }]);
            expect(info).toHaveBeenCalledWith(expect.stringContaining('it was emptied and 2 songs written again'));
            expect(spotifyClientAttempt()?.nextIds).toEqual([id('b'), id('c')]);
        } finally {
            info.mockRestore();
        }
    });


    it('writes the songs that are missing when the queue it reads back holds one of them twice', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        const d = songOf('d');
        await spotifyClientPlayback.play!(a, 0);
        // The app names a queue that holds the first song twice and does not hold the other two, and
        // says its queue could not be emptied.
        request.mockImplementation(async (operation: string) => {
            if (operation === 'client_play') return 'loaded';
            return operation === 'client_queue'
                ? { added: 3, cleared: false, queue: [id('b'), id('b')] }
                : { available: true };
        });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            await spotifyClientPlayback.prepareNext!(a, [b, c, d]);

            const writes = request.mock.calls.filter(call => call[0] === 'client_queue');
            expect(writes).toHaveLength(2);
            const second = writes[1]?.[1] as { ids: string[]; queued: string[] };
            // Told the songs were already there, a write that cannot empty the queue adds nothing:
            // the second one is given the queue the app reported instead, so what it adds is the gap.
            expect(second).toEqual({ ids: [id('b'), id('c'), id('d')], queued: [id('b'), id('b')] });
            expect(second.ids.filter(song => !second.queued.includes(song))).toEqual([id('c'), id('d')]);
            // And the log says what that write did, not what it was meant to do.
            expect(info).toHaveBeenCalledWith(expect.stringContaining('3 songs added behind what it already held'));
        } finally {
            info.mockRestore();
        }
    });

    it('counts from what Folia wrote when the app does not name its queue', async () => {
        const a = songOf('a');
        const b = songOf('b');
        const c = songOf('c');
        await spotifyClientPlayback.play!(a, 0);
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        try {
            await spotifyClientPlayback.prepareNext!(a, [b, c]);

            expect(request.mock.calls.filter(call => call[0] === 'client_queue')).toHaveLength(1);
            expect(info).toHaveBeenCalledWith(expect.stringContaining('does not say what its queue holds'));
            expect(spotifyClientAttempt()?.nextIds).toEqual([id('b'), id('c')]);
        } finally {
            info.mockRestore();
        }
    });
});


describe('the media keys and the failures that stop an advance', () => {
    it('declares that its app keeps a media session of its own (the keys are held)', () => {
        expect(spotifyClientPlayback.holdsMediaKeys?.()).toBe(true);
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
        expect(spotifyExternalPlayback.holdsMediaKeys?.()).toBe(false);
        expect(spotifyExternalPlayback.stopsAutoAdvanceWhenUnreachable?.()).toBe(false);

        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(spotifyExternalPlayback.holdsMediaKeys?.()).toBe(true);
        expect(spotifyExternalPlayback.stopsAutoAdvanceWhenUnreachable?.()).toBe(true);

        // The standard way has no external player at all.
        await setSpotifyPlaybackMode('standard');
        expect(spotifyExternalPlayback.holdsMediaKeys?.()).toBe(false);
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
