import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifySetup.test.ts — the renderer side of Spotify's three ways to play: the
// setup checklist the sign-in window shows (spotifySetup.ts), the check right after a sign-in, the
// external player that steers Soloist (spotifySoloistPlayback.ts) or Spotify's own app
// (spotifyClientPlayback.ts), the pick between the two (spotifyExternalPlayback.ts) and how their
// failures are sorted.

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    querySpotify: (name: string, variables: Record<string, unknown> = {}) => request('query', { name, variables }),
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { checkSpotifyAfterLogin, getSpotifySetup, runSpotifySetupAction } from '@/services/onlineMusic/spotify/spotifySetup';
import { readSpotifyPlaybackMode, spotifyPlaysThroughSoloist, spotifySoloistPlayback } from '@/services/onlineMusic/spotify/spotifySoloistPlayback';
import { describeSpotifyFailure } from '@/services/onlineMusic/spotify/spotifyFailure';
import { spotifyProvider } from '@/services/onlineMusic/spotify/spotifyProvider';
import { spotifyExternalPlayback } from '@/services/onlineMusic/spotify/spotifyExternalPlayback';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { UnifiedSong } from '@/types';

const DAY = 24 * 60 * 60 * 1000;
const STATE_READY = {
    executable: { path: '/opt/soloist', state: 'valid', version: '1.4.2', builtAt: Date.now() - 10 * DAY, expiresAt: Date.now() + 80 * DAY, daysLeft: 80 },
    key: 'saved', canSealKey: true, running: true, paired: true, error: null,
};
const STATE_EMPTY = { executable: null, key: 'missing', canSealKey: true, running: false, paired: false, error: null };

let mode: 'standard' | 'soloist' | 'client';
let soloistState: Record<string, unknown>;
let probe: string;
/** Whether the desktop side offers Spotify's own app, and whether it finds it installed. */
let clientOffered: boolean;
let clientInstalled: boolean;

beforeEach(async () => {
    mode = 'standard';
    soloistState = STATE_EMPTY;
    probe = 'ok';
    clientOffered = false;
    clientInstalled = true;
    request.mockReset();
    request.mockImplementation(async (operation: string, params: any = {}) => {
        switch (operation) {
            case 'playback_mode':
                if (params.mode) mode = params.mode;
                return { mode, soloist: true, ...(clientOffered ? { client: true } : {}) };
            case 'client_probe': return { available: clientInstalled };
            case 'client_play': return 'loaded';
            case 'soloist_state': return { mode, ...soloistState };
            case 'audio_probe': return probe;
            case 'soloist_key': return params.key === 'good-key-123' ? { saved: true } : { saved: false, why: 'shape' };
            case 'soloist_pick': return { picked: false, executable: { state: 'expired' } };
            default: return true;
        }
    });
    await readSpotifyPlaybackMode();
});

const SONG = {
    id: '4cOdK2wGLETKBW3PvgPWqT', name: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'spotify', mediaId: '4cOdK2wGLETKBW3PvgPWqT' },
} as unknown as UnifiedSong;

describe('Spotify after a sign-in', () => {
    it('offers both ways at the sign-in where Soloist is offered, the one in use picked to begin with', async () => {
        const methods = await spotifyProvider.auth!.resolveLoginMethods!();
        expect(methods.map(method => method.id)).toEqual(['standard', 'soloist']);
        expect(methods.every(method => method.noteKey)).toBe(true);
        expect(methods.find(method => method.preferred)?.id).toBe('standard');
        mode = 'soloist';
        expect((await spotifyProvider.auth!.resolveLoginMethods!()).find(method => method.preferred)?.id).toBe('soloist');
        await spotifyProvider.auth!.startLogin!('soloist');
        expect(request).toHaveBeenCalledWith('login_start', { method: 'soloist' });
    });

    it('lets an account that gets audio keys through, and stops one that gets none at the offer of Soloist', async () => {
        await expect(checkSpotifyAfterLogin('standard')).resolves.toBeNull();
        probe = 'no-key';
        const view = await checkSpotifyAfterLogin('standard');
        expect(view).toMatchObject({ titleKey: 'soloist.noKey.title', complete: false, steps: [{ id: 'mode', state: 'warn', actions: [{ id: 'use-soloist', primary: true }] }] });
        probe = 'free';
        await expect(checkSpotifyAfterLogin('standard')).resolves.toBeNull();
    });

    it('shows the Soloist checklist after a Soloist sign-in until it is all done', async () => {
        mode = 'soloist';
        const view = await checkSpotifyAfterLogin('soloist');
        expect(view?.steps.map(step => [step.id, step.state])).toEqual([['program', 'todo'], ['key', 'todo'], ['pair', 'todo'], ['mode', 'done']]);
        expect(request).toHaveBeenCalledWith('soloist_state', { start: true });
        soloistState = STATE_READY;
        await expect(checkSpotifyAfterLogin('soloist')).resolves.toBeNull();
    });
});

describe('Spotify setup checklist', () => {
    it('switches to Soloist from the offer and shows its steps, with the days its build has left', async () => {
        soloistState = { ...STATE_READY, paired: false };
        const view = await runSpotifySetupAction('mode', 'use-soloist');
        expect(spotifyPlaysThroughSoloist()).toBe(true);
        expect(spotifyProvider.capabilities.externalPlayback).toBe(true);
        expect(view.steps[0]).toMatchObject({ id: 'program', state: 'done', noteKey: 'soloist.program.valid', params: { version: '1.4.2', days: 80 }, detail: '/opt/soloist' });
        expect(view.steps[1]).toMatchObject({ id: 'key', state: 'done', secret: { saved: true } });
        expect(view.steps[2]).toMatchObject({ id: 'pair', state: 'todo', noteKey: 'soloist.pair.todo' });
        expect(view.complete).toBe(false);

        await runSpotifySetupAction('mode', 'use-standard');
        expect(spotifyProvider.capabilities.externalPlayback).toBe(false);
    });

    it('says what a button found, and a failure without throwing', async () => {
        mode = 'soloist';
        expect((await runSpotifySetupAction('key', 'save-key', 'has space')).message).toEqual({ key: 'soloist.message.keyShape', tone: 'error' });
        expect((await runSpotifySetupAction('key', 'save-key', 'good-key-123')).message).toEqual({ key: 'soloist.message.keySaved', tone: 'ok' });
        expect((await runSpotifySetupAction('program', 'pick')).message).toEqual({ key: 'soloist.message.pickedExpired', tone: 'error' });
        request.mockImplementationOnce(async () => { throw new Error('gone'); });
        expect((await runSpotifySetupAction('program', 'download')).message).toEqual({ key: 'soloist.message.failed', tone: 'error' });
    });

    it('marks an expiring or expired build, and a keychain that cannot keep the key', async () => {
        mode = 'soloist';
        soloistState = { ...STATE_READY, executable: { ...STATE_READY.executable, state: 'expiring', daysLeft: 9 } };
        expect((await getSpotifySetup())?.steps[0]).toMatchObject({ state: 'warn', noteKey: 'soloist.program.expiring', params: { days: 9 } });
        soloistState = { ...STATE_READY, running: false, paired: false, executable: { ...STATE_READY.executable, state: 'expired', daysLeft: 0 } };
        const expired = await getSpotifySetup();
        expect(expired?.steps[0]).toMatchObject({ state: 'error', noteKey: 'soloist.program.expired' });
        expect(expired?.steps[2]).toMatchObject({ noteKey: 'soloist.pair.waiting' });
        soloistState = { ...STATE_EMPTY, canSealKey: false };
        expect((await getSpotifySetup())?.steps[1]).toMatchObject({ state: 'error', noteKey: 'soloist.key.noKeychain' });
        // A build whose date could not be read refused to start as expired.
        soloistState = { ...STATE_READY, running: false, paired: false, error: 'expired', executable: { ...STATE_READY.executable, state: 'unknown', daysLeft: null } };
        expect((await getSpotifySetup())?.steps[0]).toMatchObject({ state: 'error', noteKey: 'soloist.program.expired' });
    });
});

describe('Spotify through Soloist', () => {
    it('starts a song at its place, with its length, and follows the program', async () => {
        await spotifySoloistPlayback.play(SONG, 12.5);
        expect(request).toHaveBeenCalledWith('soloist_play', { id: '4cOdK2wGLETKBW3PvgPWqT', startMs: 12_500, durationMs: 200_000 });
        await spotifySoloistPlayback.setVolume!(0.42);
        expect(request).toHaveBeenCalledWith('soloist_volume', { volume: 42 });

        request.mockResolvedValueOnce({ running: true, paired: true, uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', status: 'buffering', positionMs: 1000, durationMs: 200_000, ended: false });
        const status = await spotifySoloistPlayback.getStatus(SONG);
        expect(status).toMatchObject({ isPlaying: false, starting: true, positionMs: 1000, ended: false });
        expect(spotifySoloistPlayback.isStatusForSong(SONG, status)).toBe(true);
        expect(spotifySoloistPlayback.isStatusForSong(SONG, { ...status, mediaId: 'spotify:track:7qiZfU4dY1lWllzX7mPBI3' })).toBe(false);

        request.mockResolvedValueOnce({ running: false });
        await expect(spotifySoloistPlayback.getStatus(SONG)).rejects.toBeInstanceOf(OnlineProviderError);
    });

    it('sorts Soloist failures: setting it up mends some, others may pass when tried again', () => {
        const failure = (reason: string) => describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', reason));
        expect(failure('soloist-unpaired')).toEqual({ case: 'not-configured' });
        expect(failure('soloist-expired')).toEqual({ case: 'not-configured' });
        expect(failure('soloist-gone')).toEqual({ case: 'unreachable' });
        expect(failure('soloist-refused')).toEqual({ case: 'refused' });
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'Spotify gives this account no audio key', 'spotify'))).toEqual({ case: 'account-refused' });
    });
});

describe('Spotify\'s three ways to play', () => {
    beforeEach(() => {
        clientOffered = true;
    });

    it('offers the app\'s own client at the sign-in only where the desktop side offers it', async () => {
        clientOffered = false;
        await readSpotifyPlaybackMode();
        expect((await spotifyProvider.auth!.resolveLoginMethods!()).map(method => method.id)).toEqual(['standard', 'soloist']);
        clientOffered = true;
        await readSpotifyPlaybackMode();
        const methods = await spotifyProvider.auth!.resolveLoginMethods!();
        expect(methods.map(method => method.id)).toEqual(['standard', 'soloist', 'client']);
        expect(methods.every(method => method.noteKey)).toBe(true);
        expect(methods.find(method => method.preferred)?.id).toBe('standard');
        mode = 'client';
        expect((await spotifyProvider.auth!.resolveLoginMethods!()).find(method => method.preferred)?.id).toBe('client');
        await spotifyProvider.auth!.startLogin!('client');
        expect(request).toHaveBeenCalledWith('login_start', { method: 'client' });
    });

    it('turns the external route on for Soloist and for the app, and off for the standard way', async () => {
        await readSpotifyPlaybackMode();
        expect(spotifyProvider.capabilities.externalPlayback).toBe(false);
        await runSpotifySetupAction('mode', 'use-soloist');
        expect(spotifyProvider.capabilities.externalPlayback).toBe(true);
        await runSpotifySetupAction('mode', 'use-client');
        expect(spotifyProvider.capabilities.externalPlayback).toBe(true);
        expect(request).toHaveBeenCalledWith('playback_mode', { mode: 'client' });
        await runSpotifySetupAction('mode', 'use-standard');
        expect(spotifyProvider.capabilities.externalPlayback).toBe(false);
    });

    it('sends each call to the player of the way in use', async () => {
        (globalThis as { window?: unknown }).window = { electron: { platform: 'win32', spotifyRequest: vi.fn() } };
        try {
            await runSpotifySetupAction('mode', 'use-soloist');
            await spotifyExternalPlayback.play(SONG, 3);
            await spotifyExternalPlayback.pause();
            expect(request).toHaveBeenCalledWith('soloist_play', expect.objectContaining({ startMs: 3000 }));
            expect(request).toHaveBeenCalledWith('soloist_pause');
            expect(request).not.toHaveBeenCalledWith('client_pause');

            request.mockClear();
            await runSpotifySetupAction('mode', 'use-client');
            await spotifyExternalPlayback.play(SONG, 3);
            await spotifyExternalPlayback.pause();
            expect(request).toHaveBeenCalledWith('client_probe');
            expect(request).toHaveBeenCalledWith('client_play', expect.objectContaining({ id: SONG.sourceRef!.mediaId, startMs: 3000 }));
            expect(request).toHaveBeenCalledWith('client_pause');
            expect(request).not.toHaveBeenCalledWith('soloist_pause');
        } finally {
            delete (globalThis as { window?: unknown }).window;
        }
    });

    it('wakes Spotify\'s app with Folia only when it is the way in use', async () => {
        (globalThis as { window?: unknown }).window = { electron: { platform: 'win32', spotifyRequest: vi.fn() } };
        try {
            await spotifyExternalPlayback.warmUp!();
            expect(request).not.toHaveBeenCalledWith('client_launch');
            await runSpotifySetupAction('mode', 'use-client');
            await spotifyExternalPlayback.warmUp!();
            expect(request).toHaveBeenCalledWith('client_launch');
        } finally {
            delete (globalThis as { window?: unknown }).window;
        }
    });

    it('offers the app next to Soloist to an account that gets no key, and the app alone to a free one', async () => {
        probe = 'no-key';
        const noKey = await checkSpotifyAfterLogin('standard');
        expect(noKey).toMatchObject({ titleKey: 'soloist.noKey.title', complete: false });
        expect(noKey?.steps[0]).toMatchObject({ id: 'mode', state: 'warn', actions: [{ id: 'use-soloist', primary: true }, { id: 'use-client' }] });

        probe = 'free';
        const free = await checkSpotifyAfterLogin('standard');
        expect(free).toMatchObject({ titleKey: 'soloist.free.title', complete: false });
        expect(free?.steps[0]).toMatchObject({ noteKey: 'soloist.mode.freeNote', actions: [{ id: 'use-client', primary: true }] });
        expect(free?.steps[0].actions?.some(action => action.id === 'use-soloist')).toBe(false);

        // Where the app is not offered, a free account is left as it was.
        clientOffered = false;
        await readSpotifyPlaybackMode();
        await expect(checkSpotifyAfterLogin('standard')).resolves.toBeNull();
    });

    it('shows the app\'s checklist until the app is found, with the other ways to switch to', async () => {
        mode = 'client';
        clientInstalled = false;
        const missing = await checkSpotifyAfterLogin('client');
        expect(missing?.steps.map(step => [step.id, step.state])).toEqual([['app', 'error'], ['mode', 'done']]);
        expect(missing?.steps[0].noteKey).toBe('soloist.clientApp.missing');
        expect(missing?.steps[1].actions?.map(action => action.id)).toEqual(['use-standard', 'use-soloist']);
        expect(missing?.complete).toBe(false);
        clientInstalled = true;
        await expect(checkSpotifyAfterLogin('client')).resolves.toBeNull();
        expect(await getSpotifySetup()).toMatchObject({ complete: true, steps: [{ id: 'app', state: 'done' }, { id: 'mode' }] });
    });

    it('sorts the app\'s missing program as a source that is not set up', () => {
        expect(describeSpotifyFailure('audio', new OnlineProviderError('unavailable', 'x', 'spotify', 'client-missing'))).toEqual({ case: 'not-configured' });
    });
});
