// @builtin-sources
import { beforeEach, describe, expect, it } from 'vitest';

// test/unit/spotify/spotifySetup.test.ts — the client side of Spotify's two ways to play: the
// setup checklist the sign-in window shows (spotifySetup.ts), the check right after a sign-in, the
// external player that steers Soloist (spotifySoloistPlayback.ts) and how its failures are sorted.
// The checklist is read through the registered source as the host reads it (its texts are keys of the mod's
// locale files, folium-mod/spotify:soloist.*); the main entry's `request` is answered here.

import i18n from '@/i18n/config';
import type { FoliumSourceSong } from '@/mods/folium/sources/contract';
import { canPlaySongExternally } from '@/services/onlineMusic/providerRegistry';
import { OnlineProviderError } from '@/types/onlineMusic';
import { readSpotifyPlaybackMode, spotifyPlaysThroughSoloist, spotifySoloistPlayback } from '../../../sources/spotify/client/spotifySoloistPlayback';
import { describeSpotifyFailure } from '../../../sources/spotify/client/spotifyFailure';
import { spotifyError } from '../../../sources/spotify/client/spotifyTransport';
import { answerSpotifyRequests, hostSpotifySong, lazySpotifyProvider } from '../helpers/spotifySource';

const { request } = answerSpotifyRequests();
const spotifyProvider = lazySpotifyProvider();
const checkSpotifyAfterLogin = (methodId: string) => spotifyProvider.auth!.checkAfterLogin!(methodId);
const getSpotifySetup = () => spotifyProvider.auth!.getSetup!();
const runSpotifySetupAction = async (stepId: string, actionId: string, value?: string) => (await spotifyProvider.auth!.runSetupAction!(stepId, actionId, value))!;
// A text of the mod's locale files, as the host keys it.
const mod = (key: string) => `folium-mod/spotify:soloist.${key}`;
// Whether the host's key of a text with values reads as the mod's text `key`, whatever the values.
const reads = (noteKey: string | undefined, key: string): boolean => {
    const said = i18n.t(noteKey ?? '');
    let at = 0;
    for (const piece of i18n.t(mod(key)).split(/\{\{\w+\}\}/)) {
        const found = said.indexOf(piece, at);
        if (found < 0) return false;
        at = found + piece.length;
    }
    return at === said.length;
};

const DAY = 24 * 60 * 60 * 1000;
const STATE_READY = {
    executable: { path: '/opt/soloist', state: 'valid', version: '1.4.2', builtAt: Date.now() - 10 * DAY, expiresAt: Date.now() + 80 * DAY, daysLeft: 80 },
    key: 'saved', canSealKey: true, running: true, paired: true, error: null,
};
const STATE_EMPTY = { executable: null, key: 'missing', canSealKey: true, running: false, paired: false, error: null };

let mode: 'standard' | 'soloist';
let soloistState: Record<string, unknown>;
let probe: string;

beforeEach(async () => {
    mode = 'standard';
    soloistState = STATE_EMPTY;
    probe = 'ok';
    request.mockReset();
    request.mockImplementation(async (operation: string, params: any) => {
        switch (operation) {
            case 'playback_mode':
                if (params.mode) mode = params.mode;
                return { mode, soloist: true };
            case 'soloist_state': return { mode, ...soloistState };
            case 'audio_probe': return probe;
            case 'soloist_key': return params.key === 'good-key-123' ? { saved: true } : { saved: false, why: 'shape' };
            case 'soloist_pick': return { picked: false, executable: { state: 'expired' } };
            default: return true;
        }
    });
    await readSpotifyPlaybackMode();
});

const SONG: FoliumSourceSong = { id: '4cOdK2wGLETKBW3PvgPWqT', title: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 200_000 };
// The same song as the host has it.
const HOST_SONG = hostSpotifySong({
    __typename: 'Track', uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', name: 'Song', artists: { items: [] }, duration: { totalMilliseconds: 200_000 },
});

describe('Spotify after a sign-in', () => {
    it('offers both ways at the sign-in where Soloist is offered, the one in use picked to begin with', async () => {
        const methods = await spotifyProvider.auth!.resolveLoginMethods!();
        expect(methods.map(method => method.id)).toEqual(['standard', 'soloist']);
        expect(methods.map(method => method.noteKey)).toEqual([mod('method.standardNote'), mod('method.soloistNote')]);
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
        expect(view).toMatchObject({ titleKey: mod('noKey.title'), complete: false, steps: [{ id: 'mode', state: 'warn', actions: [{ id: 'use-soloist', primary: true }] }] });
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
        expect(canPlaySongExternally(HOST_SONG)).toBe(true);
        expect(view.steps[0]).toMatchObject({ id: 'program', state: 'done', detail: '/opt/soloist' });
        // A text with values is a key of its own that nests the mod's key with them.
        expect(reads(view.steps[0].noteKey, 'program.valid')).toBe(true);
        expect(i18n.t(view.steps[0].noteKey!)).toContain('1.4.2');
        expect(i18n.t(view.steps[0].noteKey!)).toContain('80');
        expect(view.steps[1]).toMatchObject({ id: 'key', state: 'done', secret: { saved: true } });
        expect(view.steps[2]).toMatchObject({ id: 'pair', state: 'todo', noteKey: mod('pair.todo') });
        expect(view.complete).toBe(false);

        await runSpotifySetupAction('mode', 'use-standard');
        expect(canPlaySongExternally(HOST_SONG)).toBe(false);
    });

    it('says what a button found, and a failure without throwing', async () => {
        mode = 'soloist';
        expect((await runSpotifySetupAction('key', 'save-key', 'has space')).message).toEqual({ key: mod('message.keyShape'), tone: 'error' });
        expect((await runSpotifySetupAction('key', 'save-key', 'good-key-123')).message).toEqual({ key: mod('message.keySaved'), tone: 'ok' });
        expect((await runSpotifySetupAction('program', 'pick')).message).toEqual({ key: mod('message.pickedExpired'), tone: 'error' });
        request.mockImplementationOnce(async () => { throw new Error('gone'); });
        expect((await runSpotifySetupAction('program', 'download')).message).toEqual({ key: mod('message.failed'), tone: 'error' });
    });

    it('marks an expiring or expired build, and a keychain that cannot keep the key', async () => {
        mode = 'soloist';
        soloistState = { ...STATE_READY, executable: { ...STATE_READY.executable, state: 'expiring', daysLeft: 9 } };
        const expiring = (await getSpotifySetup())?.steps[0];
        expect(expiring).toMatchObject({ state: 'warn' });
        expect(reads(expiring?.noteKey, 'program.expiring')).toBe(true);
        expect(i18n.t(expiring!.noteKey!)).toContain('9');
        soloistState = { ...STATE_READY, running: false, paired: false, executable: { ...STATE_READY.executable, state: 'expired', daysLeft: 0 } };
        const expired = await getSpotifySetup();
        expect(expired?.steps[0]).toMatchObject({ state: 'error' });
        expect(reads(expired?.steps[0].noteKey, 'program.expired')).toBe(true);
        expect(expired?.steps[2]).toMatchObject({ noteKey: mod('pair.waiting') });
        soloistState = { ...STATE_EMPTY, canSealKey: false };
        expect((await getSpotifySetup())?.steps[1]).toMatchObject({ state: 'error', noteKey: mod('key.noKeychain') });
        // A build whose date could not be read refused to start as expired.
        soloistState = { ...STATE_READY, running: false, paired: false, error: 'expired', executable: { ...STATE_READY.executable, state: 'unknown', daysLeft: null } };
        const refused = (await getSpotifySetup())?.steps[0];
        expect(refused).toMatchObject({ state: 'error' });
        expect(reads(refused?.noteKey, 'program.expired')).toBe(true);
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
        const failure = (reason: string) => describeSpotifyFailure('audio', spotifyError('unavailable', 'x', reason));
        expect(failure('soloist-unpaired')).toEqual({ case: 'not-configured' });
        expect(failure('soloist-expired')).toEqual({ case: 'not-configured' });
        expect(failure('soloist-gone')).toEqual({ case: 'unreachable' });
        expect(failure('soloist-refused')).toEqual({ case: 'refused' });
        expect(describeSpotifyFailure('audio', spotifyError('unavailable', 'Spotify gives this account no audio key'))).toEqual({ case: 'account-refused' });
    });
});
