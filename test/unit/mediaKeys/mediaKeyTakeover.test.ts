// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/mediaKeys/mediaKeyTakeover.test.ts
// The system media keys Folia holds, and what one press of them runs. The module that holds them is
// generic (electron/mediaKeys.cjs): three keys, each reported as a transport action, given back on
// request, and a key the system refused tried again next time. The decisions are the renderer's
// (useMediaKeyTakeoverBridge.ts): whether to hold at all - the setting, and whether a player's own
// program asks for the keys for as long as Folia runs - and what a press does at the end of a
// played-out queue, which is where the transport has nothing left to step to.

// The way Spotify plays is read from the desktop side, which only the "does its app ask" case needs.
const request = vi.hoisted(() => vi.fn(async (_operation: string, _params?: unknown): Promise<unknown> => ({ available: true })));
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));

import { PlayerState } from '@/types';
import type { SongResult } from '@/types';
import {
    createMediaKeyHoldSender, isQueuePlayedOut, planMediaKeyAction, shouldHoldMediaKeys,
    type MediaKeyHoldFacts,
} from '@/components/app/playback/bridges/useMediaKeyTakeoverBridge';
import {
    SAME_PRESS_MS, createMediaKeyPressGate, isRepeatedMediaKeyPress,
} from '@/utils/mediaKeyPressGate';
import { spotifyExternalPlayback } from '@/services/onlineMusic/spotify/spotifyExternalPlayback';
import { readSpotifyPlaybackMode } from '@/services/onlineMusic/spotify/spotifySoloistPlayback';

const require = createRequire(import.meta.url);
const { MEDIA_KEYS, createMediaKeyTakeover } = require('../../../electron/mediaKeys.cjs');

const song = { id: 'a', name: 'Song a' } as unknown as SongResult;

const makeShortcut = (refused: string[] = []) => {
    const handlers = new Map<string, () => void>();
    return {
        handlers,
        register: vi.fn((accelerator: string, handler: () => void) => {
            if (refused.includes(accelerator)) return false;
            handlers.set(accelerator, handler);
            return true;
        }),
        unregister: vi.fn((accelerator: string) => { handlers.delete(accelerator); }),
    };
};

describe('the module that holds the keys', () => {
    it('holds the three keys and tells which transport action each one is', () => {
        const globalShortcut = makeShortcut();
        const onKey = vi.fn();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey, log: () => {}, warn: () => {} });

        expect(takeover.set(true).held.sort()).toEqual(Object.keys(MEDIA_KEYS).sort());
        globalShortcut.handlers.get('MediaNextTrack')!();
        globalShortcut.handlers.get('MediaPreviousTrack')!();
        globalShortcut.handlers.get('MediaPlayPause')!();
        expect(onKey.mock.calls.map(call => call[0])).toEqual(['next', 'previous', 'play-pause']);
    });

    it('registers nothing twice and gives every key back when asked', () => {
        const globalShortcut = makeShortcut();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn: () => {} });
        takeover.set(true);
        takeover.set(true);
        expect(globalShortcut.register).toHaveBeenCalledTimes(3);

        expect(takeover.set(false)).toEqual({ enabled: false, held: [] });
        expect(globalShortcut.unregister).toHaveBeenCalledTimes(3);
        expect(globalShortcut.handlers.size).toBe(0);
    });

    it('reports a key the system refused and tries it again on the next call', () => {
        const refused = ['MediaNextTrack'];
        const globalShortcut = makeShortcut(refused);
        const warn = vi.fn();
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn });

        expect(takeover.set(true).held).not.toContain('MediaNextTrack');
        expect(warn).toHaveBeenCalled();
        refused.length = 0;
        expect(takeover.set(true).held).toContain('MediaNextTrack');
    });

    it('does not throw when the system throws on register', () => {
        const globalShortcut = makeShortcut();
        globalShortcut.register.mockImplementation(() => { throw new Error('no'); });
        const takeover = createMediaKeyTakeover({ globalShortcut, onKey: () => {}, log: () => {}, warn: () => {} });
        expect(takeover.set(true)).toEqual({ enabled: false, held: [] });
    });
});

const factsOf = (over: Partial<MediaKeyHoldFacts> = {}): MediaKeyHoldFacts => ({
    holdWhileRunning: true,
    playerAsksForAsLongAsFoliaRuns: true,
    route: 'web',
    externalSong: null,
    sessionDeclares: false,
    ...over,
});

describe('whether Folia holds the media keys', () => {
    it('holds them for the whole run while the setting is on and a player asks for them', () => {
        // The three states that let go when only a sounding song counts: the queue played out (Folia
        // idle), a song of Folia's own sounding, and the player's own session gone after it stopped.
        expect(shouldHoldMediaKeys(factsOf({ route: 'web' }))).toBe(true);
        expect(shouldHoldMediaKeys(factsOf({ route: 'hifi' }))).toBe(true);
        expect(shouldHoldMediaKeys(factsOf({ route: 'external', externalSong: null }))).toBe(true);
        expect(shouldHoldMediaKeys(factsOf({ route: 'external', externalSong: song, sessionDeclares: true }))).toBe(true);
    });

    it('lets them go the moment that player stops asking, which is a change of the way it plays', () => {
        // Back to the standard way, or to the player that registers no media session of its own: no
        // player asks any more and nothing is held - the release the listener asked for.
        expect(shouldHoldMediaKeys(factsOf({ playerAsksForAsLongAsFoliaRuns: false }))).toBe(false);
        // Unless a session of its own is still there and the player declares it: that one holds while
        // it sounds.
        expect(shouldHoldMediaKeys(factsOf({ playerAsksForAsLongAsFoliaRuns: false, route: 'external', externalSong: song, sessionDeclares: true }))).toBe(true);
    });

    it('with the setting off, holds only while that player sounds a song of Folia\'s', () => {
        const off = { holdWhileRunning: false, route: 'external', sessionDeclares: true } as const;
        expect(shouldHoldMediaKeys(factsOf({ ...off, externalSong: song }))).toBe(true);
        // Its session is gone (it stopped, or its song ended), the queue is over, or Folia is the one
        // sounding: nothing is held.
        expect(shouldHoldMediaKeys(factsOf({ ...off, externalSong: null }))).toBe(false);
        expect(shouldHoldMediaKeys(factsOf({ ...off, externalSong: song, route: 'web' }))).toBe(false);
        // A player that declares no session of its own keeps the app's own media session either way.
        expect(shouldHoldMediaKeys(factsOf({ ...off, sessionDeclares: false, externalSong: song }))).toBe(false);
    });
});

describe('what one press runs', () => {
    it('runs the ordinary transport while the queue has somewhere to go', () => {
        for (const action of ['previous', 'play-pause', 'next'] as const) {
            expect(planMediaKeyAction(action, false)).toBe('transport');
        }
    });

    it('starts the list over from its first song when the queue played out: play, and next', () => {
        expect(planMediaKeyAction('play-pause', true)).toBe('restart-list');
        expect(planMediaKeyAction('next', true)).toBe('restart-list');
    });

    it('replays the song that just ended on previous, rather than doing nothing', () => {
        expect(planMediaKeyAction('previous', true)).toBe('replay-last');
    });

    it('calls a queue played out only where it ended, not a pause or an empty queue', () => {
        expect(isQueuePlayedOut({ playerState: PlayerState.IDLE, currentSong: song, playQueue: [song] })).toBe(true);
        expect(isQueuePlayedOut({ playerState: PlayerState.PLAYING, currentSong: song, playQueue: [song] })).toBe(false);
        // Paused is the listener's, not the end: play resumes where it is.
        expect(isQueuePlayedOut({ playerState: PlayerState.PAUSED, currentSong: song, playQueue: [song] })).toBe(false);
        expect(isQueuePlayedOut({ playerState: PlayerState.IDLE, currentSong: null, playQueue: [] })).toBe(false);
    });
});

describe('one press arriving twice', () => {
    it('drops the second of the two, and only the same key', () => {
        expect(isRepeatedMediaKeyPress({ action: 'play-pause', atMs: 1000 }, 'play-pause', 1060)).toBe(true);
        // Far enough apart to be two presses of the listener's.
        expect(isRepeatedMediaKeyPress({ action: 'play-pause', atMs: 1000 }, 'play-pause', 1200)).toBe(false);
        // next straight after play is two different presses.
        expect(isRepeatedMediaKeyPress({ action: 'play-pause', atMs: 1000 }, 'next', 1005)).toBe(false);
        expect(isRepeatedMediaKeyPress(null, 'next', 1005)).toBe(false);
    });

    it('lets one press run once across both paths that can receive it', () => {
        let nowMs = 1000;
        const gate = createMediaKeyPressGate(() => nowMs);
        // One press: the global shortcut the main process holds comes first, and the app's own media
        // session receives it in the same instant.
        expect(gate.claim('play-pause')).toBe(true);
        expect(gate.claim('play-pause')).toBe(false);
        // Another action, or the same one long enough after, is another press.
        expect(gate.claim('next')).toBe(true);
        nowMs += SAME_PRESS_MS;
        expect(gate.claim('next')).toBe(true);
    });
});

describe('the wish sent to the main process', () => {
    // What the main process answers: by default it carries the wish out (that is the whole set of
    // keys the system let Folia have).
    const makeSender = (
        answer: (wanted: boolean) => { enabled: boolean; held: string[] } = wanted => ({
            enabled: wanted,
            held: wanted ? ['MediaPlayPause'] : [],
        }),
    ) => {
        const send = vi.fn(async (wanted: boolean) => answer(wanted));
        const onError = vi.fn();
        return { send, onError, sender: createMediaKeyHoldSender(send, onError) };
    };

    it('sends the wish the window mounts with, even when it looks like nothing changed', async () => {
        const { send, sender } = makeSender();
        // The main process may still hold keys a window before this one took: mounting says "not now"
        // unconditionally.
        sender.apply(false, true);
        expect(send).toHaveBeenCalledWith(false);
        await Promise.resolve();
        // The same wish is not sent twice.
        sender.apply(false);
        sender.apply(false);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('sends it again after a send that did not land', async () => {
        const { send, onError, sender } = makeSender();
        send.mockRejectedValueOnce(new Error('ipc failed'));
        sender.apply(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toBe(true);
        // The last one did not land: the next change of state sends again rather than reading it as held.
        sender.apply(true);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not read a refusal as holding the keys', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The system gave all three keys to another program: the main process answers enabled: false.
        const { send, sender } = makeSender(() => ({ enabled: false, held: [] }));
        sender.apply(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/^\[MediaKeys\]/);
        // Not recorded as held: a subscription event sends the wish again rather than reading it as in force.
        sender.apply(true);
        expect(send.mock.calls.map(call => call[0])).toEqual([true, true]);
        warn.mockRestore();
    });

    it('keeps what the main process says it now holds', async () => {
        const { send, sender } = makeSender();
        sender.apply(true);
        await Promise.resolve();
        await Promise.resolve();
        // The main process says it holds them: the same wish is not sent again.
        sender.apply(true);
        expect(send.mock.calls.map(call => call[0])).toEqual([true]);
    });

    it('sends the wish that arrived over the opposite one on its way', async () => {
        const { send, sender } = makeSender();
        sender.apply(true);
        await Promise.resolve();
        await Promise.resolve();
        // The last one that landed was "held"; "give back" is still on its way, and "held" arrives over
        // it: it must not be dropped as already there, or the main process stays on "give back".
        sender.apply(false);
        sender.apply(true);
        expect(send.mock.calls.map(call => call[0])).toEqual([true, false, true]);
    });

    it('gives the keys back when the bridge leaves, whatever the session did', async () => {
        const { send, sender } = makeSender();
        sender.apply(true);
        await Promise.resolve();
        sender.release();
        expect(send.mock.calls.map(call => call[0])).toEqual([true, false]);
    });
});

describe('a player asking for the keys for the whole run', () => {
    it('asks while its app is the way it plays, and tells the app the moment that changes', async () => {
        const heard = vi.fn();
        const stop = spotifyExternalPlayback.subscribeMediaKeysWanted?.(heard);
        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(spotifyExternalPlayback.holdsMediaKeysWhileRunning?.()).toBe(true);

        // Back to the standard way: the keys are let go, and the app is told at once (the listener's
        // second press must not keep waiting for a store change that never comes).
        request.mockResolvedValueOnce({ mode: 'standard', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(spotifyExternalPlayback.holdsMediaKeysWhileRunning?.()).toBe(false);
        expect(heard).toHaveBeenCalledTimes(2);
        stop?.();
        // A listener let go hears nothing more.
        request.mockResolvedValueOnce({ mode: 'client', soloist: true, client: true });
        await readSpotifyPlaybackMode();
        expect(heard).toHaveBeenCalledTimes(2);
    });
});
