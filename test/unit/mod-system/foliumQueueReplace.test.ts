// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
        },
    });
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@/i18n/config';
import { PlayerState, type SongResult, type StatusMessage } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { isSongUnavailable } from '@/services/onlineMusic/songAvailability';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { FOLIUM_SONG_REF_POOL_SIZE, toFoliumSong } from '@/mods/folium/dto';
import type { FoliumQueueReplaceResult, FoliumSong } from '@/mods/folium/contract';
import { useFoliumHostActions, type FoliumAppActions } from '@/mods/runtime/hostActions';
import { createFoliumPlaybackService } from '@/mods/folium/services';
import { installFoliumHostEvents } from '@/mods/runtime/hostEvents';
import { resetFoliumQueueVersionForTest } from '@/mods/runtime/queue/queueVersion';
import { resetFoliumQueueReplaceForTest } from '@/mods/runtime/queue/hostQueueReplace';
import { useFoliumQueueUndoStore } from '@/mods/runtime/queue/queueReplaceUndo';
import { reportYieldedQueue } from '@/services/wholeQueueWrites';
// Through the registry, as the palette loads its commands (the command modules import one another).
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import type { ModRuntimeInfo } from '@/mods/types';

// test/unit/mod-system/foliumQueueReplace.test.ts
// Folium 1.7 folium.playback.replaceQueue, end to end: the service's checks (permission, window,
// arguments), the host's one synchronous write (the very songs behind the refs, in order, Personal FM
// ended, nothing about what plays changed), its refusals and their order, the event it leaves (byThisMod
// for the replacing mod only), the coalesced saves and prefetch refreshes, and the notice and undo.
// The real stores, the real ref pool and the real host actions (mounted in a harness, as App mounts
// them); only the App's save and prefetch are stand-ins.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installFoliumHostEvents();

const modOf = (id: string, permissions: string[]): ModRuntimeInfo => ({
    id, name: id, version: '1.0.0', author: null, description: null, permissions,
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
});
const modA = modOf('mod-a', ['playback.queue']);
const modB = modOf('mod-b', ['playback.queue']);

const song = (id: string): SongResult => ({
    id, name: `song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const stageSong = (id: string): SongResult => ({ ...song(id), sourceRef: { kind: 'stage', mediaId: id } });
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(song);
const dto = (entry: SongResult) => toFoliumSong(entry)!;
/** A song DTO whose ref the host never handed out: it resolves to nothing, like one pushed out of the pool. */
const goneDto = (): FoliumSong => ({ id: 'gone', title: 'gone', artist: '', album: null, source: 'bodian', ref: 'song-never-minted' });

const appActions = (): FoliumAppActions => ({
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(), seekToLyricTime: vi.fn(),
    next: vi.fn(), previous: vi.fn(), playSong: vi.fn(), playQueueSong: vi.fn(), enqueue: vi.fn(),
    navigateToPlayer: vi.fn(), navigateToHome: vi.fn(),
    shuffleQueue: vi.fn(), toggleLike: vi.fn(), openVolume: vi.fn(),
    isLiked: false, controlsDisabled: false, isLyricsLoading: false,
    persistQueue: vi.fn(async () => undefined), refreshQueuePrefetch: vi.fn(),
});

const Harness: React.FC<{ actions: FoliumAppActions }> = ({ actions }) => {
    useFoliumHostActions(actions);
    return null;
};

let root: Root | null = null;
const render = (actions: FoliumAppActions = appActions()) => {
    if (!root) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    act(() => root!.render(React.createElement(Harness, { actions })));
    return actions;
};

const store = () => usePlaybackStore.getState();
const playbackA = () => createFoliumPlaybackService(modA, 'main');
const playbackB = () => createFoliumPlaybackService(modB, 'main');
const versionNow = () => playbackA().getQueue().version;
const flushMicrotasks = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};
const undoCommand = COMMAND_PALETTE_COMMANDS.find(command => command.id === 'playback-undo-queue-replace')!;
/** The notices of a replacement shown so far (the toast takes one message at a time). */
const watchNotices = () => {
    const notices: StatusMessage[] = [];
    const stop = useStatusMessageStore.subscribe(state => {
        if (state.message?.actionLabel === i18n.t('mods.queueReplaceUndo')) notices.push(state.message);
    });
    return { notices, stop };
};

const initialPlayback = usePlaybackStore.getState();
const initialAudio = useAudioSettingsStore.getState();
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: 1_000_000 });
    usePlaybackStore.setState(initialPlayback, true);
    useAudioSettingsStore.setState(initialAudio, true);
    useStatusMessageStore.setState({ message: null });
    vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    removeFoliumEventHandlers('mod-a');
    removeFoliumEventHandlers('mod-b');
    document.body.replaceChildren();
    resetFoliumQueueVersionForTest();
    resetFoliumQueueReplaceForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** What a rejection was, for the arguments the service refuses. */
const rejectionOf = async (call: Promise<unknown>) => {
    try {
        await call;
    } catch (error) {
        return error as Error & { code?: unknown };
    }
    throw new Error('the call did not reject');
};

describe('replaceQueue: the calls the service refuses', () => {
    it('needs playback.queue, also from a mod that may control playback', async () => {
        render();
        const controlOnly = createFoliumPlaybackService(modOf('mod-c', ['playback.control']), 'main');
        await expect(controlOnly.replaceQueue([], { expectedVersion: versionNow() })).rejects.toThrow('permission-denied:playback.queue');
    });

    it('is unavailable in the export window', async () => {
        await expect(createFoliumPlaybackService(modA, 'export').replaceQueue([], { expectedVersion: 'v' }))
            .rejects.toThrow('playback-unavailable-in-export-context');
    });

    it.each([
        ['songs that are not an array', () => ['x', { expectedVersion: 'v' }]],
        ['a hole in songs', () => [[undefined], { expectedVersion: 'v' }]],
        ['an entry without a ref', () => [[{ title: 'x' }], { expectedVersion: 'v' }]],
        ['a folium.omni collection DTO', () => [[{ kind: 'album', ref: 'collection-1' }], { expectedVersion: 'v' }]],
        ['an object made up by the mod', () => [[{ ref: 'x' }], { expectedVersion: 'v' }]],
        ['no options', () => [[dto(a)], undefined]],
        ['an empty version', () => [[dto(a)], { expectedVersion: '' }]],
        ['a version that is not a string', () => [[dto(a)], { expectedVersion: 7 }]],
    ])('rejects %s with a TypeError, not a refusal', async (_case, argumentsOf) => {
        render();
        const [songs, options] = argumentsOf();
        const error = await rejectionOf(playbackA().replaceQueue(songs as never, options as never));
        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/^invalid-arguments: /);
        expect('code' in error).toBe(false);
    });

    it('takes 5,000 songs and not one more', async () => {
        render();
        const many = Array.from({ length: FOLIUM_SONG_REF_POOL_SIZE + 1 }, (_, index) => song(`m${index}`));
        const expectedVersion = versionNow();
        const tooMany = await rejectionOf(playbackA().replaceQueue(many.map(dto), { expectedVersion }));
        expect(tooMany).toBeInstanceOf(TypeError);
        expect(tooMany.message).toBe(`invalid-arguments: songs holds more than ${FOLIUM_SONG_REF_POOL_SIZE} songs`);

        // Minted last, so all 5,000 refs are still in the pool.
        const result = await playbackA().replaceQueue(many.slice(1).map(dto), { expectedVersion });
        expect(result).toMatchObject({ status: 'replaced', length: FOLIUM_SONG_REF_POOL_SIZE });
        expect(store().playQueue).toHaveLength(FOLIUM_SONG_REF_POOL_SIZE);
    });
});

describe('replaceQueue: a replacement', () => {
    it('puts the very songs behind the refs in, in order, duplicates and songs marked unavailable included, and plays nothing', async () => {
        render();
        const takenDown = {
            ...song('t'), sourceRef: { kind: 'online', providerId: 'netease', mediaId: 't' }, privilege: { st: -200, pl: 0 },
        } as SongResult;
        expect(isSongUnavailable(takenDown)).toBe(true);
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a, playerState: PlayerState.PLAYING, audioSrc: 'https://audio.test/a' });

        const result = await playbackA().replaceQueue([dto(c), dto(takenDown), dto(c), dto(a)], { expectedVersion: versionNow() });

        const queue = store().playQueue;
        expect(queue).toHaveLength(4);
        [c, takenDown, c, a].forEach((entry, index) => expect(queue[index]).toBe(entry));
        expect(store().currentSong).toBe(a);
        expect(store().playerState).toBe(PlayerState.PLAYING);
        expect(store().audioSrc).toBe('https://audio.test/a');
        const page = playbackA().getQueue();
        expect(result).toEqual({ status: 'replaced', version: page.version, length: 4, currentIndex: 3 });
        expect(page.currentIndex).toBe(3);
        expect(Object.isFrozen(result)).toBe(true);
    });

    it.each([
        ['first', [a, c, d], 0],
        ['in the middle', [c, a, d], 1],
        ['not in it', [c, d], -1],
    ])('finds the song playing %s of the new queue', async (_where, next, index) => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        const result = await playbackA().replaceQueue(next.map(dto), { expectedVersion: versionNow() });
        expect(result).toMatchObject({ status: 'replaced', currentIndex: index });
        expect(playbackA().getQueue().currentIndex).toBe(index);
    });

    it.each(['append', 'next'] as const)('takes no part of the queue-add setting (%s)', async (behavior) => {
        render();
        useAudioSettingsStore.setState({ queueAddBehavior: behavior });
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await playbackA().replaceQueue([dto(c), dto(a), dto(d)], { expectedVersion: versionNow() });
        expect(store().playQueue).toEqual([c, a, d]);
    });

    it('empties the queue for an empty list', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await expect(playbackA().replaceQueue([], { expectedVersion: versionNow() })).resolves.toMatchObject({ status: 'replaced', length: 0, currentIndex: -1 });
        expect(store().playQueue).toEqual([]);
    });

    it('ends Personal FM in the same write: one store update and one event', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a, isFmMode: true });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        const updates = vi.fn();
        const stop = usePlaybackStore.subscribe(updates);

        await playbackA().replaceQueue([dto(c), dto(d)], { expectedVersion: versionNow() });
        stop();
        await flushMicrotasks();

        expect(store().isFmMode).toBe(false);
        expect(playbackA().getQueue().kind).toBe('queue');
        expect(updates).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('in Personal FM writes a list with the same songs in the same order too, to end FM', async () => {
        render();
        const queue = [a, b];
        usePlaybackStore.setState({ playQueue: queue, currentSong: a, isFmMode: true });
        const before = versionNow();
        const result = await playbackA().replaceQueue([dto(a), dto(b)], { expectedVersion: before });
        expect(store().isFmMode).toBe(false);
        expect(store().playQueue).not.toBe(queue);
        expect(result.version).not.toBe(before);
    });

    it('changes nothing for the same songs in the same order outside FM: no write, no event, no notice, no rate limit', async () => {
        const actions = render();
        const queue = [a, b];
        usePlaybackStore.setState({ playQueue: queue, currentSong: a });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        const version = versionNow();

        // An equal copy of the second song: the same song by its key.
        const result = await playbackA().replaceQueue([dto(a), dto({ ...b })], { expectedVersion: version });
        await flushMicrotasks();

        expect(result).toEqual({ status: 'replaced', version, length: 2, currentIndex: 0 });
        expect(store().playQueue).toBe(queue);
        expect(handler).not.toHaveBeenCalled();
        expect(useStatusMessageStore.getState().message).toBeNull();
        expect(actions.persistQueue).not.toHaveBeenCalled();
        await expect(playbackA().replaceQueue([dto(b), dto(a)], { expectedVersion: version })).resolves.toMatchObject({ status: 'replaced' });
    });
});

describe('replaceQueue: what it refuses, leaving the queue as it was', () => {
    /** Asks for a replacement that the state set up refuses, and checks that nothing moved. */
    const refusedWith = async (songs: FoliumSong[], expectedVersion: string) => {
        const queue = store().playQueue;
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        const result = await playbackA().replaceQueue(songs, { expectedVersion });
        await flushMicrotasks();
        expect(store().playQueue).toBe(queue);
        expect(handler).not.toHaveBeenCalled();
        expect(Object.isFrozen(result)).toBe(true);
        removeFoliumEventHandlers('mod-a');
        return result;
    };

    it.each([
        ['Stage playback', { activePlaybackContext: 'stage' as const }],
        ['a Stage song on display', { currentSong: stageSong('s') }],
    ])('stage, during %s', async (_case, state) => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a, ...state });
        const version = versionNow();
        expect(await refusedWith([dto(c)], version)).toEqual({ status: 'refused', reason: 'stage', version, index: null, retryAfterMs: null });
    });

    it('transition, while a blend holds the picture', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: b, transitionDisplay: { song: a, lyrics: null, coverUrl: null, duration: 1 } });
        const version = versionNow();
        expect(await refusedWith([dto(c)], version)).toMatchObject({ status: 'refused', reason: 'transition', version });
    });

    it('stale-version, after another change of the queue', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        const read = versionNow();
        usePlaybackStore.getState().setPlayQueue([b, a]);
        const now = versionNow();
        expect(now).not.toBe(read);
        expect(await refusedWith([dto(c)], read)).toMatchObject({ status: 'refused', reason: 'stale-version', version: now, index: null });
    });

    it('stale-ref, with the index of a song pushed out of the ref pool', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a], currentSong: a });
        const version = versionNow();
        const songs = ['r0', 'r1', 'r2', 'r3', 'r4'].map(song);
        // The third song's ref is minted first, so it is the oldest of the five...
        const third = dto(songs[2]);
        const dtos = [dto(songs[0]), dto(songs[1]), third, dto(songs[3]), dto(songs[4])];
        // ...and the pool, filled up after them, pushes out exactly that one.
        for (let index = 0; index < FOLIUM_SONG_REF_POOL_SIZE - 4; index += 1) dto(song(`filler-${index}`));
        expect(await refusedWith(dtos, version)).toEqual({ status: 'refused', reason: 'stale-ref', version, index: 2, retryAfterMs: null });
    });

    it('not-queueable, with the index of a Stage song', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a], currentSong: a });
        const version = versionNow();
        expect(await refusedWith([dto(b), dto(stageSong('s'))], version)).toMatchObject({ status: 'refused', reason: 'not-queueable', index: 1 });
    });

    it('rate-limited, a moment after this mod\'s last replacement, with the time left; other mods are not held up', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a], currentSong: a });
        const first = await playbackA().replaceQueue([dto(b)], { expectedVersion: versionNow() });

        vi.advanceTimersByTime(300);
        expect(await refusedWith([dto(c)], first.version)).toMatchObject({ status: 'refused', reason: 'rate-limited', retryAfterMs: 700, index: null });
        vi.advanceTimersByTime(300);
        expect(await refusedWith([dto(c)], first.version)).toMatchObject({ reason: 'rate-limited', retryAfterMs: 400 });
        vi.advanceTimersByTime(400);
        await expect(playbackA().replaceQueue([dto(c)], { expectedVersion: first.version })).resolves.toMatchObject({ status: 'replaced' });
        await expect(playbackB().replaceQueue([dto(d)], { expectedVersion: versionNow() })).resolves.toMatchObject({ status: 'replaced' });
    });

    it('checks in the contract\'s order: stage, transition, stale-version, the songs, rate-limited', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a], currentSong: a });
        await playbackA().replaceQueue([dto(b)], { expectedVersion: versionNow() });
        const stale = 'not-the-version';
        const reasonOf = async (songs: FoliumSong[], expectedVersion: string) => (await refusedWith(songs, expectedVersion) as Extract<FoliumQueueReplaceResult, { status: 'refused' }>).reason;

        // Rate-limited throughout (no time passes), with a stale song and a stale version too.
        usePlaybackStore.setState({ transitionDisplay: { song: b, lyrics: null, coverUrl: null, duration: 1 }, activePlaybackContext: 'stage' });
        expect(await reasonOf([goneDto()], stale)).toBe('stage');
        usePlaybackStore.setState({ activePlaybackContext: 'main' });
        expect(await reasonOf([goneDto()], stale)).toBe('transition');
        usePlaybackStore.setState({ transitionDisplay: null });
        expect(await reasonOf([goneDto()], stale)).toBe('stale-version');
        // Back from the Stage the queue has a version of its own again: that is the one to pass.
        const current = versionNow();
        expect(await reasonOf([goneDto()], current)).toBe('stale-ref');
        expect(await reasonOf([dto(c)], current)).toBe('rate-limited');
    });

    it('answers for the first song that fails, whatever the reason: a Stage song first, a stale ref later', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a], currentSong: a });
        const version = versionNow();
        expect(await refusedWith([dto(stageSong('s')), dto(b), dto(c), goneDto()], version))
            .toMatchObject({ reason: 'not-queueable', index: 0 });
    });
});

describe('replaceQueue: the event it leaves', () => {
    it('is the replacing mod\'s own only, with the version the call answered', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await flushMicrotasks();
        const fromA = vi.fn();
        const fromB = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', fromA);
        addFoliumEventHandler('mod-b', 'playback.queueChanged', fromB);

        const result = await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        await flushMicrotasks();

        expect(fromA.mock.calls).toEqual([[{ length: 2, currentIndex: 1, version: result.version, byThisMod: true }]]);
        expect(fromB.mock.calls).toEqual([[{ length: 2, currentIndex: 1, version: result.version, byThisMod: false }]]);
    });

    it('comes once more when a blend ends, also with the displayed song\'s key unchanged', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a, transitionDisplay: { song: { ...a }, lyrics: null, coverUrl: null, duration: 1 } });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);

        usePlaybackStore.getState().releaseTransitionDisplay('cancelled');
        await flushMicrotasks();

        expect(handler.mock.calls).toEqual([[expect.objectContaining({ currentIndex: 0, byThisMod: false })]]);
    });
});

describe('replaceQueue: saving and fetching ahead', () => {
    it('saves at once, then once more two seconds after, with the queue of that moment; the prefetch\'s before is the queue of the save before', async () => {
        const actions = render();
        const original = [a, b];
        usePlaybackStore.setState({ playQueue: original, currentSong: a });

        const first = await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        const afterFirst = store().playQueue;
        expect(actions.persistQueue).toHaveBeenCalledTimes(1);
        expect(vi.mocked(actions.persistQueue).mock.calls[0]).toEqual([a, afterFirst]);
        expect(vi.mocked(actions.refreshQueuePrefetch).mock.calls[0][1]).toBe(original);
        expect(vi.mocked(actions.refreshQueuePrefetch).mock.calls[0][2]).toBe(afterFirst);

        vi.advanceTimersByTime(500);
        await playbackB().replaceQueue([dto(d), dto(a)], { expectedVersion: first.version });
        expect(actions.persistQueue).toHaveBeenCalledTimes(1);
        // An edit after the second replacement: the save reads the queue when it is made.
        usePlaybackStore.getState().setPlayQueue([d, a, b]);
        const atTheSave = store().playQueue;

        vi.advanceTimersByTime(1499);
        expect(actions.persistQueue).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(actions.persistQueue).toHaveBeenCalledTimes(2);
        expect(vi.mocked(actions.persistQueue).mock.calls[1]).toEqual([a, atTheSave]);
        expect(vi.mocked(actions.refreshQueuePrefetch).mock.calls[1][1]).toBe(afterFirst);
        expect(vi.mocked(actions.refreshQueuePrefetch).mock.calls[1][2]).toBe(atTheSave);

        vi.advanceTimersByTime(10_000);
        expect(actions.persistQueue).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['the page is left', () => window.dispatchEvent(new Event('pagehide'))],
        ['the page is hidden', () => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
            delete (document as { visibilityState?: unknown }).visibilityState;
        }],
    ])('makes a save still waiting at once when %s, and not again when its time comes', async (_case, leave) => {
        const actions = render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        const first = await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        vi.advanceTimersByTime(500);
        await playbackB().replaceQueue([dto(d), dto(a)], { expectedVersion: first.version });
        expect(actions.persistQueue).toHaveBeenCalledTimes(1);

        leave();
        expect(actions.persistQueue).toHaveBeenCalledTimes(2);
        expect(vi.mocked(actions.persistQueue).mock.calls[1]).toEqual([a, store().playQueue]);

        vi.advanceTimersByTime(5000);
        expect(actions.persistQueue).toHaveBeenCalledTimes(2);
    });
});

describe('replaceQueue: the notice and the undo', () => {
    it('says which mod replaced the queue, with an undo button, and the undo command is there at once', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        expect(undoCommand.isAvailable?.()).toBe(false);

        await playbackA().replaceQueue([dto(c)], { expectedVersion: versionNow() });

        const notice = useStatusMessageStore.getState().message;
        expect(notice?.text).toBe(i18n.t('mods.queueReplaced', { name: 'mod-a' }));
        expect(notice?.text).toContain('mod-a');
        expect(notice?.actionLabel).toBe(i18n.t('mods.queueReplaceUndo'));
        expect(notice?.actionIcon).toBeDefined();
        expect(typeof notice?.onAction).toBe('function');
        expect(useFoliumQueueUndoStore.getState().modId).toBe('mod-a');
        expect(undoCommand.isAvailable?.()).toBe(true);
    });

    it('puts the queue from before back (the array itself) and Personal FM with it, from the notice', async () => {
        render();
        const original = [a, b];
        usePlaybackStore.setState({ playQueue: original, currentSong: a, isFmMode: true });
        await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        expect(store().isFmMode).toBe(false);

        useStatusMessageStore.getState().message?.onAction?.();

        expect(store().playQueue).toBe(original);
        expect(store().isFmMode).toBe(true);
        expect(useStatusMessageStore.getState().message?.text).toBe(i18n.t('mods.queueReplaceUndone'));
        expect(undoCommand.isAvailable?.()).toBe(false);
    });

    it('does not put FM back once another song is shown', async () => {
        render();
        const original = [a, b];
        usePlaybackStore.setState({ playQueue: original, currentSong: a, isFmMode: true });
        await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        usePlaybackStore.setState({ currentSong: c });

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        expect(store().playQueue).toBe(original);
        expect(store().isFmMode).toBe(false);
    });

    it('does not put FM back during a blend away from the song shown then, though that song is still on screen', async () => {
        render();
        const original = [a, b];
        usePlaybackStore.setState({ playQueue: original, currentSong: a, isFmMode: true });
        await playbackA().replaceQueue([dto(a), dto(c), dto(d)], { expectedVersion: versionNow() });
        // Automix blends from A into C: the picture holds A, the host is on C already.
        usePlaybackStore.setState({ currentSong: c, transitionDisplay: { song: a, lyrics: null, coverUrl: null, duration: 1 } });

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        expect(store().playQueue).toBe(original);
        expect(store().isFmMode).toBe(false);
    });

    it('a run of replacements by one mod is told once, and undone back to before the first', async () => {
        render();
        const original = [a, b];
        usePlaybackStore.setState({ playQueue: original, currentSong: a });
        const { notices, stop } = watchNotices();
        let version = versionNow();
        for (const next of [[c], [d], [c, d]]) {
            version = (await playbackA().replaceQueue(next.map(dto), { expectedVersion: version })).version;
            vi.advanceTimersByTime(1000);
        }
        stop();
        expect(notices).toHaveLength(1);

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        expect(store().playQueue).toBe(original);
    });

    it('two mods replacing in turn are told once; another mod again once 30 seconds have passed', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        const { notices, stop } = watchNotices();
        let version = versionNow();
        version = (await playbackA().replaceQueue([dto(c)], { expectedVersion: version })).version;
        vi.advanceTimersByTime(500);
        version = (await playbackB().replaceQueue([dto(d)], { expectedVersion: version })).version;
        vi.advanceTimersByTime(500);
        version = (await playbackA().replaceQueue([dto(c), dto(d)], { expectedVersion: version })).version;
        expect(notices).toHaveLength(1);
        expect(useFoliumQueueUndoStore.getState().modId).toBe('mod-a');

        vi.advanceTimersByTime(29_000);
        await playbackB().replaceQueue([dto(d), dto(c)], { expectedVersion: version });
        stop();
        expect(notices).toHaveLength(2);
        expect(notices[1].text).toContain('mod-b');
    });

    it('lets go once the queue is changed by anything else, and says there is nothing to undo', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        // A play landing in the new queue swaps one entry for an equal copy: that is no change.
        usePlaybackStore.getState().setPlayQueue([c, { ...a }]);
        expect(undoCommand.isAvailable?.()).toBe(true);

        // The user removes a song.
        const edited = [c];
        usePlaybackStore.getState().setPlayQueue(edited);
        expect(undoCommand.isAvailable?.()).toBe(false);

        expect(await undoCommand.execute('', {} as never)).toBe(false);
        expect(store().playQueue).toBe(edited);
        expect(useStatusMessageStore.getState().message?.text).toBe(i18n.t('mods.queueReplaceUndoGone'));
    });

    it('puts back the queue a restore under way gave up to the replacement, with the FM and the song the restore brought', async () => {
        render();
        // At launch: nothing current, the queue empty. A mod replaces it while the last session is read; the
        // restore then makes its song current and leaves its queue unwritten.
        await playbackA().replaceQueue([dto(c)], { expectedVersion: versionNow() });
        usePlaybackStore.setState({ currentSong: a });
        const remembered = [a, b];
        reportYieldedQueue({ queue: remembered, isFmMode: true, song: a });

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        expect(store().playQueue).toBe(remembered);
        expect(store().isFmMode).toBe(true);
    });

    it('keeps the FM from before the replacement when the restore that gave its queue up leaves FM alone', async () => {
        render();
        usePlaybackStore.setState({ isFmMode: true });
        await playbackA().replaceQueue([dto(c)], { expectedVersion: versionNow() });
        usePlaybackStore.setState({ currentSong: a });
        const remembered = [a, b];
        reportYieldedQueue({ queue: remembered, song: a });

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        expect(store().playQueue).toBe(remembered);
        expect(store().isFmMode).toBe(true);
    });

    it('is not made up by a restore that gives its queue up with no replacement to undo', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [c], currentSong: a });
        reportYieldedQueue({ queue: [a, b], song: a });

        expect(undoCommand.isAvailable?.()).toBe(false);
        expect(await undoCommand.execute('', {} as never)).toBe(false);
        expect(store().playQueue.map(entry => entry.id)).toEqual(['c']);
    });

    it('lets go when the Stage takes the player', async () => {
        render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        expect(undoCommand.isAvailable?.()).toBe(false);
    });

    it('reaches every mod, the replacing one too, as a change that is not its own, and saves at once', async () => {
        const actions = render();
        usePlaybackStore.setState({ playQueue: [a, b], currentSong: a });
        await playbackA().replaceQueue([dto(c), dto(a)], { expectedVersion: versionNow() });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        vi.mocked(actions.persistQueue).mockClear();

        expect(await undoCommand.execute('', {} as never)).toBe(true);
        await flushMicrotasks();

        expect(handler.mock.calls).toEqual([[expect.objectContaining({ length: 2, byThisMod: false })]]);
        expect(actions.persistQueue).toHaveBeenCalledWith(a, store().playQueue);
    });
});
