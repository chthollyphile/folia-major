import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// A start MusicKit gives up (#1336): the page loads the track, then the player stops and drops it,
// or reports why only as an event while play() resolves. Exercised on the exact code the page runs.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression } = require('../../../sources/appleMusic/main/companionRequests.cjs');

type Listener = (event?: unknown) => void;

const setUp = () => {
    let now = 0;
    const listeners = new Map<string, Listener[]>();
    const mk: Record<string, any> = {
        api: { music: vi.fn() },
        isPlaying: false,
        playbackState: 0,
        currentPlaybackTime: 0,
        nowPlayingItem: undefined,
        setQueue: vi.fn(async () => { mk.playbackState = 1; mk.nowPlayingItem = { id: '123', attributes: { durationInMillis: 320400, playParams: { catalogId: '123' } } }; }),
        play: vi.fn(async () => {}),
        pause: vi.fn(async () => {}),
        addEventListener: vi.fn((name: string, listener: Listener) => { listeners.set(name, [...(listeners.get(name) ?? []), listener]); }),
    };
    const context = { Date: { now: () => now }, window: { MusicKit: { getInstance: () => mk, Events: { mediaPlaybackError: 'mediaPlaybackError' } } } };
    const run = (operation: string, params: Record<string, unknown> = {}) => (
        runInNewContext(requestExpression(validateRequest({ id: 'r', operation, params })), context)
    );
    const emit = (name: string, event?: unknown) => { for (const listener of listeners.get(name) ?? []) listener(event); };
    const settle = () => new Promise(resolve => setImmediate(resolve));
    // The player sounding: playing, with the position moving between two answers.
    const sound = async (from = 0) => {
        mk.isPlaying = true;
        mk.playbackState = 2;
        mk.currentPlaybackTime = from;
        await run('playbackStatus');
        mk.currentPlaybackTime = from + 0.5;
        return run('playbackStatus');
    };
    return { mk, run, emit, settle, sound, listeners, advance: (ms: number) => { now += ms; } };
};

// A failure the page only guesses at is held as a start this long before it is said.
const HOLD_MS = 3000;

describe('Apple Music companion: a start the player gives up', () => {
    it('fails a start the player stopped and dropped, with no error event', async () => {
        const { mk, run, settle, advance } = setUp();
        expect(await run('playSong', { catalogId: '123' })).toMatchObject({ ok: true });
        await settle();
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        // A moment after the start, a stopped player may still be between the old track and the new one.
        advance(500);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { state: 4 } });
        advance(2000);
        // Guessed, so held as loading for a moment: the player may yet recover.
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { starting: true } });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toEqual({ ok: false, error: 'playback-failed', playbackStage: 'play', playerError: 'stopped' });
    });

    it('fails a start whose play() settled with nothing loaded', async () => {
        const { mk, run, settle, advance } = setUp();
        mk.setQueue = vi.fn(async () => {});
        await run('playSong', { catalogId: '123' });
        await settle();
        advance(2500);
        await run('playbackStatus');
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false, error: 'playback-failed', playerError: 'nothing-loaded' });
    });

    it('keeps waiting on a start whose play() is still loading', async () => {
        const { mk, run, settle, advance } = setUp();
        mk.setQueue = vi.fn(async () => {});
        mk.play = vi.fn(() => new Promise(() => {}));
        await run('playSong', { catalogId: '123' });
        await settle();
        advance(2500);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { starting: true } });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { starting: true } });
    });

    // A switch on a slow network: the last song stopped, this one not loaded yet, play() still going.
    it('keeps waiting on a stopped player that has not loaded the track while play() is pending', async () => {
        const { mk, run, settle, advance } = setUp();
        mk.setQueue = vi.fn(async () => { mk.playbackState = 4; });
        mk.play = vi.fn(() => new Promise(() => {}));
        await run('playSong', { catalogId: '123' });
        await settle();
        advance(2500);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { state: 4, starting: true } });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { state: 4, starting: true } });
    });

    // The #1336 sequence with play() never settling: loaded (state 1, length known), then stopped and cleared.
    it('fails a pending start once the player dropped the track it had loaded', async () => {
        const { mk, run, settle, advance } = setUp();
        mk.play = vi.fn(() => new Promise(() => {}));
        await run('playSong', { catalogId: '123' });
        await settle();
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { state: 1, durationMs: 320400 } });
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        advance(2500);
        await run('playbackStatus');
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false, error: 'playback-failed', playerError: 'stopped' });
    });

    // MusicKit says "playing" for a moment before it loads (nativeSpawn.cjs): that is not the song sounding.
    it('still fails a start after the brief "playing" MusicKit says before it loads', async () => {
        const { mk, run, settle, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        mk.isPlaying = true;
        mk.playbackState = 2;
        await run('playbackStatus');
        mk.isPlaying = false;
        mk.playbackState = 1;
        await run('playbackStatus');
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        advance(2500);
        await run('playbackStatus');
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false, playerError: 'stopped' });
    });

    it('does not count a track left from the song before as loaded', async () => {
        const { mk, run, settle, advance } = setUp();
        mk.nowPlayingItem = { id: '999', attributes: { playParams: { catalogId: '999' } } };
        mk.setQueue = vi.fn(async () => {});
        mk.play = vi.fn(() => new Promise(() => {}));
        await run('playSong', { catalogId: '123' });
        await settle();
        await run('playbackStatus');
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        advance(2500 + HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { starting: true } });
    });

    it('fails a start with the code MusicKit reported for it, after holding it a moment', async () => {
        const { run, emit, settle, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        emit('mediaPlaybackError', { errorCode: 'MEDIA_LICENSE', description: 'Apple words that stay in the page' });
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { starting: true, playerError: 'MEDIA_LICENSE' } });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toEqual({ ok: false, error: 'playback-failed', playbackStage: 'play', playerError: 'MEDIA_LICENSE' });
    });

    it('takes back a failure guessed from an event once the player sounds after all', async () => {
        const { run, emit, settle, sound, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        emit('mediaPlaybackError', { errorCode: 'MEDIA_KEY' });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false, playerError: 'MEDIA_KEY' });
        expect(await sound()).toMatchObject({ ok: true, data: { isPlaying: true, playerError: 'MEDIA_KEY' } });
        expect((await run('playbackStatus')).data.starting).toBeUndefined();
    });

    it('fails a rejected play() at once, and keeps it failed even if the player sounds later', async () => {
        const { mk, run, emit, settle, sound } = setUp();
        mk.play = vi.fn(async () => { throw new Error('refused'); });
        await run('playSong', { catalogId: '123' });
        await settle();
        emit('mediaPlaybackError', { error: { errorCode: 'CONTENT_RESTRICTED' } });
        expect(await run('playbackStatus')).toMatchObject({ ok: false, playerError: 'CONTENT_RESTRICTED' });
        expect(await sound()).toMatchObject({ ok: false, playerError: 'CONTENT_RESTRICTED' });
    });

    it('names an error without a usable code unknown, never by its text', async () => {
        const { run, emit, settle, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        emit('mediaPlaybackError', { errorCode: 'has spaces and https://example.invalid' });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false, playerError: 'unknown' });
    });

    it('does not fail a song that has sounded, and reports the error for the log', async () => {
        const { mk, run, emit, settle, sound, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        await sound();
        advance(10000);
        emit('mediaPlaybackError', { errorCode: 'MEDIA_KEY' });
        expect(await run('playbackStatus')).toMatchObject({ ok: true, data: { isPlaying: true, playerError: 'MEDIA_KEY', playerErrorAt: 10000 } });
        // Ended and cleared later: a song that sounded is not a failed start.
        mk.isPlaying = false;
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        advance(5000);
        expect(await run('playbackStatus')).toMatchObject({ ok: true });
    });

    it('does not fail a start the listener paused', async () => {
        const { mk, run, settle, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        await run('pause');
        mk.playbackState = 4;
        mk.nowPlayingItem = undefined;
        advance(5000 + HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: true });
    });

    it('lets the next start replace a failed one, listening to the player once', async () => {
        const { mk, run, emit, settle, listeners, advance } = setUp();
        await run('playSong', { catalogId: '123' });
        await settle();
        emit('mediaPlaybackError', { errorCode: 'MEDIA_LICENSE' });
        advance(HOLD_MS);
        expect(await run('playbackStatus')).toMatchObject({ ok: false });
        await run('playSong', { catalogId: '456' });
        await settle();
        const status = await run('playbackStatus');
        expect(status).toMatchObject({ ok: true });
        // The song before's error is not this one's.
        expect(status.data.playerError).toBeUndefined();
        expect(listeners.get('mediaPlaybackError')).toHaveLength(1);
        expect(mk.addEventListener).toHaveBeenCalledTimes(1);
    });
});
