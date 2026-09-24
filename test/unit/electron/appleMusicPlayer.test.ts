import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/appleMusicPlayer.test.ts

async function createPlayer(subscriber = true, validationStatus = 200) {
    const music = { isAuthorized: true, developerToken: 'developer-fixture', musicUserToken: 'user-fixture', authorize: vi.fn(async () => true), hasMusicSubscription: vi.fn(async () => subscriber),
        setQueue: vi.fn(async () => {}), changeToMediaAtIndex: vi.fn(async () => {}), play: vi.fn(async () => {}), addEventListener: vi.fn(),
        playLater: vi.fn(async () => {}), queue: { nextPlayableItem: null as null | { id: string } }, bitrate: 256,
        pause: vi.fn(async () => {}), seekToTime: vi.fn(async () => {}), volume: 0.4,
        api: { music: vi.fn(async () => ({ data: { data: [{ id: 'i.library', type: 'library-songs' }] } })) },
        nowPlayingItem: { id: '42', attributes: { playParams: { catalogId: '42' } } },
        currentPlaybackTime: 75, currentPlaybackDuration: 200, isPlaying: true };
    let onload = () => {};
    const context: any = { window: {}, AbortSignal, fetch: vi.fn(async () => ({ ok: validationStatus === 200, status: validationStatus })), MusicKit: { configure: async () => music }, setTimeout, clearTimeout,
        document: { getElementById: () => ({}), createElement: () => ({ setAttribute() {} }),
            addEventListener: (_: string, callback: () => void) => { onload = callback; },
            head: { appendChild: () => onload() } } };
    vm.runInNewContext(readFileSync('electron/appleMusic/player.js', 'utf8'), context);
    await context.window.foliaMusic('configure', { token: 'fixture' });
    return { music, call: context.window.foliaMusic, fetch: context.fetch };
}

describe('MusicKit player contract', () => {
    it('restores track, position, volume and pause state when replacing an expired SDK token', async () => {
        const { call, music } = await createPlayer();
        music.isPlaying = false;
        const item = music.nowPlayingItem;
        await call('configure', { token: 'new-fixture', restorePlayback: true });
        expect(music.setQueue).toHaveBeenCalledWith({ items: [item] });
        expect(music.seekToTime).toHaveBeenCalledWith(75);
        expect(music.volume).toBe(0.4);
        expect(music.pause).toHaveBeenCalledOnce();
        expect(music.play).not.toHaveBeenCalled();
    });
    it('loads Apple lyrics from the web API while keeping ordinary catalog requests on MusicKit', async () => {
        const { call, music, fetch } = await createPlayer();
        fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ attributes: { ttml: '<tt />' } }] }) });
        expect(await call('api', { path: '/v1/catalog/us/songs/42/syllable-lyrics' }))
            .toEqual({ data: [{ attributes: { ttml: '<tt />' } }] });
        expect(fetch).toHaveBeenLastCalledWith('https://amp-api.music.apple.com/v1/catalog/us/songs/42/syllable-lyrics?platform=web', expect.objectContaining({
            headers: { Authorization: 'Bearer developer-fixture', 'Music-User-Token': 'user-fixture' }, redirect: 'error',
        }));
        expect(music.api.music).not.toHaveBeenCalled();
        await call('api', { path: '/v1/catalog/us/songs/42' });
        expect(music.api.music).toHaveBeenCalledWith('/v1/catalog/us/songs/42');
    });
    it('sends writes through the SDK fetch options and tolerates empty accepted responses', async () => {
        const { call, music } = await createPlayer();
        music.api.music.mockResolvedValueOnce({} as never);
        expect(await call('api', { path: '/v1/me/ratings/songs/42', method: 'PUT', body: { type: 'rating', attributes: { value: 1 } } })).toEqual({});
        expect(music.api.music).toHaveBeenCalledWith('/v1/me/ratings/songs/42', undefined, { fetchOptions: { method: 'PUT', body: '{"type":"rating","attributes":{"value":1}}' } });
        await call('api', { path: '/v1/me/ratings/songs/42', method: 'DELETE' });
        expect(music.api.music).toHaveBeenLastCalledWith('/v1/me/ratings/songs/42', undefined, { fetchOptions: { method: 'DELETE', body: undefined } });
    });
    it('applies the requested bitrate before loading and continues an item the queue already reached', async () => {
        const { call, music } = await createPlayer();
        await call('start', { id: '7', bitrate: 64 });
        expect(music.bitrate).toBe(64);
        expect(music.setQueue).toHaveBeenCalledWith({ song: '7' });
        music.setQueue.mockClear();
        music.isPlaying = false;
        expect(await call('start', { id: '42', continueIfCurrent: true })).toBe(true);
        expect(music.setQueue).not.toHaveBeenCalled();
        expect(music.play).toHaveBeenCalled();
        await call('start', { id: '42' });
        expect(music.setQueue).toHaveBeenCalledWith({ song: '42' });
    });
    it('lines the next song up once and skips when it is already queued', async () => {
        const { call, music } = await createPlayer();
        await call('queueNext', { id: '8' });
        expect(music.playLater).toHaveBeenCalledWith({ song: '8' });
        music.queue.nextPlayableItem = { id: '8' };
        await call('queueNext', { id: '8' });
        expect(music.playLater).toHaveBeenCalledTimes(1);
        await call('queueNext', { id: 'i.library' });
        expect(music.playLater).toHaveBeenLastCalledWith({ items: [{ id: 'i.library', type: 'library-songs' }] });
    });
    it('distinguishes missing lyrics from access failures and network errors', async () => {
        const { call, fetch } = await createPlayer();
        const request = () => call('api', { path: '/v1/catalog/us/songs/42/lyrics' });
        fetch.mockResolvedValue({ ok: false, status: 404 });
        await expect(request()).resolves.toEqual({ data: [] });
        fetch.mockResolvedValue({ ok: false, status: 403 });
        await expect(request()).rejects.toThrow('lyrics-service-unavailable');
        fetch.mockRejectedValue(new Error('private request detail'));
        await expect(request()).rejects.toThrow('lyrics-network-error');
    });
    it('rejects invalid application credentials before opening an Apple login', async () => {
        await expect(createPlayer(true, 401)).rejects.toThrow('developer-token-rejected');
        await expect(createPlayer(true, 403)).rejects.toThrow('developer-token-rejected');
        await expect(createPlayer(true, 503)).rejects.toThrow('token-service-unavailable');
    });
    it('does not misreport an authorization error as a user cancellation', async () => {
        const { call, music } = await createPlayer();
        music.isAuthorized = false;
        music.authorize.mockRejectedValue(Object.assign(new Error('private SDK detail'), { name: 'AUTHORIZATION_ERROR' }));
        await expect(call('authorize')).rejects.toThrow('authorization-failed');
        expect(await call('status')).toMatchObject({ authorized: false, lastAuthorizationError: 'AUTHORIZATION_ERROR' });
    });
    it('accepts successful authorization state even when the SDK promise rejects afterwards', async () => {
        const { call, music } = await createPlayer();
        music.isAuthorized = false;
        music.authorize.mockImplementation(async () => { music.isAuthorized = true; throw new Error('late SDK rejection'); });
        await expect(call('authorize')).resolves.toBe(true);
    });
    it('does not treat a fulfilled promise without authorization as success', async () => {
        const { call, music } = await createPlayer();
        music.isAuthorized = false;
        await expect(call('authorize')).rejects.toThrow('authorization-incomplete');
    });
    it('does not fall back to a preview when the account lacks a subscription', async () => {
        const { call, music } = await createPlayer(false);
        await expect(call('start', { id: '42' })).rejects.toThrow('subscription-required');
        expect(music.setQueue).not.toHaveBeenCalled();
        expect(music.play).not.toHaveBeenCalled();
    });
    it('preserves library resources instead of treating their IDs as catalog song IDs', async () => {
        const { call, music } = await createPlayer();
        await call('start', { id: 'i.library' });
        expect(music.api.music).toHaveBeenCalledWith('/v1/me/library/songs/i.library');
        expect(music.setQueue).toHaveBeenCalledWith({ items: [{ id: 'i.library', type: 'library-songs' }] });
        expect(music.play).toHaveBeenCalledOnce();
    });
    it('reports the SDK clock and propagates asynchronous playback errors', async () => {
        const { call, music } = await createPlayer();
        expect(await call('snapshot')).toMatchObject({ position: 75, duration: 200, playing: true });
        music.addEventListener.mock.calls[0][1]();
        await expect(call('snapshot')).rejects.toThrow('playback-failed');
    });
    it('propagates item loading failures instead of reporting silent play success', async () => {
        const { call, music } = await createPlayer();
        music.changeToMediaAtIndex.mockRejectedValue(new Error('loading failed'));
        await expect(call('start', { id: '42' })).rejects.toThrow('loading failed');
        expect(music.play).not.toHaveBeenCalled();
    });
});
