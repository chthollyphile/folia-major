import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';
import { normalizeAppleMusicSong } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';
import { getOnlineMusicProvider } from '../../../src/services/onlineMusic/providerRegistry';

// A login session must not accept a late account response after cancellation.
afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music provider login', () => {
    it('confirms only after the companion supplies a valid account identity', async () => {
        const request = vi.fn(async (operation: string) => operation === 'accountStatus'
            ? { ok: true, data: { id: 'a'.repeat(64), nickname: 'Example' } }
            : { ok: true, data: {} });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        await expect(provider.auth!.checkLogin!(key)).resolves.toEqual({ state: 'confirmed' });
        expect(request).toHaveBeenCalledWith('showWindow', {});
        // The sign-in window goes back into the background once the account is confirmed.
        expect(request).toHaveBeenCalledWith('hideWindow', {});
        expect(provider.capabilities.playback).toBe(false);
    });

    it('discards an account response that arrives after cancel', async () => {
        let resolve!: (value: unknown) => void;
        const pending = new Promise(done => { resolve = done; });
        const request = vi.fn((operation: string) => operation === 'accountStatus'
            ? pending : Promise.resolve({ ok: true, data: {} }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        const check = provider.auth!.checkLogin!(key);
        await provider.auth!.cancelLogin!(key);
        resolve({ ok: true, data: { id: 'a'.repeat(64), nickname: 'Example' } });
        await expect(check).resolves.toEqual({ state: 'expired' });
    });

    it('treats authentication failure as waiting but propagates unknown identity', async () => {
        const request = vi.fn(async (operation: string) => operation === 'accountStatus'
            ? { ok: false, error: 'auth-required' } : { ok: true, data: {} });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const key = await provider.auth!.startLogin!();
        await expect(provider.auth!.checkLogin!(key)).resolves.toEqual({ state: 'waiting' });
        request.mockImplementation(async (operation: string) => operation === 'accountStatus'
            ? { ok: false, error: 'identity-unavailable' } : { ok: true, data: {} });
        await expect(provider.auth!.checkLogin!(key)).rejects.toMatchObject({ code: 'unavailable', cause: 'identity-unavailable' });
    });
});

// Apple supplies TTML for a song it has timed lyrics for; the parsed lyric keeps the timing it had.
const wordLevelTtml = [
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">',
    '<body dur="00:04.000"><div begin="00:01.000" end="00:03.000">',
    '<p begin="00:01.000" end="00:03.000" itunes:key="L1"><span begin="00:01.000" end="00:01.500">Hello</span> <span begin="00:01.500" end="00:02.500">world</span></p>',
    '</div></body></tt>',
].join('');
const lineLevelTtml = wordLevelTtml.replace('itunes:timing="Word"', 'itunes:timing="Line"');

describe('Apple Music lyrics and external playback', () => {
    const song = normalizeAppleMusicSong({ id: '123', type: 'songs', attributes: { name: 'Example' } });

    it('keeps whether Apple gave word-level or line-level timing', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { ttml: wordLevelTtml } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const result = await provider.lyrics!.getLyrics(song);
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.ttml?.timingMode).toBe('Word');

        request.mockImplementation(async () => ({ ok: true, data: { ttml: lineLevelTtml } }));
        const lineLevel = await provider.lyrics!.getLyrics(song);
        expect(lineLevel.lyrics?.isWordByWord).toBe(false);
        expect(lineLevel.lyrics?.ttml?.timingMode).toBe('Line');
    });

    it('reports no lyrics rather than an error when Apple has none for the song', async () => {
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: false, error: 'lyrics-unavailable' })) } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.lyrics!.getLyrics(song)).resolves.toEqual({ lyrics: null, isPureMusic: false });
    });

    it('steers the companion by the catalog id and follows its status', async () => {
        const request = vi.fn(async (operation: string, params?: Record<string, unknown>) => {
            if (operation === 'playbackStatus') {
                return { ok: true, data: {
                    itemId: 'i.library', catalogId: '123', isPlaying: true, state: 2, positionMs: 45000, durationMs: 180000,
                } };
            }
            return { ok: true, data: {} };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        const external = provider.externalPlayback!;
        await external.play(song, 12.25);
        expect(request).toHaveBeenCalledWith('playSong', expect.objectContaining({ catalogId: '123', startSec: 12.25, requestKey: expect.any(String) }));
        const status = await external.getStatus(song);
        expect(status).toMatchObject({ mediaId: '123', isPlaying: true, positionMs: 45000, durationMs: 180000, ended: false });
        expect(external.isStatusForSong(song, status)).toBe(true);
        expect(external.isStatusForSong({ ...song, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: 'i.other' } }, status)).toBe(false);
    });

    it('marks the end the player reports and rejects a malformed status', async () => {
        const request = vi.fn(async (): Promise<unknown> => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 5, positionMs: 180000, durationMs: 180000,
        } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: true });

        // stalled (9) is not the end; completed (10) is.
        request.mockImplementation(async () => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 9, positionMs: 1000, durationMs: 180000,
        } }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: false });
        request.mockImplementation(async () => ({ ok: true, data: {
            itemId: '123', catalogId: '123', isPlaying: false, state: 10, positionMs: 180000, durationMs: 180000,
        } }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toMatchObject({ ended: true });

        request.mockImplementation(async () => ({ ok: true, data: { itemId: '123', isPlaying: true, positionMs: -1, durationMs: 10 } }));
        await expect(provider.externalPlayback!.getStatus(song)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('waits through a player with no track instead of calling the answer malformed', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {
            itemId: '', catalogId: '', isPlaying: false, state: 0, positionMs: 0, durationMs: 0,
        } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        await expect(provider.externalPlayback!.getStatus(song)).resolves.toEqual({
            mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false,
        });
    });


    it('retains the completed song identity after MusicKit clears its item and time', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        const request = vi.fn(async () => ({ ok: true, data }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        data = { itemId: '', catalogId: '', isPlaying: false, state: 3, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ ended: false });
        data.state = 10;
        await expect(external.getStatus(song)).resolves.toEqual({
            mediaId: '123', isPlaying: false, ended: true, positionMs: 180000, durationMs: 180000,
        });
        // A new attempt has not played: the previous song's completed state cannot skip it.
        await external.play(song, 0);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });

    it('does not adopt another song completion or a late sample from an earlier attempt', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        let resolve!: (value: unknown) => void;
        let wait = false;
        const request = vi.fn(async (operation: string): Promise<unknown> => {
            if (operation === 'playbackStatus' && wait) return new Promise(done => { resolve = done; });
            return { ok: true, data };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        data = { ...data, itemId: '456', catalogId: '456' };
        await external.getStatus(song);
        data = { itemId: '', catalogId: '', isPlaying: false, state: 10, positionMs: 0, durationMs: 0 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ ended: false });
        wait = true;
        const late = external.getStatus(song);
        await external.play(song, 0);
        resolve({ ok: true, data: { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 } });
        await late;
        wait = false;
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '', ended: false });
    });


    it('adopts only the approved successor as completion of the old song', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        vi.stubGlobal('window', { electron: { appleMusicRequest: vi.fn(async () => ({ ok: true, data })) } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        await external.play(song, 0);
        await external.getStatus(song);
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        await external.prepareNext!(song, [next]);
        data = { ...data, itemId: '456', catalogId: '456', positionMs: 100 };
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
        await external.prepareNext!(song, []);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '456', ended: false });
    });


    it('keeps an already prepared handoff when an edit arrives after native advancement', async () => {
        let data = { itemId: '123', catalogId: '123', isPlaying: true, state: 2, positionMs: 179000, durationMs: 180000 };
        let stale = false;
        const request = vi.fn(async (operation: string): Promise<unknown> => operation === 'prepareNext' && stale
            ? { ok: false, error: 'stale-request' } : { ok: true, data });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const external = createAppleMusicProvider(() => ({ configured: true })).externalPlayback!;
        const next = normalizeAppleMusicSong({ id: '456', type: 'songs', attributes: { name: 'Next' } });
        const inserted = normalizeAppleMusicSong({ id: '789', type: 'songs', attributes: { name: 'Inserted' } });
        await external.play(song, 0);
        await external.getStatus(song);
        await external.prepareNext!(song, [next]);
        data = { ...data, itemId: '456', catalogId: '456', positionMs: 100, isPlaying: false };
        stale = true;
        await external.prepareNext!(song, [inserted, next]);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
        await external.prepareNext!(song, []);
        await expect(external.getStatus(song)).resolves.toMatchObject({ mediaId: '123', ended: true });
    });

    it('is the provider the registry holds', () => {
        const registered = getOnlineMusicProvider('appleMusic');
        expect(registered?.capabilities.externalPlayback).toBe(true);
        expect(registered?.capabilities.playback).toBe(false);
        expect(registered?.externalPlayback).toBeDefined();
    });
});
