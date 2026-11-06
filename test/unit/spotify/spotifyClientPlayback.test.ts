// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyClientPlayback.test.ts — what the Spotify app's own answers become for
// Folia: the song it was told to play, the handoff to a track Folia put in the app's queue, the end
// of the song near its own end, an advertisement between songs, the fallback answer that names no
// track (M4), the queue that is only written once the app took it (L4), and the run that stops
// steering fails with a reason of its own where the app is not on this computer.

// A start answers the word the app answers with (N8): it took the track. Every other call answers
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
import type { SongResult } from '@/types';

const id = (letter: string) => letter.repeat(22);
const songOf = (letter: string): SongResult => normalizeSpotifySong({
    __typename: 'Track', uri: `spotify:track:${id(letter)}`, name: `Song ${letter}`,
    artists: { items: [{ uri: `spotify:artist:${id('r')}`, profile: { name: 'Artist' } }] },
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
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')] });
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
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')] });
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

    it('remembers only the queue the app took, so a failed write is tried again (L4)', async () => {
        const a = songOf('a');
        const b = songOf('b');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));
        request.mockRejectedValueOnce(new OnlineProviderError('unavailable', 'Spotify did not answer', 'spotify'));

        await expect(spotifyClientPlayback.prepareNext!(a, [b])).rejects.toThrow();
        expect(spotifyClientPlayback.isPrepared!(b)).toBe(false);
        expect(spotifyClientAttempt()?.nextIds).toEqual([]);

        await spotifyClientPlayback.prepareNext!(a, [b]);
        expect(request).toHaveBeenLastCalledWith('client_queue', { ids: [id('b')] });
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

describe('the fallback answer (M4)', () => {
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

    it('keeps the session when the title it shows is the same song', async () => {
        const a = songOf('a');
        await spotifyClientPlayback.play!(a, 0);
        statusOfClient(playing(id('a')));

        const status = statusOfClient(degraded({ title: 'Song a', artist: 'Artist' }));
        expect(status.ended).toBe(false);
    });
});

describe('a start and where it stopped', () => {
    it('tells the desktop side that no one pressed play for an advance of its own (T5)', async () => {
        await spotifyClientPlayback.play!(songOf('a'), 0, { userAction: false });
        expect(request).toHaveBeenCalledWith('client_play', { id: id('a'), startMs: 0, userAction: false });
    });

    it('says nothing when a newer play took the app (N8)', async () => {
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('preempted');
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).resolves.toBeUndefined();
        // Nothing went wrong: the app is still steered.
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('reports a failure when the app never got to the song, and keeps steering (N8)', async () => {
        request.mockResolvedValueOnce({ available: true }).mockResolvedValueOnce('not-loaded');
        await expect(spotifyClientPlayback.play!(songOf('a'), 0)).rejects.toMatchObject({ code: 'not-playable' });
        // One track the app did not load does not retire the app for the rest of the run.
        expect(canSteerSpotifyApp()).toBe(true);
    });

    it('keeps steering when an advance of its own could not reach the app (T5)', async () => {
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
