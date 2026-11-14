import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the inherited-channel allowlist and the exact code evaluated in the isolated page.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression, createRequestDispatcher } = require('../../../electron/appleMusic/companionRequests.cjs');

describe('Apple Music companion requests', () => {
    it('does not time out an already sounding player with an unresolved play promise', async () => {
        let now = 0;
        const mk = { api: { music: vi.fn() }, isPlaying: true, play: vi.fn(() => new Promise(() => {})) };
        const context = { Date: { now: () => now }, window: { MusicKit: { getInstance: () => mk } } };
        await runInNewContext(requestExpression(validateRequest({ id: 'r', operation: 'resume' })), context);
        now = 60000;
        const read = requestExpression(validateRequest({ id: 's', operation: 'playbackStatus' }));
        expect(await runInNewContext(read, context)).toMatchObject({ ok: true });
        mk.isPlaying = false;
        now = 120000;
        expect(await runInNewContext(read, context)).toMatchObject({ ok: true });
    });

    it('allows recovery from a hung resume without waiting in the command queue', async () => {
        let now = 0;
        const mk = { api: { music: vi.fn() }, play: vi.fn(() => new Promise(() => {})) };
        const context = { Date: { now: () => now }, window: { MusicKit: { getInstance: () => mk } } };
        const resume = requestExpression(validateRequest({ id: 'r', operation: 'resume' }));
        await runInNewContext(resume, context);
        now = 60000;
        expect(await runInNewContext(requestExpression(validateRequest({ id: 's', operation: 'playbackStatus' })), context))
            .toMatchObject({ ok: false, error: 'playback-failed' });
        expect(await runInNewContext(resume, context)).toMatchObject({ ok: true });
        expect(mk.play).toHaveBeenCalledTimes(2);
    });

    it('acknowledges a buffering resume without blocking or restarting it', async () => {
        let finish!: () => void;
        const mk = { api: { music: vi.fn() }, play: vi.fn(() => new Promise<void>(done => { finish = done; })) };
        const context = { window: { MusicKit: { getInstance: () => mk } } };
        const resume = requestExpression(validateRequest({ id: 'r', operation: 'resume' }));
        expect(await runInNewContext(resume, context)).toMatchObject({ ok: true });
        expect(await runInNewContext(resume, context)).toMatchObject({ ok: true });
        expect(mk.play).toHaveBeenCalledTimes(1);
        const statusRequest = requestExpression(validateRequest({ id: 's', operation: 'playbackStatus' }));
        expect(await runInNewContext(statusRequest, context)).toMatchObject({ data: { starting: true } });
        finish();
        await new Promise(resolve => setImmediate(resolve));
        expect((await runInNewContext(statusRequest, context)).data.starting).toBeUndefined();
    });

    it('reports an asynchronous resume rejection through status', async () => {
        const mk = { api: { music: vi.fn() }, play: vi.fn(() => Promise.reject(new Error('refused'))) };
        const context = { window: { MusicKit: { getInstance: () => mk } } };
        expect(await runInNewContext(requestExpression(validateRequest({ id: 'r', operation: 'resume' })), context)).toMatchObject({ ok: true });
        await Promise.resolve();
        expect(await runInNewContext(requestExpression(validateRequest({ id: 's', operation: 'playbackStatus' })), context))
            .toMatchObject({ ok: false, error: 'playback-failed' });
    });

    it('drops queued preparation superseded by a new song', async () => {
        let finish!: (value: unknown) => void;
        const executeJavaScript = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done; }))
            .mockResolvedValue({ ok: true, data: {} });
        const contents = { isDestroyed: () => false, getURL: () => 'https://music.apple.com/', executeJavaScript };
        const dispatch = createRequestDispatcher(() => contents, 1000);
        const first = dispatch({ id: 'a', operation: 'pause' });
        const tail = dispatch({ id: 'b', operation: 'prepareNext', params: { catalogId: '123', nextIds: ['456'] } });
        const play = dispatch({ id: 'c', operation: 'playSong', params: { catalogId: '789', startSec: 0 } });
        await Promise.resolve();
        await Promise.resolve();
        finish({ ok: true, data: {} });
        await first;
        expect(await tail).toMatchObject({ error: 'stale-request' });
        expect(await play).toMatchObject({ ok: true });
        expect(executeJavaScript).toHaveBeenCalledTimes(2);
    });

    it('uses the existing pagination bounds for library songs', () => {
        expect(validateRequest({ id: 'library', operation: 'librarySongs', params: { limit: 100, offset: 100000 } }))
            .toMatchObject({ operation: 'librarySongs', params: { limit: 100, offset: 100000 } });
        for (const offset of [-1, 0.5, 100001, Number.MAX_SAFE_INTEGER]) {
            expect(validateRequest({ id: 'library', operation: 'librarySongs', params: { limit: 100, offset } })).toBeNull();
        }
        expect(validateRequest({ id: 'library', operation: 'librarySongs', params: { limit: 101 } })).toBeNull();
    });

    it('reads library songs with catalog relationships without dropping unmapped rows', async () => {
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [
                { id: 'i.mapped', type: 'library-songs', attributes: { name: 'Mapped' }, relationships: { catalog: { data: [{ id: '123' }] } } },
                { id: 'i.upload', type: 'library-songs', attributes: { name: 'Upload', token: 'private-token' } },
            ], next: '/v1/me/library/songs?offset=5' } });
        const request = validateRequest({ id: 'library', operation: 'librarySongs', params: { limit: 2, offset: 0 } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL });
        expect(call).toHaveBeenLastCalledWith('v1/me/library/songs', { limit: 2, offset: 0, include: 'catalog' });
        expect(result).toMatchObject({ ok: true, data: { items: [
            { id: 'i.mapped', attributes: { playParams: { catalogId: '123' } } },
            { id: 'i.upload', attributes: { name: 'Upload', playParams: { catalogId: '' } } },
        ], hasMore: true, nextOffset: 5 } });
        expect(JSON.stringify(result)).not.toContain('private-token');
    });

    it('rejects library-song cursors beyond the existing bound', async () => {
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [{ id: 'i.song', type: 'library-songs' }], next: '/v1/me/library/songs?offset=100001' } });
        const request = validateRequest({ id: 'library', operation: 'librarySongs', params: { limit: 1, offset: 99999 } });
        expect(await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL }))
            .toMatchObject({ ok: false, error: 'invalid-response' });
    });

    it('rejects unknown operations, dangerous IDs and invalid page sizes', () => {
        expect(validateRequest({ id: '1', operation: 'evaluate', params: { code: 'anything' } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'lyrics', params: { songId: '../me' } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'search', params: { query: 'x', limit: 101 } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'search', params: { query: '   ' } })).toBeNull();
    });

    it('returns a pseudonymous account identity and never sends the upstream identifier', async () => {
        const request = validateRequest({ id: '1', operation: 'accountStatus' });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [{ id: 'private-profile-id', attributes: { name: 'Example' } }] } });
        const context = { console, window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, crypto: webcrypto, TextEncoder, Uint8Array };
        const result = await runInNewContext(requestExpression(request), context);
        expect(result).toMatchObject({ ok: true, data: { nickname: 'Example', storefront: 'cn' } });
        expect(result.data.id).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(result)).not.toContain('private-profile-id');
    });

    it('does not misidentify a missing social profile as a signed-out user', async () => {
        const request = validateRequest({ id: '1', operation: 'accountStatus' });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [] } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: false, error: 'identity-unavailable' });
    });

    it('identifies an account with no social profile by a hash of its music user token', async () => {
        const request = validateRequest({ id: '1', operation: 'accountStatus' });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 404, data: { data: [] } });
        const mk = { api: { music: call }, musicUserToken: 'a-token-that-stays-in-the-page' };
        const result = await runInNewContext(requestExpression(request), {
            window: { MusicKit: { getInstance: () => mk } }, crypto: webcrypto, TextEncoder, Uint8Array,
        });
        expect(result).toMatchObject({ ok: true, data: { nickname: '', storefront: 'cn' } });
        expect(result.data.id).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(result)).not.toContain('a-token-that-stays-in-the-page');
    });

    it('sends search text as data and strips credentials from upstream results', async () => {
        const request = validateRequest({ id: '1', operation: 'search', params: { query: 'x\"; globalThis.injected = true; //' } });
        const call = vi.fn(async (path: string, _params?: Record<string, unknown>) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { results: { songs: { data: [{ id: '5', type: 'songs', attributes: { name: 'Example', token: 'secret' } }] } } } });
        const context = { console, window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, injected: false, URL };
        const result = await runInNewContext(requestExpression(request), context);
        expect(context.injected).toBe(false);
        expect(call.mock.calls[1][1]).toMatchObject({ term: 'x\"; globalThis.injected = true; //' });
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(result).toMatchObject({ ok: true, data: { items: [{ id: '5' }], hasMore: false } });
    });

    it('distinguishes an upstream failure from an empty page', async () => {
        const request = validateRequest({ id: '2', operation: 'playlists' });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 503, data: { errors: [{ code: 'failure' }] } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: false, error: 'upstream-error', httpStatus: 503 });
    });

    it('accepts a valid search with no song results but rejects a missing results envelope', async () => {
        const request = validateRequest({ id: '2', operation: 'search', params: { query: 'example' } });
        const call = vi.fn(async (path: string): Promise<unknown> => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { results: {} } });
        const context = { console, window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } };
        expect(await runInNewContext(requestExpression(request), context)).toMatchObject({ ok: true, data: { items: [], hasMore: false } });
        call.mockImplementation(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: {} });
        expect(await runInNewContext(requestExpression(request), context)).toMatchObject({ ok: false, error: 'invalid-response' });
    });

    it('rejects pages that promise another page without making progress', async () => {
        const request = validateRequest({ id: '3', operation: 'playlistTracks', params: { playlistId: 'p.example' } });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [], next: '/next' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL });
        expect(result).toMatchObject({ ok: false, error: 'invalid-response' });
    });

    it('uses the server pagination offset instead of guessing from the number of rows', async () => {
        const request = validateRequest({ id: '3', operation: 'playlists', params: { limit: 5, offset: 0 } });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [{ id: 'p.1', type: 'library-playlists' }], next: '/v1/me/library/playlists?offset=5' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } }, URL });
        expect(result).toMatchObject({ ok: true, data: { nextOffset: 5, hasMore: true } });
    });

    it('rejects stale results after the page changes', async () => {
        let generation = 0;
        let resolve!: (value: unknown) => void;
        const pending = new Promise(done => { resolve = done; });
        const contents = { isDestroyed: () => false, getURL: () => 'https://music.apple.com/', executeJavaScript: () => pending };
        const dispatch = createRequestDispatcher(() => contents, 1000, () => generation);
        const result = dispatch({ id: '4', operation: 'accountStatus' });
        generation++;
        resolve({ ok: true, data: { authorized: true } });
        expect(await result).toMatchObject({ ok: false, error: 'not-ready' });
    });

    it('uses a catalog ID to play and rejects malformed IDs or invalid seek values', async () => {
        for (const catalogId of ['l.album', 'i.', 'i.bad-id', '../123', 'i.' + 'a'.repeat(101)]) {
            expect(validateRequest({ id: '5', operation: 'playSong', params: { catalogId } })).toBeNull();
        }
        expect(validateRequest({ id: '5', operation: 'seek', params: { seconds: -1 } })).toBeNull();
        const setQueue = vi.fn(async () => {});
        const play = vi.fn(async () => {});
        const mk = { api: { music: vi.fn() }, setQueue, play };
        const request = validateRequest({ id: '5', operation: 'playSong', params: { catalogId: '123' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } });
        expect(setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: false, startTime: 0 });
        expect(play).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ ok: true });
    });

    // An uploaded song has no catalog counterpart: the page queues it by its library id, as Apple's web player does.
    it('plays and prepares an upload by its library ID', async () => {
        expect(validateRequest({ id: '5', operation: 'prepareNext', params: { catalogId: 'i.upload', nextIds: ['456'] } }))
            .toMatchObject({ params: { catalogId: 'i.upload', nextIds: ['456'] } });
        expect(validateRequest({ id: '5', operation: 'prepareNext', params: { catalogId: '123', nextIds: ['i.upload'] } })).toBeNull();
        const setQueue = vi.fn(async () => {});
        const play = vi.fn(async () => {});
        const mk = { api: { music: vi.fn() }, setQueue, play };
        const request = validateRequest({ id: '5', operation: 'playSong', params: { catalogId: 'i.4YBN2bxs490m70' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } });
        expect(setQueue).toHaveBeenCalledWith({ song: 'i.4YBN2bxs490m70', startPlaying: false, startTime: 0 });
        expect(play).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ ok: true });
    });

    it('plays in the account region on a page Apple kept in another, and says whether it plays previews', async () => {
        const mk: Record<string, any> = {
            api: { music: vi.fn() },
            isAuthorized: true,
            storefrontId: 'cn',
            storefrontCountryCode: 'us',
            playbackMode: 0,
            get previewOnly() { return this.playbackMode === 0; },
            hasMusicSubscription: vi.fn(async () => true),
            play: vi.fn(async () => {}),
        };
        let queuedIn: unknown[] = [];
        mk.setQueue = vi.fn(async () => { queuedIn = [mk.storefrontId, mk.playbackMode]; });
        const request = validateRequest({ id: '5', operation: 'playSong', params: { catalogId: '123' } });
        const window = { MusicKit: { getInstance: () => mk, PlaybackMode: { PREVIEW_ONLY: 0, MIXED_CONTENT: 1 } } };
        const result = await runInNewContext(requestExpression(request), { window, setTimeout, clearTimeout });
        expect(queuedIn).toEqual(['us', 1]);
        expect(result).toMatchObject({ ok: true, data: { previewOnly: false, storefront: 'us', subscribed: true } });
    });

    it('aligns the region before a station and a prepared queue too, not for other requests', async () => {
        const regionAfter = async (operation: string, params: Record<string, unknown> = {}) => {
            const mk = {
                api: { music: vi.fn(async () => ({ data: { data: [] } })) }, isAuthorized: true, storefrontId: 'cn', storefrontCountryCode: 'us',
                playbackMode: 1, setQueue: vi.fn(async () => {}), play: vi.fn(async () => {}),
            };
            const window = { MusicKit: { getInstance: () => mk, PlaybackMode: { PREVIEW_ONLY: 0, MIXED_CONTENT: 1 } } };
            await runInNewContext(requestExpression(validateRequest({ id: '1', operation, params })), { window, setTimeout, clearTimeout });
            return mk.storefrontId;
        };
        expect(await regionAfter('playStation', { stationId: 'ra.123' })).toBe('us');
        expect(await regionAfter('prepareNext', { catalogId: '1', nextIds: ['2'] })).toBe('us');
        expect(await regionAfter('playbackStatus')).toBe('cn');
        expect(await regionAfter('pause')).toBe('cn');
    });

    it('starts in the page region when aligning fails', async () => {
        const mk: Record<string, any> = {
            api: { music: vi.fn() }, isAuthorized: true, storefrontCountryCode: 'us',
            get storefrontId() { return 'cn'; }, set storefrontId(_value) { throw new Error('read-only'); },
            setQueue: vi.fn(async () => {}), play: vi.fn(async () => {}),
        };
        const request = validateRequest({ id: '5', operation: 'playSong', params: { catalogId: '123' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } });
        expect(mk.setQueue).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ ok: true, data: { storefront: 'cn' } });
    });

    it('sets the page player volume and accepts only a level from 0 to 1', async () => {
        expect(validateRequest({ id: '1', operation: 'setVolume', params: { volume: 1.5 } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'setVolume', params: { volume: -0.1 } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'setVolume', params: { volume: '0.5' } })).toBeNull();
        const mk = { api: { music: vi.fn() }, volume: 1 };
        const request = validateRequest({ id: '1', operation: 'setVolume', params: { volume: 0.25 } });
        expect(await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } }))
            .toMatchObject({ ok: true });
        expect(mk.volume).toBe(0.25);
    });

    it('sets the page player repeat of one track, never its list repeat', async () => {
        expect(validateRequest({ id: '1', operation: 'setRepeatOne', params: { enabled: 'yes' } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'setRepeatOne', params: {} })).toBeNull();
        const mk = { api: { music: vi.fn() }, setRepeatMode: vi.fn() };
        for (const enabled of [true, false]) {
            const request = validateRequest({ id: '1', operation: 'setRepeatOne', params: { enabled } });
            expect(await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } }))
                .toMatchObject({ ok: true });
        }
        expect(mk.setRepeatMode.mock.calls).toEqual([[1], [0]]);
        const plain = { api: { music: vi.fn() }, repeatMode: 0 };
        const request = validateRequest({ id: '1', operation: 'setRepeatOne', params: { enabled: true } });
        await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => plain } } });
        expect(plain.repeatMode).toBe(1);
    });

    it('accepts only a bounded start position for a song', () => {
        expect(validateRequest({ id: '1', operation: 'playSong', params: { catalogId: '123', startSec: 12.5 } }))
            .toMatchObject({ params: { catalogId: '123', startSec: 12.5 } });
        expect(validateRequest({ id: '1', operation: 'playSong', params: { catalogId: '123', startSec: -1 } })).toBeNull();
        expect(validateRequest({ id: '1', operation: 'playSong', params: { catalogId: '123', startSec: '3' } })).toBeNull();
    });

    it('turns Apple\'s own queue behaviour off and seeks after a start position', async () => {
        const calls: string[] = [];
        const mk = {
            api: { music: vi.fn() },
            setShuffleMode: vi.fn(() => calls.push('shuffle')),
            setRepeatMode: vi.fn(() => calls.push('repeat')),
            setQueue: vi.fn(async () => { calls.push('queue'); }),
            play: vi.fn(async () => { calls.push('play'); }),
            seekToTime: vi.fn(async () => { calls.push('seek'); }),
        };
        const request = validateRequest({ id: '1', operation: 'playSong', params: { catalogId: '123', startSec: 30 } });
        expect(await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } }))
            .toMatchObject({ ok: true });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(calls).toEqual(['shuffle', 'repeat', 'queue', 'play', 'seek']);
        expect(mk.setQueue).toHaveBeenCalledWith({ song: '123', startPlaying: false, startTime: 30 });
        expect(mk.seekToTime).toHaveBeenCalledWith(30);
    });

    it('reports the player state the clock and the end follow', async () => {
        const request = validateRequest({ id: '1', operation: 'playbackStatus' });
        const mk = {
            api: { music: vi.fn() },
            nowPlayingItem: { id: 'i.library', attributes: { durationInMillis: 200000, playParams: { catalogId: '123' } } },
            currentPlaybackTime: 42.5,
            isPlaying: false,
            playbackState: 5,
            queue: { length: 1 },
        };
        expect(await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => mk } } })).toEqual({
            ok: true, data: {
                itemId: 'i.library', catalogId: '123', isPlaying: false, state: 5, repeatMode: null, queueLength: 1, queueKeys: ['length'], positionMs: 42500, durationMs: 200000,
            },
        });
    });

    it('tells a missing lyric from an upstream failure, and a refused session from both', async () => {
        const lyrics = validateRequest({ id: '1', operation: 'lyrics', params: { songId: '123' } });
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 404, data: { errors: [{ code: 'not-found' }] } });
        const result = await runInNewContext(requestExpression(lyrics), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: false, error: 'lyrics-unavailable', httpStatus: 404 });

        const storefrontCall = vi.fn(async () => ({ status: 403, data: { errors: [{ code: 'forbidden' }] } }));
        const playlists = validateRequest({ id: '2', operation: 'playlists' });
        expect(await runInNewContext(requestExpression(playlists), { window: { MusicKit: { getInstance: () => ({ api: { music: storefrontCall } }) } } }))
            .toMatchObject({ ok: false, error: 'auth-required' });

        // A signed-in account refused on the operation itself is not signed out by it.
        const refusedCall = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 403, data: { errors: [{ code: 'forbidden' }] } });
        const tracks = validateRequest({ id: '3', operation: 'playlistTracks', params: { playlistId: 'p.1' } });
        expect(await runInNewContext(requestExpression(tracks), { window: { MusicKit: { getInstance: () => ({ api: { music: refusedCall } }) } } }))
            .toMatchObject({ ok: false, error: 'upstream-error', httpStatus: 403 });
    });

    it('reserves capacity for status and transport while reads are pending', async () => {
        const gates: Array<(value: unknown) => void> = [];
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/',
            executeJavaScript: () => new Promise(done => { gates.push(done); }),
        };
        const dispatch = createRequestDispatcher(() => contents, 1000);
        const reads = [dispatch({ id: 'a', operation: 'accountStatus' }), dispatch({ id: 'b', operation: 'accountStatus' })];
        expect(await dispatch({ id: 'c', operation: 'accountStatus' })).toMatchObject({ error: 'busy' });
        const status = dispatch({ id: 'd', operation: 'playbackStatus' });
        const pause = dispatch({ id: 'e', operation: 'pause' });
        await Promise.resolve();
        await Promise.resolve();
        expect(gates).toHaveLength(4);
        gates.forEach(done => done({ ok: true, data: {} }));
        expect((await Promise.all([...reads, status, pause])).every(result => result.ok)).toBe(true);
    });

    it('runs one playback command at a time and does not drop the later one', async () => {
        const gates: Array<(value: unknown) => void> = [];
        let calls = 0;
        const contents = {
            isDestroyed: () => false,
            getURL: () => 'https://music.apple.com/',
            executeJavaScript: () => new Promise(done => { calls += 1; gates.push(done); }),
        };
        const dispatch = createRequestDispatcher(() => contents, 1000);
        const first = dispatch({ id: '6', operation: 'pause' });
        const second = dispatch({ id: '7', operation: 'resume' });
        await new Promise(resolve => setTimeout(resolve, 0));
        // The second waits: the first is still running, and a pause must not be lost.
        expect(calls).toBe(1);
        gates[0]({ ok: true, data: { first: true } });
        expect(await first).toMatchObject({ ok: true, data: { first: true } });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(calls).toBe(2);
        gates[1]({ ok: true, data: { second: true } });
        expect(await second).toMatchObject({ ok: true, data: { second: true } });
    });
});
