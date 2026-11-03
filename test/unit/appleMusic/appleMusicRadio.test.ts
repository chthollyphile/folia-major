import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppleMusicProvider } from '../../../src/services/onlineMusic/appleMusic/appleMusicProvider';
import { getAppleMusicLiveStations, getAppleMusicLiveStationTracks } from '../../../src/services/onlineMusic/appleMusic/appleMusicRadio';

// Exercise Apple's station requests through the serialized page boundary, plus provider live controls.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression } = require('../../../electron/appleMusic/companionRequests.cjs');
const station = { id: 'ra.123', type: 'stations', attributes: { name: 'Live station', isLive: true, playParams: { id: 'ra.123' } } };
const song = (id: string) => ({ id, type: 'songs', attributes: { name: id, playParams: { id }, durationInMillis: 100000 } });
afterEach(() => vi.unstubAllGlobals());

function pageRun(operation: string, call: ReturnType<typeof vi.fn>, params = {}, extra = {}) {
    const request = validateRequest({ id: 'radio_test', operation, params });
    const window = { MusicKit: { getInstance: () => ({ api: { music: call }, ...extra }) } };
    return runInNewContext(requestExpression(request), { window, URL, console });
}
function catalogCall() {
    return vi.fn(async (path: string) => path === 'v1/me/storefront' ? { data: { data: [{ id: 'cn' }] } }
        : path.includes('next-tracks') ? { data: { data: [song('1'), song('2')] } } : { data: { data: [station] } });
}

describe('Apple Music radio', () => {
    it('accepts no arbitrary station URLs, and fixes FM batch size', () => {
        expect(validateRequest({ id: 'x', operation: 'station', params: { stationId: '../me' } })).toBeNull();
        expect(validateRequest({ id: 'x', operation: 'playStation', params: { stationId: 'https://example.com' } })).toBeNull();
        expect(validateRequest({ id: 'x', operation: 'personalFm', params: { limit: 100, url: 'private' } }).params).toEqual({ limit: 2, offset: 0 });
    });
    it('asks the personal station for new songs without changing the sounding queue', async () => {
        const call = catalogCall(); const setQueue = vi.fn();
        const result = await pageRun('personalFm', call, {}, { setQueue });
        expect(result).toMatchObject({ ok: true, data: { items: [{ id: '1' }, { id: '2' }], hasMore: false } });
        expect(call).toHaveBeenCalledWith('v1/catalog/cn/stations', { 'filter[identity]': 'personal', limit: 1 });
        expect(call).toHaveBeenCalledWith('v1/me/stations/next-tracks/ra.123', { limit: 2 }, { method: 'POST' });
        expect(setQueue).not.toHaveBeenCalled();
    });
    it('does not send a next-tracks write after an invalid station response', async () => {
        const call = vi.fn(async (path: string) => ({ data: { data: path === 'v1/me/storefront' ? [{ id: 'cn' }] : [{ ...station, id: '../private' }] } }));
        expect(await pageRun('personalFm', call)).toMatchObject({ ok: false });
        expect(call.mock.calls.some(([path]) => path.includes('next-tracks'))).toBe(false);
    });
    it('requests featured live stations from the signed-in storefront', async () => {
        const call = catalogCall();
        expect(await pageRun('stations', call)).toMatchObject({ ok: true, data: { items: [{ attributes: { isLive: true } }] } });
        expect(call).toHaveBeenCalledWith('v1/catalog/cn/stations', { 'filter[featured]': 'apple-music-live-radio', limit: 20 });
    });
    it('starts a station using MusicKit station rather than song queue parameters', async () => {
        const setQueue = vi.fn(); const play = vi.fn();
        expect(await pageRun('playStation', vi.fn(), { stationId: station.id }, { setQueue, play })).toMatchObject({ ok: true });
        expect(setQueue).toHaveBeenCalledWith({ station: station.id, startPlaying: false });
        expect(play).toHaveBeenCalledOnce();
    });
    it('keeps a broadcast identity when its programme metadata changes', async () => {
        const window = { __foliaLiveStation: station.id, MusicKit: { getInstance: () => ({ api: { music: vi.fn() },
            nowPlayingItem: song('456'), isPlaying: true, currentPlaybackTime: 88, playbackState: 2 }) } };
        const request = validateRequest({ id: 'x', operation: 'playbackStatus' });
        expect(await runInNewContext(requestExpression(request), { window })).toMatchObject({ ok: true, data: {
            itemId: station.id, catalogId: station.id, positionMs: 0, durationMs: 0, live: true,
        } });
    });
    it('clears the live identity when the Apple page selects another queue', async () => {
        const mk = { api: { music: vi.fn() }, setQueue: vi.fn(async (_options?: unknown) => {}), play: vi.fn(),
            nowPlayingItem: song('999'), isPlaying: true, currentPlaybackTime: 12, playbackState: 2 };
        const window = { MusicKit: { getInstance: () => mk } };
        const context = { window, console };
        await runInNewContext(requestExpression(validateRequest({ id: 'x', operation: 'playStation', params: { stationId: station.id } })), context);
        // A programme title update leaves the queue intact; choosing a song invokes setQueue.
        await mk.setQueue({ song: '999' });
        expect(await runInNewContext(requestExpression(validateRequest({ id: 'y', operation: 'playbackStatus' })), context))
            .toMatchObject({ ok: true, data: { itemId: '999', positionMs: 12000 } });
        const status = await runInNewContext(requestExpression(validateRequest({ id: 'z', operation: 'playbackStatus' })), context);
        expect(status.data.live).toBeUndefined();
    });
    it('exposes live cards and one untimed external item, not a fabricated song list', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { items: [station], hasMore: false, nextOffset: 1 } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        expect(await getAppleMusicLiveStations()).toMatchObject([{ id: station.id, type: 'radio' }]);
        const page = await getAppleMusicLiveStationTracks(station.id, 0);
        const item = page.items[0];
        const provider = createAppleMusicProvider(() => ({ configured: true }));
        expect(provider.externalPlayback!.canPlay!(item)).toBe(true);
        await provider.externalPlayback!.play(item, 0);
        expect(request).toHaveBeenCalledWith('playStation', { stationId: station.id });
        request.mockClear();
        await provider.externalPlayback!.seek(10);
        await provider.externalPlayback!.prepareNext!(item, []);
        await provider.lyrics!.getLyrics(item);
        expect(request).not.toHaveBeenCalled();
        expect(provider.externalPlayback!.isStatusForSong(item, { mediaId: station.id, isPlaying: true, positionMs: 0, durationMs: 0, ended: false })).toBe(true);
    });
});
